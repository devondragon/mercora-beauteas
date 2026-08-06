/**
 * The repricing planner (GOOB).
 *
 * The baseline file is the whole point. `compare_at_price` must always hold the
 * genuine PRE-SALE price, so re-running at a different rate has to read the
 * original from the baseline rather than from whatever price is currently on the
 * variant — otherwise each run would ratchet the "original" downward and the
 * strikethrough would quietly become a lie.
 *
 * Pure-function test with no D1: same shape as `d1-migrate-plan.test.ts`.
 */
import { describe, it, expect } from 'vitest';
import { planReprice } from '../../../scripts/goob-reprice.mjs';

const VARIANTS = [
  { id: 'var-morning', price: { amount: 2400, currency: 'USD' }, compare_at_price: null },
  { id: 'var-evening', price: { amount: 2400, currency: 'USD' }, compare_at_price: null },
];

describe('planReprice — first run', () => {
  it('sets every variant to the per-box rate', () => {
    const { plan } = planReprice({ variants: VARIANTS, rate: 2, baseline: {} });

    expect(plan).toEqual([
      { id: 'var-morning', priceMinor: 200, compareAtMinor: 2400 },
      { id: 'var-evening', priceMinor: 200, compareAtMinor: 2400 },
    ]);
  });

  it('captures the pre-sale prices into a new baseline', () => {
    const { baseline } = planReprice({ variants: VARIANTS, rate: 2, baseline: {} });

    expect(baseline).toEqual({ 'var-morning': 2400, 'var-evening': 2400 });
  });
});

describe('planReprice — re-run at a different rate', () => {
  it('reprices from the baseline, not from the discounted price', () => {
    const discounted = [
      { id: 'var-morning', price: { amount: 200, currency: 'USD' }, compare_at_price: { amount: 2400, currency: 'USD' } },
    ];

    const { plan } = planReprice({
      variants: discounted,
      rate: 3,
      baseline: { 'var-morning': 2400 },
    });

    expect(plan).toEqual([{ id: 'var-morning', priceMinor: 300, compareAtMinor: 2400 }]);
  });

  it('never lets the baseline ratchet downward', () => {
    const discounted = [
      { id: 'var-morning', price: { amount: 200, currency: 'USD' }, compare_at_price: { amount: 2400, currency: 'USD' } },
    ];

    const { baseline } = planReprice({
      variants: discounted,
      rate: 3,
      baseline: { 'var-morning': 2400 },
    });

    expect(baseline['var-morning']).toBe(2400);
  });

  it('adopts an existing compare_at_price as the baseline for a variant it has never seen', () => {
    // clearly-calendula-sample-pack-on-sale may already carry a compare-at from a
    // prior promotion. That value is the real pre-sale price, not the current one.
    const preexisting = [
      { id: 'var-promo', price: { amount: 1800, currency: 'USD' }, compare_at_price: { amount: 2400, currency: 'USD' } },
    ];

    const { plan, baseline } = planReprice({ variants: preexisting, rate: 2, baseline: {} });

    expect(baseline['var-promo']).toBe(2400);
    expect(plan).toEqual([{ id: 'var-promo', priceMinor: 200, compareAtMinor: 2400 }]);
  });
});

describe('planReprice — bad input', () => {
  it('throws on a non-positive rate rather than zeroing the catalog', () => {
    expect(() => planReprice({ variants: VARIANTS, rate: 0, baseline: {} })).toThrow(/rate/i);
    expect(() => planReprice({ variants: VARIANTS, rate: -1, baseline: {} })).toThrow(/rate/i);
  });

  it('skips a variant with no usable price rather than pricing it at zero', () => {
    const broken = [{ id: 'var-broken', price: null, compare_at_price: null }];

    expect(planReprice({ variants: broken, rate: 2, baseline: {} }).plan).toEqual([]);
  });

  it('rounds a fractional rate to whole cents', () => {
    const { plan } = planReprice({ variants: [VARIANTS[0]], rate: 2.005, baseline: {} });

    expect(plan[0].priceMinor).toBe(201);
  });
});
