/**
 * Regression tests for BMC-131 / C4 — client-controlled checkout total, plus
 * the follow-up hardening from the code review (C1–C3, M5, L2–L4).
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
 * gift-card tender) covers it. It must FAIL CLOSED for every line it cannot
 * price authoritatively, and must never throw or return a poisoned (NaN) subtotal
 * that silently passes the sufficiency check. These tests exercise that pure
 * logic with the two data-access modules mocked, so it stays a unit test with no
 * Workers runtime dependency (CI `npm test`).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/models/mach/products', () => ({
  getProduct: vi.fn(),
  getProductVariant: vi.fn(),
}));

vi.mock('@/lib/models/mach/giftCard', () => ({
  getGiftCardByCode: vi.fn(),
}));

// BMC-177: the charge gate now recomputes the cart discount server-side. Mock the
// resolver so these tests pin the FLOOR arithmetic deterministically; the resolver
// itself is exercised in tests/unit/lib/services/discount-pricing.test.ts.
vi.mock('@/lib/services/discount-pricing', () => ({
  resolveCartDiscountCents: vi.fn(),
}));

import {
  computeCatalogSubtotalCents,
  computeCatalogLineCents,
  verifyOrderChargeSufficient,
  resolveGiftCardTenderCents,
  canonicalizeOrderItemsDisplay,
  AMOUNT_TOLERANCE_CENTS,
} from '@/lib/services/order-pricing';
import { getProduct, getProductVariant } from '@/lib/models/mach/products';
import { getGiftCardByCode } from '@/lib/models/mach/giftCard';
import { resolveCartDiscountCents } from '@/lib/services/discount-pricing';

// Catalog: one $25.00 variant belonging to product "tea-1".
const VARIANT_TEA = {
  id: 'var-tea-1',
  product_id: 'tea-1',
  price: { amount: 2500, currency: 'USD' },
};

// A product whose default variant is the $25 variant above (used to exercise the
// omitted-variant_id fallback path, which the original tests never covered).
const PRODUCT_TEA = {
  id: 'tea-1',
  default_variant_id: 'var-tea-1',
  variants: [VARIANT_TEA],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getProductVariant).mockImplementation(async (id: string) =>
    id === VARIANT_TEA.id ? (VARIANT_TEA as any) : null
  );
  vi.mocked(getProduct).mockResolvedValue(null as any);
  vi.mocked(getGiftCardByCode).mockResolvedValue(null as any);
  // Default: no cart discount unless a test opts in.
  vi.mocked(resolveCartDiscountCents).mockResolvedValue(0);
});

describe('computeCatalogSubtotalCents (BMC-131)', () => {
  it('rejects a forged launch-disabled gift-card purchase line before catalog lookup', async () => {
    const result = await computeCatalogSubtotalCents([
      { product_id: 'gift-card', variant_id: 'gift-card-25', quantity: 1 },
    ]);
    expect(result.errors[0]).toContain('launch-disabled gift-card purchase');
    expect(vi.mocked(getProductVariant)).not.toHaveBeenCalled();
  });

  it('rejects a gift-card variant even when a forged line omits product_id', async () => {
    vi.mocked(getProductVariant).mockResolvedValue({
      id: 'gift-card-25',
      product_id: 'gift-card',
      price: { amount: 2500, currency: 'USD' },
    } as any);

    const result = await computeCatalogSubtotalCents([
      { variant_id: 'gift-card-25', quantity: 1 },
    ]);

    expect(result.subtotalCents).toBe(0);
    expect(result.errors[0]).toContain('launch-disabled gift-card purchase');
  });

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
    // GOOB: the withdrawal guard (isSellableVariant) now runs before
    // catalogUnitPriceCents and treats an unresolvable variant as not
    // sellable, so the line fails closed with a "withdrawn" reason rather
    // than the later "no catalog price" message. Still exactly one error —
    // the line is still unpriceable either way.
    expect(errors[0]).toContain('withdrawn');
  });

  it('rejects a variant that does not belong to the claimed product', async () => {
    // Cheap variant id paired with an expensive product id must not be priced.
    const { errors } = await computeCatalogSubtotalCents([
      { product_id: 'expensive-product', variant_id: 'var-tea-1', quantity: 1 },
    ]);
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain('does not belong');
  });

  // ── C2: non-numeric quantity must not poison the subtotal to NaN ──────────
  it('C2: fails closed for a non-numeric quantity instead of returning NaN', async () => {
    const { subtotalCents, errors } = await computeCatalogSubtotalCents([
      { product_id: 'tea-1', variant_id: 'var-tea-1', quantity: 'x' as any },
    ]);
    // Must NOT be NaN (a NaN subtotal silently passes the sufficiency check).
    expect(Number.isNaN(subtotalCents)).toBe(false);
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain('quantity');
  });

  it('C2: fails closed for a non-integer/array quantity', async () => {
    const { subtotalCents, errors } = await computeCatalogSubtotalCents([
      { product_id: 'tea-1', variant_id: 'var-tea-1', quantity: [1, 2] as any },
    ]);
    expect(Number.isNaN(subtotalCents)).toBe(false);
    expect(errors.length).toBe(1);
  });

  it('C2: fails closed for zero / negative quantity (cannot understate goods)', async () => {
    const zero = await computeCatalogSubtotalCents([
      { product_id: 'tea-1', variant_id: 'var-tea-1', quantity: 0 },
    ]);
    expect(zero.errors.length).toBe(1);
    const negative = await computeCatalogSubtotalCents([
      { product_id: 'tea-1', variant_id: 'var-tea-1', quantity: -3 },
    ]);
    expect(negative.errors.length).toBe(1);
  });

  it('C2: a valid fractional quantity is floored, not rejected', async () => {
    const { subtotalCents, errors } = await computeCatalogSubtotalCents([
      { product_id: 'tea-1', variant_id: 'var-tea-1', quantity: 2.9 },
    ]);
    expect(errors).toEqual([]);
    expect(subtotalCents).toBe(5000); // floor(2.9) = 2
  });

  // ── C1 defense: malformed items must not throw ────────────────────────────
  it('C1: a null item in the array fails closed instead of throwing', async () => {
    const { subtotalCents, errors } = await computeCatalogSubtotalCents([
      null as any,
      { product_id: 'tea-1', variant_id: 'var-tea-1', quantity: 1 },
    ]);
    expect(Number.isNaN(subtotalCents)).toBe(false);
    expect(errors.length).toBe(1); // the null line, not the valid one
  });

  it('C1: a non-object item fails closed instead of throwing', async () => {
    const { errors } = await computeCatalogSubtotalCents(['garbage' as any]);
    expect(errors.length).toBe(1);
  });

  // ── C3: an unresolvable variant_id must NOT silently fall back to default ──
  it('C3: a supplied-but-unresolvable variant_id fails closed even with a valid product_id', async () => {
    // The product exists (has a cheap default variant), but the SUPPLIED
    // variant_id doesn't resolve. Pricing must fail, not silently substitute
    // the default variant's (potentially cheaper) price.
    vi.mocked(getProduct).mockResolvedValue(PRODUCT_TEA as any);
    const { errors } = await computeCatalogSubtotalCents([
      { product_id: 'tea-1', variant_id: 'bogus-variant', quantity: 1 },
    ]);
    expect(errors.length).toBe(1);
  });

  it('C3: an OMITTED variant_id still resolves via the product default variant', async () => {
    vi.mocked(getProduct).mockResolvedValue(PRODUCT_TEA as any);
    const { subtotalCents, errors } = await computeCatalogSubtotalCents([
      { product_id: 'tea-1', quantity: 1 },
    ]);
    expect(errors).toEqual([]);
    expect(subtotalCents).toBe(2500);
  });
});

describe('priceToCents legacy formats via computeCatalogSubtotalCents (M5)', () => {
  const priceLine = { product_id: 'tea-1', variant_id: 'var-legacy', quantity: 1 };
  function mockVariantPrice(price: unknown) {
    vi.mocked(getProductVariant).mockImplementation(async (id: string) =>
      id === 'var-legacy' ? ({ id: 'var-legacy', product_id: 'tea-1', price } as any) : null
    );
  }

  it('prices a bare numeric-string price', async () => {
    mockVariantPrice('2500');
    const { subtotalCents, errors } = await computeCatalogSubtotalCents([priceLine]);
    expect(errors).toEqual([]);
    expect(subtotalCents).toBe(2500);
  });

  it('prices a bare number price (legacy row)', async () => {
    mockVariantPrice(2500);
    const { subtotalCents, errors } = await computeCatalogSubtotalCents([priceLine]);
    expect(errors).toEqual([]);
    expect(subtotalCents).toBe(2500);
  });

  it('prices a JSON-string Money price', async () => {
    mockVariantPrice('{"amount":2500,"currency":"USD"}');
    const { subtotalCents, errors } = await computeCatalogSubtotalCents([priceLine]);
    expect(errors).toEqual([]);
    expect(subtotalCents).toBe(2500);
  });

  it('fails closed on malformed JSON price (no silent 0)', async () => {
    mockVariantPrice('{bad json');
    const { errors } = await computeCatalogSubtotalCents([priceLine]);
    expect(errors.length).toBe(1);
  });

  it('fails closed on a negative price (must never reduce the subtotal)', async () => {
    mockVariantPrice({ amount: -100, currency: 'USD' });
    const { errors } = await computeCatalogSubtotalCents([priceLine]);
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

  it('C2: a NaN-inducing quantity fails closed (does not fall through to ok)', async () => {
    const result = await verifyOrderChargeSufficient({
      items: [{ product_id: 'tea-1', variant_id: 'var-tea-1', quantity: 'x' as any }],
      paidAmountCents: 50,
    });
    expect(result.ok).toBe(false);
  });

  // ── L2: exercise the tolerance boundary exactly ───────────────────────────
  it('L2: accepts paying exactly required − TOLERANCE (boundary passes)', async () => {
    const result = await verifyOrderChargeSufficient({
      items,
      paidAmountCents: 2500 - AMOUNT_TOLERANCE_CENTS,
    });
    expect(result.ok).toBe(true);
  });

  it('L2: rejects paying required − TOLERANCE − 1 (just past the boundary)', async () => {
    const result = await verifyOrderChargeSufficient({
      items,
      paidAmountCents: 2500 - AMOUNT_TOLERANCE_CENTS - 1,
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
});

describe('verifyOrderChargeSufficient cart discount floor (BMC-177)', () => {
  const items = [{ product_id: 'tea-1', variant_id: 'var-tea-1', quantity: 1 }];

  it('THE BUG: accepts the discounted total for a 25%-off cart coupon', async () => {
    // $25 goods, 25% off → required cash $18.75. Before the fix the floor
    // demanded the full $25 and rejected this legitimate promo checkout.
    vi.mocked(resolveCartDiscountCents).mockResolvedValue(625);
    const result = await verifyOrderChargeSufficient({
      items,
      paidAmountCents: 1875,
      discountCodes: ['SAVE25'],
    });
    expect(result.ok).toBe(true);
    expect(result.discountCents).toBe(625);
    expect(result.requiredCashCents).toBe(1875);
  });

  it('recomputes the discount from the coupon against the catalog goods subtotal', async () => {
    vi.mocked(resolveCartDiscountCents).mockResolvedValue(625);
    await verifyOrderChargeSufficient({ items, paidAmountCents: 1875, discountCodes: ['SAVE25'] });
    // Server subtotal (2500c), NOT any client number, drives the recompute; items
    // are threaded through so category-gated promotions verify against the catalog.
    expect(vi.mocked(resolveCartDiscountCents)).toHaveBeenCalledWith(['SAVE25'], 2500, items);
  });

  it('still rejects paying below the DISCOUNTED floor (no under-pay via a real coupon)', async () => {
    vi.mocked(resolveCartDiscountCents).mockResolvedValue(625);
    const result = await verifyOrderChargeSufficient({
      items,
      paidAmountCents: 1000, // well under the $18.75 discounted floor
      discountCodes: ['SAVE25'],
    });
    expect(result.ok).toBe(false);
  });

  it('stacks the discount with a gift-card tender', async () => {
    // $25 goods − $6.25 discount − $10 gift card → $8.75 required cash.
    vi.mocked(resolveCartDiscountCents).mockResolvedValue(625);
    const result = await verifyOrderChargeSufficient({
      items,
      paidAmountCents: 875,
      giftCardTenderCents: 1000,
      discountCodes: ['SAVE25'],
    });
    expect(result.ok).toBe(true);
    expect(result.requiredCashCents).toBe(875);
  });

  it('does not credit a discount when no codes are supplied (MCP / non-promo path)', async () => {
    const result = await verifyOrderChargeSufficient({ items, paidAmountCents: 1875 });
    expect(result.ok).toBe(false); // full $25 floor still enforced
    expect(result.discountCents).toBe(0);
  });
});

// ── M1: server-side canonicalization of fulfillment display fields ──────────
describe('canonicalizeOrderItemsDisplay (M1 — fulfillment spoofing)', () => {
  it('overwrites a spoofed product_name/imageUrl with catalog truth', async () => {
    vi.mocked(getProduct).mockResolvedValue({
      id: 'tea-1',
      name: 'Clearly Calendula Morning',
      primary_image: 'https://cdn/real.jpg',
      default_variant_id: 'var-tea-1',
      variants: [VARIANT_TEA],
    } as any);

    const [line] = await canonicalizeOrderItemsDisplay([
      {
        product_id: 'tea-1',
        variant_id: 'var-tea-1',
        quantity: 1,
        product_name: 'A $500 Luxury Spa Set', // spoofed
        imageUrl: 'https://evil/expensive.jpg',
      },
    ]);
    expect(line.product_name).toBe('Clearly Calendula Morning');
    expect(line.imageUrl).toBe('https://cdn/real.jpg');
  });

  it('coerces an i18n object name to a display string', async () => {
    vi.mocked(getProduct).mockResolvedValue({
      id: 'tea-1',
      name: { en: 'Morning Blend', fr: 'Mélange du matin' },
      variants: [VARIANT_TEA],
    } as any);
    const [line] = await canonicalizeOrderItemsDisplay([
      { product_id: 'tea-1', variant_id: 'var-tea-1', quantity: 1, product_name: 'spoof' },
    ]);
    expect(line.product_name).toBe('Morning Blend');
  });

  it('leaves gift-card lines untouched', async () => {
    const giftLine = { product_id: 'gift-card', quantity: 1, product_name: 'Gift Card', unit_price: { amount: 2500 } };
    const [line] = await canonicalizeOrderItemsDisplay([giftLine]);
    expect(line).toEqual(giftLine);
    expect(vi.mocked(getProduct)).not.toHaveBeenCalled();
  });

  it('leaves a line whose product cannot be resolved untouched', async () => {
    vi.mocked(getProduct).mockResolvedValue(null as any);
    const orig = { product_id: 'ghost', quantity: 1, product_name: 'whatever' };
    const [line] = await canonicalizeOrderItemsDisplay([orig]);
    expect(line).toEqual(orig);
  });
});

// ── L3: resolveGiftCardTenderCents guard clauses ────────────────────────────
describe('resolveGiftCardTenderCents guard clauses (L3)', () => {
  it('returns 0 for null/undefined extensions without touching the DB', async () => {
    expect(await resolveGiftCardTenderCents(undefined)).toBe(0);
    expect(await resolveGiftCardTenderCents(null)).toBe(0);
    expect(vi.mocked(getGiftCardByCode)).not.toHaveBeenCalled();
  });

  it('returns 0 when gift_card has no code (no DB call)', async () => {
    expect(await resolveGiftCardTenderCents({ gift_card: { amount: 500 } })).toBe(0);
    expect(vi.mocked(getGiftCardByCode)).not.toHaveBeenCalled();
  });

  it('returns 0 when the requested amount is zero/absent (short-circuits DB)', async () => {
    expect(await resolveGiftCardTenderCents({ gift_card: { code: 'GC-1', amount: 0 } })).toBe(0);
    expect(await resolveGiftCardTenderCents({ gift_card: { code: 'GC-1' } })).toBe(0);
    expect(vi.mocked(getGiftCardByCode)).not.toHaveBeenCalled();
  });

  it('returns 0 when the card code does not exist', async () => {
    vi.mocked(getGiftCardByCode).mockResolvedValue(null as any);
    expect(await resolveGiftCardTenderCents({ gift_card: { code: 'GC-GHOST', amount: 500 } })).toBe(0);
  });

  it('ignores tender when the card is not active', async () => {
    vi.mocked(getGiftCardByCode).mockResolvedValue({
      code: 'GC-DISABLED',
      status: 'disabled',
      balance: 5000,
    } as any);
    expect(await resolveGiftCardTenderCents({ gift_card: { code: 'GC-DISABLED', amount: 5000 } })).toBe(0);
  });
});

describe('computeCatalogLineCents — withdrawn catalog entries (GOOB)', () => {
  it('refuses to price a line whose product is archived', async () => {
    vi.mocked(getProductVariant).mockResolvedValue({
      id: 'var-bundle',
      product_id: 'bundle-1',
      status: 'active',
      price: { amount: 4500, currency: 'USD' },
    } as any);
    vi.mocked(getProduct).mockResolvedValue({
      id: 'bundle-1',
      slug: 'clearly-calendula-sample-pack',
      status: 'archived',
    } as any);

    const [line] = await computeCatalogLineCents([
      { product_id: 'bundle-1', variant_id: 'var-bundle', quantity: 1 },
    ]);

    expect(line).toHaveProperty('error');
    expect((line as { error: string }).error).toMatch(/withdrawn/i);
  });

  it('refuses to price a line whose variant is discontinued', async () => {
    vi.mocked(getProductVariant).mockResolvedValue({
      id: 'var-old',
      product_id: 'tea-1',
      status: 'discontinued',
      price: { amount: 2500, currency: 'USD' },
    } as any);
    vi.mocked(getProduct).mockResolvedValue({
      id: 'tea-1',
      slug: 'morning',
      status: 'active',
    } as any);

    const [line] = await computeCatalogLineCents([
      { product_id: 'tea-1', variant_id: 'var-old', quantity: 1 },
    ]);

    expect(line).toHaveProperty('error');
    expect((line as { error: string }).error).toMatch(/withdrawn/i);
  });

  it('still prices an active product and variant', async () => {
    vi.mocked(getProductVariant).mockResolvedValue({
      id: 'var-tea-1',
      product_id: 'tea-1',
      status: 'active',
      price: { amount: 200, currency: 'USD' },
    } as any);
    vi.mocked(getProduct).mockResolvedValue({
      id: 'tea-1',
      slug: 'morning',
      status: 'active',
    } as any);

    const [line] = await computeCatalogLineCents([
      { product_id: 'tea-1', variant_id: 'var-tea-1', quantity: 10 },
    ]);

    expect(line).toEqual({ cents: 2000 });
  });
});

// The gift-card control, the withdrawal guard, and the price lookup each used
// to issue their own catalog reads for the same line, and neither model
// function caches — so a line cost up to three reads of one variant row and
// two of one product row. `/api/tax`, `/api/payment-intent`, and `/api/orders`
// all run through here with up to MAX_ORDER_LINE_ITEMS (100) lines.
describe('computeCatalogLineCents — catalog reads per line', () => {
  beforeEach(() => {
    vi.mocked(getProductVariant).mockResolvedValue({
      id: 'var-tea-1',
      product_id: 'tea-1',
      status: 'active',
      price: { amount: 200, currency: 'USD' },
    } as any);
    vi.mocked(getProduct).mockResolvedValue({
      id: 'tea-1',
      slug: 'morning',
      status: 'active',
    } as any);
  });

  it('reads each variant and product row once per line', async () => {
    await computeCatalogLineCents([{ product_id: 'tea-1', variant_id: 'var-tea-1', quantity: 1 }]);

    expect(vi.mocked(getProductVariant)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(getProduct)).toHaveBeenCalledTimes(1);
  });

  it('does not share reads across lines — each line stays independent', async () => {
    await computeCatalogLineCents([
      { product_id: 'tea-1', variant_id: 'var-tea-1', quantity: 1 },
      { product_id: 'tea-1', variant_id: 'var-tea-1', quantity: 2 },
    ]);

    expect(vi.mocked(getProductVariant)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(getProduct)).toHaveBeenCalledTimes(2);
  });
});
