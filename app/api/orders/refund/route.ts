/**
 * === Order Refund API ===
 *
 * Handles Stripe refunds for order cancellations and returns.
 * Processes both full refunds (cancellations) and partial refunds (returns).
 *
 * === Features ===
 * - **Full Refunds**: Complete order cancellation with full amount refund
 * - **Partial Refunds**: Item-level returns with calculated partial amounts
 * - **Stripe Integration**: Direct Stripe refund processing
 * - **Order Updates**: Automatic order status and payment status updates
 * - **Audit Trail**: Comprehensive logging and reason tracking
 *
 * === Security ===
 * - Admin API key authentication required
 * - Payment intent validation
 * - Refund amount verification
 *
 * === Request Format ===
 * ```json
 * {
 *   "orderId": "WEB-USER-123456",
 *   "type": "full" | "partial",
 *   "reason": "requested_by_customer",
 *   "amount"?: number, // Required for partial refunds (in cents)
 *   "items"?: string[], // Required for partial refunds - product IDs
 *   "notes"?: string
 * }
 * ```
 */

import { NextRequest, NextResponse } from 'next/server';
import { getStripeClient } from '@/lib/stripe';
import { getDbAsync } from '@/lib/db';
import { orders } from '@/lib/db/schema/order';
import { eq } from 'drizzle-orm';
import { authenticateRequest, PERMISSIONS } from '@/lib/auth/unified-auth';
import { computeRefundedTotal, assertRefundWithinRemaining, resolveFullRefundAmount } from '@/lib/utils/refund-validation';
import { errorDetails } from '@/lib/utils/error-response';
import { sha256Hex } from '@/lib/auth/crypto';
import { sendOrderStatusUpdateEmail, type OrderStatusUpdateData } from '@/lib/utils/email';

interface RefundRequest {
  orderId: string;
  type: 'full' | 'partial';
  reason: string;
  amount?: number; // For partial refunds (in cents)
  items?: string[]; // For partial refunds - product IDs
  notes?: string;
}

