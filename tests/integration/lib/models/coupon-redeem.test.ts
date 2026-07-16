/// <reference types="@cloudflare/vitest-pool-workers/types" />
/**
 * Integration tests for redeemCoupon — the atomic coupon-redemption CAS (BMC-197).
 *
 * Runs inside the Cloudflare Workers runtime (miniflare) via
 * @cloudflare/vitest-pool-workers so the guarded conditional UPDATE — usage_count
 * increment, single_use/usage_limit status flip, and the json_insert audit append
 * — executes against REAL D1/SQLite, not a mock. This is what proves the
 * concurrency acceptance criterion (concurrent redemptions can't exceed
 * usage_limit), which cannot be exercised with a mocked DB.
 *
 * The coupon_instances DDL is lifted straight from the real 0001 migration (so the
 * test schema can't drift), minus its FOREIGN KEY to promotions — that table isn't
 * created in this isolated DB and the redeemer never touches it.
 *
 * Run with: npm run test:workers
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { env, applyD1Migrations } from 'cloudflare:test';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { couponInstances } from '@/lib/db/schema/couponInstance';
import migration0001 from '@/migrations/0001_initial_schema.sql?raw';

// Must be hoisted before any import that calls getDbAsync / getCloudflareContext.
vi.mock('@opennextjs/cloudflare', async () => {
  const { env: testEnv } = await import('cloudflare:test');
  return {
    getCloudflareContext: async () => ({ env: testEnv }),
  };
});

import { redeemCoupon, getCouponInstanceByCode } from '@/lib/models/mach/couponInstance';

// ─── Schema bootstrap ────────────────────────────────────────────────────────
// Pull ONLY the coupon_instances CREATE TABLE + its indexes from 0001, and strip
// the FK to promotions (that table isn't created here). Every other column/index
// still comes from the real migration, so this can't silently drift from prod.
function couponTableStatements(sql: string): string[] {
  return sql
    .replace(/--[^\n]*/g, '') // strip SQL line comments first — they can contain ';'
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .filter((s) => /coupon_instances/i.test(s))
    // Drop the trailing `, FOREIGN KEY (promotion_id) REFERENCES promotions(id)`.
    .map((s) => s.replace(/,\s*FOREIGN KEY\s*\([^)]*\)\s*REFERENCES\s*\w+\s*\([^)]*\)/i, ''));
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, [
    { name: '0001_coupon_instances_only', queries: couponTableStatements(migration0001) },
  ]);
});

/** Insert a coupon row directly (bypassing the model's own validation). */
async function seedCoupon(row: {
  id: string;
  code: string;
  status?: string;
  type?: string;
  usage_count?: number;
  usage_limit?: number | null;
  extensions?: string | null;
}) {
  const db = drizzle(env.DB);
  await db.insert(couponInstances).values({
    id: row.id,
    code: row.code,
    promotionId: 'promo-x',
    status: (row.status ?? 'active') as any,
    type: (row.type ?? 'single_use') as any,
    usageCount: row.usage_count ?? 0,
    usageLimit: row.usage_limit ?? null,
    extensions: row.extensions ? JSON.parse(row.extensions) : null,
  } as any);
}

async function readCoupon(code: string) {
  return getCouponInstanceByCode(code);
}

beforeEach(async () => {
  const db = drizzle(env.DB);
  await db.delete(couponInstances);
});

