/**
 * === Payment Intent Creation ===
 *
 * Creates Stripe Payment Intents for secure payment processing.
 * Tax calculation should be done via /api/tax before calling this endpoint.
 *
 * === Features ===
 * - **Payment Intent Creation**: Secure payment setup with Stripe
 * - **Order Metadata**: Links payments to order records
 * - **Address Handling**: Shipping and billing address attachment
 * - **Error Handling**: Comprehensive error management and logging
 *
 * === Request Format ===
 * ```json
 * {
 *   "amount": number,        // Total amount including tax
 *   "taxAmount": number,     // Tax amount (from /api/tax)
 *   "shippingAddress": Address,
 *   "orderId": string,
 *   "description"?: string
 * }
 * ```
 *
 * === Response Format ===
 * ```json
 * {
 *   "clientSecret": string,
 *   "paymentIntentId": string,
 *   "amount": number
 * }
 * ```
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { createPaymentIntent, cancelPaymentIntent, formatAmountForStripe, isStripeConfigured } from '@/lib/stripe';
import { validateGiftCardForRedemption } from '@/lib/models/mach/giftCard';
import {
  AMOUNT_TOLERANCE_CENTS,
  MAX_ORDER_LINE_ITEMS,
  canonicalizeOrderItemsDisplay,
} from '@/lib/services/order-pricing';
import { computeExpectedChargeExtras } from '@/lib/services/checkout-charges';
import { normalizeDiscountCodes, MAX_DISCOUNT_CODES, MAX_RAW_DISCOUNT_CODES } from '@/lib/services/discount-pricing';
import { createOrder } from '@/lib/models/mach/orders';
import { checkStockAvailability } from '@/lib/services/inventory-adjustment';
import { getOrCreateCustomer } from '@/lib/account/ensure-customer';
import { isUniqueViolation } from '@/lib/utils/db-errors';
import { Money } from '@/lib/money';
import { enforceRateLimit, getClientIp } from '@/lib/rate-limit';
import type { Address } from '@/lib/types';
import { logCritical } from '@/lib/utils/observe';
import { validateUsShippingAddress } from '@/lib/utils/address';

// Minimal shape of a cart line needed to price it from the catalog. Accepts
// both the cart-store shape (productId/variantId) and the MACH order shape.
interface PaymentIntentLineItem {
  productId?: string;
  product_id?: string;
  variantId?: string;
  variant_id?: string;
  quantity?: number;
}

interface PaymentIntentRequest {
  amount: number;
  taxAmount: number;
  shippingAddress: Address;
  orderId: string;
  description?: string;
  // Cart lines, used to recompute the goods subtotal from the catalog and
  // reject an `amount` that undercuts it (BMC-131). Optional for backward
  // compatibility; the authoritative gate is at order creation + the webhook.
  items?: PaymentIntentLineItem[];
  // Present when a gift card is applied as tender. The server re-verifies the
  // card's CURRENT balance before charging so a stale client-side balance can't
  // under-collect the amount due.
  giftCard?: { code: string; appliedCents: number };
  // Applied cart-discount coupon code(s). The server recomputes the discount
  // AUTHORITATIVELY from the coupon against the catalog subtotal (never the
  // client-supplied amount) and credits it toward the charge floor, so a
  // legitimately discounted promo checkout isn't rejected as underpaying (BMC-177).
  discountCodes?: string[];
  // BMC-167: the full order draft (line items + address + amounts), same shape
  // POST /api/orders receives, MINUS the PaymentIntent id (the server mints and
  // injects that). Persisted as a `pending` order keyed to `orderId` BEFORE the
  // client can pay, so the Stripe webhook can promote it to paid even if the
  // client POST never lands (redirect method returning in a different browser,
  // cleared localStorage, closed tab). Optional for backward compatibility.
  order?: PendingOrderDraft;
}

// The client-supplied order draft. Only the fields the pending order needs; the
// server never trusts `extensions.payment_intent_id` from here (it overwrites it
// with the id it minted) nor `customer_id` (it derives that from the session).
interface PendingOrderDraft {
  order_id?: string;
  items?: any[];
  total_amount?: any;
  currency_code?: string;
  shipping_address?: any;
  billing_address?: any;
  shipping_method?: string;
  payment_method?: string;
  external_references?: Record<string, any>;
  extensions?: Record<string, any>;
}

/**
 * Persist the server-side pending order (BMC-167).
 *
 * Called after the PaymentIntent is created but BEFORE its client secret is
 * returned, so the storefront only ever receives a secret for a PI that already
 * has a matching order row. The order is written `pending`/`pending`; it is
 * promoted to paid by whichever of POST /api/orders or the Stripe webhook
 * confirms payment first. The PaymentIntent id is stamped on both
 * `extensions.payment_intent_id` (storefront convention) and
 * `external_references.payment_intent_id` (so `getOrderByPaymentIntentId` finds
 * it). Item display fields are canonicalized from the catalog; the authoritative
 * charge verification still happens at promotion time.
 *
 * Throws on failure so the caller can refuse to hand back a client secret for a
 * PI with no order.
 */
