/**
 * Regression tests for BMC-177 — the charge floor ignored cart discounts, so a
 * valid cart coupon whose discount exceeded shipping + tax + tolerance made the
 * shopper's correctly-discounted charge fall below the floor and get rejected
 * with `amount_below_catalog`.
 *
 * `lib/services/discount-pricing.ts` recomputes the cart discount AUTHORITATIVELY
 * from the coupon (never the client number) so the floor can subtract it. It
 * resolves each code via INDEXED lookups (`getCouponInstanceByCode` on the unique
 * code index + `getPromotionById` on the PK) and gates it through the SAME
 * usability primitives the storefront uses — `validateCouponInstance().canBeUsed`
 * (active + within the coupon window + under its usage limit) and the promotion's
 * `checkTimeValidity()`. These tests mock those model reads so the suite stays a
 * pure unit test with no Workers runtime dependency (CI `npm test`); the mocked
 * `validateCouponInstance`/`checkTimeValidity` faithfully mirror the real
 * usability rules so fixtures can express expiry/usage naturally.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/models/mach/couponInstance', () => ({
  getCouponInstanceByCode: vi.fn(),
  validateCouponInstance: vi.fn(),
}));

vi.mock('@/lib/models/mach/promotions', () => ({
  getPromotionById: vi.fn(),
  checkTimeValidity: vi.fn(),
}));

vi.mock('@/lib/models/mach/products', () => ({
  getProduct: vi.fn(),
}));

import { resolveCartDiscountCents, collectCatalogCategoriesByProduct, MAX_DISCOUNT_CODES } from '@/lib/services/discount-pricing';
import { getCouponInstanceByCode, validateCouponInstance } from '@/lib/models/mach/couponInstance';
import { getPromotionById, checkTimeValidity } from '@/lib/models/mach/promotions';
import { getProduct } from '@/lib/models/mach/products';

/** A 25%-off cart promotion (the ticket's acceptance case). */
const PROMO_25_OFF = {
  id: 'promo-25',
  type: 'cart',
  status: 'active',
  rules: { actions: [{ type: 'percentage_discount', value: 25 }] },
};

/** A $10-off cart promotion (fixed, in cents). */
const PROMO_10_FIXED = {
  id: 'promo-10',
  type: 'cart',
  status: 'active',
  rules: { actions: [{ type: 'fixed_discount', value: { amount: 1000, currency: 'USD' } }] },
};

/** A 20%-off cart promotion gated on a $50 minimum subtotal. */
const PROMO_20_MIN50 = {
  id: 'promo-20-min',
  type: 'cart',
  status: 'active',
  rules: {
    conditions: [{ type: 'cart_subtotal', operator: 'gte', value: { amount: 5000, currency: 'USD' } }],
    actions: [{ type: 'percentage_discount', value: 20 }],
  },
};

/** A 25%-off cart promotion gated on the cart containing a CAT-TEA product. */
const PROMO_CAT_TEA = {
  id: 'promo-cat',
  type: 'cart',
  status: 'active',
  rules: {
    conditions: [{ type: 'product_category', operator: 'in', value: ['CAT-TEA'] }],
    actions: [{ type: 'percentage_discount', value: 25 }],
  },
};

function coupon(code: string, promotionId: string, overrides: Record<string, unknown> = {}) {
  return { id: `ci-${code}`, code, promotion_id: promotionId, status: 'active', ...overrides };
}

/**
 * Faithful stand-in for the real `validateCouponInstance().canBeUsed`: active +
 * within [valid_from, valid_to) + under usage_limit. Keeps the resolver's
 * usability gate under test without loading the DB-backed model.
 */
function fakeCanBeUsed(c: any) {
  const now = new Date();
  const canBeUsed =
    (c.status === 'active' || c.status === undefined) &&
    (!c.valid_from || new Date(c.valid_from) <= now) &&
    (!c.valid_to || new Date(c.valid_to) > now) &&
    (!c.usage_limit || (c.usage_count || 0) < c.usage_limit);
  return { isValid: true, canBeUsed, errors: [], warnings: [] };
}

/** Faithful stand-in for the real promotion `checkTimeValidity()`. */
function fakeInWindow(p: any) {
  const now = new Date();
  if (p.valid_from && new Date(p.valid_from) > now) return false;
  if (p.valid_to && new Date(p.valid_to) < now) return false;
  return true;
}

