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

  it('reports the default $75 threshold and free method', async () => {
    const { freeShippingThresholdMajor, freeMethodIds } = await resolveShippingOptions(0);

    expect(freeShippingThresholdMajor).toBe(75);
    expect(freeMethodIds).toEqual(['standard']);
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
