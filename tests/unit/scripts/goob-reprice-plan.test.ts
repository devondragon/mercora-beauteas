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
import {
  resolveTarget,
  planReprice,
  ACTIVE_PHYSICAL_VARIANTS_SQL,
  buildUpdateStatement,
  checkExpectation,
} from '../../../scripts/goob-reprice.mjs';

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

  // 2.005 (above) happens to be exactly representable in IEEE-754, so even a
  // naive `Math.round(rate * 100)` gets it right — that case does not prove
  // the big.js fix does anything. 1.005 does discriminate: native float
  // multiplication gives `Math.round(1.005 * 100) === 100` (wrong; should be
  // 101), because 1.005 has no exact binary representation. This is the case
  // that actually pins big.js's round-half-up decimal arithmetic in place.
  it('rounds a rate that IEEE-754 float multiplication gets wrong (1.005 -> 101, not 100)', () => {
    const { plan } = planReprice({ variants: [VARIANTS[0]], rate: 1.005, baseline: {} });

    expect(plan[0].priceMinor).toBe(101);
  });
});

describe('ACTIVE_PHYSICAL_VARIANTS_SQL', () => {
  // Assert on the guardrails' semantics, not the whole query string — a
  // whole-query snapshot breaks on every whitespace/formatting change and
  // teaches people to re-bless it without reading what changed.

  it('treats a NULL variant status as active, matching isActiveStatus() (lib/config/commerce.ts)', () => {
    expect(ACTIVE_PHYSICAL_VARIANTS_SQL).toMatch(
      /COALESCE\(\s*v\.status\s*,\s*'active'\s*\)\s*=\s*'active'/,
    );
  });

  it('treats a NULL product status as active, matching isActiveStatus() (lib/config/commerce.ts)', () => {
    expect(ACTIVE_PHYSICAL_VARIANTS_SQL).toMatch(
      /COALESCE\(\s*p\.status\s*,\s*'active'\s*\)\s*=\s*'active'/,
    );
  });

  it('excludes non-physical fulfillment types, e.g. the digital gift-card product', () => {
    expect(ACTIVE_PHYSICAL_VARIANTS_SQL).toMatch(/p\.fulfillment_type\s*=\s*'physical'/);
  });
});

