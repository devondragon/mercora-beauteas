/// <reference types="@cloudflare/vitest-pool-workers/types" />
/**
 * Integration smoke tests for gift-card create/redeem batch atomicity.
 *
 * Runs inside the Cloudflare Workers runtime (miniflare) via
 * @cloudflare/vitest-pool-workers so all D1 behaviour — batch atomicity,
 * UNIQUE constraints, conditional INSERT…SELECT — is real, not mocked.
 *
 * The @opennextjs/cloudflare module is mocked so getCloudflareContext()
 * returns the test env.DB binding instead of trying to read the OpenNext
 * AsyncLocalStorage context (which doesn't exist in test runs).
 *
 * Run with: npm run test:workers
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { env, applyD1Migrations } from 'cloudflare:test';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { gift_cards, gift_card_transactions } from '@/lib/db/schema/gift-card';
// The REAL production migration, imported as a raw string. Reading it directly —
// instead of re-declaring the DDL inline — means the test schema can never
// silently drift from what production applies (every column, CHECK, and index,
// including the idx_gift_cards_order_line / idx_gift_card_tx_redeem_order UNIQUE
// guards, comes from one source of truth). BMC-125 review follow-up.
import migration0010 from '@/migrations/0010_add_gift_cards.sql?raw';

// Must be hoisted before any import that calls getDbAsync / getCloudflareContext.
vi.mock('@opennextjs/cloudflare', async () => {
  const { env: testEnv } = await import('cloudflare:test');
  return {
    getCloudflareContext: async () => ({ env: testEnv }),
  };
});

// Controllable nanoid. The model builds gift-card / transaction IDs from
// nanoid(); mocking it lets the rollback test force a deterministic primary-key
// collision. The default impl (set in beforeEach) returns unique values so every
// other test behaves exactly as it would with the real (random) nanoid.
const nanoidMock = vi.hoisted(() => vi.fn());
vi.mock('nanoid', () => ({ nanoid: nanoidMock }));

import {
  createGiftCard,
  redeemGiftCard,
  getGiftCardTransactions,
  getGiftCardById,
} from '@/lib/models/mach/giftCard';

// ─── Schema bootstrap ────────────────────────────────────────────────────────
// Apply 0010 minus its product/variant seed INSERTs — those tables don't exist
// in this isolated gift-card test DB, and the model never touches them. The
// CREATE TABLE / CREATE INDEX statements have no external dependencies.
function migrationStatements(sql: string): string[] {
  return sql
    .replace(/--[^\n]*/g, '') // strip SQL line comments first — they can contain ';'
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .filter((s) => !/^INSERT\b/i.test(s)); // drop seed rows (products/variants)
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, [
    { name: '0010_add_gift_cards', queries: migrationStatements(migration0010) },
  ]);
});

beforeEach(async () => {
  // Truncate between tests so each scenario starts with an empty DB.
  const db = drizzle(env.DB);
  await db.delete(gift_card_transactions);
  await db.delete(gift_cards);

  // Default nanoid: unique-per-call within a test, deterministic across runs.
  // Individual tests may override (e.g. to force a collision).
  let seq = 0;
  nanoidMock.mockImplementation(() => `N${(seq++).toString().padStart(9, '0')}`);
});

