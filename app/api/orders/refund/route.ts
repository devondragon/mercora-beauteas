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
 * === Write ordering & concurrency (BMC-193 + review) ===
 * The refund ledger lives in the `orders.extensions.refunds[]` JSON column. The
 * reconcile-vs-reserve DECISION is a pure, unit-tested helper
 * (`lib/payments/refund-ledger.ts` → `decideRefundLedgerAction`); this route is
 * only the D1/Stripe plumbing around it. Three gaps are closed here:
 *   1. **Write-ordering.** A `pending` ledger entry (carrying the deterministic
 *      idempotency key) is reserved BEFORE the Stripe call, then flipped to
 *      `succeeded`/`failed` after. A Stripe-success / D1-failure therefore leaves
 *      a recoverable `pending` entry (already counted in the refunded total, so
 *      no over-refund window) rather than an order that looks un-refunded — a
 *      retry reconciles the pending entry by EXACT idempotency key (not a loose
 *      type+amount+items heuristic, which could collapse a genuinely-new refund
 *      into a stuck pending) and reuses its key so Stripe dedupes.
 *   2. **Lost updates.** Every ledger write is an optimistic-concurrency CAS
 *      guarded on BOTH `updated_at` AND a monotonic `extensions.refunds_version`
 *      integer (bumped on every write) — the version disambiguates two writers
 *      that share a millisecond `updated_at`. A lost race re-reads and retries.
 *      D1 has no interactive transactions, so this guarded read-modify-write is
 *      how two concurrent distinct partial refunds both land without silently
 *      dropping one entry (which would corrupt computeRefundedTotal).
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
import { and, eq, isNull, sql } from 'drizzle-orm';
import { authenticateRequest, PERMISSIONS } from '@/lib/auth/unified-auth';
import { type RefundRecord } from '@/lib/utils/refund-validation';
import { errorDetails } from '@/lib/utils/error-response';
import { decideRefundLedgerAction } from '@/lib/payments/refund-ledger';
import { sendOrderStatusUpdateEmail, type OrderStatusUpdateData } from '@/lib/utils/email';
import { restockForOrder, selectRestockLines } from '@/lib/services/inventory-adjustment';
import { Money } from '@/lib/money';
import { logCritical } from '@/lib/utils/observe';

interface RefundRequest {
  orderId: string;
  type: 'full' | 'partial';
  reason: string;
  amount?: number; // For partial refunds (in cents)
  items?: string[]; // For partial refunds - product IDs
  notes?: string;
}

/** Bounded CAS retries on the ledger column before we give up with a 409. */
const MAX_CAS_ATTEMPTS = 5;

/** Parse a `mode:"json"` column that may arrive already-parsed or as a string. */
function parseJson(value: unknown): any {
  return typeof value === 'string' ? JSON.parse(value) : value;
}

/**
 * The `updated_at` half of a CAS guard. `updated_at` can be NULL on legacy rows,
 * and `= NULL` never matches in SQL, so route those to `IS NULL`.
 */
function updatedAtGuard(value: string | null) {
  return value === null ? isNull(orders.updated_at) : eq(orders.updated_at, value);
}

/**
 * Monotonic version half of the CAS guard (BMC-193 review, Finding 2). The
 * `updated_at` timestamp is millisecond-resolution ISO text, so two writes in
 * the same millisecond could theoretically share it and both pass an
 * `updated_at`-only CAS. `extensions.refunds_version` is an integer bumped on
 * EVERY ledger write, so it disambiguates same-millisecond writers: a lost
 * racer reads the stale version and its `COALESCE(json_extract(...),0) = <read>`
 * predicate no longer matches once the winner has incremented it. Legacy rows
 * (no `refunds_version`) read as 0 via COALESCE; the first write bumps them to 1.
 * Kept as a single atomic UPDATE statement (no schema migration needed).
 */
function refundsVersionGuard(version: number) {
  return sql`COALESCE(json_extract(${orders.extensions}, '$.refunds_version'), 0) = ${version}`;
}

