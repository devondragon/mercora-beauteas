#!/usr/bin/env node
/**
 * Reprice the catalog for the going-out-of-business sale.
 *
 *   node scripts/goob-reprice.mjs --rate 2.00 --expect-skus BTCCM1,BTCCA1,BTCCE1 --dry-run
 *   D1_REMOTE=true node scripts/goob-reprice.mjs --rate 2.00 --expect-skus BTCCM1,BTCCA1,BTCCE1
 *
 * Every remaining SKU is one box, so every active variant is set to the flat
 * per-box rate, with its genuine PRE-SALE price kept as compare_at_price so the
 * strikethrough on the PDP, the catalog cards, and Chai's product cards is true.
 *
 * --expect-skus <SKU,SKU,...> or --expect-count <N> is REQUIRED (one or both).
 * `ACTIVE_PHYSICAL_VARIANTS_SQL` matches every active, physical variant —
 * including bundle SKUs (e.g. a 9-box "Full Package") if they haven't been
 * archived yet, per the runbook's Phase 3. Without stating what you expect to
 * reprice, this script cannot tell "every active physical variant, correctly"
 * from "every active physical variant, including a bundle that should have
 * been withdrawn first" — both look identical to a dry-run eyeball check.
 * Checked BEFORE any write, including --dry-run.
 *
 * `data/goob/price-baseline.json` is written on first run and read on every run
 * after. Re-running at a different rate therefore reprices from the ORIGINAL
 * price, not from the already-discounted one — without it the "original" would
 * ratchet downward on each run.
 *
 * Amounts are stored as integer MINOR units, per lib/money.
 *
 * --dry-run writes nothing at all: no D1 UPDATEs, no baseline file.
 *
 * On money and lib/money (see "Never write raw *100 / 100" in CLAUDE.md):
 * this script deliberately does NOT import lib/money/money.ts's `Money` class.
 * lib/money is plain TypeScript with extensionless internal imports
 * (`from './currencies'` inside money.ts), which only resolve under a
 * bundler or a transpiling loader (webpack/Next.js, or vitest/tsx). Verified
 * empirically: `node` alone cannot resolve those imports (ERR_MODULE_NOT_FOUND),
 * and every sibling script here — d1-migrate.mjs, enrich-catalog.mjs — is a
 * plain-`node`-executable .mjs with zero TypeScript dependencies. Requiring a
 * build step just for this script would break that, and would break running
 * it exactly as documented above.
 *
 * Instead this imports `big.js` directly — the same arbitrary-precision
 * library money.ts uses internally — and replicates ONLY the one operation
 * needed (major-unit dollars -> integer minor units, round-half-up, USD
 * precision 2), the exact algorithm `Money.fromMajor` runs for USD. This is
 * not a style-only stand-in for a bare `rate * 100`: naive float
 * multiplication genuinely misrounds ordinary inputs —
 *   Math.round(0.145 * 100) === 14   (should be 15)
 *   Math.round(1.005 * 100) === 100  (should be 101)
 * — because those decimals have no exact IEEE-754 binary representation.
 * big.js's decimal arithmetic avoids that class of bug entirely.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname } from 'node:path';
import Big from 'big.js';
import { sqlString } from './lib/sql-escape.mjs';

const BASELINE_PATH = 'data/goob/price-baseline.json';
const tag = '[goob-reprice]';

/** Major-unit dollars -> integer minor units, round-half-up. Mirrors
 * `Money.fromMajor(rate).toMinorUnits()` for USD (precision 2) — see the
 * file header for why this doesn't import the Money class directly. */
function dollarsToMinorUnits(rate) {
  return Number(Big(rate).times(100).round(0, Big.roundHalfUp));
}

/** Integer minor units -> a "12.34"-style string for display only. */
function formatMinor(minor) {
  return Big(minor).div(100).toFixed(2);
}

