/**
 * === Checkout Order Payload / Pending-Order Snapshot ===
 *
 * Shared between the two ways an order reaches `POST /api/orders`:
 *
 *  1. **Inline (card / Link)** — `stripe.confirmPayment({ redirect: 'if_required' })`
 *     resolves on the page, so `CheckoutClient.handlePaymentSuccess` builds the
 *     body and POSTs it directly.
 *  2. **Redirect (Klarna, Cash App Pay, Amazon Pay)** — the customer is sent
 *     off-site and `handlePaymentSuccess` never runs. Before redirecting we
 *     stash the *exact same* body in localStorage; on return, `/checkout/success`
 *     reads it back and POSTs it.
 *
 * Both paths call {@link buildCreateOrderBody} so the two bodies are identical —
 * the only place order line items / totals get shaped for the API. All money
 * fields are integer MINOR units (cents), matching the cart store and the
 * `Money.toJSON()` wire contract expected by the orders route.
 */

import { Money } from '@/lib/money';
import type { CartItem } from '@/lib/types/cartitem';
import type { Address } from '@/lib/types';
import type { ShippingOption } from '@/lib/types/shipping';
import type { AppliedGiftCard } from '@/lib/stores/cart-store';

/** Totals subset needed to build the order body (all integer minor units). */
export interface OrderTotals {
  subtotal: number;
  shippingCost: number;
  tax: number;
  /** Amount of the applied gift card credited against this order. */
  giftCardApplied: number;
  /** Order value BEFORE the gift-card tender (goods − discounts + shipping + tax). */
  totalBeforeGiftCard: number;
}

export interface BuildOrderArgs {
  orderId: string;
  paymentIntentId: string;
  items: CartItem[];
  shippingAddress?: Address;
  shippingOption?: ShippingOption;
  appliedGiftCard?: AppliedGiftCard;
  totals: OrderTotals;
}

/**
 * Build the `POST /api/orders` request body from checkout state. The server
 * re-verifies payment against Stripe and ignores the client `payment_status`
 * flag, so this is display/line-item data only — never a source of truth for
 * whether the order was actually paid.
 */
export function buildCreateOrderBody(args: BuildOrderArgs) {
  const { orderId, paymentIntentId, items, shippingAddress, shippingOption, appliedGiftCard, totals } = args;
  const { subtotal, shippingCost, tax, giftCardApplied, totalBeforeGiftCard } = totals;

  return {
    order_id: orderId, // keep order id consistent with payment-intent metadata
    items: items.map((item) => ({
      product_id: item.productId,
      variant_id: item.variantId,
      sku: `${item.productId}-${item.variantId || 'default'}`,
      quantity: item.quantity,
      unit_price: Money.fromMinor(item.price, 'USD').toJSON(),
      total_price: Money.fromMinor(item.price, 'USD').times(item.quantity).toJSON(),
      product_name: item.name,
      // Carry gift-card recipient details through to fulfillment.
      ...(item.giftCard ? { gift_card: item.giftCard } : {}),
    })),
    // Server contract (lib/services/gift-card-fulfillment.ts): order total_amount
    // is the PRE-gift-card value — the server subtracts the gift card itself when
    // computing the expected Stripe charge.
    total_amount: Money.fromMinor(totalBeforeGiftCard, 'USD').toJSON(),
    currency_code: 'USD',
    shipping_address: shippingAddress,
    billing_address: shippingAddress, // Use same as shipping for now
    shipping_method: shippingOption?.label || 'standard',
    payment_method: 'stripe',
    payment_status: 'paid', // Advisory only — server verifies against Stripe.
    extensions: {
      payment_intent_id: paymentIntentId,
      shipping_cost: shippingCost,
      tax_amount: tax,
      subtotal,
      ...(giftCardApplied > 0 && appliedGiftCard
        ? { gift_card: { code: appliedGiftCard.code, amount: giftCardApplied } }
        : {}),
    },
  };
}

export type CreateOrderBody = ReturnType<typeof buildCreateOrderBody>;

// ─── Pending-order snapshot (redirect payment-method fallback) ──────────────

const PENDING_ORDER_KEY = 'beauteas.pendingOrder';

/**
 * A stashed order body plus the payment-intent id it belongs to. `orderId` is
 * duplicated out for a cheap sanity check on return without re-parsing the body.
 */
interface PendingOrder {
  orderId: string;
  paymentIntentId: string;
  body: CreateOrderBody;
}

/**
 * Persist the order body before a redirect-based payment so `/checkout/success`
 * can finalize the order when the customer returns. No-op outside the browser.
 */
export function savePendingOrder(body: CreateOrderBody): void {
  if (typeof window === 'undefined') return;
  try {
    const pending: PendingOrder = {
      orderId: body.order_id,
      paymentIntentId: body.extensions.payment_intent_id,
      body,
    };
    window.localStorage.setItem(PENDING_ORDER_KEY, JSON.stringify(pending));
  } catch {
    // localStorage can throw (private mode / quota). A missing snapshot only
    // degrades the redirect fallback; the webhook still reconciles payment.
  }
}

/** Read the stashed pending order, or null if none / unreadable. */
export function loadPendingOrder(): PendingOrder | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(PENDING_ORDER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingOrder;
    if (!parsed?.body?.order_id) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Clear the stashed pending order once it has been finalized (or abandoned). */
export function clearPendingOrder(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(PENDING_ORDER_KEY);
  } catch {
    // ignore
  }
}
