/**
 * Regression tests for admin settings row parsing.
 *
 * The admin settings page called `JSON.parse(setting.value)` unguarded inside a
 * `forEach`. Production carries eleven legacy rows holding BARE strings rather
 * than JSON (currency = USD, promo_message = 🍵 Holiday Sale..., social_instagram
 * = https://..., store_name = BeauTeas, ...). The first one threw, the loop
 * aborted, the page's outer catch swallowed it, and no settings loaded at all —
 * every field silently kept its hardcoded default.
 *
 * Because that page then saves every category from the same state, one Save
 * wrote defaults over all 31 stored settings on production: per-box shipping off,
 * free shipping over $75 restored mid-closing-sale, the express and overnight
 * methods migration 0028 disabled turned back on, and the banner copy replaced.
 * Nothing errored and the page looked normal the whole time.
 *
 * So the contract under test is narrow and absolute: ONE unparseable row must
 * never cost you the others.
 */
import { describe, it, expect } from 'vitest';

import { parseSettingValue, parseSettingRows } from '@/lib/admin/settings-parse';

describe('parseSettingValue', () => {
  it('parses JSON rows', () => {
    expect(parseSettingValue('1')).toBe(1);
    expect(parseSettingValue('true')).toBe(true);
    expect(parseSettingValue('"USD"')).toBe('USD');
    expect(parseSettingValue('[]')).toEqual([]);
    expect(parseSettingValue('{"a":1}')).toEqual({ a: 1 });
  });

  it('returns a bare legacy string instead of throwing', () => {
    expect(parseSettingValue('USD')).toBe('USD');
    expect(parseSettingValue('https://instagram.com/beauteas')).toBe(
      'https://instagram.com/beauteas'
    );
    expect(parseSettingValue('🍵 Holiday Sale: 30% off')).toBe('🍵 Holiday Sale: 30% off');
    expect(parseSettingValue('/sale')).toBe('/sale');
  });

  it('treats absent values as undefined, never a throw', () => {
    expect(parseSettingValue(null)).toBeUndefined();
    expect(parseSettingValue(undefined)).toBeUndefined();
  });
});

describe('parseSettingRows', () => {
  it('keeps every good row when a legacy row sits in the middle', () => {
    // This is the exact shape of the production payload that broke the page.
    const { values } = parseSettingRows([
      { key: 'shipping.per_box_cost', value: '1', category: 'shipping' },
      { key: 'currency', value: 'USD', category: 'store' },
      { key: 'shipping.free_methods', value: '[]', category: 'shipping' },
      { key: 'social_instagram', value: 'https://instagram.com/beauteas', category: 'social' },
      { key: 'promotions.banner_enabled', value: 'true', category: 'promotions' },
    ]);

    // The bug: everything after `currency` was lost, so these were all undefined
    // and the page saved its defaults over them.
    expect(values.get('shipping.per_box_cost')).toBe(1);
    expect(values.get('shipping.free_methods')).toEqual([]);
    expect(values.get('promotions.banner_enabled')).toBe(true);
    expect(values.get('currency')).toBe('USD');
    expect(values.get('social_instagram')).toBe('https://instagram.com/beauteas');
  });

  it('reports which rows were not JSON without treating them as failures', () => {
    const { nonJsonKeys } = parseSettingRows([
      { key: 'currency', value: 'USD' },
      { key: 'shipping.tiers', value: '[]' },
      { key: 'store_name', value: 'BeauTeas' },
      // A JSON string row must NOT be reported: '"info"' is valid JSON.
      { key: 'promotions.banner_type', value: '"info"' },
    ]);

    expect(nonJsonKeys).toEqual(['currency', 'store_name']);
  });

  it('skips malformed rows rather than throwing', () => {
    const { values } = parseSettingRows([
      null,
      'not a row',
      { value: 'orphan with no key' },
      { key: 'shipping.per_box_cost', value: '1' },
    ]);

    expect(values.size).toBe(1);
    expect(values.get('shipping.per_box_cost')).toBe(1);
  });

  it('returns empty rather than throwing on a non-array payload', () => {
    expect(parseSettingRows(undefined).values.size).toBe(0);
    expect(parseSettingRows({ settings: [] }).values.size).toBe(0);
  });
});