async function persistPendingOrder(
  draft: PendingOrderDraft,
  orderId: string,
  paymentIntentId: string,
  userId: string | null,
  /**
   * The amount actually put on the PaymentIntent, in integer minor units. This
   * — not `draft.total_amount` — is what gets persisted as the order total.
   */
  chargedAmountCents: number,
  expectedCharges?: { expectedShippingCents?: number; expectedTaxCents?: number }
): Promise<void> {
  // C1 (BMC-167 review): D1 enforces `orders.customer_id → customers.id`, and
  // Clerk sign-up does NOT create a `customers` row (it is provisioned lazily —
  // see lib/account/ensure-customer.ts). Without provisioning it here, a
  // first-time AUTHENTICATED buyer's pending-order insert FK-fails, which would
  // reintroduce the exact money-captured-no-order bug this ticket fixes. Ensure
  // the customer exists before the insert. If provisioning genuinely fails,
  // degrade to a GUEST order (customer_id = null is allowed by the FK) so the
  // order still persists rather than blocking checkout — the same graceful
  // degradation the order-creation path uses.
  let customerId: string | null = userId;
  if (customerId) {
    try {
      await getOrCreateCustomer(customerId);
    } catch (customerError) {
      console.error(
        `[payment-intent] order ${orderId}: customer provisioning failed; persisting as a guest order`,
        customerError
      );
      customerId = null;
    }
  }

  let items = Array.isArray(draft.items) ? draft.items : [];
  try {
    items = await canonicalizeOrderItemsDisplay(items);
  } catch (canonError) {
    console.error(`[payment-intent] order ${orderId}: pending-order canonicalization failed; using client display`, canonError);
  }

  // BMC-201: stamp the SERVER-computed expected shipping + tax (cents) on the
  // order so finalization / the Stripe webhook enforce the same figures the floor
  // used at PI creation, with no second Stripe Tax call (→ no drift). When the
  // fail-fast pricing block didn't run (no top-level `items`), recompute here from
  // the draft's own catalog items + address so a crafted request that skipped that
  // gate still can't dodge tax/shipping enforcement. These are ALWAYS overwritten
  // server-side (never trusted from the client draft's extensions).
  let shippingCents = expectedCharges?.expectedShippingCents;
  let taxCents = expectedCharges?.expectedTaxCents;
  if (shippingCents === undefined || taxCents === undefined) {
    try {
      const draftLines = (Array.isArray(draft.items) ? draft.items : []).map((it: any) => ({
        product_id: it?.product_id ?? it?.productId,
        variant_id: it?.variant_id ?? it?.variantId,
        quantity: it?.quantity,
      }));
      const draftDiscountCodes = normalizeDiscountCodes(draft.extensions?.discount_codes);
      const extras = await computeExpectedChargeExtras(
        draftLines,
        draft.shipping_address ?? null,
        draftDiscountCodes,
        orderId
      );
      // Only stamp when the draft is fully priceable; an unpriceable draft is
      // rejected by the goods charge gate at finalization anyway.
      if (extras.priceable) {
        shippingCents = extras.shippingCents;
        taxCents = extras.taxCents;
      }
    } catch (chargeError) {
      console.error(
        `[payment-intent] order ${orderId}: failed to compute expected shipping/tax for pending order; ` +
          `finalization will enforce goods only`,
        chargeError
      );
    }
  }

  const extensions: Record<string, any> = {
    ...(draft.extensions ?? {}),
    // Server-authoritative: never trust a client-supplied PI id here.
    payment_intent_id: paymentIntentId,
  };
  // Drop any client-supplied expected-charge keys unconditionally, THEN set the
  // server-computed ones. Without the strip, a run where we couldn't compute them
  // (compute threw) would let the client draft's copy survive and be enforced as
  // authoritative at finalization — so a `{ expected_tax_cents: 0 }` in the draft
  // would defeat the floor. Absent server values → keys omitted → finalization
  // falls back to the goods-only floor (safe, never client-controlled).
  delete extensions.expected_shipping_cents;
  delete extensions.expected_tax_cents;
  if (shippingCents !== undefined) extensions.expected_shipping_cents = shippingCents;
  if (taxCents !== undefined) extensions.expected_tax_cents = taxCents;
  // Bound the persisted cart-discount codes (pre-auth storage hardening, BMC-177
  // review): normalize + cap so a client can't stash an unbounded array into the
  // D1 `extensions` JSON via the order draft. Stores exactly the deduped list the
  // charge gate will recompute from at finalization.
  if (extensions.discount_codes !== undefined) {
    extensions.discount_codes = normalizeDiscountCodes(extensions.discount_codes).slice(0, MAX_DISCOUNT_CODES);
  }
  const externalReferences = {
    ...(draft.external_references ?? {}),
    payment_intent_id: paymentIntentId,
  };

  await createOrder({
    id: orderId,
    customer_id: customerId ?? undefined,
    // SERVER-authoritative, like payment_intent_id and the expected_* charges
    // above: the total is the amount actually charged (already validated against
    // the catalog floor), never the client draft's number.
    //
    // The draft value used to be passed through `Money.fromStored()`, which
    // assumes integer minor units and ROUNDS. A draft carrying major units
    // (`{amount: 34.99}`) therefore persisted an order totalling 35 CENTS —
    // silently, since the charge itself is floored server-side. `total_amount`
    // is the ceiling the refund path refunds against, so a wrong value here
    // under-refunds the customer by ~100x. `POST /api/orders` already rejects a
    // non-integer-minor-unit total; this path now can't record one at all.
    total_amount: Money.fromMinor(chargedAmountCents, draft.currency_code || 'USD').toJSON(),
    currency_code: draft.currency_code || 'USD',
    shipping_address: draft.shipping_address ?? undefined,
    billing_address: draft.billing_address ?? undefined,
    items,
    shipping_method: draft.shipping_method,
    payment_method: draft.payment_method || 'stripe',
    external_references: externalReferences,
    extensions,
  });
}

