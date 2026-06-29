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
import { gift_cards, gift_card_transactions } from '@/lib/db/schema/gift-card';

// Must be hoisted before any import that calls getDbAsync / getCloudflareContext.
vi.mock('@opennextjs/cloudflare', async () => {
  const { env: testEnv } = await import('cloudflare:test');
  return {
    getCloudflareContext: async () => ({ env: testEnv }),
  };
});

import {
  createGiftCard,
  redeemGiftCard,
  getGiftCardTransactions,
  getGiftCardById,
} from '@/lib/models/mach/giftCard';

// ─── Schema bootstrap ────────────────────────────────────────────────────────
// Only the gift_cards + gift_card_transactions tables are needed.  We skip the
// full 0010_add_gift_cards.sql seed (products/variants) since the model never
// touches those tables.
const GIFT_CARD_DDL = `
CREATE TABLE IF NOT EXISTS gift_cards (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  initial_balance INTEGER NOT NULL,
  balance INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'redeemed', 'disabled', 'expired')),
  purchaser_customer_id TEXT,
  purchaser_email TEXT,
  recipient_email TEXT,
  recipient_name TEXT,
  gift_message TEXT,
  order_id TEXT,
  order_line_id TEXT,
  expires_at TEXT,
  delivered_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS gift_card_transactions (
  id TEXT PRIMARY KEY,
  gift_card_id TEXT NOT NULL REFERENCES gift_cards(id),
  type TEXT NOT NULL CHECK (type IN ('issue', 'redeem', 'refund', 'adjust')),
  amount INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  order_id TEXT,
  customer_id TEXT,
  note TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_gift_cards_code ON gift_cards(code);

-- Idempotency guard: one redeem ledger entry per (card, order).
-- A UNIQUE violation rolls back the whole batch, preventing double-deductions.
CREATE UNIQUE INDEX IF NOT EXISTS idx_gift_card_tx_redeem_order
  ON gift_card_transactions(gift_card_id, order_id)
  WHERE type = 'redeem' AND order_id IS NOT NULL;
`;

beforeAll(async () => {
  // The runtime D1Migration shape requires queries: string[] (individual statements),
  // not sql: string. Split on semicolons so applyD1Migrations can prepare() each one.
  const queries = GIFT_CARD_DDL.split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  await applyD1Migrations(env.DB, [{ name: '0010_gift_card_schema', queries }]);
});

beforeEach(async () => {
  // Truncate between tests so each scenario starts with an empty DB.
  const db = drizzle(env.DB);
  await db.delete(gift_card_transactions);
  await db.delete(gift_cards);
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

// ─── 5. Concurrent guard: unique-index prevents double-deduction ──────────────
describe('redeemGiftCard — concurrent guard', () => {
  it('two concurrent redeems for the same (card, order) produce exactly one ledger row', async () => {
    const card = await createGiftCard({ amount: 5000 });

    // Both fire concurrently. In miniflare's event loop they interleave at await
    // points. The CAS guard (balance = current.balance) ensures the second batch
    // no-ops if the first already committed. When the balance hits 0, the retried
    // call correctly returns "no remaining balance" rather than double-deducting.
    const [r1, r2] = await Promise.all([
      redeemGiftCard({ code: card.code, amount: 5000, orderId: 'ORDER-RACE-1' }),
      redeemGiftCard({ code: card.code, amount: 5000, orderId: 'ORDER-RACE-1' }),
    ]);

    // At least one call must succeed
    expect(r1.success || r2.success).toBe(true);

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