/** Wire the indexed lookups to resolve from in-memory registries (by code / id). */
function seed(coupons: any[], promotions: any[]) {
  const byCode = new Map(coupons.map((c) => [c.code, c]));
  const byId = new Map(promotions.map((p) => [p.id, p]));
  vi.mocked(getCouponInstanceByCode).mockImplementation(async (code: string) => (byCode.get(code) ?? null) as any);
  vi.mocked(getPromotionById).mockImplementation(async (id: string) => (byId.get(id) ?? null) as any);
}

/** Register catalog products (with categories) for server-side category checks. */
function seedProducts(products: Array<{ id: string; categories?: string[] }>) {
  const byId = new Map(products.map((p) => [p.id, p]));
  vi.mocked(getProduct).mockImplementation(async (id: string) => (byId.get(id) ?? null) as any);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getCouponInstanceByCode).mockResolvedValue(null as any);
  vi.mocked(getPromotionById).mockResolvedValue(null as any);
  vi.mocked(getProduct).mockResolvedValue(null as any);
  vi.mocked(validateCouponInstance).mockImplementation(fakeCanBeUsed as any);
  vi.mocked(checkTimeValidity).mockImplementation(fakeInWindow as any);
});

describe('resolveCartDiscountCents (BMC-177)', () => {
  it('returns 0 when no codes are supplied', async () => {
    expect(await resolveCartDiscountCents(undefined, 10000)).toBe(0);
    expect(await resolveCartDiscountCents([], 10000)).toBe(0);
    expect(await resolveCartDiscountCents('', 10000)).toBe(0);
  });

  it('returns 0 for a zero subtotal without hitting the DB', async () => {
    expect(await resolveCartDiscountCents('SAVE25', 0)).toBe(0);
    expect(getCouponInstanceByCode).not.toHaveBeenCalled();
  });

  it('applies a 25%-off cart coupon against the catalog subtotal (acceptance case)', async () => {
    seed([coupon('SAVE25', 'promo-25')], [PROMO_25_OFF]);
    // $100.00 subtotal → 25% → $25.00
    expect(await resolveCartDiscountCents('SAVE25', 10000)).toBe(2500);
  });

  it('looks the coupon up by its (unique, indexed) code — no full-table scan', async () => {
    seed([coupon('SAVE25', 'promo-25')], [PROMO_25_OFF]);
    await resolveCartDiscountCents('save25', 10000);
    // Normalized to upper-case for the exact-match index lookup.
    expect(vi.mocked(getCouponInstanceByCode)).toHaveBeenCalledWith('SAVE25');
    expect(vi.mocked(getPromotionById)).toHaveBeenCalledWith('promo-25');
  });

  it('matches coupon codes case-insensitively', async () => {
    seed([coupon('SAVE25', 'promo-25')], [PROMO_25_OFF]);
    expect(await resolveCartDiscountCents('save25', 10000)).toBe(2500);
    expect(await resolveCartDiscountCents('  Save25 ', 10000)).toBe(2500);
  });

  it('applies a fixed cart discount capped at the subtotal', async () => {
    seed([coupon('TENOFF', 'promo-10')], [PROMO_10_FIXED]);
    expect(await resolveCartDiscountCents('TENOFF', 10000)).toBe(1000);
    // Never exceeds the subtotal.
    expect(await resolveCartDiscountCents('TENOFF', 600)).toBe(600);
  });

  it('honors a cart_subtotal minimum condition', async () => {
    seed([coupon('MIN50', 'promo-20-min')], [PROMO_20_MIN50]);
    // Below the $50 minimum → no discount.
    expect(await resolveCartDiscountCents('MIN50', 4999)).toBe(0);
    // At/above the minimum → 20%.
    expect(await resolveCartDiscountCents('MIN50', 5000)).toBe(1000);
  });

  it('fails closed for an inactive coupon', async () => {
    seed([coupon('SAVE25', 'promo-25', { status: 'disabled' })], [PROMO_25_OFF]);
    expect(await resolveCartDiscountCents('SAVE25', 10000)).toBe(0);
  });

  it('fails closed for an expired coupon (past valid_to)', async () => {
    seed([coupon('SAVE25', 'promo-25', { valid_to: '2020-01-01T00:00:00.000Z' })], [PROMO_25_OFF]);
    expect(await resolveCartDiscountCents('SAVE25', 10000)).toBe(0);
  });

  it('fails closed for a not-yet-active coupon (future valid_from)', async () => {
    seed([coupon('SAVE25', 'promo-25', { valid_from: '2999-01-01T00:00:00.000Z' })], [PROMO_25_OFF]);
    expect(await resolveCartDiscountCents('SAVE25', 10000)).toBe(0);
  });

  it('fails closed for a coupon at its usage limit', async () => {
    seed([coupon('SAVE25', 'promo-25', { usage_limit: 1, usage_count: 1 })], [PROMO_25_OFF]);
    expect(await resolveCartDiscountCents('SAVE25', 10000)).toBe(0);
  });

  it('applies a coupon that is within its validity window', async () => {
    seed(
      [coupon('SAVE25', 'promo-25', { valid_from: '2020-01-01T00:00:00.000Z', valid_to: '2999-01-01T00:00:00.000Z' })],
      [PROMO_25_OFF]
    );
    expect(await resolveCartDiscountCents('SAVE25', 10000)).toBe(2500);
  });

  it('fails closed for an inactive promotion', async () => {
    seed([coupon('SAVE25', 'promo-25')], [{ ...PROMO_25_OFF, status: 'paused' }]);
    expect(await resolveCartDiscountCents('SAVE25', 10000)).toBe(0);
  });

  it('fails closed for an out-of-window promotion (past valid_to)', async () => {
    seed([coupon('SAVE25', 'promo-25')], [{ ...PROMO_25_OFF, valid_to: '2020-01-01T00:00:00.000Z' }]);
    expect(await resolveCartDiscountCents('SAVE25', 10000)).toBe(0);
  });

  it('ignores non-cart promotions (shipping/product do not reduce the goods floor)', async () => {
    seed(
      [coupon('FREESHIP', 'promo-ship'), coupon('PROD30', 'promo-prod')],
      [
        { id: 'promo-ship', type: 'shipping', status: 'active', rules: { actions: [{ type: 'shipping_percentage_discount', value: 100 }] } },
        { id: 'promo-prod', type: 'product', status: 'active', rules: { actions: [{ type: 'item_percentage_discount', value: 30 }] } },
      ]
    );
    expect(await resolveCartDiscountCents('FREESHIP', 10000)).toBe(0);
    expect(await resolveCartDiscountCents('PROD30', 10000)).toBe(0);
  });

  it('credits a category-gated cart promo when a CATALOG category qualifies', async () => {
    seed([coupon('CATTEA', 'promo-cat')], [PROMO_CAT_TEA]);
    seedProducts([{ id: 'tea-1', categories: ['CAT-TEA'] }]);
    const items = [{ product_id: 'tea-1', quantity: 1 }];
    expect(await resolveCartDiscountCents('CATTEA', 10000, items)).toBe(2500);
  });

  it('derives categories from the CATALOG, not the client — a non-qualifying cart gets 0', async () => {
    seed([coupon('CATTEA', 'promo-cat')], [PROMO_CAT_TEA]);
    // The product's real catalog category is CAT-MERCH, so the CAT-TEA-gated promo
    // must NOT apply — even if a client claimed otherwise, the floor uses catalog truth.
    seedProducts([{ id: 'mug-1', categories: ['CAT-MERCH'] }]);
    const items = [{ product_id: 'mug-1', quantity: 1 }];
    expect(await resolveCartDiscountCents('CATTEA', 10000, items)).toBe(0);
  });

  it('fails closed for a category-gated cart promo when items are omitted (unverifiable)', async () => {
    seed([coupon('CATTEA', 'promo-cat')], [PROMO_CAT_TEA]);
    expect(await resolveCartDiscountCents('CATTEA', 10000)).toBe(0);
  });

  it('reads the catalog only when a promotion actually gates on category', async () => {
    // A plain percentage promo (no product_category condition) must not trigger
    // any getProduct reads, even when items are supplied.
    seed([coupon('SAVE25', 'promo-25')], [PROMO_25_OFF]);
    await resolveCartDiscountCents('SAVE25', 10000, [{ product_id: 'tea-1', quantity: 1 }]);
    expect(getProduct).not.toHaveBeenCalled();
  });

  it('returns 0 for an unknown code', async () => {
    seed([coupon('SAVE25', 'promo-25')], [PROMO_25_OFF]);
    expect(await resolveCartDiscountCents('NOPE', 10000)).toBe(0);
  });

  it('sums multiple valid cart coupons, capped at the subtotal', async () => {
    seed([coupon('SAVE25', 'promo-25'), coupon('TENOFF', 'promo-10')], [PROMO_25_OFF, PROMO_10_FIXED]);
    // 25% of $100 ($25) + $10 = $35
    expect(await resolveCartDiscountCents(['SAVE25', 'TENOFF'], 10000)).toBe(3500);
    // Combined discount can never exceed the subtotal.
    expect(await resolveCartDiscountCents(['SAVE25', 'TENOFF'], 1000)).toBe(1000);
  });

  it('de-duplicates repeated codes so a coupon is only counted once', async () => {
    seed([coupon('SAVE25', 'promo-25')], [PROMO_25_OFF]);
    expect(await resolveCartDiscountCents(['SAVE25', 'save25', ' SAVE25 '], 10000)).toBe(2500);
  });

  it('credits a promotion ONCE even when two distinct codes resolve to it (no double-credit under-pay)', async () => {
    // Two different bulk codes for the SAME 25%-off promotion. The cart store
    // dedups by promotionId, so the shopper's charge only ever reflects 25%.
    // The floor must match — crediting 25% ($25), not 50% ($50) — or a client
    // could stack same-promotion codes to under-pay (BMC-177 review, Finding 1).
    seed([coupon('WELCOME25', 'promo-25'), coupon('PARTNER25', 'promo-25')], [PROMO_25_OFF]);
    expect(await resolveCartDiscountCents(['WELCOME25', 'PARTNER25'], 10000)).toBe(2500);
  });

  it('caps the resolved code list at MAX_DISCOUNT_CODES (bounds pre-auth work)', async () => {
    seed([coupon('SAVE25', 'promo-25')], [PROMO_25_OFF]);
    const many = Array.from({ length: MAX_DISCOUNT_CODES + 5 }, (_, i) => `CODE${i}`);
    await resolveCartDiscountCents(many, 10000);
    // Only the first MAX_DISCOUNT_CODES distinct codes drive a lookup.
    expect(vi.mocked(getCouponInstanceByCode).mock.calls.length).toBe(MAX_DISCOUNT_CODES);
  });
});

