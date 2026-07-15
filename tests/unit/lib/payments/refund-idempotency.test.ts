/**
 * BMC-192: unit coverage for the deterministic refund idempotency-key derivation
 * extracted from app/api/orders/refund/route.ts (originally BMC-172).
 *
 * The key exists so a RETRY of the *same* refund reuses it — Stripe then returns
 * the ORIGINAL refund instead of moving money a second time. The scenarios below
 * mirror the route's write-ordering invariants:
 *   - A retry after a D1-write failure (ledger did NOT grow → same
 *     priorRefundCount) reproduces the SAME key → Stripe dedupes.
 *   - A genuinely distinct partial refund lands after a prior write succeeded
 *     (higher priorRefundCount) → DIFFERENT key → a real second refund.
 *   - Full vs. partial of the same amount never collide.
 *   - The key stays within Stripe's 255-char cap.
 *
 * deriveRefundIdempotencyKey is pure (only Web Crypto via sha256Hex), so it runs
 * directly in the jsdom unit env with no Cloudflare bindings.
 */
import { describe, it, expect } from 'vitest';
import { deriveRefundIdempotencyKey, normalizeRefundItemKeys } from '@/lib/payments/refund-idempotency';

describe('normalizeRefundItemKeys', () => {
  it('is order-independent', () => {
    expect(normalizeRefundItemKeys(['b', 'a', 'c'])).toBe(normalizeRefundItemKeys(['c', 'b', 'a']));
  });

  it('normalizes null/undefined/empty to the empty string', () => {
    expect(normalizeRefundItemKeys(null)).toBe('');
    expect(normalizeRefundItemKeys(undefined)).toBe('');
    expect(normalizeRefundItemKeys([])).toBe('');
  });
});

describe('deriveRefundIdempotencyKey', () => {
  it('is prefixed with "refund:" and deterministic for identical inputs', async () => {
    const input = {
      orderId: 'WEB-USER-123456',
      type: 'partial' as const,
      refundAmount: 2500,
      priorRefundCount: 0,
      items: ['sku-a', 'sku-b'],
    };
    const a = await deriveRefundIdempotencyKey(input);
    const b = await deriveRefundIdempotencyKey({ ...input });
    expect(a).toMatch(/^refund:[0-9a-f]{64}$/);
    expect(a).toBe(b);
  });

  it('RETRY after a D1-write failure (unchanged priorRefundCount) reproduces the SAME key', async () => {
    // The first attempt refunded at Stripe but the ledger write threw, so
    // extensions.refunds did NOT grow → priorRefundCount is identical on retry.
    const attempt1 = await deriveRefundIdempotencyKey({
      orderId: 'WEB-USER-1',
      type: 'partial',
      refundAmount: 1500,
      priorRefundCount: 0,
      items: ['sku-a'],
    });
    const retry = await deriveRefundIdempotencyKey({
      orderId: 'WEB-USER-1',
      type: 'partial',
      refundAmount: 1500,
      priorRefundCount: 0,
      items: ['sku-a'],
    });
    expect(retry).toBe(attempt1);
  });

  it('a genuinely distinct partial refund after a prior write (higher priorRefundCount) gets a DIFFERENT key', async () => {
    const first = await deriveRefundIdempotencyKey({
      orderId: 'WEB-USER-1',
      type: 'partial',
      refundAmount: 1500,
      priorRefundCount: 0,
      items: ['sku-a'],
    });
    // A prior refund is now recorded → the ledger grew → priorRefundCount = 1.
    const second = await deriveRefundIdempotencyKey({
      orderId: 'WEB-USER-1',
      type: 'partial',
      refundAmount: 1500,
      priorRefundCount: 1,
      items: ['sku-a'],
    });
    expect(second).not.toBe(first);
  });

  it('full vs. partial refunds of the same amount produce different keys', async () => {
    const base = { orderId: 'WEB-USER-1', refundAmount: 5000, priorRefundCount: 0, items: [] as string[] };
    const full = await deriveRefundIdempotencyKey({ ...base, type: 'full' });
    const partial = await deriveRefundIdempotencyKey({ ...base, type: 'partial' });
    expect(full).not.toBe(partial);
  });

  it('different amounts produce different keys', async () => {
    const a = await deriveRefundIdempotencyKey({ orderId: 'o', type: 'partial', refundAmount: 100, priorRefundCount: 0 });
    const b = await deriveRefundIdempotencyKey({ orderId: 'o', type: 'partial', refundAmount: 200, priorRefundCount: 0 });
    expect(a).not.toBe(b);
  });

  it('item order does not change the key (uses normalized line keys)', async () => {
    const a = await deriveRefundIdempotencyKey({ orderId: 'o', type: 'partial', refundAmount: 100, priorRefundCount: 0, items: ['x', 'y', 'z'] });
    const b = await deriveRefundIdempotencyKey({ orderId: 'o', type: 'partial', refundAmount: 100, priorRefundCount: 0, items: ['z', 'y', 'x'] });
    expect(a).toBe(b);
  });

  it('stays within Stripe\'s 255-char idempotency-key cap', async () => {
    const key = await deriveRefundIdempotencyKey({
      orderId: 'WEB-USER-'.padEnd(500, 'X'), // absurdly long order id
      type: 'partial',
      refundAmount: 999999,
      priorRefundCount: 42,
      items: Array.from({ length: 200 }, (_, i) => `sku-${i}`),
    });
    // "refund:" (7) + 64 hex chars = 71, regardless of input size.
    expect(key.length).toBe(71);
    expect(key.length).toBeLessThanOrEqual(255);
  });
});
