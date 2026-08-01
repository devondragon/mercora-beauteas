/// <reference types="@cloudflare/vitest-pool-workers/types" />
/**
 * BMC-224: the "no refund in flight" guard on `shipOrder`, exercised against
 * REAL D1.
 *
 * Why this suite and not `tests/unit/**`: the guard's primary enforcement is a
 * SQL predicate inside the `db.batch()` CAS —
 *
 *   NOT EXISTS (SELECT 1 FROM json_each(COALESCE(json_extract(extensions,
 *     '$.refunds'), '[]')) WHERE json_extract(json_each.value,'$.status')='pending')
 *
 * — and a mocked DB cannot tell you whether that SQLite JSON syntax is even
 * valid. It has to be, because it now sits on the ONLY path that ships an
 * order: a malformed predicate would not fail closed on refunded orders, it
 * would fail *every* shipment. `decideShipment`'s pure half is covered in
 * tests/unit/lib/fulfillment/transitions.test.ts; this covers the half that
 * talks to the database.
 *
 * The predicate must also be race-safe: `POST /api/orders/refund` writes its
 * `pending` reservation BEFORE calling Stripe precisely so a concurrent
 * operation cannot slip past, and a guard that lived only in the pre-read would
 * miss a reservation landing between the read and the batch.
 *
 * NOTE: this suite is NOT gated by CI (ci.yml runs `npm test` only). Run with
 * `npm run test:workers`.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { env, applyD1Migrations } from 'cloudflare:test';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { orders } from '@/lib/db/schema/order';
import migration0001 from '@/migrations/0001_initial_schema.sql?raw';
import migration0022 from '@/migrations/0022_add_shipping_carrier.sql?raw';
import migration0023 from '@/migrations/0023_add_order_events.sql?raw';

vi.mock('@opennextjs/cloudflare', async () => {
  const { env: testEnv } = await import('cloudflare:test');
  return { getCloudflareContext: async () => ({ env: testEnv }) };
});

import { shipOrder } from '@/lib/fulfillment/service';

const ORDER_ID = 'WEB-USER-224001';
const ACTOR = { type: 'admin' as const, id: 'admin_1' };
const UPS = { carrier: 'ups' as const, trackingNumber: '1Z999AA10123456784' };

function migrationStatements(sql: string): string[] {
  return sql
    .replace(/--[^\n]*/g, '')
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .filter((s) => !/^INSERT\b/i.test(s));
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, [
    { name: '0001_initial_schema', queries: migrationStatements(migration0001) },
    { name: '0022_add_shipping_carrier', queries: migrationStatements(migration0022) },
    { name: '0023_add_order_events', queries: migrationStatements(migration0023) },
  ]);
});

/** Insert a shippable order carrying `extensions` verbatim. */
async function seedOrder(extensions: unknown) {
  const db = drizzle(env.DB);
  await db.delete(orders).where(eq(orders.id, ORDER_ID));
  await db.insert(orders).values({
    id: ORDER_ID,
    status: 'processing',
    payment_status: 'paid',
    currency_code: 'USD',
    total_amount: { amount: 5000, currency: 'USD' } as any,
    items: [] as any,
    extensions: extensions as any,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
  } as any);
}

async function storedStatus() {
  const db = drizzle(env.DB);
  const [row] = await db.select().from(orders).where(eq(orders.id, ORDER_ID));
  return row?.status;
}

beforeEach(async () => {
  vi.clearAllMocks();
});