/**
 * The SELECT that sources variants to reprice. Exported (and used verbatim by
 * `main()`) so a regression test can assert on its guardrails directly rather
 * than duplicating the query — this string, not a copy of it, is what runs
 * against production.
 *
 * Three guardrails, each protecting real money:
 *  - `COALESCE(v.status, 'active') = 'active'` — a NULL variant status reads
 *    as active, matching Task 1's `isActiveStatus()` (lib/config/commerce.ts),
 *    which deliberately fails open on NULL so a NULL row can't dark the whole
 *    catalog. A NULL-status variant is sellable everywhere else in the app;
 *    excluding it here would just leave it un-discounted, not withdrawn.
 *  - `COALESCE(p.status, 'active') = 'active'` — same reasoning, product level.
 *  - `p.fulfillment_type = 'physical'` — excludes the digital gift-card
 *    product. "Every remaining SKU is one box" only describes physical tea;
 *    a gift card's `price` is stored-credit face value, not something a flat
 *    per-box rate can touch (repricing a $100 gift card to $2 would sell $100
 *    of credit for $2 — confirmed against seeded data during Step 5).
 */
export const ACTIVE_PHYSICAL_VARIANTS_SQL = `
  SELECT v.id, v.sku, p.name AS product_name, v.price, v.compare_at_price
  FROM product_variants v
  JOIN products p ON p.id = v.product_id
  WHERE COALESCE(v.status, 'active') = 'active'
    AND COALESCE(p.status, 'active') = 'active'
    AND p.fulfillment_type = 'physical'
`;

/**
 * Build the UPDATE for one row of the plan. Exported so a regression test can
 * assert the id is actually escaped: `wrangler d1 execute --command` has no
 * parameterized query support, so hand-interpolating `id` here is a real SQL
 * injection surface if `sqlString()` is ever dropped or bypassed.
 */
export function buildUpdateStatement({ id, priceMinor, compareAtMinor }) {
  const priceJson = JSON.stringify({ amount: priceMinor, currency: 'USD' });
  const compareAtJson = JSON.stringify({ amount: compareAtMinor, currency: 'USD' });
  return `UPDATE product_variants
       SET price = ${sqlString(priceJson)},
           compare_at_price = ${sqlString(compareAtJson)},
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ${sqlString(id)}`;
}

/**
 * Guard against a human ordering error silently repricing the wrong catalog.
 *
 * The runbook's Phase 3 (withdraw the bundle SKUs) and Phase 4 (reprice) are
 * written as independently sequenceable, and Phase 3 is explicitly
 * deferrable ("Do not start this phase today if the bundles are still meant
 * to be actively for sale"). If Phase 4 runs first, `BTCCFP` (Full Package,
 * 9 boxes) and `BTCCSP` (Sample Pack, 3 boxes) are still `active` + `physical`
 * and match `ACTIVE_PHYSICAL_VARIANTS_SQL` exactly like the three single-box
 * blends — "every active, physical, tea variant" is precisely what a dry run
 * shows either way, so eyeballing the printed plan does not catch this. A
 * 9-box bundle silently reprices to the same $2.00 flat per-box rate as a
 * single box.
 *
 * The caller must state what they expect (SKU set or count); this is a HARD
 * exit on mismatch, not a warning, and is checked before any write — dry-run
 * included, since the dry run is what a human reads before committing to the
 * real run. Returns `{ ok, message }` rather than throwing so `main()` can
 * still print the full plan (useful for diagnosing the mismatch) before
 * exiting.
 *
 * @param {{ plan: Array<{id: string}>, skuById: Map<string, string>, expectSkus?: string[], expectCount?: number }} args
 * @returns {{ ok: boolean, message?: string }}
 */