describe('redeemCoupon (BMC-197)', () => {
  it('single_use: first redemption succeeds and flips status to used; second is a no-op', async () => {
    await seedCoupon({ id: 'ci-1', code: 'ONCE', type: 'single_use' });

    const first = await redeemCoupon('ONCE', { orderId: 'ORD-1', customerId: 'cust-1' });
    expect(first.redeemed).toBe(true);
    expect(first.usageCount).toBe(1);
    expect(first.status).toBe('used');

    const second = await redeemCoupon('ONCE', { orderId: 'ORD-2', customerId: 'cust-2' });
    expect(second.redeemed).toBe(false);

    const after = await readCoupon('ONCE');
    expect(after?.usage_count).toBe(1); // never moved past the single use
    expect(after?.status).toBe('used');
  });

  it('multi_use with usage_limit: increments up to the limit, then flips to used and blocks', async () => {
    await seedCoupon({ id: 'ci-2', code: 'TWICE', type: 'multi_use', usage_limit: 2 });

    const r1 = await redeemCoupon('TWICE', { orderId: 'O1' });
    expect(r1).toMatchObject({ redeemed: true, usageCount: 1, status: 'active' });

    const r2 = await redeemCoupon('TWICE', { orderId: 'O2' });
    // Reaching the limit flips it to used in the same statement.
    expect(r2).toMatchObject({ redeemed: true, usageCount: 2, status: 'used' });

    const r3 = await redeemCoupon('TWICE', { orderId: 'O3' });
    expect(r3.redeemed).toBe(false);

    const after = await readCoupon('TWICE');
    expect(after?.usage_count).toBe(2);
  });

  it('unlimited: never caps and never flips to used', async () => {
    await seedCoupon({ id: 'ci-3', code: 'FOREVER', type: 'unlimited' });

    for (let i = 1; i <= 5; i++) {
      const r = await redeemCoupon('FOREVER', { orderId: `O${i}` });
      expect(r).toMatchObject({ redeemed: true, usageCount: i, status: 'active' });
    }
    const after = await readCoupon('FOREVER');
    expect(after?.usage_count).toBe(5);
    expect(after?.status).toBe('active');
  });

  it('concurrent redemptions can never exceed usage_limit', async () => {
    await seedCoupon({ id: 'ci-4', code: 'LIMIT3', type: 'multi_use', usage_limit: 3 });

    // Fire 10 redemptions concurrently; the guarded CAS must let exactly 3 win.
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => redeemCoupon('LIMIT3', { orderId: `O${i}` }))
    );
    const wins = results.filter((r) => r.redeemed).length;
    expect(wins).toBe(3);

    const after = await readCoupon('LIMIT3');
    expect(after?.usage_count).toBe(3);
    expect(after?.status).toBe('used');
  });

  it('appends a MACHUsageRecord to extensions.usage_records for each redemption', async () => {
    await seedCoupon({ id: 'ci-5', code: 'AUDIT', type: 'multi_use', usage_limit: 5 });

    await redeemCoupon('AUDIT', { orderId: 'ORD-A', customerId: 'cust-A', channel: 'web' });
    await redeemCoupon('AUDIT', { orderId: 'ORD-B', customerId: 'cust-B', channel: 'web' });

    const after = await readCoupon('AUDIT');
    const records = (after?.extensions as any)?.usage_records;
    expect(Array.isArray(records)).toBe(true);
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({ order_id: 'ORD-A', customer_id: 'cust-A', channel: 'web' });
    expect(records[1]).toMatchObject({ order_id: 'ORD-B', customer_id: 'cust-B' });
    expect(typeof records[0].timestamp).toBe('string');
  });

  it('preserves pre-existing extensions data when appending the audit record', async () => {
    await seedCoupon({
      id: 'ci-6',
      code: 'KEEPEXT',
      type: 'multi_use',
      usage_limit: 5,
      extensions: JSON.stringify({ campaign: 'launch', usage_records: [{ order_id: 'OLD' }] }),
    });

    await redeemCoupon('KEEPEXT', { orderId: 'NEW' });

    const after = await readCoupon('KEEPEXT');
    const ext = after?.extensions as any;
    expect(ext.campaign).toBe('launch'); // untouched
    expect(ext.usage_records.map((r: any) => r.order_id)).toEqual(['OLD', 'NEW']);
  });

  it('normalizes the code (trim + upper-case) to match the stored index', async () => {
    await seedCoupon({ id: 'ci-7', code: 'CASECODE', type: 'multi_use', usage_limit: 5 });
    const r = await redeemCoupon('  casecode ', { orderId: 'O1' });
    expect(r.redeemed).toBe(true);
    expect((await readCoupon('CASECODE'))?.usage_count).toBe(1);
  });

  it('is a no-op for an unknown or already-disabled coupon', async () => {
    await seedCoupon({ id: 'ci-8', code: 'DISABLED', type: 'multi_use', usage_limit: 5, status: 'disabled' });
    expect((await redeemCoupon('NOSUCHCODE', { orderId: 'O1' })).redeemed).toBe(false);
    expect((await redeemCoupon('DISABLED', { orderId: 'O2' })).redeemed).toBe(false);
    expect((await readCoupon('DISABLED'))?.usage_count).toBe(0);
  });
});
