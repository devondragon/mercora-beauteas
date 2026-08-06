/**
 * `getSaleRules` is the ONE settings read behind the sale. It lives apart from
 * `lib/sale/rules.ts` because the cart drawer and checkout page import the pure
 * rules into a client bundle, and `getSettings` reaches lib/db →
 * getCloudflareContext plus the whole Drizzle schema barrel.
 *
 * Both booleans default to the SALE posture. A settings outage must never render
 * a storefront that implies returns are accepted or subscriptions still sold.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/utils/settings', () => ({ getSettings: vi.fn() }));

import { getSaleRules } from '@/lib/sale/settings';
import { getSettings } from '@/lib/utils/settings';

function withSettings(sale: Record<string, unknown>, shipping: Record<string, unknown> = {}) {
  vi.mocked(getSettings).mockImplementation(async (category?: string) =>
    category === 'sale' ? sale : shipping
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  withSettings({}, {});
});

describe('getSaleRules', () => {
  it('falls back to a 10-box final sale when nothing is configured', async () => {
    const rules = await getSaleRules();

    expect(rules.minimumBoxes).toBe(10);
    expect(rules.finalSale).toBe(true);
    expect(rules.subscriptionsEnabled).toBe(false);
  });

  it('reads the configured values', async () => {
    withSettings({
      'sale.minimum_boxes': 6,
      'sale.final_sale': false,
      'sale.subscriptions_enabled': true,
    });

    const rules = await getSaleRules();

    expect(rules.minimumBoxes).toBe(6);
    expect(rules.finalSale).toBe(false);
    expect(rules.subscriptionsEnabled).toBe(true);
  });

  it('coerces a numeric-string minimum, as settings values can arrive quoted', async () => {
    withSettings({ 'sale.minimum_boxes': '12' });

    expect((await getSaleRules()).minimumBoxes).toBe(12);
  });

  it('ignores a nonsensical minimum rather than blocking every checkout', async () => {
    withSettings({ 'sale.minimum_boxes': 'lots' });

    expect((await getSaleRules()).minimumBoxes).toBe(10);
  });

  it('reads tiers from the shipping category', async () => {
    withSettings({}, { 'shipping.tiers': [{ max_boxes: null, cost: 12 }] });

    expect((await getSaleRules()).tiers).toEqual([{ max_boxes: null, cost: 12 }]);
  });

  it('returns no tiers when the setting is malformed', async () => {
    withSettings({}, { 'shipping.tiers': 'nonsense' });

    expect((await getSaleRules()).tiers).toEqual([]);
  });
});