// ─── 1. createGiftCard atomicity ─────────────────────────────────────────────
describe('createGiftCard', () => {
  it('writes card row and opening issue ledger row in a single atomic batch', async () => {
    const card = await createGiftCard({ amount: 5000 }); // $50.00

    expect(card.balance).toBe(5000);
    expect(card.initial_balance).toBe(5000);
    expect(card.status).toBe('active');

    const txs = await getGiftCardTransactions(card.id);
    expect(txs).toHaveLength(1);
    const issueTx = txs[0];
    expect(issueTx.type).toBe('issue');
    expect(issueTx.amount).toBe(5000);
    expect(issueTx.balance_after).toBe(5000);
    expect(issueTx.gift_card_id).toBe(card.id);
  });

  it('rolls back the card row when the ledger insert fails (batch atomicity)', async () => {
    const db = drizzle(env.DB);

    // A valid card so the pre-seeded colliding ledger row satisfies its FK.
    const seedCard = await createGiftCard({ amount: 1000 });

    // Pin nanoid to a constant so every createGiftCard attempt builds the SAME
    // transaction id, then pre-seed a row that already owns it. The card insert
    // and the ledger insert run in one db.batch(); the ledger insert hits the
    // duplicate primary key, so D1 must roll the WHOLE batch back — the card row
    // included. (createGiftCard retries on UNIQUE up to 5 times; with a constant
    // id every attempt collides, so it ultimately throws.)
    nanoidMock.mockImplementation(() => 'DUP00001');
    await db.insert(gift_card_transactions).values({
      id: 'GCT-DUP00001',
      gift_card_id: seedCard.id,
      type: 'adjust',
      amount: 0,
      balance_after: 1000,
    });

    const cardsBefore = await db.select().from(gift_cards);
    await expect(createGiftCard({ amount: 5000 })).rejects.toThrow(/after retries/i);

    // If the batch were non-atomic, the card insert from the first attempt would
    // survive the ledger failure. It must not: GC-DUP00001 should be absent.
    const cardsAfter = await db.select().from(gift_cards);
    expect(cardsAfter).toHaveLength(cardsBefore.length);
    expect(cardsAfter.find((c) => c.id === 'GC-DUP00001')).toBeUndefined();
  });
});

// ─── 2. redeemGiftCard happy path ────────────────────────────────────────────
describe('redeemGiftCard — happy path', () => {
  it('decrements balance and writes redeem ledger row atomically', async () => {
    const card = await createGiftCard({ amount: 5000 });

    const result = await redeemGiftCard({
      code: card.code,
      amount: 2000,
      orderId: 'ORDER-HAPPY-1',
    });

    expect(result.success).toBe(true);
    expect(result.applied).toBe(2000);
    expect(result.remaining).toBe(3000);
    expect(result.giftCardId).toBe(card.id);

    const fresh = await getGiftCardById(card.id);
    expect(fresh?.balance).toBe(3000);
    expect(fresh?.status).toBe('active');

    const txs = await getGiftCardTransactions(card.id);
    const redeemTx = txs.find((t) => t.type === 'redeem');
    expect(redeemTx).toBeDefined();
    expect(redeemTx!.amount).toBe(-2000); // negative = deduction
    expect(redeemTx!.balance_after).toBe(3000);
    expect(redeemTx!.order_id).toBe('ORDER-HAPPY-1');
  });

  it('marks card redeemed and balance 0 when fully drained', async () => {
    const card = await createGiftCard({ amount: 5000 });

    const result = await redeemGiftCard({
      code: card.code,
      amount: 5000,
      orderId: 'ORDER-FULL-1',
    });

    expect(result.success).toBe(true);
    expect(result.applied).toBe(5000);
    expect(result.remaining).toBe(0);

    const fresh = await getGiftCardById(card.id);
    expect(fresh?.balance).toBe(0);
    expect(fresh?.status).toBe('redeemed');
  });
});

// ─── 3. Partial redemption (request > balance) ───────────────────────────────
describe('redeemGiftCard — partial redemption', () => {
  it('clamps applied to remaining balance when requested amount exceeds it', async () => {
    const card = await createGiftCard({ amount: 3000 }); // $30.00

    const result = await redeemGiftCard({
      code: card.code,
      amount: 9999, // request $99.99 — more than available
      orderId: 'ORDER-PARTIAL-1',
    });

    expect(result.success).toBe(true);
    expect(result.applied).toBe(3000); // only what was available
    expect(result.remaining).toBe(0);

    const txs = await getGiftCardTransactions(card.id);
    const redeemTx = txs.find((t) => t.type === 'redeem');
    expect(redeemTx!.amount).toBe(-3000);
    expect(redeemTx!.balance_after).toBe(0);

    const fresh = await getGiftCardById(card.id);
    expect(fresh?.status).toBe('redeemed');
  });
});

