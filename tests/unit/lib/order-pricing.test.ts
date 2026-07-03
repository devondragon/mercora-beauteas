/**
 * Regression test for BMC-131 / C4 — client-controlled checkout total.
 *
 * Before the fix, the charged amount was entirely client-supplied: `/api/orders`
 * stored `total_amount` / `unit_price` verbatim and marked an order paid whenever
 * the bound PaymentIntent had merely succeeded — never checking the money
 * actually collected against real catalog prices. A shopper could pay a $0.50
 * PaymentIntent and then submit an order for expensive goods.
 *
 * `lib/services/order-pricing.ts` is the guard: it recomputes the goods subtotal
 * from the D1 catalog (`product_variants.price`) — NEVER from any client-supplied
 * price — and verifies the server-verified cash received (plus DB-resolved
 * gift-card tender) covers it. These tests exercise that pure logic with the two
 * data-access modules mocked, so it stays a unit test with no Workers runtime
 * dependency (CI `npm test`).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/models/mach/products', () => ({
  getProduct: vi.fn(),
  getProductVariant: vi.fn(),
}));

vi.mock('@/lib/models/mach/giftCard', () => ({
  getGiftCardByCode: vi.fn(),
}));

import {
  computeCatalogSubtotalCents,
  verifyOrderChargeSufficient,
  resolveGiftCardTenderCents,
} from '@/lib/services/order-pricing';
import { getProduct, getProductVariant } from '@/lib/models/mach/products';
import { getGiftCardByCode } from '@/lib/models/mach/giftCard';

// Catalog: one $25.00 variant belonging to product "tea-1".
const VARIANT_TEA = {
  id: 'var-tea-1',
  product_id: 'tea-1',
  price: { amount: 2500, currency: 'USD' },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getProductVariant).mockImplementation(async (id: string) =>
    id === VARIANT_TEA.id ? (VARIANT_TEA as any) : null
  );
  vi.mocked(getProduct).mockResolvedValue(null as any);
  vi.mocked(getGiftCardByCode).mockResolvedValue(null as any);
});

describe('computeCatalogSubtotalCents (BMC-131)', () => {
  it('prices from the catalog and ignores any client-supplied price', async () => {
    // The client claims a laughable unit_price; the catalog is authoritative.
    const { subtotalCents, errors } = await computeCatalogSubtotalCents([
      { product_id: 'tea-1', variant_id: 'var-tea-1', quantity: 2, unit_price: { amount: 1 } } as any,
    ]);
    expect(errors).toEqual([]);
    expect(subtotalCents).toBe(5000); // 2500 × 2, not the client's 1c
  });

  it('reports an error for an unknown variant (fails closed, no silent 0)', async () => {
    const { errors } = await computeCatalogSubtotalCents([
      { product_id: 'tea-1', variant_id: 'does-not-exist', quantity: 1 },
    ]);
    expect(errors.length).toBe(1);
  });

  it('rejects a variant that does not belong to the claimed product', async () => {
    // Cheap variant id paired with an expensive product id must not be priced.
    const { errors } = await computeCatalogSubtotalCents([
      { product_id: 'expensive-product', variant_id: 'var-tea-1', quantity: 1 },
    ]);
    expect(errors.length).toBe(1);
  });
});

describe('verifyOrderChargeSufficient (BMC-131)', () => {
  const items = [{ product_id: 'tea-1', variant_id: 'var-tea-1', quantity: 1 }];

  it('THE EXPLOIT: rejects paying $0.50 for $25.00 of goods', async () => {
    const result = await verifyOrderChargeSufficient({ items, paidAmountCents: 50 });
    expect(result.ok).toBe(false);
    expect(result.goodsCents).toBe(2500);
  });

  it('accepts a payment that covers the catalog goods (within tolerance)', async () => {
    const result = await verifyOrderChargeSufficient({ items, paidAmountCents: 2500 });
    expect(result.ok).toBe(true);
  });

  it('accepts a payment above goods (tax/shipping ride on top)', async () => {
    const result = await verifyOrderChargeSufficient({ items, paidAmountCents: 2999 });
    expect(result.ok).toBe(true);
  });

  it('fails closed when any line cannot be priced from the catalog', async () => {
    const result = await verifyOrderChargeSufficient({
      items: [{ product_id: 'tea-1', variant_id: 'ghost', quantity: 1 }],
      paidAmountCents: 1_000_000,
    });
    expect(result.ok).toBe(false);
  });

  it('credits a gift-card tender resolved from the DB balance, not the client', async () => {
    // Client claims a huge gift-card amount; the card only has $10.00 of balance.
    vi.mocked(getGiftCardByCode).mockResolvedValue({
      code: 'GC-1',
      status: 'active',
      balance: 1000,
    } as any);

    const tender = await resolveGiftCardTenderCents({
      gift_card: { code: 'GC-1', amount: 999_999 },
    });
    expect(tender).toBe(1000); // capped at the live balance

    // With $10 gift card, required cash for $25 goods is $15 → $15 paid passes,
    // but the client can't overstate the tender to pay less.
    const ok = await verifyOrderChargeSufficient({ items, paidAmountCents: 1500, giftCardTenderCents: tender });
    expect(ok.ok).toBe(true);

    const short = await verifyOrderChargeSufficient({ items, paidAmountCents: 1400, giftCardTenderCents: tender });
    expect(short.ok).toBe(false);
  });

  it('ignores gift-card tender when the card is not active', async () => {
    vi.mocked(getGiftCardByCode).mockResolvedValue({
      code: 'GC-DISABLED',
      status: 'disabled',
      balance: 5000,
    } as any);
    const tender = await resolveGiftCardTenderCents({ gift_card: { code: 'GC-DISABLED', amount: 5000 } });
    expect(tender).toBe(0);
  });
});
