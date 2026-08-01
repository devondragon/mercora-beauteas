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
  createOrder
} from "@/lib/models/mach/orders";
import { eq, desc, and } from "drizzle-orm";
import { authenticateRequest, PERMISSIONS } from "@/lib/auth/unified-auth";
import type { Order, CreateOrderRequest, UpdateOrderRequest } from "@/lib/types/order";
import { getCustomer, createCustomer } from "@/lib/models/mach/customer";
import { canonicalizeOrderItemsDisplay, MAX_ORDER_LINE_ITEMS } from "@/lib/services/order-pricing";
import { computeExpectedChargeExtras } from "@/lib/services/checkout-charges";
import { normalizeDiscountCodes, MAX_DISCOUNT_CODES, MAX_RAW_DISCOUNT_CODES } from "@/lib/services/discount-pricing";
import { finalizePaidOrder } from "@/lib/services/order-finalization";
import { retrievePaymentIntent } from "@/lib/stripe";
import { Money } from "@/lib/money";
import { toWireOrder } from "@/lib/utils/order-wire";
import { isUniqueViolation } from "@/lib/utils/db-errors";
import {
  validatePutOrderBody,
  mergeExtensions,
  mergeExternalReferences,
} from "@/lib/utils/order-update-guards";
import { logCritical } from "@/lib/utils/observe";



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
    // BMC-167 (M1): the storefront now persists an UNPAID `pending` order at
    // PaymentIntent creation, so every abandoned checkout-past-shipping leaves a
    // phantom draft. Exclude those unpaid drafts from operational list reads by
    // default so they don't pollute the admin fulfillment queue or a customer's
    // order history. An admin can still see them with ?includePending=true, and a
    // direct ?orderId= lookup always returns the exact order regardless.
    const includePending = url.searchParams.has('includePending');

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
    // Hide unpaid drafts (BMC-167 M1) unless explicitly requested or a specific
    // order is being looked up by id.
    if (!includePending && !orderId) {
      filteredOrders = filteredOrders.filter(order => order.payment_status !== 'pending');
    }

    const total = filteredOrders.length;
    const paginatedOrders = filteredOrders.slice(offset, offset + limit);
    const hydratedOrders = paginatedOrders.map(hydrateOrder);

    const response = {
      // BMC-164: MACH wire shape at the response boundary only.
      data: hydratedOrders.map(toWireOrder),
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

    // JSON.parse('null') / a non-object body doesn't throw a SyntaxError, so the
    // field checks below would throw a TypeError that the catch misclassifies as
    // a system fault (spurious 500 + page). Reject a non-object body as a client
    // 400 up front (BMC-168 review).
    if (!body || typeof body !== 'object') {
      return NextResponse.json({
        error: 'Validation failed',
        details: ['request body must be a JSON object']
      }, { status: 400 });
    }

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
    // Bound the persisted cart-discount codes the same way /api/payment-intent
    // does — this route is reachable pre-auth, so an unbounded `discount_codes`
    // array would otherwise be stored verbatim into the D1 `extensions` JSON and
    // drive a burst of coupon lookups at finalization. Bound the RAW array before
    // the dedup pass, then enforce the deduped limit (BMC-177 review).
    const rawDiscountCodes = (body.extensions as { discount_codes?: unknown })?.discount_codes;
    if (
      (Array.isArray(rawDiscountCodes) && rawDiscountCodes.length > MAX_RAW_DISCOUNT_CODES) ||
      normalizeDiscountCodes(rawDiscountCodes as string[] | undefined).length > MAX_DISCOUNT_CODES
    ) {
      return NextResponse.json({
        error: 'Validation failed',
        details: [`discount_codes must not exceed ${MAX_DISCOUNT_CODES} codes`]
      }, { status: 400 });
    }
    if (
      !body.total_amount ||
      typeof body.total_amount.amount !== 'number' ||
      !Number.isInteger(body.total_amount.amount)
    ) {
      return NextResponse.json({
        error: 'Validation failed',
        details: ['total_amount is required and must be a Money object with an integer minor-unit amount']
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
    // can't create orders inside another user's id namespace. The GUEST segment
    // is also accepted from an authenticated caller: a redirect checkout
    // (BMC-165) that began as a guest bakes WEB-GUEST-<ts> into its snapshot,
    // and the Clerk session can become authenticated during the multi-minute
    // off-site trip (cookie sync / logging in elsewhere) — rejecting it here
    // would permanently strand the returning order with a 400. This is safe:
    // the guest segment carries no other user's identity, the order_id is still
    // cross-checked against the PaymentIntent metadata before it can be marked
    // paid, and the idempotent-return path re-proves ownership via
    // callerOwnsExistingOrder().
    if (
      providedId &&
      !providedId.startsWith(`WEB-${safeUserId}-`) &&
      !providedId.startsWith('WEB-GUEST-')
    ) {
      return NextResponse.json({
        error: 'Validation failed',
        details: ['order_id does not match the authenticated user']
      }, { status: 400 });
    }
    const orderId = providedId || `WEB-${safeUserId}-${now}`;

    const db = await getDbAsync();

    // BMC-167: the storefront now persists a server-side PENDING order at
    // PaymentIntent creation (POST /api/payment-intent), so by the time this
    // route runs the order row usually already exists. This handler therefore
    // FINDS-AND-PROMOTES rather than blindly inserting: it is the idempotent
    // client fast-path that promotes the SAME pending order the Stripe webhook
    // would otherwise promote — the two converge on exactly one paid order.
    //
    // Three cases:
    //   (a) order exists + already paid  → pure idempotent no-op (return id only)
    //   (b) order exists + still pending → finalize it (verify PI, CAS-promote)
    //   (c) order does not exist         → create it pending (older client that
    //       didn't send the draft, or pending-order persistence failed at PI
    //       creation), then finalize
    let orderRow: typeof orders.$inferSelect | null = null;

    const existing = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
    if (existing.length > 0) {
      // SECURITY: authenticated ids are already namespace-bound to the caller
      // above, but guest orders share the WEB-GUEST-<ts> namespace, so a guessed
      // id must NOT hand back another guest's order. Confirm ownership before
      // touching it, and never echo the persisted order (it carries the shipping
      // address / email / line items) — return only the id.
      if (!callerOwnsExistingOrder(existing[0], userId, body)) {
        return NextResponse.json({ error: 'Order already exists' }, { status: 409 });
      }
      // (a) Already finalized — payment state is owned by the first writer to
      // promote it (client or webhook); never re-touch it here.
      if (existing[0].payment_status === 'paid') {
        return NextResponse.json(
          { data: { id: orderId }, meta: { schema: 'mach:order', idempotent: true } },
          { status: 200 }
        );
      }
      // (b) Owner + still pending → promote it below.
      orderRow = existing[0];
    } else {
      // (c) No pending order for this id — create one now so this path still
      // yields exactly one order.
      // Handle customer_id — ensure there's a valid customer record or null for
      // guest orders.
      let customerId = userId || body.customer_id || null;
      if (customerId === "guest") {
        customerId = null;
      }
      if (customerId) {
        try {
          let customer = await getCustomer(customerId);
          if (!customer) {
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
          customerId = null;
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

      // Bind the PaymentIntent id into external_references too (not just the
      // client-supplied extensions) so getOrderByPaymentIntentId can find it.
      const bodyPaymentIntentId = (body.extensions as any)?.payment_intent_id;
      const externalReferences =
        bodyPaymentIntentId && typeof bodyPaymentIntentId === 'string'
          ? { ...(body.external_references ?? {}), payment_intent_id: bodyPaymentIntentId }
          : body.external_references ?? null;

      // BMC-201: the expected shipping/tax the charge floor enforces are
      // SERVER-authoritative. The standard storefront flow stamps them at
      // PaymentIntent creation (`persistPendingOrder`) and reuses that pre-persisted
      // row on the id collision below — so this fresh-insert branch (c) only runs
      // when NO pending order exists (older client, or a client that deliberately
      // omitted the `order` draft AND `items` at PI creation to skip the floor).
      // For that path we must (1) strip any client-supplied `expected_*_cents` so
      // the field can't be spoofed, and (2) RECOMPUTE it server-side from the
      // catalog items + address, so finalization enforces tax/shipping here too
      // rather than defaulting to a goods-only floor (the bypass). Priceable check
      // fails soft: an unpriceable cart is rejected by the goods charge gate at
      // finalization anyway. This compute is cold-path only (never on the standard
      // pre-persisted flow, which lands in branch (b)).
      let sanitizedExtensions: Record<string, unknown> | null = null;
      if (body.extensions) {
        sanitizedExtensions = { ...(body.extensions as Record<string, unknown>) };
        delete sanitizedExtensions.expected_shipping_cents;
        delete sanitizedExtensions.expected_tax_cents;
      }
      try {
        const draftLines = (Array.isArray(body.items) ? body.items : []).map((it: any) => ({
          product_id: it?.product_id ?? it?.productId,
          variant_id: it?.variant_id ?? it?.variantId,
          quantity: it?.quantity,
        }));
        const extras = await computeExpectedChargeExtras(draftLines, body.shipping_address ?? null);
        if (extras.priceable) {
          sanitizedExtensions = { ...(sanitizedExtensions ?? {}) };
          sanitizedExtensions.expected_shipping_cents = extras.shippingCents;
          sanitizedExtensions.expected_tax_cents = extras.taxCents;
        }
      } catch (chargeError) {
        // Transient failure computing the floor extras — leave them unstamped; the
        // goods charge gate at finalization still fails closed on an unpriceable
        // cart, and a genuine underpayment is caught by goods alone.
        console.error(`Order ${orderId}: failed to compute expected shipping/tax on fresh insert`, chargeError);
      }

      // Encoding contract: total_amount / shipping_address / billing_address /
      // items / external_references / extensions are `mode: "json"` columns —
      // Drizzle serializes them on write and parses on read. Pass the RAW
      // objects; a manual JSON.stringify would double-encode and break
      // json_extract() in SQL. Always persist pending/pending — the paid state
      // is reached only via the guarded promotion below (BMC-167).
      const machOrder: any = {
        id: orderId,
        customer_id: customerId,
        status: 'pending',
        total_amount: Money.fromStored(body.total_amount).toJSON(),
        currency_code: body.currency_code,
        shipping_address: body.shipping_address ?? null,
        billing_address: body.billing_address ?? null,
        items: canonicalItems,
        shipping_method: body.shipping_method || null,
        payment_method: body.payment_method || null,
        payment_status: 'pending',
        notes: body.notes || null,
        external_references: externalReferences,
        extensions: sanitizedExtensions,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      // On a duplicate-id violation, another writer created the row concurrently
      // (a redirect return racing a refresh, or the PI-creation pending order
      // landing between our pre-check and insert). Recover: promote/return the
      // existing row rather than a spurious 400.
      try {
        [orderRow] = await db.insert(orders).values(machOrder).returning();
      } catch (insertError) {
        // Only a duplicate-primary-key/unique violation means the id was created
        // concurrently (the idempotency race). Use the canonical classifier
        // (cause-chain aware, matches ONLY unique/primary-key — never a FK/
        // NOTNULL/CHECK failure) so an unrelated constraint error propagates as a
        // real error instead of being masked as a duplicate.
        if (!isUniqueViolation(insertError)) {
          throw insertError;
        }
        const raced = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
        if (raced.length > 0 && callerOwnsExistingOrder(raced[0], userId, body)) {
          if (raced[0].payment_status === 'paid') {
            return NextResponse.json(
              { data: { id: orderId }, meta: { schema: 'mach:order', idempotent: true } },
              { status: 200 }
            );
          }
          orderRow = raced[0];
        } else if (raced.length > 0) {
          return NextResponse.json({ error: 'Order already exists' }, { status: 409 });
        } else {
          throw insertError;
        }
      }
    }

    // ── Finalize: verify the PaymentIntent server-side, then promote ──────────
    // We NEVER trust the client's payment_status flag: the order becomes 'paid'
    // only if Stripe confirms the PaymentIntent SUCCEEDED and it is bound to THIS
    // order, and the captured cash covers the catalog value of the goods
    // (BMC-131, re-checked inside finalizePaidOrder). Any doubt leaves the order
    // pending; the webhook reconciles later. The promotion is a guarded CAS, so
    // a client-first and a webhook-first arrival converge on ONE paid order with
    // side effects (email, gift cards) firing exactly once.
    const order = hydrateOrder(orderRow);
    const paymentIntentId = (body.extensions as any)?.payment_intent_id;
    if (paymentIntentId && typeof paymentIntentId === 'string') {
      try {
        const verifiedPi = await retrievePaymentIntent(paymentIntentId);
        const piSucceededAndBound =
          verifiedPi.status === 'succeeded' && verifiedPi.metadata?.orderId === orderId;
        if (!piSucceededAndBound) {
          console.warn(
            `Order ${orderId}: PaymentIntent ${paymentIntentId} not confirmed ` +
              `(status=${verifiedPi.status}, boundOrder=${verifiedPi.metadata?.orderId ?? 'none'}); leaving order pending`
          );
        } else {
          // Best-effort display name for the confirmation email.
          let customerName: string | undefined;
          try {
            const user = await currentUser();
            if (user?.firstName && user?.lastName) {
              customerName = `${user.firstName} ${user.lastName}`;
            }
          } catch {
            // no session (guest / redirect return) — finalize falls back to the
            // shipping recipient.
          }
          await finalizePaidOrder({
            order,
            paidAmountCents: verifiedPi.amount_received ?? 0,
            sendEmail: true,
            paidNotes: `Payment completed via Stripe - Payment Intent: ${paymentIntentId}`,
            customerName,
          });
        }
      } catch (piError) {
        // A throw anywhere here (Stripe retrieval, a transient D1 error while
        // pricing the catalog, a gift-card lookup) leaves the order pending by
        // construction — the webhook reconciles later. Fail closed, never open.
        console.error(
          `Order ${orderId}: payment finalization failed; leaving order pending`,
          piError
        );
      }
    }

    // Re-read for the response so it reflects the promoted state (finalize may
    // have flipped pending → processing/paid, or an H1 revert may have undone it).
    const finalRows = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
    const responseOrder = finalRows.length > 0 ? hydrateOrder(finalRows[0]) : order;

    const response = {
      // BMC-164: MACH wire shape at the response boundary only.
      data: toWireOrder(responseOrder),
      meta: {
        schema: "mach:order"
      }
    };
    return NextResponse.json(response, { status: 201 });

  } catch (error) {
    console.error('Orders API error:', error);

    // Classify (BMC-168 review): all field validation above returns 400 INLINE
    // and never reaches this catch. The only expected client-side throw here is a
    // malformed JSON body (request.json() → SyntaxError) — a 400, not paged.
    // Everything else that reaches this catch is a SYSTEM fault (e.g. a re-thrown
    // D1 insert error): those were previously mislabeled 400 and never alerted —
    // surface a 500 and page.
    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { error: 'Invalid request body' },
        { status: 400 }
      );
    }

    logCritical('order_create', 'order_create_failed', {}, error);
    return NextResponse.json(
      { error: 'Failed to create order' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/orders - Update order METADATA only (BMC-216F).
 *
 * Accepts exactly `notes`, `external_references`, and a merged `extensions`.
 * Fulfillment fields are rejected with a 400 naming their dedicated endpoint —
 * see validatePutOrderBody in lib/utils/order-update-guards.ts.
 */
export async function PUT(request: NextRequest) {
  try {
    // Authenticate with admin permissions
    const authResult = await authenticateRequest(request, PERMISSIONS.ORDERS_UPDATE);
    if (!authResult.success) {
      return authResult.response!;
    }

    const body = await request.json() as UpdateOrderRequest & Record<string, unknown>;

    const orderId = (body as any).orderId;
    if (!orderId) {
      return NextResponse.json({
        error: 'Validation failed',
        details: ['orderId is required in the request body']
      }, { status: 400 });
    }

    // SECURITY (BMC-216F): this route is an explicit metadata allowlist. Every
    // lifecycle transition now has a dedicated, verified owner — the Stripe
    // webhook (pending → processing), POST /api/admin/orders/{id}/ship
    // (processing → shipped), and POST /api/orders/refund (→ cancelled /
    // refunded, which issues the Stripe refund atomically). Nothing legitimate
    // is left for a generic status/fulfillment write, so status,
    // tracking_number, shipped_at, delivered_at, shipping_method, and any
    // tracking URL are rejected with a 400 naming the correct endpoint.
    const bodyCheck = validatePutOrderBody(body as Record<string, unknown>);
    if (!bodyCheck.ok) {
      return NextResponse.json({ error: bodyCheck.error }, { status: bodyCheck.status });
    }

    const { notes, external_references, extensions } = body;

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
    // Any client-supplied payment_status is logged and silently dropped rather
    // than applied (kept as a drop, not a 400, so existing automation callers
    // that harmlessly echo the field keep working — BMC-216F).
    if (body.payment_status) {
      console.warn(
        `Order ${orderId}: ignoring client-supplied payment_status="${body.payment_status}" on PUT ` +
          `(payment_status can only be set via verified payment or the /refund route)`
      );
    }

    // SECURITY (BMC-158): the `extensions` JSON column holds server-owned keys
    // the client must not clobber — `payment_intent_id` (the binding the refund
    // route trusts to locate the PaymentIntent it refunds) and `refunds[]` (the
    // ledger computeRefundedTotal sums for the over-refund guard), plus
    // refunds_version / restockedLineKeys / email / carrier / trackingUrl. A
    // wholesale `extensions` overwrite here could rebind/drop the PI (refund
    // fraud) or wipe the refunds ledger (resetting the over-refund guard →
    // double refund). mergeExtensions MERGES the client's keys over the stored
    // ones, re-pins payment_intent_id, and strips every key in
    // SERVER_OWNED_EXTENSION_KEYS from the client overlay; it fails safe
    // (rejects) if the stored extensions are corrupt rather than persisting a
    // stripped object.
    let mergedExtensions: Record<string, unknown> | undefined;
    if (extensions !== undefined) {
      const mergeResult = mergeExtensions(extensions, currentOrder.extensions);
      if (!mergeResult.ok) {
        return NextResponse.json({ error: mergeResult.error }, { status: mergeResult.status });
      }
      mergedExtensions = mergeResult.extensions;
    }

    // SECURITY (BMC-230): `external_references` gets the same treatment for the
    // one key it shares with `extensions` — `payment_intent_id`, which order
    // creation dual-writes into BOTH columns and getOrderByPaymentIntentId
    // OR-matches across both. Written wholesale from the client, a PUT could
    // point a second order at a victim's PaymentIntent so charge.refunded
    // reconciliation lands on the wrong row. Everything else in this column
    // (erp, shopify_id, …) is legitimate caller metadata and passes through.
    let mergedExternalReferences: Record<string, unknown> | undefined;
    if (external_references !== undefined) {
      const refsResult = mergeExternalReferences(
        external_references,
        currentOrder.external_references
      );
      if (!refsResult.ok) {
        return NextResponse.json({ error: refsResult.error }, { status: refsResult.status });
      }
      mergedExternalReferences = refsResult.externalReferences;
    }

    // Build update data (metadata only — BMC-216F).
    // external_references / extensions are `mode: "json"` columns — pass the RAW
    // objects and let Drizzle serialize; a manual JSON.stringify double-encodes.
    const updateData: any = {
      ...(notes && { notes }),
      ...(mergedExternalReferences !== undefined && {
        external_references: mergedExternalReferences,
      }),
      ...(mergedExtensions !== undefined && { extensions: mergedExtensions }),
      updated_at: new Date().toISOString()
    };

    // Update the order. No email is sent from this route: with no status writes
    // possible there is no status change to announce (BMC-216F deleted the
    // email-on-status-change block rather than guarding it).
    const [updatedOrder] = await db.update(orders)
      .set(updateData)
      .where(eq(orders.id, orderId))
      .returning();

    console.log('Order metadata update:', {
      orderId,
      fields: Object.keys(updateData).filter((k) => k !== 'updated_at'),
      updatedBy: authResult.tokenInfo?.tokenName || 'unknown',
      timestamp: new Date().toISOString(),
    });

    const response = {
      // BMC-164: MACH wire shape at the response boundary only.
      data: toWireOrder(hydrateOrder(updatedOrder)),
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
 * Ownership gate for the idempotent-create path (BMC-165 security follow-up).
 *
 * An existing order is only returned to a re-POST if the caller can prove they
 * own it — never on id-guess alone (guest orders share the WEB-GUEST-<ts>
 * namespace). Ownership is proven by EITHER:
 *   - the authenticated Clerk user matching the order's customer_id, OR
 *   - possession of the order's PaymentIntent id (a long, unguessable `pi_...`
 *     the legitimate /checkout/success snapshot always carries) matching the
 *     one stored on the order.
 * Guest orders have no customer_id, so the PaymentIntent-id proof is what makes
 * a guest's own redirect-return re-POST succeed while a guessed id fails.
 */
function callerOwnsExistingOrder(
  existing: typeof orders.$inferSelect,
  userId: string | null,
  body: CreateOrderRequest
): boolean {
  if (userId && existing.customer_id === userId) return true;

  const incomingPi = (body.extensions as any)?.payment_intent_id;
  if (typeof incomingPi !== 'string' || incomingPi.length === 0) return false;

  const rawExt = existing.extensions;
  const existingExt = rawExt
    ? (typeof rawExt === 'string' ? safeParse(rawExt) : rawExt)
    : null;
  const existingPi = existingExt && typeof existingExt === 'object'
    ? (existingExt as any).payment_intent_id
    : undefined;

  return typeof existingPi === 'string' && existingPi.length > 0 && existingPi === incomingPi;
}

/** JSON.parse that returns null instead of throwing on malformed input. */
function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
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
    // dbOrder.total_amount is already parsed to an object by Drizzle's
    // mode:"json" column — Money.fromStored handles object | JSON string |
    // bare number so this reads the real persisted total instead of
    // silently falling back to 0 (BMC-164 review follow-up).
    total_amount: Money.fromStored(dbOrder.total_amount, dbOrder.currency_code).toJSON(),
    currency_code: dbOrder.currency_code,
    shipping_address: dbOrder.shipping_address ? (typeof dbOrder.shipping_address === 'string' ? JSON.parse(dbOrder.shipping_address) : dbOrder.shipping_address) : undefined,
    billing_address: dbOrder.billing_address ? (typeof dbOrder.billing_address === 'string' ? JSON.parse(dbOrder.billing_address) : dbOrder.billing_address) : undefined,
    items: dbOrder.items ? (typeof dbOrder.items === 'string' ? JSON.parse(dbOrder.items) : dbOrder.items) : [],
    shipping_method: dbOrder.shipping_method ?? undefined,
    shipping_carrier: dbOrder.shipping_carrier ?? undefined,
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

