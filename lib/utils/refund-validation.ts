/**
 * Pure helpers for validating refund amounts against an order's refund
 * history (BMC-152). Kept dependency-free (no DB/Cloudflare bindings) so
 * they can be unit tested directly and reused wherever refund math needs
 * to happen — currently `app/api/orders/refund/route.ts`.
 *
 * Units: all amounts are whatever unit the caller uses consistently
 * (this codebase stores order totals/refunds in cents), never mixed.
 */

export interface RefundRecord {
  amount?: number;
  [key: string]: unknown;
}

export interface OrderExtensions {
  refunds?: RefundRecord[];
  [key: string]: unknown;
}

/**
 * Sums the `amount` of every entry in `extensions.refunds[]`.
 * Safe against a missing/undefined/null extensions object, a missing
 * `refunds` key, a non-array value, and entries with a non-numeric amount.
 */
export function computeRefundedTotal(extensions: OrderExtensions | null | undefined): number {
  const refunds = extensions?.refunds;
  if (!Array.isArray(refunds)) {
    return 0;
  }
  return refunds.reduce((sum, refund) => {
    const amount = refund?.amount;
    return sum + (typeof amount === 'number' && Number.isFinite(amount) ? amount : 0);
  }, 0);
}

/**
 * Validates that a new refund of `requestedAmount` does not push the
 * cumulative refunded total (prior refunds + this one) past `totalAmount`.
 * Returns a discriminated result instead of throwing so callers can turn a
 * failure directly into a clean 400 response.
 */
export function assertRefundWithinRemaining(
  totalAmount: number,
  alreadyRefunded: number,
  requestedAmount: number
): { ok: true } | { ok: false; error: string } {
  const remaining = totalAmount - alreadyRefunded;
  if (requestedAmount > remaining) {
    return {
      ok: false,
      error: 'Refund exceeds remaining refundable amount'
    };
  }
  return { ok: true };
}

/**
 * Resolves the amount to charge Stripe for a "full" refund request. A "full"
 * refund should only ever refund what's still outstanding — never the whole
 * order total again after prior refunds (partial or full) have already
 * reduced the remaining balance. Without this, a full refund issued after a
 * prior partial refund would ask Stripe to refund the entire original total
 * a second time, and Stripe would reject it with a raw 500 instead of a
 * clean 400 (BMC-152 review).
 */
export function resolveFullRefundAmount(
  totalAmount: number,
  alreadyRefunded: number
): { ok: true; amount: number } | { ok: false; error: string } {
  const remaining = totalAmount - alreadyRefunded;
  if (remaining <= 0) {
    return {
      ok: false,
      error: 'Order is already fully refunded'
    };
  }
  return { ok: true, amount: remaining };
}