describe('shipOrder — SQL guard against an in-flight refund', () => {
  it('ships normally when the order has no refunds at all', async () => {
    // The COALESCE path: `$.refunds` is absent on any order never refunded, and
    // json_each() of a NULL argument is not a safe no-op. If this regresses,
    // EVERY shipment breaks — which is why it is the first assertion here.
    await seedOrder({ payment_intent_id: 'pi_1' });

    const result = await shipOrder(ORDER_ID, UPS, ACTOR);

    expect(result.outcome).toBe('shipped');
    expect(await storedStatus()).toBe('shipped');
  });

  it('ships when extensions is NULL entirely (legacy rows)', async () => {
    await seedOrder(null);

    const result = await shipOrder(ORDER_ID, UPS, ACTOR);

    expect(result.outcome).toBe('shipped');
  });

  it('REFUSES to ship while a refund entry is pending', async () => {
    await seedOrder({
      payment_intent_id: 'pi_1',
      refunds: [{ id: 'refund:abc', status: 'pending', amount: 5000 }],
    });

    const result = await shipOrder(ORDER_ID, UPS, ACTOR);

    expect(result).toMatchObject({ outcome: 'not_fulfillable', refundPending: true });
    // The row is genuinely untouched — the CAS matched zero rows.
    expect(await storedStatus()).toBe('processing');
  });

  it('ships once a pending refund has settled', async () => {
    await seedOrder({
      payment_intent_id: 'pi_1',
      refunds: [{ id: 're_1', status: 'succeeded', amount: 1000 }],
    });

    // A settled PARTIAL refund leaves the order live and shippable.
    expect((await shipOrder(ORDER_ID, UPS, ACTOR)).outcome).toBe('shipped');
  });

  it('ships once a pending refund has been released to failed', async () => {
    await seedOrder({
      payment_intent_id: 'pi_1',
      refunds: [{ id: 're_1', status: 'failed', amount: 5000 }],
    });

    expect((await shipOrder(ORDER_ID, UPS, ACTOR)).outcome).toBe('shipped');
  });

  it('blocks when ANY entry is pending, even alongside settled ones', async () => {
    await seedOrder({
      payment_intent_id: 'pi_1',
      refunds: [
        { id: 're_1', status: 'succeeded', amount: 1000 },
        { id: 're_2', status: 'pending', amount: 2000 },
      ],
    });

    expect(await shipOrder(ORDER_ID, UPS, ACTOR)).toMatchObject({
      outcome: 'not_fulfillable',
      refundPending: true,
    });
  });

  it.each([
    ['a string', 'not-an-array'],
    ['an object', { nope: true }],
    ['a number', 42],
  ])('does not blow up when refunds is %s', async (_label, refunds) => {
    // Found here, not by any unit test: json_each() of a NON-ARRAY raises
    // `malformed JSON: SQLITE_ERROR`, aborting the batch. Because this predicate
    // is on the ONLY ship path, that turned one malformed row into a permanently
    // unshippable order returning 500. Must degrade, never throw.
    await seedOrder({ payment_intent_id: 'pi_1', refunds });

    const result = await shipOrder(ORDER_ID, UPS, ACTOR);
    expect(result.outcome).toBe('shipped');
  });

  it('tolerates an array of scalars without throwing', async () => {
    // json_extract(json_each.value, '$.status') on a scalar element yields NULL
    // rather than erroring — pinned so a future rewrite of the predicate can't
    // reintroduce the malformed-JSON abort through a different door.
    await seedOrder({ payment_intent_id: 'pi_1', refunds: ['nonsense', 7] });

    expect((await shipOrder(ORDER_ID, UPS, ACTOR)).outcome).toBe('shipped');
  });

  it('is not fooled by "pending" appearing in an unrelated field', async () => {
    // Why json_each and not a LIKE '%"status":"pending"%' on the serialized
    // column: a refund note or reason mentioning the word would silently block
    // every future shipment on that order.
    await seedOrder({
      payment_intent_id: 'pi_1',
      refunds: [
        {
          id: 're_1',
          status: 'succeeded',
          amount: 1000,
          notes: 'customer asked while the order was still "status":"pending"',
        },
      ],
    });

    expect((await shipOrder(ORDER_ID, UPS, ACTOR)).outcome).toBe('shipped');
  });
});