export async function POST(request: NextRequest) {
  try {
    // Authenticate with admin permissions
    const authResult = await authenticateRequest(request, PERMISSIONS.ORDERS_UPDATE);
    if (!authResult.success) {
      return authResult.response!;
    }

    const body = await request.json() as RefundRequest;
    const { orderId, type, reason, amount, items, notes } = body;

    // Validate required fields
    if (!orderId || !type || !reason) {
      return NextResponse.json({
        error: 'Missing required fields: orderId, type, reason'
      }, { status: 400 });
    }

    if (type === 'partial' && (!amount || !items || items.length === 0)) {
      return NextResponse.json({
        error: 'Partial refunds require amount and items'
      }, { status: 400 });
    }

    const db = await getDbAsync();
    
    // Get the order
    const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
    if (!order) {
      return NextResponse.json({
        error: 'Order not found'
      }, { status: 404 });
    }

    // Parse order data
    const extensions = order.extensions ? (typeof order.extensions === 'string' ? JSON.parse(order.extensions) : order.extensions) : {};
    const totalAmount = order.total_amount ? (typeof order.total_amount === 'string' ? JSON.parse(order.total_amount) : order.total_amount) : { amount: 0 };
    
    const paymentIntentId = extensions.payment_intent_id;
    if (!paymentIntentId) {
      return NextResponse.json({
        error: 'No payment intent found for this order'
      }, { status: 400 });
    }

    // Check if order is already cancelled or refunded
    if (order.status === 'cancelled' || order.status === 'refunded') {
      return NextResponse.json({
        error: 'Order is already cancelled or refunded'
      }, { status: 400 });
    }

    // Process Stripe refund
    const stripe = getStripeClient();
    let refundAmount: number;
    let newStatus: string;
    let newPaymentStatus: string;

    if (type === 'full') {
      // Full refund — refund whatever is still outstanding, not the whole
      // order total again. If a prior refund (partial or full) already
      // covers the total, reject with a clean 400 instead of calling
      // Stripe, which would reject the over-refund with a raw 500 (BMC-152).
      const alreadyRefunded = computeRefundedTotal(extensions);
      const fullRefundResolution = resolveFullRefundAmount(totalAmount.amount, alreadyRefunded);
      if (!fullRefundResolution.ok) {
        return NextResponse.json({
          error: fullRefundResolution.error
        }, { status: 400 });
      }
      refundAmount = fullRefundResolution.amount;
      newStatus = 'cancelled';
      newPaymentStatus = 'refunded';
    } else {
      // Partial refund
      refundAmount = amount!;
      newStatus = order.status; // Keep same status for partial refunds
      newPaymentStatus = 'paid'; // Still considered paid since it's partial
      
      // Validate partial refund amount doesn't exceed what's actually left
      // to refund — i.e. total minus everything already recorded in
      // extensions.refunds[], not just the order total in isolation.
      // Stripe would also reject a true over-refund, but we want a clean
      // 400 here instead of surfacing a raw Stripe error (BMC-152).
      const alreadyRefunded = computeRefundedTotal(extensions);
      const refundCheck = assertRefundWithinRemaining(totalAmount.amount, alreadyRefunded, refundAmount);
      if (!refundCheck.ok) {
        return NextResponse.json({
          error: refundCheck.error
        }, { status: 400 });
      }
    }

    // BMC-172: deterministic idempotency key so a RETRY of the *same* refund
    // reuses it — Stripe then returns the ORIGINAL refund instead of moving money
    // a second time. This closes the audited double-refund window: if the D1 write
    // below throws AFTER Stripe succeeds (→ 500), the admin's retry passes the
    // "already refunded" guards above (the failed write left the order untouched)
    // and would otherwise issue a SECOND full refund. The key is scoped to the
    // order, refund type/amount, the specific line items, AND the count of refunds
    // already recorded on the order: a failed write leaves that count unchanged so
    // the retry collides (dedupes to one refund), while a genuinely NEW partial
    // refund lands after a successful prior write (higher count) and so gets a
    // distinct key. Hashed to bound the length (Stripe caps keys at 255 chars).
    const priorRefundCount = Array.isArray(extensions.refunds) ? extensions.refunds.length : 0;
    const refundLineKeys = (items ?? []).slice().sort().join(',');
    const idempotencyKey = `refund:${await sha256Hex(
      `${orderId}|${type}|${refundAmount}|${priorRefundCount}|${refundLineKeys}`
    )}`;

    // Create Stripe refund
    let stripeRefund;
    try {
      // Check if we're using regular Stripe SDK or Cloudflare-compatible version
      if ('refunds' in stripe) {
        // Using regular Stripe SDK
        const regularStripe = stripe as any;
        stripeRefund = await regularStripe.refunds.create({
          payment_intent: paymentIntentId,
          amount: refundAmount,
          reason: 'requested_by_customer',
          metadata: {
            orderId,
            refundType: type,
            refundReason: reason,
            ...(items && { refundedItems: items.join(',') })
          }
        }, { idempotencyKey });
      } else {
        // Using Cloudflare-compatible Stripe client
        const stripeCloudflare = stripe as any;
        stripeRefund = await stripeCloudflare.request('POST', '/refunds', {
          payment_intent: paymentIntentId,
          amount: refundAmount,
          reason: 'requested_by_customer',
          metadata: {
            orderId,
            refundType: type,
            refundReason: reason,
            ...(items && { refundedItems: items.join(',') })
          }
        }, { idempotencyKey });
      }
    } catch (stripeError: any) {
      console.error('Stripe refund failed:', stripeError);
      return NextResponse.json({
        error: 'Failed to process refund with Stripe',
        details: errorDetails(stripeError)
      }, { status: 500 });
    }

    // Update order in database
    const updateData: any = {
      status: newStatus,
      payment_status: newPaymentStatus,
      updated_at: new Date().toISOString()
    };

    // Add refund information to extensions
    const updatedExtensions = {
      ...extensions,
      refunds: [
        ...(extensions.refunds || []),
        {
          id: stripeRefund.id,
          amount: refundAmount,
          type,
          reason,
          items: items || [],
          notes: notes || '',
          processed_at: new Date().toISOString(),
          stripe_refund_id: stripeRefund.id
        }
      ]
    };
    // extensions is a `mode: "json"` column — assign the RAW object and let
    // Drizzle serialize; a manual JSON.stringify would double-encode.
    updateData.extensions = updatedExtensions;

    // Add cancellation reason to notes for full cancellations
    if (type === 'full') {
      const currentNotes = order.notes || '';
      const cancellationNote = `CANCELLED: ${reason}${notes ? ` - ${notes}` : ''}`;
      updateData.notes = currentNotes ? `${currentNotes}\n\n${cancellationNote}` : cancellationNote;
    }

    // Update order
    const [updatedOrder] = await db.update(orders)
      .set(updateData)
      .where(eq(orders.id, orderId))
      .returning();

    // Log the refund action
    console.log(`${type.toUpperCase()} refund processed:`, {
      orderId,
      stripeRefundId: stripeRefund.id,
      amount: refundAmount,
      reason,
      items,
      admin: authResult.tokenInfo?.tokenName || 'unknown'
    });

    // BMC-170: notify the customer of the refund/cancellation. Non-blocking and
    // wrapped so a mail failure can never surface as a 500 or roll back the
    // already-processed Stripe refund + D1 write (mirrors PUT /api/orders). A full
    // refund is modeled by this route as a cancellation (status set to 'cancelled'
    // above) → 'cancelled' template; a partial refund leaves the order active but
    // returns money → 'refunded' template. Both cases reuse sendOrderStatusUpdateEmail.
    try {
      const emailStatus = type === 'full' ? 'cancelled' : 'refunded';
      const emailData = buildRefundStatusEmail(updatedOrder, emailStatus);
      await sendOrderStatusUpdateEmail(emailData);
      console.log(`Refund status email sent for order ${orderId}: ${emailStatus}`);
    } catch (emailError) {
      console.error(`Failed to send refund status email for order ${orderId}:`, emailError);
    }

    return NextResponse.json({
      success: true,
      refund: {
        id: stripeRefund.id,
        amount: refundAmount,
        type,
        reason,
        items: items || [],
        processed_at: new Date().toISOString()
      },
      order: {
        id: updatedOrder.id,
        status: updatedOrder.status,
        payment_status: updatedOrder.payment_status
      }
    });

  } catch (error) {
    console.error('Refund processing error:', error);
    return NextResponse.json({
      error: 'Failed to process refund',
      details: errorDetails(error)
    }, { status: 500 });
  }
}