/** Current refund-ledger version on a parsed extensions object (default 0). */
function readRefundsVersion(extensions: any): number {
  const v = extensions?.refunds_version;
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
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
    const refundedItemKeys = items ?? [];

    // ── Phase 1: reserve a `pending` ledger entry (CAS) ──────────────────────
    // Re-reads the order each attempt so validation runs against fresh ledger
    // state (a concurrent refund may have consumed some remaining balance). Emits
    // the pending entry BEFORE Stripe so a later crash is recoverable, and
    // reconciles an already-pending entry from an interrupted prior attempt
    // instead of issuing a second refund.
    let reservation:
      | { idempotencyKey: string; refundAmount: number; entryId: string; reused: boolean }
      | null = null;
    let paymentIntentId: string | undefined;
    let newStatus: string = type;
    let newPaymentStatus: string = 'paid';

    for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
      const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
      if (!order) {
        return NextResponse.json({ error: 'Order not found' }, { status: 404 });
      }

      const extensions = order.extensions ? (parseJson(order.extensions) ?? {}) : {};
      const totalAmount = order.total_amount ? (parseJson(order.total_amount) ?? { amount: 0 }) : { amount: 0 };
      const refunds: RefundRecord[] = Array.isArray(extensions.refunds) ? extensions.refunds : [];
      const version = readRefundsVersion(extensions);

      paymentIntentId = extensions.payment_intent_id;
      if (!paymentIntentId) {
        return NextResponse.json({ error: 'No payment intent found for this order' }, { status: 400 });
      }

      // Already fully resolved (a concurrent full refund may have cancelled it).
      if (order.status === 'cancelled' || order.status === 'refunded') {
        return NextResponse.json({ error: 'Order is already cancelled or refunded' }, { status: 400 });
      }

      // Pure decision: reconcile an existing `pending` entry (a retry of an
      // interrupted refund — matched by EXACT idempotency key, Finding 1) or
      // reserve a brand-new one. All the amount/validation math lives in the
      // helper so it is unit-tested under tests/unit/** (the CI-gated suite).
      const decision = await decideRefundLedgerAction(refunds, {
        orderId,
        type,
        amount,
        items: refundedItemKeys,
        totalAmount: totalAmount.amount ?? 0,
      });

      if (decision.action === 'reject') {
        return NextResponse.json({ error: decision.error }, { status: decision.status });
      }

      if (decision.action === 'reconcile') {
        // The `pending` entry (from an interrupted prior attempt) is already
        // reserved and counted in the refunded total — no write here, just carry
        // its idempotency key into the Stripe call so Stripe dedupes.
        const entry: any = refunds[decision.entryIndex];
        reservation = {
          idempotencyKey: decision.idempotencyKey,
          refundAmount: decision.refundAmount,
          entryId: (entry?.id as string) ?? decision.idempotencyKey,
          reused: true,
        };
        newStatus = type === 'full' ? 'cancelled' : order.status;
        newPaymentStatus = type === 'full' ? 'refunded' : 'paid';
        break;
      }

      // Reserve a new `pending` entry BEFORE Stripe (write-ordering).
      const { idempotencyKey, refundAmount } = decision;
      newStatus = type === 'full' ? 'cancelled' : order.status;
      newPaymentStatus = type === 'full' ? 'refunded' : 'paid';

      const nowIso = new Date().toISOString();
      const pendingEntry = {
        id: idempotencyKey,
        status: 'pending' as const,
        amount: refundAmount,
        type,
        reason,
        items: refundedItemKeys,
        notes: notes || '',
        idempotency_key: idempotencyKey,
        created_at: nowIso,
      };
      const nextExtensions = {
        ...extensions,
        refunds: [...refunds, pendingEntry],
        refunds_version: version + 1,
      };

      // CAS: only commit if the row is unchanged since we read it — guarded on
      // BOTH updated_at and the monotonic refunds_version (Finding 2).
      const [row] = await db.update(orders)
        .set({ extensions: nextExtensions, updated_at: nowIso })
        .where(and(
          eq(orders.id, orderId),
          updatedAtGuard(order.updated_at ?? null),
          refundsVersionGuard(version),
        ))
        .returning();

      if (row) {
        reservation = { idempotencyKey, refundAmount, entryId: idempotencyKey, reused: false };
        break;
      }
      // Lost the CAS race — a concurrent write landed first; re-read and retry.
    }

    if (!reservation) {
      return NextResponse.json({
        error: 'Refund could not be recorded due to concurrent updates; please retry'
      }, { status: 409 });
    }

    const { idempotencyKey, refundAmount, entryId } = reservation;

    // ── Phase 2: create the Stripe refund ────────────────────────────────────
    const stripe = getStripeClient();
    let stripeRefund;
    try {
      const refundParams = {
        payment_intent: paymentIntentId,
        amount: refundAmount,
        reason: 'requested_by_customer' as const,
        metadata: {
          orderId,
          refundType: type,
          refundReason: reason,
          ...(items && { refundedItems: items.join(',') })
        }
      };
      // Check if we're using regular Stripe SDK or Cloudflare-compatible version
      if ('refunds' in stripe) {
        const regularStripe = stripe as any;
        stripeRefund = await regularStripe.refunds.create(refundParams, { idempotencyKey });
      } else {
        const stripeCloudflare = stripe as any;
        stripeRefund = await stripeCloudflare.request('POST', '/refunds', refundParams, { idempotencyKey });
      }
    } catch (stripeError: any) {
      console.error('Stripe refund failed:', stripeError);
      // The customer's money was NOT returned (Stripe declined / errored / timed
      // out). Broken money path — alert, don't just log.
      logCritical('refund', 'stripe_refund_create_failed', { orderId }, stripeError);
      // Release the reservation (flip pending → failed) so it stops counting
      // toward the refunded total and a corrected retry isn't blocked.
      await settleRefundEntry(db, orderId, entryId, () => 'failed');
      return NextResponse.json({
        error: 'Failed to process refund with Stripe',
        details: errorDetails(stripeError)
      }, { status: 500 });
    }

    // ── Phase 3: settle the ledger entry (CAS) + apply order-level effects ────
    // BMC-178: restock is decided from the FRESH order read inside the CAS loop,
    // so the "already restocked" record commits atomically with the settled
    // refund entry. A FULL refund restores every not-yet-restocked line; a
    // PARTIAL refund restores only the refunded lines. selectRestockLines
    // excludes any line a prior refund already restocked.
    let updatedOrder: typeof orders.$inferSelect | undefined;
    let restockItems: any[] = [];

    for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
      const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
      if (!order) {
        // Money is already refunded; a vanished order is unrecoverable here.
        console.error(`Refund settled at Stripe but order ${orderId} disappeared before ledger flip`);
        logCritical('refund', 'settled_but_order_missing', { orderId });
        return NextResponse.json({ error: 'Order not found while settling refund' }, { status: 500 });
      }

      const extensions = order.extensions ? (parseJson(order.extensions) ?? {}) : {};
      const refunds: any[] = Array.isArray(extensions.refunds) ? extensions.refunds : [];
      const version = readRefundsVersion(extensions);
      const idx = refunds.findIndex((r: any) => r?.id === entryId || r?.idempotency_key === idempotencyKey);

      // Finding 4: the reserved `pending` entry should always be present here
      // (Phase 1 wrote it, or reconciled one that exists). If it is somehow gone
      // (idx < 0) — a defensive, effectively-unreachable branch — do NOT blindly
      // append: a settled entry carrying this idempotency key / Stripe refund id
      // may already exist (a concurrent settle or a prior retry), and appending
      // again would DOUBLE-COUNT the refund in computeRefundedTotal. Detect that
      // and no-op instead. Only append if truly nothing for this refund exists.
      if (idx < 0) {
        const alreadySettled = refunds.some((r: any) =>
          r?.status === 'succeeded' &&
          (r?.idempotency_key === idempotencyKey || r?.stripe_refund_id === stripeRefund.id)
        );
        if (alreadySettled) {
          console.warn(`Refund ${idempotencyKey} already settled on order ${orderId}; skipping duplicate ledger append`);
          updatedOrder = order;
          restockItems = [];
          break;
        }
      }

      const nowIso = new Date().toISOString();
      const settledEntry = {
        ...(idx >= 0 ? refunds[idx] : {}),
        id: stripeRefund.id,
        status: 'succeeded' as const,
        amount: refundAmount,
        type,
        reason,
        items: items || [],
        notes: notes || '',
        idempotency_key: idempotencyKey,
        stripe_refund_id: stripeRefund.id,
        processed_at: nowIso,
      };
      const nextRefunds = idx >= 0
        ? refunds.map((r: any, i: number) => (i === idx ? settledEntry : r))
        : [...refunds, settledEntry];

      const rawItems = order.items ? parseJson(order.items) : [];
      const orderItems: any[] = Array.isArray(rawItems) ? rawItems : [];
      const priorRestockedKeys: string[] = Array.isArray(extensions.restockedLineKeys)
        ? extensions.restockedLineKeys
        : [];
      const { lines: restockLines, keys: newlyRestockedKeys } = selectRestockLines(orderItems, {
        fullRefund: type === 'full',
        refundedItemKeys,
        alreadyRestockedKeys: priorRestockedKeys,
      });

      const nextExtensions = {
        ...extensions,
        refunds: nextRefunds,
        // Deduped union of lines restored so far so a later refund won't restock
        // them again (see selectRestockLines).
        restockedLineKeys: Array.from(new Set([...priorRestockedKeys, ...newlyRestockedKeys])),
        refunds_version: version + 1,
      };

      // extensions is a `mode: "json"` column — assign the RAW object and let
      // Drizzle serialize; a manual JSON.stringify would double-encode.
      const updateData: Record<string, unknown> = {
        status: newStatus,
        payment_status: newPaymentStatus,
        extensions: nextExtensions,
        updated_at: nowIso,
      };

      // Add cancellation reason to notes for full cancellations
      if (type === 'full') {
        const currentNotes = order.notes || '';
        const cancellationNote = `CANCELLED: ${reason}${notes ? ` - ${notes}` : ''}`;
        updateData.notes = currentNotes ? `${currentNotes}\n\n${cancellationNote}` : cancellationNote;
      }

      const [row] = await db.update(orders)
        .set(updateData)
        .where(and(
          eq(orders.id, orderId),
          updatedAtGuard(order.updated_at ?? null),
          refundsVersionGuard(version),
        ))
        .returning();

      if (row) {
        updatedOrder = row;
        restockItems = restockLines;
        break;
      }
      // Lost the CAS race — re-read and retry the settle.
    }

    if (!updatedOrder) {
      // Stripe refunded but we exhausted CAS retries writing the ledger. The
      // pending entry (still counted) preserves the ledger, and a retry will
      // reconcile it — surface a 500 so the caller knows to retry.
      console.error(`Refund settled at Stripe but ledger flip failed after ${MAX_CAS_ATTEMPTS} attempts for order ${orderId}`);
      logCritical('refund', 'settled_but_ledger_flip_failed', { orderId, attempts: MAX_CAS_ATTEMPTS });
      return NextResponse.json({
        error: 'Refund processed but order update failed due to concurrent updates; please retry'
      }, { status: 500 });
    }

    // BMC-178: now actually restore on-hand stock for the selected lines (the
    // inverse of the decrement at payment success). Best-effort and wrapped: the
    // money is already refunded and the order already written (including the
    // restockedLineKeys record), so an inventory hiccup here must never surface
    // as a 500 or unwind the refund.
    try {
      if (restockItems.length > 0) {
        const { restocked } = await restockForOrder(restockItems);
        if (restocked.length) {
          console.log(`Restocked ${restocked.length} variant(s) for ${type} refund on order ${orderId}`);
        }
      }
    } catch (restockError) {
      console.error(`Failed to restock inventory for ${type} refund on order ${orderId}:`, restockError);
    }

    // Log the refund action
    console.log(`${type.toUpperCase()} refund processed:`, {
      orderId,
      stripeRefundId: stripeRefund.id,
      amount: refundAmount,
      reason,
      items,
      admin: authResult.tokenInfo?.tokenName || 'unknown'
    });

    // BMC-170: notify the customer of the refund. Non-blocking and wrapped so a
    // mail failure can never surface as a 500 or roll back the already-processed
    // Stripe refund + D1 write (mirrors PUT /api/orders). This is the refund
    // endpoint, so money always comes back — BOTH full and partial refunds use the
    // 'refunded' template. A full refund also cancels the order, so we flag it
    // (isFullRefund) to add a "will not be shipped" line, and we always surface
    // the refunded amount (remaining for full, partial amount for partial).
    try {
      const refundAmountFormatted = Money.fromMinor(refundAmount, updatedOrder.currency_code).format();
      const emailData = buildRefundStatusEmail(updatedOrder, {
        isFullRefund: type === 'full',
        refundAmount: refundAmountFormatted,
      });
      // sendOrderStatusUpdateEmail() swallows Resend errors and returns
      // { success:false } rather than throwing, so inspect the result instead of
      // logging success unconditionally.
      const emailResult = await sendOrderStatusUpdateEmail(emailData);
      if (emailResult.success) {
        console.log(`Refund status email sent for order ${orderId}: refunded (${refundAmountFormatted})`);
      } else {
        console.error(`Failed to send refund status email for order ${orderId}: ${emailResult.error}`);
      }
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
    logCritical('refund', 'processing_failed', {}, error);
    return NextResponse.json({
      error: 'Failed to process refund',
      details: errorDetails(error)
    }, { status: 500 });
  }
}

