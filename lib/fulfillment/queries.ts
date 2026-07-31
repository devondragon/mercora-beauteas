/**
 * BMC-216D: SQL-backed admin fulfillment queue queries.
 *
 * The predicate/sort builders below are pure Drizzle `SQL` fragments so they can
 * be compiled and asserted in a unit test without D1. `queryAdminOrders`
 * plugs them into the query builder so filtering, counting and sorting all
 * happen in SQLite BEFORE LIMIT/OFFSET — the bug this ticket fixes is the old
 * admin page filtering only the already-paginated page in React.
 */
import { sql, type SQL } from "drizzle-orm";
import { getDbAsync } from "@/lib/db";
import { orders } from "@/lib/db/schema/order";
import { Money } from "@/lib/money";
import type { Order } from "@/lib/types/order";

export const ADMIN_ORDER_VIEWS = ["awaiting", "shipped", "cancelled", "all"] as const;
export type AdminOrderView = (typeof ADMIN_ORDER_VIEWS)[number];

export const DEFAULT_ADMIN_ORDER_LIMIT = 20;
export const MAX_ADMIN_ORDER_LIMIT = 100;

/**
 * D1 rejects LIKE patterns longer than 50 characters
 * ("LIKE or GLOB pattern too complex"). The pattern is `%term%`, so the term
 * itself must stay well under that.
 */
export const MAX_ADMIN_SEARCH_LENGTH = 40;

export function isAdminOrderView(value: unknown): value is AdminOrderView {
  return typeof value === "string" && (ADMIN_ORDER_VIEWS as readonly string[]).includes(value);
}

/**
 * Lowercase (every compared column is lowered in SQL), strip LIKE wildcards so
 * a user cannot turn the search into a full scan pattern, and bound the length.
 * Returns null when nothing searchable remains.
 */
export function normalizeSearchTerm(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw.replace(/[%_\\]/g, "").trim().toLowerCase();
  if (!cleaned) return null;
  return cleaned.slice(0, MAX_ADMIN_SEARCH_LENGTH);
}

export function viewPredicate(view: AdminOrderView): SQL {
  switch (view) {
    case "awaiting":
      return sql`status = 'processing' AND payment_status = 'paid'`;
    case "shipped":
      return sql`status IN ('shipped', 'delivered')`;
    case "cancelled":
      return sql`status IN ('cancelled', 'refunded')`;
    case "all":
      // COALESCE keeps the NOT(...) from evaluating to NULL (and silently
      // dropping the row) when payment_status is NULL on a legacy record.
      return sql`NOT (status = 'pending' AND COALESCE(payment_status, 'pending') <> 'paid')`;
  }
}

/**
 * Order number, customer email (both persisted locations) and recipient name.
 * `shipping_address` stores a MACHAddress — the recipient-name keys actually
 * written by checkout are `recipient` and `company` (lib/types/mach/Address.ts).
 */
export function searchPredicate(term: string): SQL {
  const pattern = `%${term}%`;
  return sql`(
    lower(id) LIKE ${pattern}
    OR lower(COALESCE(json_extract(shipping_address, '$.email'), '')) LIKE ${pattern}
    OR lower(COALESCE(json_extract(extensions, '$.email'), '')) LIKE ${pattern}
    OR lower(COALESCE(json_extract(shipping_address, '$.recipient'), '')) LIKE ${pattern}
    OR lower(COALESCE(json_extract(shipping_address, '$.company'), '')) LIKE ${pattern}
  )`;
}

export function whereForView(view: AdminOrderView, term: string | null): SQL {
  const base = viewPredicate(view);
  if (!term) return base;
  return sql`(${base}) AND (${searchPredicate(term)})`;
}

/** Oldest-first for the awaiting queue; `id` is the stable tiebreak. */
export function orderByForView(view: AdminOrderView): SQL {
  return view === "awaiting"
    ? sql`created_at ASC, id ASC`
    : sql`created_at DESC, id DESC`;
}