/**
 * Build the status-update email payload for a refunded/cancelled order.
 *
 * Mirrors transformOrderForEmail() in app/api/orders/route.ts, but takes the
 * email status explicitly: a partial refund does not change the order's stored
 * status, yet the customer still needs a 'refunded' notification. `order` is the
 * post-write row; its JSON columns arrive already parsed (mode:"json"), but we
 * parse defensively in case a raw string ever slips through.
 */
function buildRefundStatusEmail(
  order: typeof orders.$inferSelect,
  status: 'cancelled' | 'refunded'
): OrderStatusUpdateData {
  const parse = (value: unknown): any =>
    typeof value === 'string' ? JSON.parse(value) : value;
  const rawItems = order.items ? parse(order.items) : [];
  const items: any[] = Array.isArray(rawItems) ? rawItems : [];
  const shippingAddr = (order.shipping_address ? parse(order.shipping_address) : {}) || {};
  const extensions = (order.extensions ? parse(order.extensions) : {}) || {};

  return {
    orderNumber: order.id ?? '',
    customerName: shippingAddr.recipient || shippingAddr.company || 'Valued Customer',
    customerEmail: extensions.email || shippingAddr.email || '',
    status,
    carrier: extensions.carrier,
    trackingNumber: order.tracking_number ?? undefined,
    trackingUrl: extensions.trackingUrl,
    notes: order.notes ?? undefined,
    cancellationReason: extensions.cancellationReason,
    items: items.map((item: any) => ({
      productId: item.product_id || item.id,
      name: item.product_name || item.name || item.title,
      price: item.unit_price?.amount || item.unit_price || item.price || 0,
      quantity: item.quantity || 1,
      imageUrl: item.imageUrl || '',
    })),
    shippingAddress: {
      street: [shippingAddr.line1, shippingAddr.line2].filter(Boolean).join(', '),
      city: shippingAddr.city || '',
      state: shippingAddr.region || '',
      zipCode: shippingAddr.postal_code || '',
      country: shippingAddr.country || 'US',
    },
  };
}