/**
 * Unit tests for the storefront shipping model (BMC-242).
 *
 * `resolveShippingOptions` was extracted here from `checkout-charges.ts` so the
 * Chai assistant could read the same rates without pulling in the Stripe SDK.
 * It has three callers now — `/api/shipping-options` (the customer quote), the
 * BMC-201 charge floor, and `lib/ai/deterministic-answers.ts` — so this file
 * pins the module's OWN contract rather than leaving it covered only indirectly
 * through what its callers happen to assert.
 *
 * `freeShippingThresholdMajor` and `freeMethodIds` are new in BMC-242 and are
 * what let a caller state the free-shipping policy without a second settings
 * read or a hardcoded $75; nothing else asserts them as first-class values.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/utils/settings', () => ({ getSettings: vi.fn() }));

import { resolveShippingOptions } from '@/lib/services/shipping-options';
import { getSettings } from '@/lib/utils/settings';

/** `{}` for every category → the module's built-in defaults. */
function withSettings(shipping: Record<string, unknown>, store: Record<string, unknown> = {}) {
  vi.mocked(getSettings).mockImplementation(async (category?: string) =>
    category === 'shipping' ? shipping : store
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  withSettings({}, {});
});

describe('resolveShippingOptions — defaults', () => {
  it('returns the three storefront methods at their documented rates', async () => {
    const { options } = await resolveShippingOptions(0);

    expect(options).toEqual([
      { id: 'standard', label: 'Standard (5–7 days)', cost: 5.99, estimatedDays: 5 },
      { id: 'express', label: 'Express (2–3 days)', cost: 9.99, estimatedDays: 2 },
      { id: 'overnight', label: 'Overnight', cost: 19.99, estimatedDays: 1 },
    ]);
  });

  it('reports the default $75 threshold and NO free methods', async () => {
    // The free-method default is empty on purpose. Migration 0025 turns free
    // shipping off with a row-guarded UPDATE, so a database that never got the
    // original seed has no `shipping.free_methods` row and falls back to this
    // constant — which, as `['standard']`, silently re-enabled free shipping
    // over $75 during the closing sale. The threshold is untouched: it only
    // matters once a method is listed as free.
    const { freeShippingThresholdMajor, freeMethodIds } = await resolveShippingOptions(0);

    expect(freeShippingThresholdMajor).toBe(75);
    expect(freeMethodIds).toEqual([]);
  });

  it('charges every method when no free_methods row exists, however large the cart', async () => {
    const { options, qualifiesForFreeShipping } = await resolveShippingOptions(999999);

    // The threshold is still "cleared" — there is simply nothing it can zero.
    expect(qualifiesForFreeShipping).toBe(true);
    expect(options.map((o) => o.cost)).toEqual([5.99, 9.99, 19.99]);
  });

  it('reads both the shipping and store settings categories', async () => {
    await resolveShippingOptions(0);

    expect(getSettings).toHaveBeenCalledWith('shipping');
    expect(getSettings).toHaveBeenCalledWith('store');
  });
});

describe('resolveShippingOptions — free-shipping threshold', () => {
  it('does NOT discount a subtotal below the threshold', async () => {
    const { options, qualifiesForFreeShipping } = await resolveShippingOptions(7499);

    expect(qualifiesForFreeShipping).toBe(false);
    expect(options.find((o) => o.id === 'standard')!.cost).toBe(5.99);
  });

  it('zeroes only the free methods once the subtotal clears the threshold', async () => {
    // `free_methods` is stated explicitly rather than relying on the module
    // default, which is now empty: this pins the zeroing MECHANIC, which has to
    // keep working if a store ever re-enables free shipping.
    withSettings({ 'shipping.free_methods': ['standard'] });

    // Exactly at the threshold — the comparison is `gte`, and the answer Chai
    // gives says "or more", so this boundary is load-bearing.
    const { options, qualifiesForFreeShipping } = await resolveShippingOptions(7500);

    expect(qualifiesForFreeShipping).toBe(true);
    expect(options.find((o) => o.id === 'standard')!.cost).toBe(0);
    expect(options.find((o) => o.id === 'express')!.cost).toBe(9.99);
  });

  it('fails the perk closed when the subtotal could not be priced', async () => {
    const { options, qualifiesForFreeShipping } = await resolveShippingOptions(20000, {
      subtotalPriceable: false,
    });

    expect(qualifiesForFreeShipping).toBe(false);
    expect(options.find((o) => o.id === 'standard')!.cost).toBe(5.99);
  });

  it('surfaces an admin-configured threshold and free-method set', async () => {
    withSettings(
      { 'shipping.free_methods': ['express'] },
      { 'store.free_shipping_threshold': 120 }
    );

    const { freeShippingThresholdMajor, freeMethodIds, options } =
      await resolveShippingOptions(12000);

    expect(freeShippingThresholdMajor).toBe(120);
    expect(freeMethodIds).toEqual(['express']);
    expect(options.find((o) => o.id === 'express')!.cost).toBe(0);
    expect(options.find((o) => o.id === 'standard')!.cost).toBe(5.99);
  });

  it('coerces a numeric-string threshold rather than returning it as a string', async () => {
    // Settings values arrive JSON-parsed, but a value saved as a quoted number
    // stays a string — callers format this, so it must be a number.
    withSettings({}, { 'store.free_shipping_threshold': '90' });

    const { freeShippingThresholdMajor } = await resolveShippingOptions(0);

    expect(freeShippingThresholdMajor).toBe(90);
  });
});

