/**
 * MACH-Compliant Orders API - Unified Order Management
 * 
 * This endpoint consolidates all order functionality:
 * - GET: List orders (replaces user-orders) 
 * - POST: Create orders (replaces submit-order)
 * - PUT: Update orders (replaces update-order)
 */

import { NextRequest, NextResponse } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import { getDbAsync } from "@/lib/db";
import { orders } from "@/lib/db/schema/order";
import { 
  getOrdersByCustomer, 
  getOrderById, 
  createOrder, 
  updateOrderStatus,
  updateOrderShipping 
} from "@/lib/models/mach/orders";
import { 
  getOrdersByCustomerId, 
  insertOrder
} from "@/lib/models/order";
import { eq, desc, and } from "drizzle-orm";
import { authenticateRequest, PERMISSIONS } from "@/lib/auth/unified-auth";
import { sendOrderConfirmationEmail, sendOrderStatusUpdateEmail, type OrderData } from "@/lib/utils/email";
import type { Order, CreateOrderRequest, UpdateOrderRequest } from "@/lib/types/order";
import { getCustomer, createCustomer } from "@/lib/models/mach/customer";
import { processGiftCardsForOrder, orderInvolvesGiftCards } from "@/lib/services/gift-card-fulfillment";
import { resolveGiftCardTenderCents, verifyOrderChargeSufficient, canonicalizeOrderItemsDisplay, MAX_ORDER_LINE_ITEMS } from "@/lib/services/order-pricing";
import { retrievePaymentIntent } from "@/lib/stripe";



/**
 * GET /api/orders - List orders (consolidates user-orders functionality)
 */
