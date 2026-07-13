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
import type { AppliedGiftCard, AppliedDiscount } from '@/lib/stores/cart-store';

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
  /**
   * The funding PaymentIntent id. Optional so the checkout can build the order
   * DRAFT it sends to `/api/payment-intent` (BMC-167) BEFORE the id has been
   * minted — the server stamps the real id it created onto the persisted pending
   * order. Always supplied for the localStorage redirect snapshot, whose lookup
   * is keyed by this id.
   */
  paymentIntentId?: string;
  items: CartItem[];
  shippingAddress?: Address;
  shippingOption?: ShippingOption;
  appliedGiftCard?: AppliedGiftCard;
  /**
   * Applied discounts from the cart. Only the CART-type codes are persisted on
   * the order (`extensions.discount_codes`) so the charge gate can recompute the
   * discount authoritatively from the coupon at finalization (BMC-177).
   */
  appliedDiscounts?: AppliedDiscount[];
  totals: OrderTotals;
}

/**
 * Build the `POST /api/orders` request body from checkout state. The server
 * re-verifies payment against Stripe and ignores the client `payment_status`
 * flag, so this is display/line-item data only — never a source of truth for
 * whether the order was actually paid.
 */
export function buildCreateOrderBody(args: BuildOrderArgs) {
  const { orderId, paymentIntentId, items, shippingAddress, shippingOption, appliedGiftCard, appliedDiscounts, totals } = args;
  const { subtotal, shippingCost, tax, giftCardApplied, totalBeforeGiftCard } = totals;

  // Only cart-type discounts reduce the goods subtotal the charge floor enforces,
  // so those are the codes the server must recompute at finalization (BMC-177).
  const cartDiscountCodes = (appliedDiscounts ?? [])
    .filter((d) => d.type === 'cart')
    .map((d) => d.code);

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
      // Empty string when building the pre-PI draft (BMC-167); the server
      // overwrites it with the real id it minted. Always the real id on the
      // localStorage redirect snapshot, whose lookup is keyed by it.
      payment_intent_id: paymentIntentId ?? '',
      shipping_cost: shippingCost,
      tax_amount: tax,
      subtotal,
      ...(giftCardApplied > 0 && appliedGiftCard
        ? { gift_card: { code: appliedGiftCard.code, amount: giftCardApplied } }
        : {}),
      // Persist the cart-discount code(s) so the charge gate re-derives the
      // discount from the coupon at finalization — never a client amount (BMC-177).
      ...(cartDiscountCodes.length > 0 ? { discount_codes: cartDiscountCodes } : {}),
    },
  };
}

export type CreateOrderBody = ReturnType<typeof buildCreateOrderBody>;

// ─── Pending-order snapshot (redirect payment-method fallback) ──────────────

// One snapshot PER PaymentIntent. A single global key would let a second
// concurrent checkout in the same browser (another tab, or a resumed earlier
// attempt) overwrite the snapshot for an in-flight redirect — so /checkout/success
// could POST the WRONG order body for the PaymentIntent that actually succeeded,
// orphaning the real payment. Keying by PI id keeps concurrent checkouts isolated
// and lets the return page load the snapshot for exactly the PI it returned for.
const PENDING_ORDER_PREFIX = 'beauteas.pendingOrder.';
// Cap retained snapshots so abandoned redirect attempts don't grow unbounded.
const MAX_PENDING_ORDERS = 10;
// A snapshot carries PII (shipping address / name / email). A redirect
// round-trip completes in minutes, so expire snapshots well before then in
// wall-clock terms — this bounds how long abandoned PII lingers on a shared
// machine rather than relying on the count cap alone.
const PENDING_ORDER_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

/**
 * A stashed order body plus the payment-intent id it belongs to. `orderId` is
 * duplicated out for a cheap sanity check on return without re-parsing the body.
 */
