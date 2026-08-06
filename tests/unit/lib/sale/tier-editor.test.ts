/**
 * Unit tests for the admin shipping-tier editor's pure helpers
 * (`lib/sale/tier-editor.ts`). `hasZeroCostTier` is the one that matters: it
 * encodes the exact failure mode migration 0025's empty seed exists to avoid
 * — a non-empty `shipping.tiers` with a $0 band ships that band free — so it
 * gets pinned directly rather than only exercised through the admin page.
 */
import { describe, it, expect } from 'vitest';

import { addTierRow, removeTierRow, hasZeroCostTier } from '@/lib/sale/tier-editor';
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