describe('collectCatalogCategoriesByProduct (BMC-198 shared helper)', () => {
  it('maps each distinct product id to its catalog categories', async () => {
    seedProducts([
      { id: 'tea-1', categories: ['CAT-TEA', 'CAT-ORGANIC'] },
      { id: 'mug-1', categories: ['CAT-MERCH'] },
    ]);
    const map = await collectCatalogCategoriesByProduct(['tea-1', 'mug-1']);
    expect(map.get('tea-1')).toEqual(['CAT-TEA', 'CAT-ORGANIC']);
    expect(map.get('mug-1')).toEqual(['CAT-MERCH']);
  });

  it('reads the catalog once per DISTINCT id and skips falsy ids', async () => {
    seedProducts([{ id: 'tea-1', categories: ['CAT-TEA'] }]);
    await collectCatalogCategoriesByProduct(['tea-1', 'tea-1', undefined, '']);
    expect(vi.mocked(getProduct)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(getProduct)).toHaveBeenCalledWith('tea-1');
  });

  it('drops non-string ids so a malformed untrusted body fails closed, never hitting getProduct', async () => {
    // /api/validate-discount feeds this straight from request.json(); a bad
    // productId (object/number/null) must be filtered here rather than reach
    // getProduct() and 500 the public endpoint (Copilot review, BMC-198).
    seedProducts([{ id: 'tea-1', categories: ['CAT-TEA'] }]);
    const map = await collectCatalogCategoriesByProduct([
      'tea-1',
      { evil: true } as any,
      42 as any,
      null as any,
    ]);
    expect(vi.mocked(getProduct)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(getProduct)).toHaveBeenCalledWith('tea-1');
    expect(map.get('tea-1')).toEqual(['CAT-TEA']);
  });

  it('keeps only string categories and yields an empty list for an unknown product', async () => {
    // A catalog `categories` entry can be a non-string; only strings survive, so
    // the floor and validate-discount evaluate the identical set.
    seedProducts([{ id: 'tea-1', categories: ['CAT-TEA', 42 as any, null as any] }]);
    const map = await collectCatalogCategoriesByProduct(['tea-1', 'ghost']);
    expect(map.get('tea-1')).toEqual(['CAT-TEA']);
    expect(map.get('ghost')).toEqual([]);
  });
});