export function checkExpectation({ plan, skuById, expectSkus, expectCount }) {
  if ((!expectSkus || expectSkus.length === 0) && expectCount == null) {
    return {
      ok: false,
      message:
        'refusing to run without --expect-skus <SKU,SKU,...> or --expect-count <N> — ' +
        'state what you expect to reprice so an ordering mistake (e.g. running this ' +
        'before archiving the bundle SKUs) cannot silently reprice the wrong catalog.',
    };
  }

  const actualSkus = plan.map((row) => skuById.get(row.id) ?? row.id).sort();

  if (expectSkus && expectSkus.length > 0) {
    const expectedSorted = [...expectSkus].sort();
    const expectedSet = new Set(expectedSorted);
    const actualSet = new Set(actualSkus);
    const missing = expectedSorted.filter((sku) => !actualSet.has(sku));
    const unexpected = actualSkus.filter((sku) => !expectedSet.has(sku));

    if (missing.length > 0 || unexpected.length > 0) {
      return {
        ok: false,
        message:
          `--expect-skus mismatch: expected [${expectedSorted.join(', ')}], ` +
          `plan would reprice [${actualSkus.join(', ')}].` +
          (missing.length > 0 ? ` Missing: ${missing.join(', ')}.` : '') +
          (unexpected.length > 0 ? ` Unexpected: ${unexpected.join(', ')}.` : ''),
      };
    }
  }

  if (expectCount != null && plan.length !== expectCount) {
    return {
      ok: false,
      message:
        `--expect-count mismatch: expected ${expectCount}, plan has ${plan.length} ` +
        `variant(s) (skus: ${actualSkus.join(', ')}).`,
    };
  }

  return { ok: true };
}

/**
 * Pure planner — exported for unit testing.
 *
 * @param {{ variants: Array<{id: string, price: any, compare_at_price: any}>, rate: number, baseline: Record<string, number> }} args
 * @returns {{ plan: Array<{id: string, priceMinor: number, compareAtMinor: number}>, baseline: Record<string, number> }}
 */
export function planReprice({ variants, rate, baseline }) {
  if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) {
    throw new Error(`--rate must be a positive number of dollars, got: ${rate}`);
  }

  const priceMinor = dollarsToMinorUnits(rate);
  const nextBaseline = { ...baseline };
  const plan = [];

  for (const variant of variants) {
    // An existing compare_at_price is the real pre-sale price for a variant we
    // have never recorded — a prior promotion already moved `price` down.
    const recorded = nextBaseline[variant.id];
    const preSaleMinor =
      recorded ??
      (variant.compare_at_price?.amount ?? variant.price?.amount);

    if (typeof preSaleMinor !== 'number' || !Number.isFinite(preSaleMinor)) continue;

    nextBaseline[variant.id] = preSaleMinor;
    plan.push({ id: variant.id, priceMinor, compareAtMinor: preSaleMinor });
  }

  return { plan, baseline: nextBaseline };
}

/**
 * Run `wrangler d1 execute --json` and parse the result.
 *
 * D1_REMOTE=true targets the LIVE production database (beauteas-db); anything
 * else targets the local dev D1 (beauteas-db-dev --local). Both need an
 * explicit --env: wrangler.jsonc defines d1_databases only under env.dev /
 * env.production, not at the top level, so a call missing --env cannot
 * resolve the binding at all.
 */
function d1(sql) {
  const remote = process.env.D1_REMOTE === 'true';
  const database = remote ? 'beauteas-db' : 'beauteas-db-dev';
  const wranglerEnv = remote ? 'production' : 'dev';
  const args = [
    'wrangler', 'd1', 'execute', database,
    remote ? '--remote' : '--local',
    '--env', wranglerEnv,
    '--json', '--command', sql,
  ];
  const out = execFileSync('npx', args, { encoding: 'utf8' });
  // wrangler can print a banner (e.g. an "update available" notice) before the
  // JSON array — slice to the first `[`, same guard scripts/enrich-catalog.mjs
  // uses for the identical `--json` output shape.
  return JSON.parse(out.slice(out.indexOf('[')));
}