describe('resolveShippingOptions — admin-configured methods', () => {
  it('drops disabled methods', async () => {
    withSettings({
      'shipping.methods': [
        { id: 'on', label: 'On', cost: 3, estimatedDays: 4, enabled: true },
        { id: 'off', label: 'Off', cost: 4, estimatedDays: 5, enabled: false },
      ],
    });

    const { options } = await resolveShippingOptions(0);

    expect(options.map((o) => o.id)).toEqual(['on']);
  });

  it('returns no options when every method is disabled', async () => {
    withSettings({
      'shipping.methods': [{ id: 'off', label: 'Off', cost: 4, estimatedDays: 5, enabled: false }],
    });

    expect((await resolveShippingOptions(0)).options).toEqual([]);
  });
});

describe('resolveShippingOptions — per-box shipping (GOOB)', () => {
  const STANDARD_ONLY = [
    { id: 'standard', label: 'Standard', cost: 5.99, estimatedDays: 5, enabled: true },
  ];

  it('charges the rate for every box in the cart', async () => {
    withSettings({ 'shipping.per_box_cost': 1, 'shipping.methods': STANDARD_ONLY });

    expect((await resolveShippingOptions(3000, { boxes: 10 })).options[0].cost).toBe(10);
    expect((await resolveShippingOptions(3000, { boxes: 19 })).options[0].cost).toBe(19);
    expect((await resolveShippingOptions(3000, { boxes: 20 })).options[0].cost).toBe(20);
    expect((await resolveShippingOptions(3000, { boxes: 137 })).options[0].cost).toBe(137);
  });

  it('scales with no cliff at any box count', async () => {
    // The whole point of the model: every additional box costs exactly the rate,
    // so there is no boundary where one more box jumps the price by $10 (which
    // is both a sticker shock and a reason to stop one box short of it).
    withSettings({ 'shipping.per_box_cost': 1, 'shipping.methods': STANDARD_ONLY });

    for (let boxes = 10; boxes < 60; boxes++) {
      const here = (await resolveShippingOptions(3000, { boxes })).options[0].cost;
      const next = (await resolveShippingOptions(3000, { boxes: boxes + 1 })).options[0].cost;
      expect(next - here).toBeCloseTo(1, 10);
    }
  });

  it('OUTRANKS the tier bands', async () => {
    // Both models configured at once is reachable — the sale switched from bands
    // to per-box and the band rows are deliberately left in place so switching
    // back is one settings write. The quote, the charge floor, and Chai all
    // resolve through this function, so they can only agree if the precedence
    // lives here rather than at each call site.
    withSettings({
      'shipping.per_box_cost': 1,
      'shipping.tiers': [{ max_boxes: null, cost: 22 }],
      'shipping.methods': STANDARD_ONLY,
    });

    expect((await resolveShippingOptions(3000, { boxes: 10 })).options[0].cost).toBe(10);
  });

  it('bills a minimum of one box when the box count is unknown', async () => {
    // Chai calls this with no cart, so `boxes` is absent. Zero boxes would quote
    // $0 and floor the charge at $0.
    withSettings({ 'shipping.per_box_cost': 1, 'shipping.methods': STANDARD_ONLY });

    expect((await resolveShippingOptions(0)).options[0].cost).toBe(1);
    expect((await resolveShippingOptions(0, { boxes: 0 })).options[0].cost).toBe(1);
  });

  it('keeps sub-cent rates exact across a large cart', async () => {
    // 0.45 * 37 is 16.650000000000002 in float. The quote and the charge floor
    // both resolve through here, so a fraction of a cent apart would reject an
    // honest order at the floor check.
    withSettings({ 'shipping.per_box_cost': 0.45, 'shipping.methods': STANDARD_ONLY });

    expect((await resolveShippingOptions(3000, { boxes: 37 })).options[0].cost).toBe(16.65);
  });

  it('falls back to the tiers or flat rate when the rate is unusable', async () => {
    // Zero, blank, and non-numeric all mean NOT configured. Treating any of them
    // as a rate would ship every order free.
    for (const raw of [0, '', '  ', null, 'free']) {
      withSettings({ 'shipping.per_box_cost': raw, 'shipping.methods': STANDARD_ONLY });
      expect((await resolveShippingOptions(3000, { boxes: 30 })).options[0].cost).toBe(5.99);
    }

    withSettings({
      'shipping.per_box_cost': 0,
      'shipping.tiers': [{ max_boxes: null, cost: 22 }],
      'shipping.methods': STANDARD_ONLY,
    });
    expect((await resolveShippingOptions(3000, { boxes: 30 })).options[0].cost).toBe(22);
  });
});