interface PendingOrder {
  orderId: string;
  paymentIntentId: string;
  /** Epoch ms the snapshot was written — used only for oldest-first pruning. */
  savedAt: number;
  body: CreateOrderBody;
}

function pendingKey(paymentIntentId: string): string {
  return `${PENDING_ORDER_PREFIX}${paymentIntentId}`;
}

/**
 * Persist the order body before a redirect-based payment so `/checkout/success`
 * can finalize the order when the customer returns. Keyed by the PaymentIntent
 * id it belongs to. No-op outside the browser.
 */
export function savePendingOrder(body: CreateOrderBody): void {
  if (typeof window === 'undefined') return;
  const paymentIntentId = body.extensions.payment_intent_id;
  if (!paymentIntentId) return;
  try {
    const pending: PendingOrder = {
      orderId: body.order_id,
      paymentIntentId,
      savedAt: Date.now(),
      body,
    };
    window.localStorage.setItem(pendingKey(paymentIntentId), JSON.stringify(pending));
    prunePendingOrders();
  } catch {
    // localStorage can throw (private mode / quota). A missing snapshot only
    // degrades the redirect fallback; the webhook still reconciles payment.
  }
}

/**
 * Read the snapshot for a specific PaymentIntent, or null if none / unreadable /
 * mismatched. The `paymentIntentId` MUST be the one the redirect actually
 * returned for — never post a snapshot that isn't bound to the succeeded PI.
 */
export function loadPendingOrder(paymentIntentId: string): PendingOrder | null {
  if (typeof window === 'undefined' || !paymentIntentId) return null;
  try {
    const raw = window.localStorage.getItem(pendingKey(paymentIntentId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingOrder;
    // Defense in depth: the key already scopes by PI id, but require the stored
    // body to agree so a corrupted/mis-keyed entry can never be posted.
    if (parsed?.paymentIntentId !== paymentIntentId) return null;
    if (parsed?.body?.extensions?.payment_intent_id !== paymentIntentId) return null;
    if (!parsed?.body?.order_id) return null;
    // Expire stale snapshots (bounds how long abandoned PII persists).
    if (typeof parsed.savedAt === 'number' && Date.now() - parsed.savedAt > PENDING_ORDER_TTL_MS) {
      try {
        window.localStorage.removeItem(pendingKey(paymentIntentId));
      } catch {
        // ignore
      }
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/** Clear a PaymentIntent's snapshot once it has been finalized (or abandoned). */
export function clearPendingOrder(paymentIntentId: string): void {
  if (typeof window === 'undefined' || !paymentIntentId) return;
  try {
    window.localStorage.removeItem(pendingKey(paymentIntentId));
  } catch {
    // ignore
  }
}

/**
 * Best-effort hygiene: drop snapshots past the TTL (bounds abandoned-PII
 * lifetime) and then the oldest beyond MAX_PENDING_ORDERS (bounds count).
 */
function prunePendingOrders(): void {
  try {
    const now = Date.now();
    const entries: Array<{ key: string; savedAt: number }> = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (!key || !key.startsWith(PENDING_ORDER_PREFIX)) continue;
      let savedAt = 0;
      try {
        savedAt = (JSON.parse(window.localStorage.getItem(key) || '{}') as PendingOrder).savedAt || 0;
      } catch {
        // Unparseable entry — treat as oldest so it's pruned first.
      }
      // Expired: remove immediately and don't count it toward the cap.
      if (savedAt && now - savedAt > PENDING_ORDER_TTL_MS) {
        window.localStorage.removeItem(key);
        continue;
      }
      entries.push({ key, savedAt });
    }
    if (entries.length <= MAX_PENDING_ORDERS) return;
    entries
      .sort((a, b) => a.savedAt - b.savedAt)
      .slice(0, entries.length - MAX_PENDING_ORDERS)
      .forEach((e) => window.localStorage.removeItem(e.key));
  } catch {
    // ignore — pruning is best-effort hygiene
  }
}