function main() {
  const argv = process.argv;
  const rateIndex = argv.indexOf('--rate');
  if (rateIndex === -1 || argv[rateIndex + 1] === undefined) {
    console.error(
      `${tag} usage: node scripts/goob-reprice.mjs --rate <dollars> ` +
        `(--expect-skus <SKU,SKU,...> | --expect-count <N>) [--dry-run]`,
    );
    process.exit(1);
  }
  const rate = Number(argv[rateIndex + 1]);
  const dryRun = argv.includes('--dry-run');
  const remote = process.env.D1_REMOTE === 'true';

  const expectSkusIndex = argv.indexOf('--expect-skus');
  const expectSkus =
    expectSkusIndex !== -1 && argv[expectSkusIndex + 1] !== undefined
      ? argv[expectSkusIndex + 1].split(',').map((s) => s.trim()).filter(Boolean)
      : undefined;
  const expectCountIndex = argv.indexOf('--expect-count');
  const expectCount =
    expectCountIndex !== -1 && argv[expectCountIndex + 1] !== undefined
      ? Number(argv[expectCountIndex + 1])
      : undefined;

  // Fail fast, before the D1 read: same reasoning as checkExpectation below,
  // just checked here so a missing flag doesn't cost a network round trip
  // first. checkExpectation still re-derives this failure on its own (it has
  // no way to know main() already checked), which is what the unit tests
  // exercise directly.
  if ((!expectSkus || expectSkus.length === 0) && expectCount == null) {
    console.error(
      `${tag} refusing to run without --expect-skus <SKU,SKU,...> or --expect-count <N> — ` +
        `state what you expect to reprice so an ordering mistake (e.g. running this before ` +
        `archiving the bundle SKUs) cannot silently reprice the wrong catalog.`,
    );
    process.exit(1);
  }

  console.log(
    `${tag} target: ${remote ? 'beauteas-db (PRODUCTION, remote)' : 'beauteas-db-dev (local)'}` +
      `${dryRun ? ' — DRY RUN, no writes' : ''}`,
  );

  const rows = d1(ACTIVE_PHYSICAL_VARIANTS_SQL);
  const results = rows[0]?.results ?? [];
  const variants = results.map((r) => ({
    id: r.id,
    price: typeof r.price === 'string' ? JSON.parse(r.price) : r.price,
    compare_at_price:
      typeof r.compare_at_price === 'string' ? JSON.parse(r.compare_at_price) : r.compare_at_price,
  }));
  // sku/product name aren't part of the pricing plan — carried alongside it
  // only so the printed output is reviewable by a human, not just a list of IDs.
  const meta = new Map(results.map((r) => [r.id, { sku: r.sku, name: r.product_name }]));

  const baseline = existsSync(BASELINE_PATH) ? JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) : {};

  let result;
  try {
    result = planReprice({ variants, rate, baseline });
  } catch (err) {
    console.error(`${tag} ${err.message}`);
    process.exit(1);
  }

  for (const row of result.plan) {
    const m = meta.get(row.id) ?? {};
    const label = [row.id, m.sku ? `sku:${m.sku}` : null, m.name ?? null].filter(Boolean).join(' ');
    console.log(`${label}: ${formatMinor(row.compareAtMinor)} -> ${formatMinor(row.priceMinor)}`);
  }

  console.log(
    `${tag} ${result.plan.length} of ${variants.length} active variant(s) selected` +
      (result.plan.length < variants.length
        ? ` (${variants.length - result.plan.length} skipped — no usable price).`
        : '.'),
  );

  // Hard guard (checked for --dry-run too — see checkExpectation's doc
  // comment): a human ordering error must not be able to silently reprice
  // the wrong catalog, e.g. running this before Phase 3 archives the bundle
  // SKUs, which would reprice a 9-box bundle to the same flat per-box rate
  // as a single box.
  const skuById = new Map(Array.from(meta.entries()).map(([id, m]) => [id, m.sku]));
  const expectation = checkExpectation({ plan: result.plan, skuById, expectSkus, expectCount });
  if (!expectation.ok) {
    console.error(`${tag} ${expectation.message}`);
    process.exit(1);
  }

  if (dryRun) {
    console.log(`${tag} [dry-run] Nothing written — no D1 updates, no baseline file.`);
    return;
  }

  for (const row of result.plan) {
    d1(buildUpdateStatement(row));
  }

  mkdirSync(dirname(BASELINE_PATH), { recursive: true });
  writeFileSync(BASELINE_PATH, JSON.stringify(result.baseline, null, 2) + '\n');
  console.log(`${tag} Repriced ${result.plan.length} variant(s). Baseline written to ${BASELINE_PATH}.`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