export interface AdminOrderQuery {
  view: AdminOrderView;
  q?: string;
  limit: number;
  offset: number;
}

export type AdminOrderCounts = Record<AdminOrderView, number>;

export interface AdminOrderQueryResult {
  orders: Order[];
  total: number;
  counts: AdminOrderCounts;
}

function parseJson<T>(value: unknown): T | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return undefined;
    }
  }
  return value as T;
}

type OrderRow = typeof orders.$inferSelect;

function hydrateOrderRow(row: OrderRow): Order {
  return {
    id: row.id ?? undefined,
    customer_id: row.customer_id || undefined,
    status: row.status,
    // Drizzle already parses mode:"json"; Money.fromStored also tolerates a raw
    // string/number so legacy rows read back at their real persisted value.
    total_amount: Money.fromStored(row.total_amount, row.currency_code).toJSON(),
    currency_code: row.currency_code,
    shipping_address: parseJson<Order["shipping_address"]>(row.shipping_address),
    billing_address: parseJson<Order["billing_address"]>(row.billing_address),
    items: parseJson<Order["items"]>(row.items) ?? [],
    shipping_method: row.shipping_method ?? undefined,
    payment_method: row.payment_method ?? undefined,
    payment_status: row.payment_status ?? "pending",
    shipping_carrier: row.shipping_carrier ?? undefined,
    tracking_number: row.tracking_number ?? undefined,
    shipped_at: row.shipped_at ?? undefined,
    delivered_at: row.delivered_at ?? undefined,
    notes: row.notes ?? undefined,
    external_references: parseJson<Order["external_references"]>(row.external_references),
    extensions: parseJson<Order["extensions"]>(row.extensions),
    created_at: row.created_at ?? undefined,
    updated_at: row.updated_at ?? undefined,
  };
}

/**
 * One page of the admin fulfillment queue plus the tab counts.
 *
 * Every filter is a SQL predicate applied before LIMIT/OFFSET. `total` is the
 * row count for the requested view (search applied); `counts` is the per-view
 * breakdown scoped by the search term only, so the tab badges keep matching
 * what the operator would see after switching tabs.
 */
export async function queryAdminOrders(params: AdminOrderQuery): Promise<AdminOrderQueryResult> {
  const db = await getDbAsync();
  const term = normalizeSearchTerm(params.q);
  const limit = Math.max(1, Math.min(params.limit, MAX_ADMIN_ORDER_LIMIT));
  const offset = Math.max(0, params.offset);
  const where = whereForView(params.view, term);

  const rows = (await db
    .select()
    .from(orders)
    .where(where)
    .orderBy(orderByForView(params.view))
    .limit(limit)
    .offset(offset)) as OrderRow[];

  const [totalRow] = await db
    .select({ value: sql<number>`COUNT(*)` })
    .from(orders)
    .where(where);

  const countsBase = db
    .select({
      awaiting: sql<number>`SUM(CASE WHEN ${viewPredicate("awaiting")} THEN 1 ELSE 0 END)`,
      shipped: sql<number>`SUM(CASE WHEN ${viewPredicate("shipped")} THEN 1 ELSE 0 END)`,
      cancelled: sql<number>`SUM(CASE WHEN ${viewPredicate("cancelled")} THEN 1 ELSE 0 END)`,
      all: sql<number>`SUM(CASE WHEN ${viewPredicate("all")} THEN 1 ELSE 0 END)`,
    })
    .from(orders);

  const countRows = await (term ? countsBase.where(searchPredicate(term)) : countsBase);
  const countsRow = countRows[0];

  return {
    orders: rows.map(hydrateOrderRow),
    total: Number(totalRow?.value ?? 0),
    counts: {
      awaiting: Number(countsRow?.awaiting ?? 0),
      shipped: Number(countsRow?.shipped ?? 0),
      cancelled: Number(countsRow?.cancelled ?? 0),
      all: Number(countsRow?.all ?? 0),
    },
  };
}
