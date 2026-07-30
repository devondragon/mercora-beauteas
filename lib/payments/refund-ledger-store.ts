/**
 * Shared persistence primitives for the `orders.extensions.refunds[]` ledger
 * (extracted for BMC-213).
 *
 * The ledger is a JSON column, and D1 has no interactive transactions, so every
 * write is an optimistic-concurrency (CAS) read-modify-write guarded on BOTH
 * `updated_at` AND a monotonic `extensions.refunds_version` integer. Those two
 * predicates are load-bearing — they are what stops two concurrent refunds from
 * silently dropping one another's entry and corrupting `computeRefundedTotal`
 * (BMC-193). They were previously defined inline in
 * `app/api/orders/refund/route.ts`; BMC-213 adds a SECOND writer (the
 * `charge.refunded` webhook reconciler), so they live here as the single source
 * of truth rather than being copy-pasted into a parallel update path.
 *
 * `mutateRefundLedger` wraps the whole CAS retry loop for callers that only need
 * to transform the extensions object. The refund route keeps its own loops
 * because they interleave a Stripe call and order-level side effects (restock
 * selection, status transitions) with the ledger write; it imports the guards
 * from here so both writers agree on the concurrency contract.
 */

import { and, eq, isNull, sql } from 'drizzle-orm';
import { orders } from '@/lib/db/schema/order';
import type { getDbAsync } from '@/lib/db';

type Db = Awaited<ReturnType<typeof getDbAsync>>;
type OrderRow = typeof orders.$inferSelect;

/** Bounded CAS retries on the ledger column before a caller gives up. */
export const MAX_CAS_ATTEMPTS = 5;

/** Parse a `mode:"json"` column that may arrive already-parsed or as a string. */
export function parseJson(value: unknown): any {
  return typeof value === 'string' ? JSON.parse(value) : value;
}

/**
 * The `updated_at` half of a CAS guard. `updated_at` can be NULL on legacy rows,
 * and `= NULL` never matches in SQL, so route those to `IS NULL`.
 */
export function updatedAtGuard(value: string | null) {
  return value === null ? isNull(orders.updated_at) : eq(orders.updated_at, value);
}

/**
 * Monotonic version half of the CAS guard (BMC-193 review, Finding 2). The
 * `updated_at` timestamp is millisecond-resolution ISO text, so two writes in
 * the same millisecond could theoretically share it and both pass an
 * `updated_at`-only CAS. `extensions.refunds_version` is an integer bumped on
 * EVERY ledger write, so it disambiguates same-millisecond writers: a lost
 * racer reads the stale version and its `COALESCE(json_extract(...),0) = <read>`
 * predicate no longer matches once the winner has incremented it. Legacy rows
 * (no `refunds_version`) read as 0 via COALESCE; the first write bumps them to 1.
 * Kept as a single atomic UPDATE statement (no schema migration needed).
 */
export function refundsVersionGuard(version: number) {
  return sql`COALESCE(json_extract(${orders.extensions}, '$.refunds_version'), 0) = ${version}`;
}

/** Current refund-ledger version on a parsed extensions object (default 0). */
export function readRefundsVersion(extensions: any): number {
  const v = extensions?.refunds_version;
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** What a `mutateRefundLedger` callback returns for one CAS attempt. */
export type LedgerMutation =
  /** Nothing to write — stop the loop and report success. */
  | { action: 'skip' }
  /**
   * Commit these changes. `extensions` is written verbatim (the caller is
   * responsible for bumping `refunds_version`, which `mutateRefundLedger`
   * supplies pre-incremented); `columns` carries any other order columns to set
   * atomically with the ledger (status, payment_status, notes …).
   */
  | { action: 'write'; extensions: Record<string, unknown>; columns?: Record<string, unknown> };

export type LedgerMutationContext = {
  order: OrderRow;
  /** Parsed `extensions` (never null — defaults to `{}`). */
  extensions: any;
  /** `extensions.refunds` as an array (never null). */
  refunds: any[];
  /** Version read this attempt; write back `nextVersion` to win the CAS. */
  version: number;
  /** `version + 1` — put this on the extensions object you return. */
  nextVersion: number;
  /** Timestamp to stamp on the write, shared with the `updated_at` column. */
  nowIso: string;
};

export type LedgerMutationResult =
  | { ok: true; skipped: true; order: OrderRow }
  | { ok: true; skipped: false; order: OrderRow }
  | { ok: false; reason: 'not_found' | 'cas_exhausted' };

/**
 * Run a guarded read-modify-write against an order's refund ledger.
 *
 * Re-reads the order on every attempt so `mutate` always decides against fresh
 * ledger state (a concurrent refund may have consumed remaining balance), then
 * commits under the `updated_at` + `refunds_version` CAS. A lost race re-reads
 * and retries up to `MAX_CAS_ATTEMPTS`.
 *
 * `mutate` must be free of side effects — it can be invoked several times.
 */
export async function mutateRefundLedger(
  db: Db,
  orderId: string,
  mutate: (ctx: LedgerMutationContext) => LedgerMutation | Promise<LedgerMutation>
): Promise<LedgerMutationResult> {
  for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
    const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
    if (!order) {
      return { ok: false, reason: 'not_found' };
    }

    const extensions = order.extensions ? (parseJson(order.extensions) ?? {}) : {};
    const refunds: any[] = Array.isArray(extensions.refunds) ? extensions.refunds : [];
    const version = readRefundsVersion(extensions);
    const nowIso = new Date().toISOString();

    const decision = await mutate({
      order,
      extensions,
      refunds,
      version,
      nextVersion: version + 1,
      nowIso,
    });

    if (decision.action === 'skip') {
      return { ok: true, skipped: true, order };
    }

    // extensions is a `mode: "json"` column — assign the RAW object and let
    // Drizzle serialize; a manual JSON.stringify would double-encode.
    const [row] = await db
      .update(orders)
      .set({
        ...(decision.columns ?? {}),
        extensions: decision.extensions,
        updated_at: nowIso,
      })
      .where(
        and(
          eq(orders.id, orderId),
          updatedAtGuard(order.updated_at ?? null),
          refundsVersionGuard(version)
        )
      )
      .returning();

    if (row) {
      return { ok: true, skipped: false, order: row };
    }
    // Lost the CAS race — a concurrent write landed first; re-read and retry.
  }

  return { ok: false, reason: 'cas_exhausted' };
}