// ─── 4. Idempotency (same order_id redeemed twice) ───────────────────────────
describe('redeemGiftCard — idempotency', () => {
  it('second redeem for the same order returns alreadyRedeemed with no second ledger row', async () => {
    const card = await createGiftCard({ amount: 5000 });

    const r1 = await redeemGiftCard({
      code: card.code,
      amount: 2000,
      orderId: 'ORDER-IDEM-1',
    });
    const r2 = await redeemGiftCard({
      code: card.code,
      amount: 2000,
      orderId: 'ORDER-IDEM-1',
    });

    expect(r1.success).toBe(true);
    expect(r1.alreadyRedeemed).toBeFalsy();

    expect(r2.success).toBe(true);
    expect(r2.alreadyRedeemed).toBe(true);
    // Second call must report the same applied and remaining as the first
    expect(r2.applied).toBe(r1.applied);
    expect(r2.remaining).toBe(r1.remaining);

    // Exactly one redeem ledger entry — no double-charge
    const txs = await getGiftCardTransactions(card.id);
    const redeemTxs = txs.filter((t) => t.type === 'redeem');
    expect(redeemTxs).toHaveLength(1);

    // Balance decremented only once
    const fresh = await getGiftCardById(card.id);
    expect(fresh?.balance).toBe(3000);
  });
});

// ─── 5. Concurrent guard: CAS guard prevents double-deduction ────────────────
describe('redeemGiftCard — concurrent guard', () => {
  it('two concurrent redeems for the same (card, order) produce exactly one ledger row', async () => {
    const card = await createGiftCard({ amount: 5000 });

    // Both fire concurrently. miniflare runs a single JS event loop and D1
    // serializes the two batches, so in THIS environment it is the optimistic
    // CAS guard (balance = current.balance), not the UNIQUE index, that stops
    // the double-deduction: the first batch commits (balance 5000→0); the second
    // batch's guard no longer holds, so it no-ops, re-reads balance 0, and
    // returns "no remaining balance". The UNIQUE redeem index is the defence for
    // a true multi-process race (two batches with overlapping read snapshots),
    // which miniflare can't reproduce — it is exercised directly below.
    const [r1, r2] = await Promise.all([
      redeemGiftCard({ code: card.code, amount: 5000, orderId: 'ORDER-RACE-1' }),
      redeemGiftCard({ code: card.code, amount: 5000, orderId: 'ORDER-RACE-1' }),
    ]);

    // Exactly one call succeeds; the other reports a clean, non-applying failure
    // (never a second deduction).
    expect(r1.success).not.toBe(r2.success);
    const loser = r1.success ? r2 : r1;
    expect(loser.applied).toBe(0);

    // The critical invariant: exactly one redeem ledger row (no double-deduction)
    const txs = await getGiftCardTransactions(card.id);
    const redeemTxs = txs.filter((t) => t.type === 'redeem');
    expect(redeemTxs).toHaveLength(1);

    const fresh = await getGiftCardById(card.id);
    expect(fresh?.balance).toBe(0);
    expect(fresh?.status).toBe('redeemed');
  });

  it('two concurrent redeems for different orders both succeed independently', async () => {
    const card = await createGiftCard({ amount: 5000 });

    const [r1, r2] = await Promise.all([
      redeemGiftCard({ code: card.code, amount: 2000, orderId: 'ORDER-RACE-A' }),
      redeemGiftCard({ code: card.code, amount: 2000, orderId: 'ORDER-RACE-B' }),
    ]);

    expect(r1.success).toBe(true);
    expect(r2.success).toBe(true);

    const txs = await getGiftCardTransactions(card.id);
    const redeemTxs = txs.filter((t) => t.type === 'redeem');
    expect(redeemTxs).toHaveLength(2);

    const fresh = await getGiftCardById(card.id);
    // Total deducted: 2000 + 2000 = 4000; remaining 1000
    expect(fresh?.balance).toBe(1000);
  });
});