describe('resolveShippingOptions — quantity tiers (GOOB)', () => {
  const TIERS = [
    { max_boxes: 20, cost: 8 },
    { max_boxes: 40, cost: 14 },
    { max_boxes: null, cost: 22 },
  ];

  it('prices the method from the tier matching the box count', async () => {
    withSettings({
      'shipping.tiers': TIERS,
      'shipping.methods': [
        { id: 'standard', label: 'Standard', cost: 5.99, estimatedDays: 5, enabled: true },
      ],
    });

    const { options } = await resolveShippingOptions(2000, { boxes: 10 });

    expect(options).toEqual([{ id: 'standard', label: 'Standard', cost: 8, estimatedDays: 5 }]);
  });

  it('crosses tiers at the inclusive bound', async () => {
    withSettings({
      'shipping.tiers': TIERS,
      'shipping.methods': [
        { id: 'standard', label: 'Standard', cost: 5.99, estimatedDays: 5, enabled: true },
      ],
    });

    expect((await resolveShippingOptions(2000, { boxes: 20 })).options[0].cost).toBe(8);
    expect((await resolveShippingOptions(2000, { boxes: 21 })).options[0].cost).toBe(14);
    expect((await resolveShippingOptions(2000, { boxes: 41 })).options[0].cost).toBe(22);
  });

  it('ignores the per-method cost entirely once tiers are configured', async () => {
    withSettings({
      'shipping.tiers': [{ max_boxes: null, cost: 22 }],
      'shipping.methods': [
        { id: 'standard', label: 'Standard', cost: 5.99, estimatedDays: 5, enabled: true },
      ],
    });

    expect((await resolveShippingOptions(2000, { boxes: 10 })).options[0].cost).toBe(22);
  });

  // Regression: with every tier bounded, `resolveShippingTier` returned null
  // for a cart above the largest bound and this function read that as "no
  // tiers configured" — so the LARGEST orders both quoted and were charged the
  // flat $5.99. `computeShippingFloorCents` resolves through here too, so the
  // floor agreed and nothing caught the undercharge. A configured tier set
  // must price every cart; the editor warns about the missing open-ended row.
  it('charges the top band above the largest bound rather than the flat rate', async () => {
    withSettings({
      'shipping.tiers': [
        { max_boxes: 20, cost: 8 },
        { max_boxes: 40, cost: 14 },
      ],
      'shipping.methods': [
        { id: 'standard', label: 'Standard', cost: 5.99, estimatedDays: 5, enabled: true },
      ],
    });

    expect((await resolveShippingOptions(2000, { boxes: 60 })).options[0].cost).toBe(14);
  });

  it('keeps the flat per-method cost when no tiers are configured', async () => {
    withSettings({
      'shipping.methods': [
        { id: 'standard', label: 'Standard', cost: 5.99, estimatedDays: 5, enabled: true },
      ],
    });

    expect((await resolveShippingOptions(2000, { boxes: 10 })).options[0].cost).toBe(5.99);
  });

  it('charges the lowest tier when the box count is unknown', async () => {
    // The floor is a MINIMUM the charge must clear, so an unknown count must
    // never invent a higher one and reject an honest order. Callers that can
    // price a cart always know the count; an unpriceable cart is rejected before
    // this is reached.
    withSettings({
      'shipping.tiers': TIERS,
      'shipping.methods': [
        { id: 'standard', label: 'Standard', cost: 5.99, estimatedDays: 5, enabled: true },
      ],
    });

    expect((await resolveShippingOptions(2000)).options[0].cost).toBe(8);
  });

  it('charges nothing for a method still listed as free', async () => {
    // Free shipping is switched off in production by emptying free_methods; the
    // mechanic itself stays intact and must keep working if it is ever re-enabled.
    withSettings(
      {
        'shipping.tiers': TIERS,
        'shipping.methods': [
          { id: 'standard', label: 'Standard', cost: 5.99, estimatedDays: 5, enabled: true },
        ],
        'shipping.free_methods': ['standard'],
      },
      { 'store.free_shipping_threshold': 20 }
    );

    expect((await resolveShippingOptions(2000, { boxes: 10 })).options[0].cost).toBe(0);
  });

  it('charges the tier when free_methods is empty, whatever the threshold says', async () => {
    withSettings(
      {
        'shipping.tiers': TIERS,
        'shipping.methods': [
          { id: 'standard', label: 'Standard', cost: 5.99, estimatedDays: 5, enabled: true },
        ],
        'shipping.free_methods': [],
      },
      { 'store.free_shipping_threshold': 1 }
    );

    expect((await resolveShippingOptions(999999, { boxes: 10 })).options[0].cost).toBe(8);
  });
});
