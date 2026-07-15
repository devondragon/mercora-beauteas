/**
 * Pure derivation of the deterministic Stripe `Idempotency-Key` for a refund
 * (BMC-172, extracted for BMC-192).
 *
 * Kept dependency-free (only `sha256Hex` from the auth crypto module, which is
 * itself framework-free) so it can be unit-tested directly and reused by
 * `app/api/orders/refund/route.ts` without pulling in Next/Stripe/D1.
 *
 * The key exists so a RETRY of the *same* refund reuses it — Stripe then returns
 * the ORIGINAL refund instead of moving money a second time. It is scoped to:
 *   - `orderId`            — the order being refunded
 *   - `type`              — 'full' vs 'partial' (these must never collide)
 *   - `refundAmount`      — the amount in minor units (cents)
 *   - `priorRefundCount`  — how many refund entries the order already carries;
 *                            a failed D1 write leaves this unchanged so the
 *                            retry collides (dedupes to one refund), while a
 *                            genuinely new refund lands after a successful prior
 *                            write (higher count) and gets a distinct key
 *   - the refunded line items (order-independent)
 *
 * `reason`/`notes` are intentionally excluded so a same-amount retry that only
 * changes those still dedupes to the original refund. Hashed to bound the length
 * (Stripe caps keys at 255 chars — this yields `refund:` + 64 hex = 71 chars).
 */

import { sha256Hex } from '@/lib/auth/crypto';

export interface RefundIdempotencyInput {
  orderId: string;
  type: 'full' | 'partial';
  /** Refund amount in minor units (cents). */
  refundAmount: number;
  /** Count of refund entries already recorded on the order. */
  priorRefundCount: number;
  /** Product ids covered by this refund; order-independent. */
  items?: string[] | null;
}

/**
 * Normalize the refunded line items into a stable, order-independent string so
 * the same set of items always hashes to the same key regardless of input order
 * or duplicates in the caller's array ordering.
 */
export function normalizeRefundItemKeys(items: string[] | null | undefined): string {
  return (items ?? []).slice().sort().join(',');
}

/** Derive the deterministic `refund:<sha256>` idempotency key. */
export async function deriveRefundIdempotencyKey(
  input: RefundIdempotencyInput
): Promise<string> {
  const { orderId, type, refundAmount, priorRefundCount, items } = input;
  const refundLineKeys = normalizeRefundItemKeys(items);
  const digest = await sha256Hex(
    `${orderId}|${type}|${refundAmount}|${priorRefundCount}|${refundLineKeys}`
  );
  return `refund:${digest}`;
}