// ─── 6. Redemption guards: invalid / disabled / expired ──────────────────────
describe('redeemGiftCard — rejects non-redeemable cards', () => {
  it('returns "not found" for an unknown code without writing a ledger row', async () => {
    const result = await redeemGiftCard({
      code: 'BEAU-0000-0000-0000',
      amount: 1000,
      orderId: 'ORDER-NOPE',
    });

    expect(result.success).toBe(false);
    expect(result.applied).toBe(0);
    expect(result.error).toMatch(/not found/i);
  });

  it('refuses to redeem a disabled card and leaves the balance untouched', async () => {
    const card = await createGiftCard({ amount: 5000 });
    const db = drizzle(env.DB);
    await db
      .update(gift_cards)
      .set({ status: 'disabled' })
      .where(eq(gift_cards.id, card.id));

    const result = await redeemGiftCard({
      code: card.code,
      amount: 2000,
      orderId: 'ORDER-DISABLED',
    });

    expect(result.success).toBe(false);
    expect(result.applied).toBe(0);
    expect(result.remaining).toBe(5000); // reports the real balance, not a hardcoded 0

    const fresh = await getGiftCardById(card.id);
    expect(fresh?.balance).toBe(5000);
    const redeemTxs = (await getGiftCardTransactions(card.id)).filter((t) => t.type === 'redeem');
    expect(redeemTxs).toHaveLength(0);
  });

  it('refuses to redeem an expired card and leaves the balance untouched', async () => {
    const card = await createGiftCard({ amount: 5000 });
    const db = drizzle(env.DB);
    // Past expiry, but status still 'active' — this is the case the read-only
    // validator catches but the write path previously did not (BMC-125 bug fix).
    await db
      .update(gift_cards)
      .set({ expires_at: '2000-01-01T00:00:00.000Z' })
      .where(eq(gift_cards.id, card.id));

    const result = await redeemGiftCard({
      code: card.code,
      amount: 2000,
      orderId: 'ORDER-EXPIRED',
    });

    expect(result.success).toBe(false);
    expect(result.applied).toBe(0);
    expect(result.remaining).toBe(5000); // real balance preserved in the result
    expect(result.error).toMatch(/expired/i);

    const fresh = await getGiftCardById(card.id);
    expect(fresh?.balance).toBe(5000);
    const redeemTxs = (await getGiftCardTransactions(card.id)).filter((t) => t.type === 'redeem');
    expect(redeemTxs).toHaveLength(0);
  });
});

// ─── 7. Schema-level guard: UNIQUE redeem index ──────────────────────────────
// The concurrent test above is resolved by the CAS guard under miniflare's
// serialized writes, so the UNIQUE index it relies on is never actually hit
// there. Exercise that index directly so a regression dropping it (or its
// partial WHERE clause) is caught.
describe('idx_gift_card_tx_redeem_order (schema guard)', () => {
  it('rejects a second redeem ledger row for the same (card, order)', async () => {
    const db = drizzle(env.DB);
    const card = await createGiftCard({ amount: 5000 });

    await db.insert(gift_card_transactions).values({
      id: 'GCT-DIRECT-1',
      gift_card_id: card.id,
      type: 'redeem',
      amount: -1000,
      balance_after: 4000,
      order_id: 'ORDER-DIRECT',
    });

    // drizzle-d1 wraps the SQLITE_CONSTRAINT as "Failed query: …", so assert the
    // insert is rejected and that exactly one redeem row survives — proof the
    // partial UNIQUE index rejected the duplicate.
    await expect(
      db.insert(gift_card_transactions).values({
        id: 'GCT-DIRECT-2',
        gift_card_id: card.id,
        type: 'redeem',
        amount: -1000,
        balance_after: 3000,
        order_id: 'ORDER-DIRECT',
      })
    ).rejects.toThrow();

    const redeemTxs = (await getGiftCardTransactions(card.id)).filter((t) => t.type === 'redeem');
    expect(redeemTxs).toHaveLength(1);
  });

  it('allows two redeem rows for the same card under different orders', async () => {
    const db = drizzle(env.DB);
    const card = await createGiftCard({ amount: 5000 });

    await db.insert(gift_card_transactions).values({
      id: 'GCT-DIFF-1',
      gift_card_id: card.id,
      type: 'redeem',
      amount: -1000,
      balance_after: 4000,
      order_id: 'ORDER-DIFF-A',
    });
    await expect(
      db.insert(gift_card_transactions).values({
        id: 'GCT-DIFF-2',
        gift_card_id: card.id,
        type: 'redeem',
        amount: -1000,
        balance_after: 3000,
        order_id: 'ORDER-DIFF-B',
      })
    ).resolves.toBeDefined();
  });
});
