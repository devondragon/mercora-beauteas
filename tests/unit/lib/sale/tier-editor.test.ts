/**
 * Unit tests for the admin shipping-tier editor's pure helpers
 * (`lib/sale/tier-editor.ts`). `hasZeroCostTier` encodes the exact failure
 * mode migration 0025's empty seed exists to avoid — a non-empty
 * `shipping.tiers` with a $0 band ships that band free. `addTierRow` and
 * `setOpenEndedTier` encode the other one: at most one tier may be
 * open-ended, or `resolveShippingTier` (lib/sale/rules.ts) has to guess which
 * one wins. Both get pinned directly rather than only exercised through the
 * admin page.
 */
import { describe, it, expect } from 'vitest';

import { addTierRow, removeTierRow, setOpenEndedTier, hasZeroCostTier } from '@/lib/sale/tier-editor';
import type { ShippingTier } from '@/lib/sale/rules';

describe('addTierRow', () => {
  it('appends an open-ended, zero-cost row without mutating the input', () => {
    const original: ShippingTier[] = [{ max_boxes: 20, cost: 8 }];
    const result = addTierRow(original);

    expect(result).toEqual([
      { max_boxes: 20, cost: 8 },
      { max_boxes: null, cost: 0 },
    ]);
    expect(original).toEqual([{ max_boxes: 20, cost: 8 }]);
  });

  it('builds a first row from an empty list', () => {
    expect(addTierRow([])).toEqual([{ max_boxes: null, cost: 0 }]);
  });

  it('adds a numeric row, not a second open-ended one, when a tier is already open-ended', () => {
    const withOpenEnded: ShippingTier[] = [{ max_boxes: null, cost: 22 }];
    const result = addTierRow(withOpenEnded);

    expect(result).toEqual([
      { max_boxes: null, cost: 22 },
      { max_boxes: 1, cost: 0 },
    ]);
  });
});

describe('setOpenEndedTier', () => {
  it('makes the target row open-ended', () => {
    const tiers: ShippingTier[] = [{ max_boxes: 20, cost: 8 }, { max_boxes: 40, cost: 14 }];

    expect(setOpenEndedTier(tiers, 1, true)).toEqual([
      { max_boxes: 20, cost: 8 },
      { max_boxes: null, cost: 14 },
    ]);
  });

  it('makes the target row numeric again when unchecked', () => {
    const tiers: ShippingTier[] = [{ max_boxes: null, cost: 22 }];

    expect(setOpenEndedTier(tiers, 0, false)).toEqual([{ max_boxes: 1, cost: 22 }]);
  });

  it('clears any OTHER open-ended row when a new one is checked, so at most one remains', () => {
    const tiers: ShippingTier[] = [
      { max_boxes: null, cost: 22 },
      { max_boxes: 40, cost: 14 },
    ];

    expect(setOpenEndedTier(tiers, 1, true)).toEqual([
      { max_boxes: 1, cost: 22 },
      { max_boxes: null, cost: 14 },
    ]);
  });

  it('does not mutate the input', () => {
    const tiers: ShippingTier[] = [{ max_boxes: 20, cost: 8 }];
    setOpenEndedTier(tiers, 0, true);

    expect(tiers).toEqual([{ max_boxes: 20, cost: 8 }]);
  });
});

describe('removeTierRow', () => {
  it('drops the row at the given index without mutating the input', () => {
    const original: ShippingTier[] = [
      { max_boxes: 20, cost: 8 },
      { max_boxes: 40, cost: 14 },
      { max_boxes: null, cost: 22 },
    ];
    const result = removeTierRow(original, 1);

    expect(result).toEqual([
      { max_boxes: 20, cost: 8 },
      { max_boxes: null, cost: 22 },
    ]);
    expect(original.length).toBe(3);
  });
});

describe('hasZeroCostTier', () => {
  it('is false for an empty (not configured) tier list', () => {
    expect(hasZeroCostTier([])).toBe(false);
  });

  it('is false when every configured tier has a real cost', () => {
    expect(hasZeroCostTier([{ max_boxes: 20, cost: 8 }, { max_boxes: null, cost: 22 }])).toBe(false);
  });

  it('flags a configured tier priced at $0 — that band ships free', () => {
    expect(hasZeroCostTier([{ max_boxes: 20, cost: 0 }, { max_boxes: null, cost: 22 }])).toBe(true);
  });

  it('flags the all-zero state the empty seed exists to avoid', () => {
    const allZero: ShippingTier[] = [
      { max_boxes: 20, cost: 0 },
      { max_boxes: 40, cost: 0 },
      { max_boxes: null, cost: 0 },
    ];
    expect(hasZeroCostTier(allZero)).toBe(true);
  });
});