// Final-review re-review fix: a human ordering error (running Phase 4 before
// Phase 3 archives the bundle SKUs) makes BTCCFP/BTCCSP still match
// ACTIVE_PHYSICAL_VARIANTS_SQL alongside the three real single-box blends —
// exactly what the runbook's OWN dry-run sanity check ("every active,
// physical, tea variant") would see with the bundles included, so it can't
// catch this. checkExpectation is the hard guard: the caller must state what
// they expect, and any mismatch is a hard failure, not a warning.
describe('checkExpectation', () => {
  const skuById = new Map([
    ['var-morning', 'BTCCM1'],
    ['var-afternoon', 'BTCCA1'],
    ['var-evening', 'BTCCE1'],
  ]);
  const threeBoxPlan = [{ id: 'var-morning' }, { id: 'var-afternoon' }, { id: 'var-evening' }];

  it('refuses to run when neither --expect-skus nor --expect-count is given', () => {
    const result = checkExpectation({ plan: threeBoxPlan, skuById });

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/--expect-skus|--expect-count/);
  });

  it('passes when --expect-skus matches the plan exactly, order-independent', () => {
    const result = checkExpectation({
      plan: threeBoxPlan,
      skuById,
      expectSkus: ['BTCCE1', 'BTCCM1', 'BTCCA1'],
    });

    expect(result.ok).toBe(true);
  });

  it('passes when --expect-count matches the plan size', () => {
    const result = checkExpectation({ plan: threeBoxPlan, skuById, expectCount: 3 });

    expect(result.ok).toBe(true);
  });

  it('fails --expect-skus when a bundle SKU (not yet archived by Phase 3) is in the plan', () => {
    const skuByIdWithBundles = new Map([...skuById, ['var-full-package', 'BTCCFP'], ['var-sample-pack', 'BTCCSP']]);
    const planWithBundles = [...threeBoxPlan, { id: 'var-full-package' }, { id: 'var-sample-pack' }];

    const result = checkExpectation({
      plan: planWithBundles,
      skuById: skuByIdWithBundles,
      expectSkus: ['BTCCM1', 'BTCCA1', 'BTCCE1'],
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain('BTCCFP');
    expect(result.message).toContain('BTCCSP');
  });

  it('fails --expect-count when a bundle SKU inflates the plan size', () => {
    const planWithBundles = [...threeBoxPlan, { id: 'var-full-package' }];

    const result = checkExpectation({ plan: planWithBundles, skuById, expectCount: 3 });

    expect(result.ok).toBe(false);
    expect(result.message).toContain('expected 3');
    expect(result.message).toContain('has 4');
  });

  it('fails --expect-skus when the plan is missing an expected SKU', () => {
    const result = checkExpectation({
      plan: [{ id: 'var-morning' }, { id: 'var-afternoon' }],
      skuById,
      expectSkus: ['BTCCM1', 'BTCCA1', 'BTCCE1'],
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain('BTCCE1');
  });
});

describe('buildUpdateStatement', () => {
  it('writes price and compare_at_price as minor-unit JSON objects', () => {
    const stmt = buildUpdateStatement({ id: 'var-x', priceMinor: 200, compareAtMinor: 2400 });

    expect(stmt).toContain(`price = '{"amount":200,"currency":"USD"}'`);
    expect(stmt).toContain(`compare_at_price = '{"amount":2400,"currency":"USD"}'`);
  });

  // wrangler d1 execute --command has no parameterized query support, so a
  // variant id with a single quote is a real SQL injection surface unless
  // it's escaped. Guards against sqlString() ever being dropped or bypassed.
  it('escapes a single quote in the id so the statement stays well-formed', () => {
    const stmt = buildUpdateStatement({ id: "var-o'brien", priceMinor: 200, compareAtMinor: 2400 });

    // Doubled quote is SQL's escape for a literal quote inside a string.
    expect(stmt).toContain(`WHERE id = 'var-o''brien'`);
    // The unescaped form must never appear — that would mean the quote broke
    // out of the string literal instead of staying inside it.
    expect(stmt).not.toContain(`WHERE id = 'var-o'brien'`);
  });

  it('neutralizes an attempted injection by keeping it inside the quoted literal', () => {
    const malicious = "x'; DROP TABLE product_variants; --";
    const stmt = buildUpdateStatement({ id: malicious, priceMinor: 200, compareAtMinor: 2400 });

    // The entire malicious id, quote doubled, must form ONE closed string
    // literal running to the very end of the statement. If the quote hadn't
    // been escaped, the literal would terminate early at `x'`, and everything
    // from `; DROP TABLE` onward would sit outside any string — live SQL, not
    // a value — which is exactly what this asserts did NOT happen.
    expect(stmt.endsWith(`WHERE id = 'x''; DROP TABLE product_variants; --'`)).toBe(true);
  });
});

/**
 * Target resolution. This script writes prices to live databases, so which
 * one it picks is load-bearing: the whole reason `dev-remote` exists is that
 * the default local target writes a file the deployed dev Worker never reads,
 * which made "rehearse on dev" impossible without touching production.
 *
 * The asymmetry is deliberate and pinned here: D1_REMOTE=true still means
 * production and only production, so no existing invocation changed meaning
 * when dev-remote was added.
 */
describe('resolveTarget', () => {
  it('defaults to the LOCAL dev database when nothing is set', () => {
    const t = resolveTarget({});
    expect(t).toMatchObject({ database: 'beauteas-db-dev', wranglerEnv: 'dev', remote: false });
  });

  it('sends D1_REMOTE=true to production, unchanged', () => {
    const t = resolveTarget({ D1_REMOTE: 'true' });
    expect(t).toMatchObject({ database: 'beauteas-db', wranglerEnv: 'production', remote: true });
    expect(t.label).toContain('PRODUCTION');
  });

  it('sends D1_TARGET=dev-remote to the deployed dev database, not production', () => {
    const t = resolveTarget({ D1_TARGET: 'dev-remote' });
    expect(t).toMatchObject({ database: 'beauteas-db-dev', wranglerEnv: 'dev', remote: true });
    expect(t.label).not.toContain('PRODUCTION');
  });

  it('refuses to guess when both are set rather than picking one', () => {
    // The two disagree about which database is intended. A precedence rule
    // would silently write to whichever the author happened to rank first.
    const t = resolveTarget({ D1_REMOTE: 'true', D1_TARGET: 'dev-remote' });
    expect(t.error).toMatch(/disagree/i);
    expect(t.database).toBeUndefined();
  });

  it('rejects an unrecognised D1_TARGET rather than falling back to a default', () => {
    // A typo like D1_TARGET=prod must not quietly resolve to the local file.
    const t = resolveTarget({ D1_TARGET: 'prod' });
    expect(t.error).toMatch(/unknown D1_TARGET/i);
    expect(t.database).toBeUndefined();
  });

  it('treats an empty D1_TARGET as unset', () => {
    expect(resolveTarget({ D1_TARGET: '' })).toMatchObject({ remote: false });
  });
});