/**
 * Flip a reserved `pending` ledger entry to a terminal status via a CAS loop.
 * Used only for the Stripe-failure path (→ 'failed'); the success path settles
 * inline because it also applies restock + order-status effects. Best-effort:
 * a swallowed final failure leaves the entry `pending` (still counted, so no
 * over-refund), which a later retry reconciles.
 */
async function settleRefundEntry(
  db: Awaited<ReturnType<typeof getDbAsync>>,
  orderId: string,
  entryId: string,
  nextStatus: (entry: any) => 'succeeded' | 'failed'
): Promise<void> {
  for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
    const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
    if (!order) return;

    const extensions = order.extensions ? (parseJson(order.extensions) ?? {}) : {};
    const refunds: any[] = Array.isArray(extensions.refunds) ? extensions.refunds : [];
    const version = readRefundsVersion(extensions);
    const idx = refunds.findIndex((r: any) => r?.id === entryId || r?.idempotency_key === entryId);
    if (idx < 0) return; // nothing to settle (already reconciled)

    const status = nextStatus(refunds[idx]);
    const nowIso = new Date().toISOString();
    const settledEntry = {
      ...refunds[idx],
      status,
      ...(status === 'failed' ? { failed_at: nowIso } : { processed_at: nowIso }),
    };
    const nextExtensions = {
      ...extensions,
      refunds: refunds.map((r: any, i: number) => (i === idx ? settledEntry : r)),
      refunds_version: version + 1,
    };

    const [row] = await db.update(orders)
      .set({ extensions: nextExtensions, updated_at: nowIso })
      .where(and(
        eq(orders.id, orderId),
        updatedAtGuard(order.updated_at ?? null),
        refundsVersionGuard(version),
      ))
      .returning();
    if (row) return;
    // Lost the CAS race — re-read and retry.
  }
  console.error(`Failed to settle refund ledger entry ${entryId} on order ${orderId} after ${MAX_CAS_ATTEMPTS} attempts`);
}

/**
 * Build the status-update email payload for a refunded order.
 *
 * Mirrors transformOrderForEmail() in app/api/orders/route.ts. Always uses the
 * 'refunded' status (this is the refund endpoint — money always comes back), and
 * carries the formatted refund amount plus an `isFullRefund` flag: a full refund
 * also cancels the order (→ "will not be shipped" line), while a partial refund
 * leaves the order active. `order` is the post-write row; its JSON columns arrive
 * already parsed (mode:"json"), but we parse defensively in case a raw string ever
 * slips through.
 */
function buildRefundStatusEmail(
  order: typeof orders.$inferSelect,
  opts: { isFullRefund: boolean; refundAmount: string }
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
    status: 'refunded',
    refundAmount: opts.refundAmount,
    orderCancelled: opts.isFullRefund,
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