export async function GET(request: NextRequest) {
  try {
    const { userId } = await auth();
    const url = new URL(request.url);
    
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 100);
    const offset = parseInt(url.searchParams.get('offset') || '0');
    const status = url.searchParams.get('status');
    const requestedUserId = url.searchParams.get('userId');
    const orderId = url.searchParams.get('orderId');
    const isAdminRequest = url.searchParams.has('admin');

    const db = await getDbAsync();
    
    if (isAdminRequest) {
      // Admin request - requires API key authentication
      const authResult = await authenticateRequest(request, PERMISSIONS.ORDERS_READ);
      if (!authResult.success) {
        return authResult.response!;
      }
    } else if (requestedUserId) {
      // User-specific orders - requires user to be authenticated and match
      if (!userId || requestedUserId !== userId) {
        return NextResponse.json(
          { error: "Unauthorized - can only access your own orders" },
          { status: 403 }
        );
      }
    } else {
      // Public access not allowed without specific auth
      return NextResponse.json(
        { error: "Authentication required. Use ?userId=<id> or admin=true with API key" },
        { status: 401 }
      );
    }

  let query = db.select().from(orders).orderBy(desc(orders.created_at));
    const allOrders = await query;
    let filteredOrders = allOrders;
    
    // Apply filters based on MACH schema
    if (!isAdminRequest && requestedUserId) {
      filteredOrders = filteredOrders.filter(order => order.customer_id === requestedUserId);
    }
    if (orderId) {
      filteredOrders = filteredOrders.filter(order => order.id === orderId);
    }
    if (status) {
      filteredOrders = filteredOrders.filter(order => order.status === status);
    }
    
    const total = filteredOrders.length;
    const paginatedOrders = filteredOrders.slice(offset, offset + limit);
    const hydratedOrders = paginatedOrders.map(hydrateOrder);
    
    const response = {
      data: hydratedOrders,
      meta: {
        total,
        limit,
        offset,
        schema: "mach:order"
      },
      links: {
        self: `/api/orders?limit=${limit}&offset=${offset}`,
        first: `/api/orders?limit=${limit}&offset=0`,
        ...(offset + limit < total && {
          next: `/api/orders?limit=${limit}&offset=${offset + limit}`
        }),
        ...(offset > 0 && {
          prev: `/api/orders?limit=${limit}&offset=${Math.max(0, offset - limit)}`
        }),
        last: `/api/orders?limit=${limit}&offset=${Math.floor(total / limit) * limit}`
      }
    };
    return NextResponse.json(response);

  } catch (error) {
    console.error('Orders API error:', error);
    return NextResponse.json(
      { error: 'Failed to retrieve orders' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/orders - Create order (consolidates submit-order functionality)
 */
export async function POST(request: NextRequest) {
  try {
    const { userId } = await auth();
    const body = await request.json() as CreateOrderRequest;
    
    // Validate required fields

    // Validate MACH-compliant order fields
    if (!body.items || !Array.isArray(body.items) || body.items.length === 0) {
      return NextResponse.json({
        error: 'Validation failed',
        details: ['items array is required and must not be empty']
      }, { status: 400 });
    }
    // M6: bound the line count before it drives one catalog lookup per item in
    // the charge-verification step below.
    if (body.items.length > MAX_ORDER_LINE_ITEMS) {
      return NextResponse.json({
        error: 'Validation failed',
        details: [`items array must not exceed ${MAX_ORDER_LINE_ITEMS} lines`]
      }, { status: 400 });
    }
    if (!body.total_amount || typeof body.total_amount.amount !== 'number') {
      return NextResponse.json({
        error: 'Validation failed',
        details: ['total_amount is required and must be a Money object']
      }, { status: 400 });
    }
    if (!body.currency_code) {
      return NextResponse.json({
        error: 'Validation failed',
        details: ['currency_code is required']
      }, { status: 400 });
    }

    // Generate order ID — honor a client-provided id so it matches the id used
    // in the Stripe payment-intent metadata (keeps the webhook able to find the
    // order). Fall back to generating one for older clients.
    const now = Date.now();
    let baseId = userId ?? "guest";
    if (baseId.includes("@")) baseId = baseId.split("@")[0];
    const safeUserId = baseId.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
    const providedId = typeof (body as any).order_id === "string" ? (body as any).order_id : undefined;
    // Constrain client-supplied ids to the known WEB-<user>-<ts> shape so a
    // client can't inject arbitrary identifiers. Primary-key uniqueness stops
    // collisions (a duplicate insert fails), and gift card fulfillment further
    // verifies the id is bound to the matching Stripe PaymentIntent.
    if (providedId && !/^WEB-[A-Z0-9]+-\d+$/.test(providedId)) {
      return NextResponse.json({
        error: 'Validation failed',
        details: ['order_id has an invalid format']
      }, { status: 400 });
    }
    // Bind the client-supplied id to this caller's own user segment so a user
    // can't create orders inside another user's id namespace.
    if (providedId && !providedId.startsWith(`WEB-${safeUserId}-`)) {
      return NextResponse.json({
        error: 'Validation failed',
        details: ['order_id does not match the authenticated user']
      }, { status: 400 });
    }
    const orderId = providedId || `WEB-${safeUserId}-${now}`;

    const db = await getDbAsync();
    
    // Handle customer_id - ensure there's a valid customer record or null for guest orders
    let customerId = userId || body.customer_id || null;
    if (customerId === "guest") {
      customerId = null;
    }
    
    // If we have a customer ID, make sure the customer exists in the database
    if (customerId) {
      try {
        let customer = await getCustomer(customerId);
        if (!customer) {
          // Create a customer record if it doesn't exist
          const user = await currentUser();
          customer = await createCustomer({
            id: customerId,
            type: "person",
            person: {
              email: user?.emailAddresses?.[0]?.emailAddress || body.extensions?.email || '',
              first_name: user?.firstName || '',
              last_name: user?.lastName || '',
              full_name: user ? `${user.firstName || ''} ${user.lastName || ''}`.trim() : '',
            }
          });
        }
      } catch (error) {
        console.error('Error handling customer record:', error);
        // If customer creation fails, proceed as guest order
        customerId = null;
      }
    }

    // Verify payment server-side before marking the order paid. We NEVER trust
    // the client's payment_status flag: the order is 'paid' only if Stripe
    // confirms the PaymentIntent succeeded AND it is bound to THIS order. This
    // makes order creation the primary fulfiller (the webhook is a backup), so
    // status no longer depends on a reachable NEXT_PUBLIC_URL. Fail closed to
    // 'pending' on any doubt; the webhook reconciles later.
    const paymentIntentId = (body.extensions as any)?.payment_intent_id;
    let verifiedPi: Awaited<ReturnType<typeof retrievePaymentIntent>> | null = null;
    // SECURITY (BMC-131 / C1): paymentConfirmed starts false and is set true
    // ONLY as the very last step, after every check has passed. It must never be
    // set true up front and cleared on failure: a throw anywhere in the block
    // (Stripe retrieval, a transient D1 error while pricing the catalog, a
    // gift-card lookup) then falls into the catch and leaves it at its default
    // false — the order fails closed to 'pending' by construction, not by luck.
    let paymentConfirmed = false;
    // Gift-card tender (cents) that the sufficiency decision counted on. Kept in
    // the outer scope so the fulfillment step below can detect a tender that was
    // credited to the paid decision but never actually redeemed (H1).
    let giftCardTenderCents = 0;
    // M4: set when a genuinely-captured payment can't be reconciled because the
    // catalog can't price the order (e.g. a variant was discontinued between
    // capture and order creation). Distinguishes a legit paid-but-stuck order
    // from an ordinary abandoned/underpaid 'pending' so ops can triage it.
    let reviewNote: string | null = null;
    if (paymentIntentId && typeof paymentIntentId === 'string') {
      try {
        verifiedPi = await retrievePaymentIntent(paymentIntentId);
        const piSucceededAndBound =
          verifiedPi.status === 'succeeded' && verifiedPi.metadata?.orderId === orderId;
        if (!piSucceededAndBound) {
          console.warn(
            `Order ${orderId}: PaymentIntent ${paymentIntentId} not confirmed ` +
              `(status=${verifiedPi.status}, boundOrder=${verifiedPi.metadata?.orderId ?? 'none'}); leaving order pending`
          );
        } else {
          // BMC-131: a succeeded, order-bound PaymentIntent is necessary but NOT
          // sufficient. Re-verify that the cash actually collected covers the
          // catalog value of the goods (never the client-supplied total/unit
          // prices). Without this a shopper could pay a $0.50 PaymentIntent and
          // submit an order for expensive items. Use ONLY amount_received (the
          // captured amount), never the authorized pi.amount. Fail closed to
          // 'pending' on any shortfall; the webhook re-runs the same check.
          const paidAmountCents = verifiedPi.amount_received ?? 0;
          giftCardTenderCents = await resolveGiftCardTenderCents(body.extensions);
          const charge = await verifyOrderChargeSufficient({
            items: body.items as any,
            paidAmountCents,
            giftCardTenderCents,
          });
          if (charge.ok) {
            paymentConfirmed = true;
          } else {
            console.warn(
              `Order ${orderId}: PaymentIntent ${paymentIntentId} amount check failed; leaving order pending — ${charge.reason}`
            );
            // M4: real money was captured but the catalog couldn't price the
            // order — a legit customer stuck, not an underpayment attack. Flag
            // for manual review instead of silently parking it as 'pending'.
            if (paidAmountCents > 0 && charge.reason?.startsWith('cannot price order from catalog')) {
              reviewNote =
                `NEEDS REVIEW (BMC-131): captured ${paidAmountCents}c but the catalog could not price ` +
                `this order — ${charge.reason}`;
            }
          }
        }
      } catch (piError) {
        console.error(
          `Order ${orderId}: PaymentIntent ${paymentIntentId} verification failed; leaving order pending`,
          piError
        );
      }
    }

    // M1: overwrite each line's DISPLAY fields (product_name/imageUrl) with
    // catalog truth before persisting, so a spoofed name/image can't make the
    // packing slip or confirmation email describe cheap goods as an expensive
    // product. Never throws (fails soft to the client-supplied display).
    let canonicalItems = body.items;
    try {
      canonicalItems = await canonicalizeOrderItemsDisplay(body.items as any);
    } catch (canonError) {
      console.error(`Order ${orderId}: display canonicalization failed; using client display`, canonError);
    }

    // Encoding contract: total_amount / shipping_address / billing_address /
    // items / external_references / extensions are `mode: "json"` columns —
    // Drizzle serializes them on write and parses on read. Pass the RAW objects;
    // a manual JSON.stringify would double-encode and break json_extract() in SQL.
    const machOrder: any = {
      id: orderId,
      customer_id: customerId,
      status: paymentConfirmed ? 'processing' : 'pending',
      total_amount: body.total_amount,
      currency_code: body.currency_code,
      shipping_address: body.shipping_address ?? null,
      billing_address: body.billing_address ?? null,
      items: canonicalItems,
      shipping_method: body.shipping_method || null,
      payment_method: body.payment_method || null,
      payment_status: paymentConfirmed ? 'paid' : 'pending',
      notes: reviewNote || body.notes || null,
      external_references: body.external_references ?? null,
      extensions: body.extensions ?? null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    // Create the order
    const [newOrder] = await db.insert(orders).values(machOrder).returning();


    // Send order confirmation email (MACH-compliant)
    try {
      const user = await currentUser();
      const shippingAddr = body.shipping_address;
      let customerName = 'Valued Customer';
      if (user?.firstName && user?.lastName) {
        customerName = `${user.firstName} ${user.lastName}`;
      } else if (shippingAddr?.recipient) {
        customerName = shippingAddr.recipient;
      } else if (shippingAddr?.company) {
        customerName = shippingAddr.company;
      }
      const customerEmail = body.extensions?.email || shippingAddr?.email || '';
      const orderData: OrderData = {
        orderNumber: orderId,
        customerName,
        customerEmail,
        items: canonicalItems.map(item => ({
          productId: item.product_id,
          name: item.product_name,
          price: typeof item.unit_price === 'object' ? item.unit_price.amount : item.unit_price,
          quantity: item.quantity,
          imageUrl: (item as any).imageUrl || '',
        })),
        subtotal: body.extensions?.subtotal || 0,
        shipping: body.extensions?.shippingCost || 0,
        tax: body.extensions?.taxAmount || 0,
        total: typeof body.total_amount === 'object' ? body.total_amount.amount : body.total_amount,
        shippingAddress: shippingAddr ? {
          street: [shippingAddr.line1, shippingAddr.line2].filter(Boolean).join(', '),
          city: typeof shippingAddr.city === 'string' ? shippingAddr.city : (shippingAddr.city ? Object.values(shippingAddr.city)[0] : ''),
          state: shippingAddr.region || '',
          zipCode: shippingAddr.postal_code || '',
          country: shippingAddr.country || 'US',
        } : {
          street: '', city: '', state: '', zipCode: '', country: ''
        },
        estimatedDelivery: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toLocaleDateString(),
      };
      const emailResult = await sendOrderConfirmationEmail(orderData);
      if (emailResult.success) {
        console.log('Order confirmation email sent successfully:', emailResult.id);
      } else {
        console.error('Failed to send confirmation email:', emailResult.error);
      }
    } catch (emailError) {
      console.error('Email preparation failed:', emailError);
    }

    // Gift card fulfillment (safety net for the client/webhook race).
    // Security: we do NOT trust any client-supplied paid flag. We retrieve the
    // PaymentIntent from Stripe and verify it actually succeeded and is bound to
    // this order before issuing/redeeming any stored value. Idempotent +
    // order-keyed, so running here and in the webhook is safe.
    const hydratedOrder = hydrateOrder(newOrder);
    if (orderInvolvesGiftCards(hydratedOrder)) {
      try {
        // Reuse the PaymentIntent verified above — no second Stripe round-trip.
        // Stored value is only issued/redeemed once payment is confirmed for
        // THIS order; otherwise defer to the webhook (which re-verifies).
        if (!verifiedPi || !paymentConfirmed) {
          console.warn(`Gift card order ${orderId}: payment not confirmed at creation; deferring fulfillment to webhook`);
        } else {
          // Use ONLY the captured amount. pi.amount is the authorized amount
          // (can exceed what was captured in partial-capture flows), so we
          // must never accept it as proof of full payment — fail closed at 0.
          const paidAmountCents = verifiedPi.amount_received ?? 0;
          const gcResult = await processGiftCardsForOrder(hydratedOrder, { paidAmountCents });
          if (gcResult.issued || gcResult.redeemed) {
            console.log(
              `Gift cards for ${orderId}: issued=${gcResult.issued} redeemed=${gcResult.redeemed}`
            );
          }
          if (gcResult.errors.length) {
            console.error('Gift card fulfillment errors:', gcResult.errors);
          }

          // SECURITY (BMC-131 / H1): the paid decision above credited an
          // UNRESERVED gift-card balance snapshot as tender. If the actual
          // redemption then applied nothing (e.g. two orders raced for the same
          // card and this one lost the balance CAS), the tender never
          // materialized — so the cash we collected does NOT cover the goods.
          // Revert the order to pending rather than fulfilling goods that were
          // only partially paid for.
          const appliedGiftCardCode = (body.extensions as any)?.gift_card?.code;
          if (appliedGiftCardCode && giftCardTenderCents > 0 && gcResult.redeemed === 0) {
            console.error(
              `Order ${orderId}: gift-card tender (${giftCardTenderCents}c) was counted toward payment ` +
                `but redemption applied nothing; reverting order to pending`
            );
            await db
              .update(orders)
              .set({ status: 'pending', payment_status: 'pending', updated_at: new Date().toISOString() })
              .where(eq(orders.id, orderId));
            hydratedOrder.status = 'pending';
            hydratedOrder.payment_status = 'pending';
          }
        }
      } catch (gcError) {
        console.error('Gift card fulfillment failed:', gcError);
      }
    }

    const response = {
      data: hydratedOrder,
      meta: {
        schema: "mach:order"
      }
    };
    return NextResponse.json(response, { status: 201 });

  } catch (error) {
    console.error('Orders API error:', error);
    
    if (error instanceof Error) {
      return NextResponse.json({
        error: 'Validation failed',
        message: error.message
      }, { status: 400 });
    }
    
    return NextResponse.json(
      { error: 'Failed to create order' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/orders - Update order status (consolidates update-order functionality)
 */
export async function PUT(request: NextRequest) {
  try {
    // Authenticate with admin permissions
    const authResult = await authenticateRequest(request, PERMISSIONS.ORDERS_UPDATE);
    if (!authResult.success) {
      return authResult.response!;
    }

    const body = await request.json() as UpdateOrderRequest;

    const { status, payment_status, shipping_method, tracking_number, shipped_at, delivered_at, notes, external_references, extensions } = body;
    const orderId = (body as any).orderId;
    if (!orderId) {
      return NextResponse.json({
        error: 'Validation failed',
        details: ['orderId is required in the request body']
      }, { status: 400 });
    }

    if (!status) {
      return NextResponse.json({
        error: 'Validation failed', 
        details: ['status is required']
      }, { status: 400 });
    }

    // Validate status value (must match schema)
    const validStatuses = ['pending', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded'];
    if (!validStatuses.includes(status)) {
      return NextResponse.json({
        error: `Invalid status. Must be one of: ${validStatuses.join(', ')}`
      }, { status: 400 });
    }

    const db = await getDbAsync();
    
    // Check if order exists
    const existingOrder = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
    if (existingOrder.length === 0) {
      return NextResponse.json({
        error: 'Order not found'
      }, { status: 404 });
    }

    const currentOrder = existingOrder[0];


    // SECURITY (BMC-140): payment_status is intentionally NOT accepted from this
    // client-driven PUT. A caller holding only ORDERS_UPDATE (e.g. a webhook/
    // automation token) could otherwise flip an unpaid order to 'paid' (or
    // 'refunded') with zero Stripe verification. payment_status has exactly
    // three legitimate writers, each of which verifies against Stripe first and
    // none of which is client-controllable:
    //   - order creation (POST /api/orders) via retrievePaymentIntent
    //   - the Stripe webhook's markOrderPaid()
    //   - the refund route (/api/orders/refund), which only sets payment_status
    //     after actually creating a Stripe refund
    // This PUT handler is for fulfillment/tracking updates only, so any client-
    // supplied payment_status is logged and silently dropped rather than applied.
    if (payment_status) {
      console.warn(
        `Order ${orderId}: ignoring client-supplied payment_status="${payment_status}" on PUT ` +
          `(payment_status can only be set via verified payment or the /refund route)`
      );
    }

    // Build update data (MACH-compliant).
    // external_references / extensions are `mode: "json"` columns — pass the RAW
    // objects and let Drizzle serialize; a manual JSON.stringify double-encodes.
    const updateData: any = {
      ...(status && { status }),
      ...(shipping_method && { shipping_method }),
      ...(tracking_number && { tracking_number }),
      ...(shipped_at && { shipped_at }),
      ...(delivered_at && { delivered_at }),
      ...(notes && { notes }),
      ...(external_references && { external_references }),
      ...(extensions && { extensions }),
      updated_at: new Date().toISOString()
    };

    // Update the order
    const [updatedOrder] = await db.update(orders)
      .set(updateData)
      .where(eq(orders.id, orderId))
      .returning();

    // Send email notification for status changes
    const emailStatuses = ['processing', 'shipped', 'delivered', 'cancelled', 'refunded'];
    if (emailStatuses.includes(status) && currentOrder.status !== status) {
      try {
        const orderData = transformOrderForEmail(updatedOrder);
        await sendOrderStatusUpdateEmail(orderData);
        console.log(`Status update email sent for order ${orderId}: ${status}`);
      } catch (emailError) {
        console.error(`Failed to send status update email for order ${orderId}:`, emailError);
      }
    }

    // TODO: Re-implement webhook audit trail in MACH orders model
    // Create webhook record for audit trail
    console.log('Order status update:', {
      orderId,
      previousStatus: currentOrder.status,
      newStatus: status,
      updatedBy: authResult.tokenInfo?.tokenName || 'unknown',
      timestamp: new Date().toISOString(),
    });

    const response = {
      data: hydrateOrder(updatedOrder),
      meta: {
        schema: "mach:order"
      }
    };
    return NextResponse.json(response);

  } catch (error) {
    console.error('Orders API error:', error);
    return NextResponse.json(
      { error: 'Failed to update order' },
      { status: 500 }
    );
  }
}

/**
 * Hydrate order data from MACH database format to Order type
 */
function hydrateOrder(dbOrder: typeof orders.$inferSelect): Order {
  return {
    id: dbOrder.id ?? undefined,
    customer_id: dbOrder.customer_id || undefined,
    status: dbOrder.status,
    total_amount: typeof dbOrder.total_amount === 'string' ? JSON.parse(dbOrder.total_amount) : { amount: 0, currency: dbOrder.currency_code },
    currency_code: dbOrder.currency_code,
    shipping_address: dbOrder.shipping_address ? (typeof dbOrder.shipping_address === 'string' ? JSON.parse(dbOrder.shipping_address) : dbOrder.shipping_address) : undefined,
    billing_address: dbOrder.billing_address ? (typeof dbOrder.billing_address === 'string' ? JSON.parse(dbOrder.billing_address) : dbOrder.billing_address) : undefined,
    items: dbOrder.items ? (typeof dbOrder.items === 'string' ? JSON.parse(dbOrder.items) : dbOrder.items) : [],
    shipping_method: dbOrder.shipping_method ?? undefined,
    payment_method: dbOrder.payment_method ?? undefined,
    payment_status: dbOrder.payment_status ?? 'pending',
    tracking_number: dbOrder.tracking_number ?? undefined,
    shipped_at: dbOrder.shipped_at ?? undefined,
    delivered_at: dbOrder.delivered_at ?? undefined,
    notes: dbOrder.notes ?? undefined,
    external_references: dbOrder.external_references ? (typeof dbOrder.external_references === 'string' ? JSON.parse(dbOrder.external_references) : dbOrder.external_references) : undefined,
    extensions: dbOrder.extensions ? (typeof dbOrder.extensions === 'string' ? JSON.parse(dbOrder.extensions) : dbOrder.extensions) : undefined,
    created_at: dbOrder.created_at ?? undefined,
    updated_at: dbOrder.updated_at ?? undefined
  };
}

/**
 * Transform order data for email notification
 */
function transformOrderForEmail(order: any): any {
  // Use MACH-compliant fields
  const items = order.items ? (typeof order.items === 'string' ? JSON.parse(order.items) : order.items) : [];
  const shippingAddr = order.shipping_address ? (typeof order.shipping_address === 'string' ? JSON.parse(order.shipping_address) : order.shipping_address) : {};
  const extensions = order.extensions ? (typeof order.extensions === 'string' ? JSON.parse(order.extensions) : order.extensions) : {};

  // MACHAddress: line1, line2, city, region, postal_code, country, recipient, company
  let customerName = '';
  if (shippingAddr.recipient) {
    customerName = shippingAddr.recipient;
  } else if (shippingAddr.company) {
    customerName = shippingAddr.company;
  } else {
    customerName = 'Valued Customer';
  }

  return {
    orderNumber: order.id,
    customerName,
    customerEmail: extensions.email || shippingAddr.email || '',
    status: order.status,
    carrier: extensions.carrier,
    trackingNumber: order.tracking_number,
    trackingUrl: extensions.trackingUrl,
    notes: order.notes,
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