export async function POST(req: NextRequest) {
  try {
    // Public (guest checkout supported) and the most expensive of the public
    // POSTs — each call creates a real Stripe PaymentIntent. Throttle per IP to
    // blunt PI-creation spam (BMC-180). Line-item/discount caps live below.
    const limited = await enforceRateLimit('PUBLIC_RATE_LIMITER', `payment-intent:${getClientIp(req)}`);
    if (limited) return limited;

    const {
      amount,
      taxAmount,
      shippingAddress,
      orderId,
      description,
      giftCard,
      items,
      order,
      discountCodes,
    }: PaymentIntentRequest = await req.json();

    // Validate required fields
    if (!amount || amount <= 0) {
      return NextResponse.json(
        { error: 'Valid amount is required' },
        { status: 400 }
      );
    }

    // Stripe rejects charges below its $0.50 minimum. Enforce it server-side
    // (the checkout UI also guards this, but a direct API call must not slip a
    // sub-minimum amount through to Stripe and surface as an opaque 500).
    if (amount < 0.5) {
      return NextResponse.json(
        { error: 'Amount must be at least $0.50' },
        { status: 400 }
      );
    }

    if (!shippingAddress) {
      return NextResponse.json(
        { error: 'Shipping address is required' },
        { status: 400 }
      );
    }

    const addressErrors = validateUsShippingAddress(shippingAddress);
    if (addressErrors.length) {
      return NextResponse.json(
        { error: addressErrors[0], code: 'invalid_shipping_address', details: addressErrors },
        { status: 400 }
      );
    }

    if (!orderId) {
      return NextResponse.json(
        { error: 'Order ID is required' },
        { status: 400 }
      );
    }

    // Fail loudly and specifically when Stripe isn't configured in this runtime.
    // Previously this surfaced as an opaque 500 ("Failed to create payment
    // intent") because the missing-secret-key throw was swallowed by the generic
    // catch below. The Workers runtime reads secrets from `.dev.vars` /
    // `wrangler secret`, NOT `.env.local`.
    if (!isStripeConfigured()) {
      console.error(
        '[payment-intent] STRIPE_SECRET_KEY is not configured in this runtime. ' +
          'For `wrangler dev`/OpenNext preview set it in `.dev.vars`; for deployed ' +
          'envs use `wrangler secret put STRIPE_SECRET_KEY --env <env>`. ' +
          '`.env.local` is only read by `next dev`.'
      );
      return NextResponse.json(
        {
          error: 'Payments are temporarily unavailable. Please try again later.',
          code: 'stripe_not_configured',
        },
        { status: 503 }
      );
    }

    // If a gift card is applied as tender, re-verify its CURRENT balance here.
    // The client derives `amount` from a balance it fetched earlier; if the card
    // was partially redeemed in the meantime, that amount would under-collect.
    // Reject (don't silently charge the stale, too-low amount) so the shopper
    // re-applies the card at its current balance.
    if (giftCard?.code) {
      const appliedCents = Math.round(giftCard.appliedCents);
      const check = await validateGiftCardForRedemption(giftCard.code);
      const currentBalanceCents = check.valid ? check.balance ?? 0 : 0;
      if (!check.valid || appliedCents > currentBalanceCents) {
        return NextResponse.json(
          {
            error:
              'Your gift card balance changed. Please re-apply your gift card to continue.',
            code: 'gift_card_balance_changed',
          },
          { status: 409 }
        );
      }
    }

    // Server-computed expected shipping + tax (cents) for this order (BMC-201).
    // Set inside the pricing block below when top-level `items` are present, then
    // stamped on the pending order so finalization re-enforces the identical
    // figure. `undefined` here (no top-level items) → persistPendingOrder computes
    // them itself from the draft, so a crafted request that skips the fail-fast
    // gate still can't dodge tax/shipping enforcement at finalization.
    let expectedShippingCents: number | undefined;
    let expectedTaxCents: number | undefined;

    // BMC-131: fail early if the requested charge doesn't even cover the
    // catalog value of the goods (BMC-201: now including shipping + tax). The
    // authoritative gate is at order creation and the Stripe webhook (which
    // re-verify against the CAPTURED amount); rejecting an under-priced
    // PaymentIntent here stops a bogus charge from ever being created and gives
    // the shopper an immediate, clear error.
    if (Array.isArray(items) && items.length > 0) {
      // M6: cap the line count before it drives one catalog lookup per item.
      if (items.length > MAX_ORDER_LINE_ITEMS) {
        console.warn(
          `[payment-intent] order ${orderId}: rejected — ${items.length} items exceeds the ${MAX_ORDER_LINE_ITEMS} line limit`
        );
        return NextResponse.json(
          { error: 'Too many items in your cart. Please reduce the number of items and try again.', code: 'too_many_items' },
          { status: 400 }
        );
      }
      // Cap discount codes before they drive one coupon+promotion lookup each
      // (this route is reachable pre-auth, so an unbounded array is a cheap way to
      // force a burst of concurrent D1 reads — same reasoning as the item cap).
      // First bound the RAW array before the normalize/dedup pass runs over it…
      if (Array.isArray(discountCodes) && discountCodes.length > MAX_RAW_DISCOUNT_CODES) {
        console.warn(
          `[payment-intent] order ${orderId}: rejected — ${discountCodes.length} raw discount codes exceeds the ${MAX_RAW_DISCOUNT_CODES} limit`
        );
        return NextResponse.json(
          { error: 'Too many discount codes. Please remove some and try again.', code: 'too_many_discount_codes' },
          { status: 400 }
        );
      }
      // …then check the DEDUPED count so repeated / case-variant codes don't 400.
      const normalizedDiscountCodes = normalizeDiscountCodes(discountCodes);
      if (normalizedDiscountCodes.length > MAX_DISCOUNT_CODES) {
        console.warn(
          `[payment-intent] order ${orderId}: rejected — ${normalizedDiscountCodes.length} discount codes exceeds the ${MAX_DISCOUNT_CODES} limit`
        );
        return NextResponse.json(
          { error: 'Too many discount codes. Please remove some and try again.', code: 'too_many_discount_codes' },
          { status: 400 }
        );
      }
      const normalized = items.map((it) => ({
        product_id: it.product_id ?? it.productId,
        variant_id: it.variant_id ?? it.variantId,
        quantity: it.quantity,
      }));
      // BMC-201: compute the SERVER's expected goods + shipping + tax from the
      // catalog and destination in one pass (never the client's `taxAmount`). Tax
      // comes from the shared `checkout-charges` seam — the same Stripe-Tax path
      // `/api/tax` quoted the shopper — so an honest amount clears the floor and a
      // tax-omitting one is rejected.
      const extras = await computeExpectedChargeExtras(
        normalized,
        shippingAddress,
        normalizedDiscountCodes,
        orderId
      );
      if (!extras.priceable) {
        console.warn(`[payment-intent] order ${orderId}: catalog pricing errors while computing charge floor`);
        return NextResponse.json(
          {
            error: 'One or more items are no longer available. Please refresh your cart and try again.',
            code: 'catalog_price_unavailable',
          },
          { status: 409 }
        );
      }
      const subtotalCents = extras.goodsCents;
      // Stash the server-computed expected shipping + tax so they are persisted on
      // the pending order (below) and re-enforced identically at finalization.
      expectedShippingCents = extras.shippingCents;
      expectedTaxCents = extras.taxCents;

      // The gift card was already re-validated above against its live balance,
      // so appliedCents is a safe (<= balance) tender to credit here.
      const giftCardTenderCents = giftCard?.code
        ? Math.max(0, Math.round(giftCard.appliedCents || 0))
        : 0;
      // Recompute the cart discount from the coupon against the catalog subtotal
      // (never the client number) and credit it toward the floor, so a valid
      // promo checkout isn't rejected (BMC-177). `normalized` lets a category-gated
      // promotion verify against catalog-derived categories.
      const discountCents = extras.discountCents;
      // Floor now includes server-computed shipping + tax (BMC-201): a client can
      // no longer create a PaymentIntent that covers only goods and omits tax.
      const requiredCashCents = Math.max(
        0,
        subtotalCents - discountCents + expectedShippingCents + expectedTaxCents - giftCardTenderCents
      );
      const amountCents = Math.round(amount * 100);
      if (amountCents + AMOUNT_TOLERANCE_CENTS < requiredCashCents) {
        console.warn(
          `[payment-intent] order ${orderId}: requested amount ${amountCents}c is below ` +
            `catalog floor ${requiredCashCents}c (goods ${subtotalCents}c, cart discount ${discountCents}c, ` +
            `shipping ${expectedShippingCents}c, tax ${expectedTaxCents}c, gift card ${giftCardTenderCents}c)`
        );
        return NextResponse.json(
          {
            error: 'The payment amount is less than the price of your items. Please refresh your cart and try again.',
            code: 'amount_below_catalog',
          },
          { status: 400 }
        );
      }
    }

    // BMC-178: reject BEFORE charging if any tracked, non-backorderable line
    // lacks the requested quantity on hand. This is oversell PREVENTION with a
    // clear, immediate error; the authoritative backstop is the guarded decrement
    // at payment success (finalizePaidOrder / MCP place_order), which can never
    // take a tracked variant below zero even if this pre-check is skipped or a
    // concurrent checkout races for the last unit. Backorderable and untracked
    // (made-to-order) variants are always allowed through.
    if (Array.isArray(items) && items.length > 0) {
      const availability = await checkStockAvailability(items as any);
      if (!availability.ok) {
        const detail = availability.shortfalls
          .map((s) => `${s.product_name ?? s.variant_id}: ${s.available} on hand, ${s.requested} requested`)
          .join('; ');
        console.warn(`[payment-intent] order ${orderId}: insufficient stock — ${detail}`);
        return NextResponse.json(
          {
            error:
              'Some items in your cart are no longer available in the quantity you requested. Please adjust your cart and try again.',
            code: 'insufficient_stock',
            shortfalls: availability.shortfalls,
          },
          { status: 409 }
        );
      }
    }

    // The single source of truth for "what this order costs": put on the
    // PaymentIntent AND persisted as the pending order's total, so the order row
    // can never disagree with the charge.
    const chargedAmountCents = formatAmountForStripe(amount);

    // Create Payment Intent
    const paymentIntent = await createPaymentIntent({
      amount: chargedAmountCents,
      currency: 'usd',
      automatic_payment_methods: {
        enabled: true,
        // Redirect-based methods (Klarna, Cash App Pay, Amazon Pay) are allowed:
        // PaymentForm confirms with a real return_url (/checkout/success) that
        // finalizes the order on return (BMC-165). Card / Link still pay inline
        // via redirect: 'if_required'. (The MCP/agent flow stays 'never' — a
        // headless agent has no browser to complete a redirect.)
        allow_redirects: 'always',
      },
      metadata: {
        orderId,
        taxAmount: taxAmount.toString(),
        totalAmount: amount.toString(),
      },
      shipping: {
        address: {
          line1: String(shippingAddress.line1),
          line2: shippingAddress.line2 ? String(shippingAddress.line2) : undefined,
          city: String(shippingAddress.city),
          state: String(shippingAddress.region),
          postal_code: String(shippingAddress.postal_code),
          country: 'US',
        },
        name: String(shippingAddress.recipient || 'Customer'),
      },
      description: description || `Order ${orderId}`,
    });

    const paymentIntentId = (paymentIntent as any).id as string;

    // BMC-167: persist a server-side pending order keyed to this PaymentIntent
    // BEFORE returning the client secret. This is the crux of the fix: once the
    // shopper can pay, an order row already exists, so the Stripe webhook can
    // promote it to paid even if the client-side POST /api/orders never lands
    // (redirect payment method returning in a different browser, cleared
    // localStorage, closed tab). We only hand back a client secret if this
    // succeeds — never expose a payable PI that has no order behind it.
    if (order) {
      try {
        // customer_id is derived from the session, never the client draft, so a
        // caller can't stamp another user's id onto the order.
        const { userId } = await auth();
        await persistPendingOrder({
          ...order,
          // The top-level address was validated and is the address attached to
          // Stripe. Never persist a second, client-controlled draft address.
          shipping_address: shippingAddress,
        }, orderId, paymentIntentId, userId ?? null, chargedAmountCents, {
          expectedShippingCents,
          expectedTaxCents,
        });
      } catch (persistError) {
        // H1 (BMC-167 review): use the canonical unique-violation classifier
        // (walks the cause chain, matches ONLY unique/primary-key — never a
        // FK/NOTNULL/CHECK failure). A genuine non-unique constraint error must
        // fail closed (500, withhold the client secret), never be swallowed as
        // "already exists".
        if (isUniqueViolation(persistError)) {
          // The pending order already exists for this id (a retry / double-submit
          // of the PI request). Safe — the order is there; fall through and return
          // the client secret.
          console.warn(`[payment-intent] order ${orderId}: pending order already exists; reusing it`);
        } else {
          console.error(
            `[payment-intent] order ${orderId}: failed to persist pending order for PaymentIntent ${paymentIntentId}; ` +
              `refusing to return a client secret for an order-less payment`,
            persistError
          );
          // Best-effort cleanup (BMC-167 review): we are withholding the client
          // secret, so this PaymentIntent can never capture money — but cancel it
          // so it doesn't linger as an abandoned intent in the Stripe dashboard.
          // Strictly non-fatal: a cancel failure only leaves a harmless orphan,
          // and must never block or change the error response.
          try {
            await cancelPaymentIntent(paymentIntentId);
          } catch (cancelError) {
            console.error(
              `[payment-intent] order ${orderId}: failed to cancel orphaned PaymentIntent ${paymentIntentId} (non-fatal)`,
              cancelError
            );
          }
          // Alert: a PaymentIntent exists (money can move) but no order backs it,
          // and the client secret is withheld — a checkout outage / lost-order
          // risk that must page, not just log.
          logCritical(
            'payment_intent',
            'pending_order_persist_failed',
            { orderId, paymentIntentId },
            persistError
          );
          return NextResponse.json(
            {
              error: 'We could not start your checkout. Please try again.',
              code: 'pending_order_persist_failed',
            },
            { status: 500 }
          );
        }
      }
    } else {
      // Backward compatibility: an older client that doesn't send the order draft
      // still gets a PaymentIntent, but the webhook cannot rebuild the order from
      // metadata alone — such a checkout relies entirely on the client POST.
      console.warn(`[payment-intent] order ${orderId}: no order draft supplied; skipping server-side pending order`);
    }

    return NextResponse.json({
      clientSecret: (paymentIntent as any).client_secret,
      paymentIntentId,
      amount,
    });

  } catch (error) {
    // Log the actual cause (message + full error) so a real Stripe failure is
    // diagnosable from `wrangler tail` instead of hiding behind the generic
    // client-facing message.
    const detail = error instanceof Error ? error.message : String(error);
    console.error('Error creating payment intent:', detail, error);
    logCritical('payment_intent', 'create_failed', {}, error);
    return NextResponse.json(
      { error: 'Failed to create payment intent' },
      { status: 500 }
    );
  }
}
