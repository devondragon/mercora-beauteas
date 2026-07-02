/**
 * Regression tests for BMC-152 / L2 — partial refunds were validated only
 * against the order total, never against amounts already refunded, so an
 * order could be over-refunded via repeated partial refunds (defense-in-depth
 * gap; Stripe would reject the true over-refund, but with a raw 500 instead
 * of a clean 400).
 *
 * Exercises the pure helpers used by app/api/orders/refund/route.ts:
 * computeRefundedTotal() sums extensions.refunds[], and
 * assertRefundWithinRemaining() checks the new request against what's left.
 *
 * Also covers a follow-up review gap: the "full" refund branch used to
 * always refund the whole order total, skipping the cumulative check
 * entirely — so a full refund issued after a prior partial refund would ask
 * Stripe to refund the full total a second time and get a raw 500.
 * resolveFullRefundAmount() fixes that by refunding only what's still
 * outstanding, and rejecting cleanly once nothing remains.
 */
import { describe, it, expect } from 'vitest';
import { computeRefundedTotal, assertRefundWithinRemaining, resolveFullRefundAmount } from '@/lib/utils/refund-validation';

describe('computeRefundedTotal', () => {
  it('returns 0 when extensions is undefined', () => {
    expect(computeRefundedTotal(undefined)).toBe(0);
  });

  it('returns 0 when extensions is null', () => {
    expect(computeRefundedTotal(null)).toBe(0);
  });

  it('returns 0 when extensions has no refunds key', () => {
    expect(computeRefundedTotal({})).toBe(0);
  });

  it('returns 0 when refunds is an empty array', () => {
    expect(computeRefundedTotal({ refunds: [] })).toBe(0);
  });

  it('returns 0 when refunds is not an array', () => {
    expect(computeRefundedTotal({ refunds: 'not-an-array' as unknown as [] })).toBe(0);
  });

  it('sums a single prior refund', () => {
    expect(computeRefundedTotal({ refunds: [{ amount: 500 }] })).toBe(500);
  });

  it('sums multiple prior refunds', () => {
    expect(computeRefundedTotal({ refunds: [{ amount: 500 }, { amount: 300 }, { amount: 200 }] })).toBe(1000);
  });

  it('ignores entries with a non-numeric amount', () => {
    expect(computeRefundedTotal({ refunds: [{ amount: 500 }, { amount: undefined }, { amount: 'oops' as unknown as number }] })).toBe(500);
  });

  it('ignores negative and fractional entries (defense-in-depth)', () => {
    expect(computeRefundedTotal({ refunds: [{ amount: 500 }, { amount: -200 }, { amount: 10.5 }] })).toBe(500);
  });
});

describe('assertRefundWithinRemaining', () => {
  it('allows a partial refund under the total with no prior refunds', () => {
    const result = assertRefundWithinRemaining(10000, 0, 4000);
    expect(result.ok).toBe(true);
  });

  it('allows a partial refund that exactly consumes the remaining amount', () => {
    const result = assertRefundWithinRemaining(10000, 6000, 4000);
    expect(result.ok).toBe(true);
  });

  it('allows a partial refund that fits within what remains after a prior refund', () => {
    const result = assertRefundWithinRemaining(10000, 3000, 4000);
    expect(result.ok).toBe(true);
  });

  it('rejects a refund that exceeds the remaining amount after one prior refund', () => {
    const result = assertRefundWithinRemaining(10000, 7000, 4000);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('Refund exceeds remaining refundable amount');
    }
  });

  it('rejects a refund that exceeds the total with no prior refunds', () => {
    const result = assertRefundWithinRemaining(10000, 0, 10001);
    expect(result.ok).toBe(false);
  });

  it('rejects cumulatively across multiple prior refunds', () => {
    // Total 10000, already refunded 5000 + 4000 = 9000, remaining = 1000.
    const alreadyRefunded = computeRefundedTotal({ refunds: [{ amount: 5000 }, { amount: 4000 }] });
    const result = assertRefundWithinRemaining(10000, alreadyRefunded, 1500);
    expect(result.ok).toBe(false);
  });

  it('allows a refund that fits within remaining across multiple prior refunds', () => {
    const alreadyRefunded = computeRefundedTotal({ refunds: [{ amount: 5000 }, { amount: 4000 }] });
    const result = assertRefundWithinRemaining(10000, alreadyRefunded, 1000);
    expect(result.ok).toBe(true);
  });

  it('rejects a negative refund amount', () => {
    const result = assertRefundWithinRemaining(10000, 0, -1);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('Refund amount must be a positive whole number');
    }
  });

  it('rejects a zero refund amount', () => {
    const result = assertRefundWithinRemaining(10000, 0, 0);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('Refund amount must be a positive whole number');
    }
  });

  it('rejects a non-integer refund amount', () => {
    const result = assertRefundWithinRemaining(10000, 0, 10.5);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('Refund amount must be a positive whole number');
    }
  });
});

describe('resolveFullRefundAmount', () => {
  it('refunds the entire total when there are no prior refunds', () => {
    const result = resolveFullRefundAmount(10000, 0);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.amount).toBe(10000);
    }
  });

  it('refunds only the outstanding balance after a prior partial refund', () => {
    const alreadyRefunded = computeRefundedTotal({ refunds: [{ amount: 4000 }] });
    const result = resolveFullRefundAmount(10000, alreadyRefunded);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.amount).toBe(6000);
    }
  });

  it('refunds only the outstanding balance across multiple prior partial refunds', () => {
    const alreadyRefunded = computeRefundedTotal({ refunds: [{ amount: 3000 }, { amount: 2000 }] });
    const result = resolveFullRefundAmount(10000, alreadyRefunded);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.amount).toBe(5000);
    }
  });

  it('rejects when the order is already fully refunded by prior partials', () => {
    const alreadyRefunded = computeRefundedTotal({ refunds: [{ amount: 6000 }, { amount: 4000 }] });
    const result = resolveFullRefundAmount(10000, alreadyRefunded);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('Order is already fully refunded');
    }
  });

  it('rejects when prior refunds exceed the total (defensive over-refund case)', () => {
    const alreadyRefunded = computeRefundedTotal({ refunds: [{ amount: 7000 }, { amount: 4000 }] });
    const result = resolveFullRefundAmount(10000, alreadyRefunded);
    expect(result.ok).toBe(false);
  });
});
