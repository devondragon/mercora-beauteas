# BMC-216D: Admin Fulfillment Queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the admin order list's page-local status/search filtering and unrestricted inline status/tracking editing with a SQL-backed fulfillment queue whose only mutations are the guarded ship / tracking / shipping-email endpoints.

**Architecture:** A new pure SQL-fragment layer (`lib/fulfillment/queries.ts`) builds view predicates, a `json_extract`-based search predicate and per-view sort orders, which `queryAdminOrders` plugs into the Drizzle query builder so filtering, counting and sorting all happen in D1 *before* `LIMIT`/`OFFSET`. `GET /api/admin/orders` wraps that behind `checkAdminPermissions` with strict param validation. The React queue is rebuilt around a pure view-model module (`lib/fulfillment/queue-view.ts`) — row-state derivation, tab-count formatting, email-state derivation and event-timeline formatting all live there and are unit-tested, leaving the components as thin JSX over tested logic.

**Tech Stack:** Next.js 15 App Router (client components), Drizzle ORM `sql` fragments over Cloudflare D1, shadcn/ui (`Dialog`, `Button`, `Input`, `Label`, `Badge`, `Card`), lucide-react, Tailwind, Vitest (`tests/unit/**`), `lib/money` for totals.

**Depends on:** BMC-216B (ship/tracking/events routes), BMC-216C (shipping-email route)

**Also consumes (BMC-216A):** `lib/fulfillment/types.ts` (`Carrier`, `OrderEventType`), `lib/fulfillment/tracking.ts` (`normalizeLegacyCarrier`, `sanitizeTrackingNumber`, `buildTrackingUrl`), and `orders.shipping_carrier` in the Drizzle schema (migration `0022`).

**Interface contract:** docs/superpowers/plans/2026-07-30-bmc-216-interfaces.md (binding)

## Global Constraints

- Tests live under `tests/unit/**` only (CI runs nothing else). Mock the model layer with `vi.mock("@/lib/models/…")` — unit tests must not touch Cloudflare bindings.
- `npm run lint` and `npx tsc --noEmit` must pass before every commit claim.
- Money: all monetary display/serialization through `lib/money` — never raw `*100`/`/100`.
- D1: `db.batch()` for atomic writes; no `db.transaction()`.
- Files kebab-case; components PascalCase; `@/*` path alias.
- Pure modules (`lib/fulfillment/tracking.ts`, `transitions.ts`, `lib/order-status/token.ts`, `lib/orders/customer-email.ts`) must import nothing from D1/Next/Clerk/Resend.
- Migration files: next free numbers `0022`, `0023`. Never renumber existing migrations. D1 LIKE patterns are capped at 50 chars — use `json_extract`, not long LIKE guards.
- `ORDER_STATUS_SECRET` typing is hand-added to `cloudflare-env.d.ts` — never regenerate that file wholesale.

**BMC-216D-specific constraints:**

- `app/api/orders/route.ts` is **not touched** by this ticket. Its `GET`/`PUT` keep serving customer + MCP consumers; ticket F hardens `PUT`. The admin queue simply stops calling it.
- No component-rendering test library is installed (`vitest.config.ts` sets `environment: 'jsdom'` and includes `*.test.tsx`, but `@testing-library/react` is **absent** and zero `.test.tsx` files exist). Do **not** add one. All UI logic is extracted into `lib/fulfillment/queue-view.ts` and unit-tested there; JSX-only steps verify with `npm run lint && npx tsc --noEmit` plus a listed manual check.

---

### Task 1: Pure admin-queue SQL fragment builders

**Files:**
- Create: `lib/fulfillment/queries.ts`
- Test: `tests/unit/fulfillment/admin-order-predicates.test.ts`

**Interfaces:**
- Produces: `ADMIN_ORDER_VIEWS`, `AdminOrderView`, `isAdminOrderView(v: unknown): v is AdminOrderView`, `normalizeSearchTerm(raw: unknown): string | null`, `viewPredicate(view: AdminOrderView): SQL`, `searchPredicate(term: string): SQL`, `whereForView(view: AdminOrderView, term: string | null): SQL`, `orderByForView(view: AdminOrderView): SQL`, `DEFAULT_ADMIN_ORDER_LIMIT`, `MAX_ADMIN_ORDER_LIMIT`, `MAX_ADMIN_SEARCH_LENGTH`
- Consumes: `sql`, `SQL` from `drizzle-orm`

**Suggested agent:** opus — the view predicates, NULL-safe `all` clause and the `json_extract` search shape are the correctness core of the whole ticket.

- [ ] Write the failing test `tests/unit/fulfillment/admin-order-predicates.test.ts`:

```ts
/**
 * BMC-216D: the admin queue's SQL predicates. These are compiled with
 * Drizzle's own SQLite dialect so the assertions are on the real emitted SQL
 * + bound params — no D1, no Cloudflare bindings.
 */
import { describe, it, expect } from 'vitest';
import { SQLiteAsyncDialect } from 'drizzle-orm/sqlite-core';
import type { SQL } from 'drizzle-orm';
import {
  ADMIN_ORDER_VIEWS,
  isAdminOrderView,
  normalizeSearchTerm,
  viewPredicate,
  searchPredicate,
  whereForView,
  orderByForView,
  MAX_ADMIN_SEARCH_LENGTH,
} from '@/lib/fulfillment/queries';

const dialect = new SQLiteAsyncDialect();

function compile(fragment: SQL): { sql: string; params: unknown[] } {
  const query = dialect.sqlToQuery(fragment);
  return { sql: query.sql.replace(/\s+/g, ' ').trim(), params: query.params as unknown[] };
}

describe('admin order view predicates', () => {
  it('lists exactly the four contracted views', () => {
    expect([...ADMIN_ORDER_VIEWS]).toEqual(['awaiting', 'shipped', 'cancelled', 'all']);
    expect(isAdminOrderView('awaiting')).toBe(true);
    expect(isAdminOrderView('bogus')).toBe(false);
    expect(isAdminOrderView(undefined)).toBe(false);
  });

  it('awaiting excludes unpaid drafts — paid AND processing only', () => {
    const { sql } = compile(viewPredicate('awaiting'));
    expect(sql).toContain("status = 'processing'");
    expect(sql).toContain("payment_status = 'paid'");
  });

  it('shipped covers shipped + delivered, cancelled covers cancelled + refunded', () => {
    expect(compile(viewPredicate('shipped')).sql).toContain("status in ('shipped', 'delivered')".replace('in', 'IN'));
    expect(compile(viewPredicate('cancelled')).sql).toContain("status IN ('cancelled', 'refunded')");
  });

  it('all excludes unpaid pending drafts and is NULL-safe on payment_status', () => {
    const { sql } = compile(viewPredicate('all'));
    expect(sql).toContain("status = 'pending'");
    expect(sql).toContain('COALESCE(payment_status');
    expect(sql.startsWith('NOT (')).toBe(true);
  });
});

describe('search term normalization', () => {
  it('lowercases, trims and strips LIKE wildcards', () => {
    expect(normalizeSearchTerm('  Ac%me_Co\\ ')).toBe('acmeco');
  });

  it('bounds length so the %term% pattern stays under D1’s 50-char LIKE cap', () => {
    const long = 'a'.repeat(200);
    expect(normalizeSearchTerm(long)).toHaveLength(MAX_ADMIN_SEARCH_LENGTH);
    expect(MAX_ADMIN_SEARCH_LENGTH + 2).toBeLessThanOrEqual(50);
  });

  it('returns null for empty / non-string input', () => {
    expect(normalizeSearchTerm('   ')).toBeNull();
    expect(normalizeSearchTerm(null)).toBeNull();
    expect(normalizeSearchTerm(7)).toBeNull();
  });
});

describe('search predicate', () => {
  it('matches order id, both email keys and the recipient-name keys', () => {
    const { sql, params } = compile(searchPredicate('acme'));
    expect(sql).toContain('lower(id) LIKE');
    expect(sql).toContain("json_extract(shipping_address, '$.email')");
    expect(sql).toContain("json_extract(extensions, '$.email')");
    expect(sql).toContain("json_extract(shipping_address, '$.recipient')");
    expect(sql).toContain("json_extract(shipping_address, '$.company')");
    expect(params).toEqual(Array(5).fill('%acme%'));
  });
});

describe('whereForView', () => {
  it('ANDs the search predicate onto the view predicate', () => {
    const { sql, params } = compile(whereForView('shipped', 'acme'));
    expect(sql).toContain("status IN ('shipped', 'delivered')");
    expect(sql).toContain(') AND (');
    expect(params).toEqual(Array(5).fill('%acme%'));
  });

  it('emits the bare view predicate when there is no search term', () => {
    const { sql, params } = compile(whereForView('awaiting', null));
    expect(sql).toContain("status = 'processing'");
    expect(params).toEqual([]);
  });
});

describe('orderByForView', () => {
  it('sorts awaiting oldest-first with a stable id tiebreak', () => {
    expect(compile(orderByForView('awaiting')).sql).toBe('created_at ASC, id ASC');
  });

  it('sorts every other view newest-first with a stable id tiebreak', () => {
    for (const view of ['shipped', 'cancelled', 'all'] as const) {
      expect(compile(orderByForView(view)).sql).toBe('created_at DESC, id DESC');
    }
  });
});
```

- [ ] Run `npx vitest run tests/unit/fulfillment/admin-order-predicates.test.ts` — expect failure: `Failed to resolve import "@/lib/fulfillment/queries"`.
- [ ] Create `lib/fulfillment/queries.ts` with the pure layer only:

```ts
/**
 * BMC-216D: SQL-backed admin fulfillment queue queries.
 *
 * The predicate/sort builders below are pure Drizzle `SQL` fragments so they can
 * be compiled and asserted in a unit test without D1. `queryAdminOrders`
 * (added next) plugs them into the query builder so filtering, counting and
 * sorting all happen in SQLite BEFORE LIMIT/OFFSET — the bug this ticket fixes
 * is the old admin page filtering only the already-paginated page in React.
 */
import { sql, type SQL } from "drizzle-orm";

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
```

- [ ] Run `npx vitest run tests/unit/fulfillment/admin-order-predicates.test.ts` — expect all tests to pass. If `sqlToQuery` normalizes `IN` casing differently than asserted, fix the *test's* expected string, never the predicate semantics.
- [ ] Run `npm run lint && npx tsc --noEmit` — expect clean.
- [ ] Commit:

```bash
git add lib/fulfillment/queries.ts tests/unit/fulfillment/admin-order-predicates.test.ts
git commit -m "feat(fulfillment): SQL predicates for the admin order queue (BMC-216D)"
```

---

### Task 2: `queryAdminOrders` — execution, counts and row hydration

**Files:**
- Modify: `lib/fulfillment/queries.ts` (append below the pure layer from Task 1)
- Modify: `lib/types/order.ts` (add `shipping_carrier` to `Order` **only if BMC-216A did not already**)
- Test: `tests/unit/fulfillment/query-admin-orders.test.ts`

**Interfaces:**
- Produces: `AdminOrderQuery { view; q?; limit; offset }`, `AdminOrderCounts = Record<AdminOrderView, number>`, `queryAdminOrders(params: AdminOrderQuery): Promise<{ orders: Order[]; total: number; counts: AdminOrderCounts }>`
- Consumes: `getDbAsync` from `@/lib/db`, `orders` from `@/lib/db/schema/order`, `Money` from `@/lib/money`, `Order` from `@/lib/types/order`

**Suggested agent:** opus — conditional-aggregation counts, filter-before-pagination ordering and JSON row hydration are the highest-risk SQL in the ticket.

- [ ] Read `lib/types/order.ts` and check whether `Order` already declares `shipping_carrier`. If it does not, add exactly one line inside the `Order` interface next to `tracking_number`:

```ts
  shipping_carrier?: Carrier | null;
```

  …importing `import type { Carrier } from "@/lib/fulfillment/types";` at the top. (Record this in `## Contract Deviations` only if you had to add it.)

- [ ] Write the failing test `tests/unit/fulfillment/query-admin-orders.test.ts`:

```ts
/**
 * BMC-216D: queryAdminOrders must filter/sort/count in SQL, not in JS.
 * The D1 layer is mocked with a thenable fake builder that records the
 * fragments it was handed — no Cloudflare bindings are touched.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SQLiteAsyncDialect } from 'drizzle-orm/sqlite-core';
import type { SQL } from 'drizzle-orm';

vi.mock('@/lib/db', () => ({ getDbAsync: vi.fn() }));

import { queryAdminOrders } from '@/lib/fulfillment/queries';
import { getDbAsync } from '@/lib/db';

const dialect = new SQLiteAsyncDialect();
const text = (fragment: SQL) => dialect.sqlToQuery(fragment).sql.replace(/\s+/g, ' ').trim();
const bound = (fragment: SQL) => dialect.sqlToQuery(fragment).params as unknown[];

interface RecordedQuery {
  kind: 'rows' | 'total' | 'counts';
  where?: SQL;
  orderBy?: SQL;
  limit?: number;
  offset?: number;
}

function row(id: string, status: string, payment_status: string, created_at: string) {
  return {
    id,
    customer_id: 'cus_1',
    status,
    payment_status,
    total_amount: { amount: 2500, currency: 'USD' },
    currency_code: 'USD',
    shipping_address: { recipient: 'Ada Lovelace', email: 'ada@example.com' },
    billing_address: null,
    items: [{ product_name: 'Morning Blend', quantity: 1 }],
    shipping_method: 'standard',
    payment_method: 'card',
    shipping_carrier: 'ups',
    tracking_number: '1Z999',
    shipped_at: null,
    delivered_at: null,
    notes: null,
    external_references: null,
    extensions: { email: 'ada@example.com' },
    created_at,
    updated_at: created_at,
  };
}

const ROWS = [
  row('WEB-1', 'processing', 'paid', '2026-07-01T00:00:00.000Z'),
  // Deliberately NOT matching the awaiting view: if this survives, the SQL
  // result is being trusted (correct). If it were dropped, a JS filter crept in.
  row('WEB-2', 'refunded', 'refunded', '2026-07-02T00:00:00.000Z'),
];

let recorded: RecordedQuery[] = [];

function fakeDb(totalValue: number, counts: Record<string, number>) {
  return {
    select(fields?: Record<string, unknown>) {
      const kind: RecordedQuery['kind'] =
        fields === undefined ? 'rows' : 'awaiting' in fields ? 'counts' : 'total';
      const state: RecordedQuery = { kind };
      recorded.push(state);
      const builder: Record<string, unknown> = {
        from: () => builder,
        where: (w: SQL) => { state.where = w; return builder; },
        orderBy: (o: SQL) => { state.orderBy = o; return builder; },
        limit: (n: number) => { state.limit = n; return builder; },
        offset: (n: number) => { state.offset = n; return builder; },
        then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => {
          const value =
            kind === 'rows' ? ROWS : kind === 'total' ? [{ value: totalValue }] : [counts];
          return Promise.resolve(value).then(resolve, reject);
        },
      };
      return builder;
    },
  };
}

beforeEach(() => {
  recorded = [];
  vi.mocked(getDbAsync).mockResolvedValue(
    fakeDb(2, { awaiting: 3, shipped: 4, cancelled: 5, all: 12 }) as never,
  );
});

const rowsQuery = () => recorded.find((q) => q.kind === 'rows')!;

describe('queryAdminOrders', () => {
  it('applies the view filter in SQL on the same query that paginates', async () => {
    await queryAdminOrders({ view: 'awaiting', limit: 20, offset: 40 });
    const q = rowsQuery();
    expect(text(q.where!)).toContain("status = 'processing'");
    expect(text(q.where!)).toContain("payment_status = 'paid'");
    expect(q.limit).toBe(20);
    expect(q.offset).toBe(40);
  });

  it('returns the SQL result verbatim — no JS re-filtering of the page', async () => {
    const result = await queryAdminOrders({ view: 'awaiting', limit: 20, offset: 0 });
    expect(result.orders.map((o) => o.id)).toEqual(['WEB-1', 'WEB-2']);
  });

  it('orders the awaiting queue oldest-first', async () => {
    await queryAdminOrders({ view: 'awaiting', limit: 20, offset: 0 });
    expect(text(rowsQuery().orderBy!)).toBe('created_at ASC, id ASC');
  });

  it('orders every other view newest-first', async () => {
    await queryAdminOrders({ view: 'shipped', limit: 20, offset: 0 });
    expect(text(rowsQuery().orderBy!)).toBe('created_at DESC, id DESC');
  });

  it('pushes the search term into the SQL predicate, not into JS', async () => {
    await queryAdminOrders({ view: 'all', q: 'Ada', limit: 20, offset: 0 });
    const where = rowsQuery().where!;
    expect(text(where)).toContain("json_extract(shipping_address, '$.recipient')");
    expect(bound(where)).toEqual(Array(5).fill('%ada%'));
  });

  it('caps limit at 100 and floors offset at 0', async () => {
    await queryAdminOrders({ view: 'all', limit: 5000, offset: -10 });
    expect(rowsQuery().limit).toBe(100);
    expect(rowsQuery().offset).toBe(0);
  });

  it('returns the per-view counts and the filtered total', async () => {
    const result = await queryAdminOrders({ view: 'awaiting', limit: 20, offset: 0 });
    expect(result.total).toBe(2);
    expect(result.counts).toEqual({ awaiting: 3, shipped: 4, cancelled: 5, all: 12 });
  });

  it('scopes the counts query by the search term but not by the active view', async () => {
    await queryAdminOrders({ view: 'awaiting', q: 'ada', limit: 20, offset: 0 });
    const countsQuery = recorded.find((q) => q.kind === 'counts')!;
    expect(text(countsQuery.where!)).toContain("json_extract(extensions, '$.email')");
    expect(text(countsQuery.where!)).not.toContain("status = 'processing' AND payment_status = 'paid' AND");
  });

  it('hydrates JSON columns and the persisted total', async () => {
    const [order] = (await queryAdminOrders({ view: 'all', limit: 20, offset: 0 })).orders;
    expect(order.shipping_address?.recipient).toBe('Ada Lovelace');
    expect(order.items).toHaveLength(1);
    expect(order.shipping_carrier).toBe('ups');
    expect(order.total_amount.amount).toBe(2500);
  });
});
```

- [ ] Run `npx vitest run tests/unit/fulfillment/query-admin-orders.test.ts` — expect failure: `queryAdminOrders is not a function`.
- [ ] Append to `lib/fulfillment/queries.ts`:

```ts
import { getDbAsync } from "@/lib/db";
import { orders } from "@/lib/db/schema/order";
import { Money } from "@/lib/money";
import type { Order } from "@/lib/types/order";
import type { Carrier } from "./types";

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

type OrderRow = typeof orders.$inferSelect & { shipping_carrier?: string | null };

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
    shipping_carrier: (row.shipping_carrier ?? null) as Carrier | null,
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
```

- [ ] Run `npx vitest run tests/unit/fulfillment/query-admin-orders.test.ts` — expect all tests to pass.
- [ ] Run `npm run lint && npx tsc --noEmit` — expect clean.
- [ ] Commit:

```bash
git add lib/fulfillment/queries.ts lib/types/order.ts tests/unit/fulfillment/query-admin-orders.test.ts
git commit -m "feat(fulfillment): queryAdminOrders filters, sorts and counts in SQL (BMC-216D)"
```

---

### Task 3: `GET /api/admin/orders`

**Files:**
- Create: `app/api/admin/orders/route.ts`
- Test: `tests/unit/app/api/admin-orders-list-route.test.ts`

**Interfaces:**
- Produces: `GET(request: NextRequest)` → `200 { orders: WireOrder[]; total: number; counts: AdminOrderCounts; meta: { view; limit; offset } }`; `400 { error }` for an unknown `view`; `401 { error }` when not admin
- Consumes: `checkAdminPermissions` from `@/lib/auth/admin-middleware`, `queryAdminOrders` / `isAdminOrderView` / limit constants from `@/lib/fulfillment/queries`, `toWireOrder` from `@/lib/utils/order-wire`

**Suggested agent:** sonnet — a thin, well-specified route handler over an already-tested query.

- [ ] Write the failing test `tests/unit/app/api/admin-orders-list-route.test.ts`:

```ts
/**
 * BMC-216D: GET /api/admin/orders — admin auth + param validation.
 * Auth and the query layer are mocked; no D1 or Clerk is reached.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth/admin-middleware', () => ({ checkAdminPermissions: vi.fn() }));
vi.mock('@/lib/fulfillment/queries', async () => {
  const actual = await vi.importActual<typeof import('@/lib/fulfillment/queries')>(
    '@/lib/fulfillment/queries',
  );
  return { ...actual, queryAdminOrders: vi.fn() };
});

import { NextRequest } from 'next/server';
import { GET } from '@/app/api/admin/orders/route';
import { checkAdminPermissions } from '@/lib/auth/admin-middleware';
import { queryAdminOrders } from '@/lib/fulfillment/queries';

const ORDER = {
  id: 'WEB-1',
  status: 'processing' as const,
  total_amount: { amount: 2500, currency: 'USD' },
  currency_code: 'USD',
  items: [],
  payment_status: 'paid',
  created_at: '2026-07-01T00:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(checkAdminPermissions).mockResolvedValue({ success: true, userId: 'user_admin' });
  vi.mocked(queryAdminOrders).mockResolvedValue({
    orders: [ORDER] as never,
    total: 1,
    counts: { awaiting: 1, shipped: 2, cancelled: 3, all: 6 },
  });
});

const req = (qs = '') => new NextRequest(`http://localhost/api/admin/orders${qs ? `?${qs}` : ''}`);

describe('GET /api/admin/orders', () => {
  it('rejects a non-admin without touching the query layer', async () => {
    vi.mocked(checkAdminPermissions).mockResolvedValue({ success: false, error: 'nope' });
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(queryAdminOrders).not.toHaveBeenCalled();
  });

  it('defaults to the awaiting view, limit 20, offset 0', async () => {
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(vi.mocked(queryAdminOrders).mock.calls[0][0]).toMatchObject({
      view: 'awaiting',
      limit: 20,
      offset: 0,
    });
  });

  it('caps limit at 100', async () => {
    await GET(req('limit=5000'));
    expect(vi.mocked(queryAdminOrders).mock.calls[0][0].limit).toBe(100);
  });

  it('falls back to the default limit for junk input', async () => {
    await GET(req('limit=abc&offset=abc'));
    expect(vi.mocked(queryAdminOrders).mock.calls[0][0]).toMatchObject({ limit: 20, offset: 0 });
  });

  it('400s on an unknown view rather than silently defaulting', async () => {
    const res = await GET(req('view=everything'));
    expect(res.status).toBe(400);
    expect(queryAdminOrders).not.toHaveBeenCalled();
  });

  it('passes the raw search term through and returns orders + total + counts', async () => {
    const res = await GET(req('view=shipped&q=ada'));
    expect(vi.mocked(queryAdminOrders).mock.calls[0][0]).toMatchObject({ view: 'shipped', q: 'ada' });
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.total).toBe(1);
    expect(body.counts).toEqual({ awaiting: 1, shipped: 2, cancelled: 3, all: 6 });
    expect(Array.isArray(body.orders)).toBe(true);
  });

  it('500s (not throws) when the query layer fails', async () => {
    vi.mocked(queryAdminOrders).mockRejectedValue(new Error('d1 down'));
    const res = await GET(req());
    expect(res.status).toBe(500);
  });
});
```

- [ ] Run `npx vitest run tests/unit/app/api/admin-orders-list-route.test.ts` — expect failure: cannot resolve `@/app/api/admin/orders/route`.
- [ ] Create `app/api/admin/orders/route.ts`:

```ts
/**
 * BMC-216D: SQL-backed admin order list for the fulfillment queue.
 *
 * This replaces `GET /api/orders?admin=true` FOR THE ADMIN QUEUE UI ONLY — that
 * legacy route still serves customer and MCP consumers and is untouched here.
 */
import { NextRequest, NextResponse } from "next/server";
import { checkAdminPermissions } from "@/lib/auth/admin-middleware";
import {
  DEFAULT_ADMIN_ORDER_LIMIT,
  MAX_ADMIN_ORDER_LIMIT,
  isAdminOrderView,
  queryAdminOrders,
} from "@/lib/fulfillment/queries";
import { toWireOrder } from "@/lib/utils/order-wire";

function clampInt(raw: string | null, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(parsed, max));
}

export async function GET(request: NextRequest) {
  const auth = await checkAdminPermissions(request);
  if (!auth.success) {
    return NextResponse.json({ error: auth.error ?? "Admin access required" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const rawView = searchParams.get("view");
  if (rawView !== null && !isAdminOrderView(rawView)) {
    return NextResponse.json({ error: `Unknown view "${rawView}"` }, { status: 400 });
  }
  const view = rawView ?? "awaiting";
  const limit = clampInt(
    searchParams.get("limit"),
    DEFAULT_ADMIN_ORDER_LIMIT,
    1,
    MAX_ADMIN_ORDER_LIMIT,
  );
  const offset = clampInt(searchParams.get("offset"), 0, 0, Number.MAX_SAFE_INTEGER);

  try {
    const result = await queryAdminOrders({
      view,
      q: searchParams.get("q") ?? undefined,
      limit,
      offset,
    });

    return NextResponse.json({
      orders: result.orders.map(toWireOrder),
      total: result.total,
      counts: result.counts,
      meta: { view, limit, offset },
    });
  } catch (error) {
    console.error("Admin order queue query failed", error);
    return NextResponse.json({ error: "Failed to load orders" }, { status: 500 });
  }
}
```

- [ ] Run `npx vitest run tests/unit/app/api/admin-orders-list-route.test.ts` — expect all tests to pass.
- [ ] Run `npm run lint && npx tsc --noEmit` — expect clean.
- [ ] Commit:

```bash
git add app/api/admin/orders/route.ts tests/unit/app/api/admin-orders-list-route.test.ts
git commit -m "feat(api): GET /api/admin/orders for the fulfillment queue (BMC-216D)"
```

---

### Task 4: Queue view-model — row state, tabs, pagination, post-ship list update

**Files:**
- Create: `lib/fulfillment/queue-view.ts`
- Test: `tests/unit/fulfillment/queue-view.test.ts`

**Interfaces:**
- Produces: `QUEUE_VIEWS`, `QueueView`, `QUEUE_VIEW_LABELS`, `CARRIER_LABELS`, `QueueOrderLike`, `AdminQueueOrder`, `QueueRowAction`, `QueueRowState`, `deriveQueueRowState(order: QueueOrderLike): QueueRowState`, `formatTabCount(count: number): string`, `buildQueueQueryString(params): string`, `applyShipmentResult<T extends QueueOrderLike>(rows: T[], view: QueueView, updated: T): T[]`
- Consumes: `normalizeLegacyCarrier`, `buildTrackingUrl` from `@/lib/fulfillment/tracking`; `Carrier` from `@/lib/fulfillment/types`

**Suggested agent:** sonnet — pure TypeScript with a fully specified test.

- [ ] Write the failing test `tests/unit/fulfillment/queue-view.test.ts`:

```ts
/**
 * BMC-216D: the admin queue's view-model. All row-state / tab / list-update
 * logic lives here (rather than inside JSX) so it is unit-testable — the repo
 * has no component-rendering test library and this ticket does not add one.
 */
import { describe, it, expect } from 'vitest';
import {
  QUEUE_VIEWS,
  QUEUE_VIEW_LABELS,
  CARRIER_LABELS,
  deriveQueueRowState,
  formatTabCount,
  buildQueueQueryString,
  applyShipmentResult,
  type QueueOrderLike,
} from '@/lib/fulfillment/queue-view';

const base: QueueOrderLike = {
  id: 'WEB-1',
  status: 'processing',
  payment_status: 'paid',
  shipping_carrier: null,
  tracking_number: null,
  shipped_at: null,
  created_at: '2026-07-01T00:00:00.000Z',
};

describe('queue views', () => {
  it('exposes the four contracted views with labels', () => {
    expect([...QUEUE_VIEWS]).toEqual(['awaiting', 'shipped', 'cancelled', 'all']);
    expect(QUEUE_VIEW_LABELS.awaiting).toBe('Awaiting shipment');
    expect(QUEUE_VIEW_LABELS.cancelled).toBe('Cancelled / refunded');
  });
});

describe('deriveQueueRowState', () => {
  it('offers Mark shipped only for a paid processing order', () => {
    expect(deriveQueueRowState(base).action).toBe('mark_shipped');
    expect(deriveQueueRowState({ ...base, payment_status: 'pending' }).action).toBe('none');
    expect(deriveQueueRowState({ ...base, status: 'pending' }).action).toBe('none');
  });

  it('offers Edit tracking for a shipped order and nothing for terminal states', () => {
    expect(deriveQueueRowState({ ...base, status: 'shipped' }).action).toBe('edit_tracking');
    expect(deriveQueueRowState({ ...base, status: 'delivered' }).action).toBe('none');
    expect(deriveQueueRowState({ ...base, status: 'refunded' }).action).toBe('none');
  });

  it('derives the carrier label and tracking link from stored carrier data', () => {
    const state = deriveQueueRowState({
      ...base,
      status: 'shipped',
      shipping_carrier: 'ups',
      tracking_number: ' 1Z999AA1 ',
      shipped_at: '2026-07-03T12:00:00.000Z',
    });
    expect(state.carrier).toBe('ups');
    expect(state.carrierLabel).toBe(CARRIER_LABELS.ups);
    expect(state.trackingNumber).toBe('1Z999AA1');
    expect(state.trackingUrl).toContain('ups.com');
    expect(state.shippedAt).toBe('2026-07-03T12:00:00.000Z');
  });

  it('renders an "other" carrier as a bare tracking number with no link', () => {
    const state = deriveQueueRowState({
      ...base,
      status: 'shipped',
      shipping_carrier: 'other',
      tracking_number: 'ABC123',
    });
    expect(state.carrierLabel).toBe('Other');
    expect(state.trackingUrl).toBeNull();
  });

  it('reports no tracking when the stored number is blank', () => {
    const state = deriveQueueRowState({ ...base, status: 'shipped', tracking_number: '   ' });
    expect(state.trackingNumber).toBeNull();
    expect(state.trackingUrl).toBeNull();
  });
});

describe('formatTabCount', () => {
  it('formats plain counts and caps at 99+', () => {
    expect(formatTabCount(0)).toBe('0');
    expect(formatTabCount(7)).toBe('7');
    expect(formatTabCount(99)).toBe('99');
    expect(formatTabCount(1200)).toBe('99+');
    expect(formatTabCount(Number.NaN)).toBe('0');
  });
});

describe('buildQueueQueryString', () => {
  it('always sends view/limit/offset and omits an empty search', () => {
    expect(buildQueueQueryString({ view: 'awaiting', limit: 20, offset: 0 })).toBe(
      'view=awaiting&limit=20&offset=0',
    );
    expect(buildQueueQueryString({ view: 'all', q: '  ada  ', limit: 20, offset: 40 })).toBe(
      'view=all&q=ada&limit=20&offset=40',
    );
  });
});

describe('applyShipmentResult', () => {
  const rows: QueueOrderLike[] = [base, { ...base, id: 'WEB-2' }];

  it('removes a newly shipped order from the awaiting queue', () => {
    const updated = { ...base, status: 'shipped', shipped_at: '2026-07-03T00:00:00.000Z' };
    const next = applyShipmentResult(rows, 'awaiting', updated);
    expect(next.map((r) => r.id)).toEqual(['WEB-2']);
  });

  it('replaces the row in place on every non-awaiting view', () => {
    const updated = { ...base, status: 'shipped', tracking_number: '1Z' };
    const next = applyShipmentResult(rows, 'all', updated);
    expect(next.map((r) => r.id)).toEqual(['WEB-1', 'WEB-2']);
    expect(next[0].status).toBe('shipped');
    expect(next[0].tracking_number).toBe('1Z');
  });
});
```

- [ ] Run `npx vitest run tests/unit/fulfillment/queue-view.test.ts` — expect failure: cannot resolve `@/lib/fulfillment/queue-view`.
- [ ] Create `lib/fulfillment/queue-view.ts`:

```ts
/**
 * BMC-216D: pure view-model for the admin fulfillment queue.
 *
 * Everything the queue UI decides — which action a row offers, how a carrier and
 * tracking link render, how counts and query strings are formed, what happens to
 * the list after a successful shipment — lives here so it can be unit-tested.
 * The components in components/admin/orders/ are thin JSX over these functions.
 *
 * Tracking URLs come from lib/fulfillment/tracking.ts. The queue must NEVER
 * build a tracking URL itself: the old client-side generateTrackingUrl leaked
 * tracking numbers to a Google search URL for unknown carriers.
 */
import { buildTrackingUrl, normalizeLegacyCarrier } from "./tracking";
import type { Carrier } from "./types";

export const QUEUE_VIEWS = ["awaiting", "shipped", "cancelled", "all"] as const;
export type QueueView = (typeof QUEUE_VIEWS)[number];

export const QUEUE_VIEW_LABELS: Record<QueueView, string> = {
  awaiting: "Awaiting shipment",
  shipped: "Shipped",
  cancelled: "Cancelled / refunded",
  all: "All",
};

export const CARRIER_LABELS: Record<Carrier, string> = {
  ups: "UPS",
  fedex: "FedEx",
  other: "Other",
};

/** The minimum an order row must expose for queue state derivation. */
export interface QueueOrderLike {
  id?: string;
  status: string;
  payment_status?: string | null;
  shipping_carrier?: string | null;
  tracking_number?: string | null;
  shipped_at?: string | null;
  created_at?: string | null;
}

/** The wire-shaped order the queue page actually renders. */
export interface AdminQueueOrder extends QueueOrderLike {
  id: string;
  total_amount: { amount: number; currency: string; precision?: number };
  currency_code: string;
  shipping_address?: { recipient?: string; company?: string; email?: string } | null;
  extensions?: { email?: string } | null;
  items: Array<{ product_name: string; quantity: number }>;
}

export type QueueRowAction = "mark_shipped" | "edit_tracking" | "none";

export interface QueueRowState {
  action: QueueRowAction;
  carrier: Carrier | null;
  carrierLabel: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  shippedAt: string | null;
}

export function deriveQueueRowState(order: QueueOrderLike): QueueRowState {
  const carrier = normalizeLegacyCarrier(order.shipping_carrier);
  const trackingNumber =
    typeof order.tracking_number === "string" && order.tracking_number.trim()
      ? order.tracking_number.trim()
      : null;

  // `shipped` is the terminal operator-managed state (product decision 13):
  // `delivered` is read-only legacy/carrier state, so it offers no action.
  const action: QueueRowAction =
    order.status === "processing" && order.payment_status === "paid"
      ? "mark_shipped"
      : order.status === "shipped"
        ? "edit_tracking"
        : "none";

  return {
    action,
    carrier,
    carrierLabel: carrier ? CARRIER_LABELS[carrier] : null,
    trackingNumber,
    trackingUrl: buildTrackingUrl(carrier, trackingNumber),
    shippedAt: order.shipped_at ?? null,
  };
}

export function formatTabCount(count: number): string {
  if (!Number.isFinite(count) || count <= 0) return "0";
  return count > 99 ? "99+" : String(Math.floor(count));
}

export function buildQueueQueryString(params: {
  view: QueueView;
  q?: string;
  limit: number;
  offset: number;
}): string {
  const search = new URLSearchParams();
  search.set("view", params.view);
  if (params.q && params.q.trim()) search.set("q", params.q.trim());
  search.set("limit", String(params.limit));
  search.set("offset", String(params.offset));
  return search.toString();
}

/**
 * After a successful shipment the order is no longer awaiting shipment, so the
 * awaiting view drops it immediately; every other view shows the updated row.
 */
export function applyShipmentResult<T extends QueueOrderLike>(
  rows: T[],
  view: QueueView,
  updated: T,
): T[] {
  if (view === "awaiting") return rows.filter((row) => row.id !== updated.id);
  return rows.map((row) => (row.id === updated.id ? updated : row));
}
```

- [ ] Run `npx vitest run tests/unit/fulfillment/queue-view.test.ts` — expect all tests to pass.
- [ ] Run `npm run lint && npx tsc --noEmit` — expect clean.
- [ ] Commit:

```bash
git add lib/fulfillment/queue-view.ts tests/unit/fulfillment/queue-view.test.ts
git commit -m "feat(fulfillment): pure view-model for the admin queue rows (BMC-216D)"
```

---

### Task 5: Queue view-model — email state and human-readable event timeline

**Files:**
- Modify: `lib/fulfillment/queue-view.ts` (append)
- Test: `tests/unit/fulfillment/queue-view-events.test.ts`

**Interfaces:**
- Produces: `FulfillmentEventLike`, `EmailMode`, `EmailUiState`, `deriveEmailState(events: FulfillmentEventLike[]): EmailUiState`, `TimelineEntry`, `formatFulfillmentEvent(event: FulfillmentEventLike): TimelineEntry`, `formatFulfillmentTimeline(events: FulfillmentEventLike[]): TimelineEntry[]`
- Consumes: `GET /api/admin/orders/[id]/events` response shape `{ events: [{ id, type, actorType, actorId, fromStatus, toStatus, details, createdAt }] }` (oldest first)

**Suggested agent:** sonnet — pure formatting logic with a fully specified test.

- [ ] Write the failing test `tests/unit/fulfillment/queue-view-events.test.ts`:

```ts
/**
 * BMC-216D: email retry/resend state + the audit timeline's human-readable
 * rendering. The spec forbids showing raw event JSON, so that is asserted here.
 */
import { describe, it, expect } from 'vitest';
import {
  deriveEmailState,
  formatFulfillmentEvent,
  formatFulfillmentTimeline,
  type FulfillmentEventLike,
} from '@/lib/fulfillment/queue-view';

const event = (
  overrides: Partial<FulfillmentEventLike> & Pick<FulfillmentEventLike, 'id' | 'type'>,
): FulfillmentEventLike => ({
  actorType: 'admin',
  actorId: 'user_admin',
  fromStatus: null,
  toStatus: null,
  details: null,
  createdAt: '2026-07-03T12:00:00.000Z',
  ...overrides,
});

describe('deriveEmailState', () => {
  it('reports the never-attempted state with a retry-mode action', () => {
    const state = deriveEmailState([event({ id: 'e1', type: 'shipment_created' })]);
    expect(state.kind).toBe('never_attempted');
    expect(state.mode).toBe('retry');
  });

  it('shows a retry action and the error after a failed send', () => {
    const state = deriveEmailState([
      event({ id: 'e1', type: 'shipment_created' }),
      event({ id: 'e2', type: 'shipping_email_failed', details: { error: 'resend 500' } }),
    ]);
    expect(state.kind).toBe('failed');
    expect(state.mode).toBe('retry');
    expect(state.actionLabel).toBe('Retry email');
    expect(state.lastError).toBe('resend 500');
  });

  it('switches to resend mode once a send has succeeded', () => {
    const state = deriveEmailState([
      event({ id: 'e1', type: 'shipping_email_failed', details: { error: 'boom' } }),
      event({ id: 'e2', type: 'shipping_email_sent', details: { idempotencyKey: 'k' } }),
    ]);
    expect(state.kind).toBe('sent');
    expect(state.mode).toBe('resend');
    expect(state.actionLabel).toBe('Resend email');
    expect(state.lastError).toBeNull();
  });

  it('stays in resend mode when a later resend fails', () => {
    const state = deriveEmailState([
      event({ id: 'e1', type: 'shipping_email_sent' }),
      event({ id: 'e2', type: 'shipping_email_failed', details: { error: 'later boom' } }),
    ]);
    expect(state.mode).toBe('resend');
  });
});

describe('formatFulfillmentEvent', () => {
  it('renders shipment_created with carrier, tracking and the status move', () => {
    const entry = formatFulfillmentEvent(
      event({
        id: 'e1',
        type: 'shipment_created',
        fromStatus: 'processing',
        toStatus: 'shipped',
        details: { carrier: 'ups', trackingNumber: '1Z999', trackingUrl: 'https://ups' },
      }),
    );
    expect(entry.title).toBe('Marked shipped');
    expect(entry.tone).toBe('success');
    expect(entry.details).toContain('Carrier: UPS');
    expect(entry.details).toContain('Tracking: 1Z999');
    expect(entry.details).toContain('Status: processing → shipped');
  });

  it('renders tracking_updated with old and new carrier + tracking', () => {
    const entry = formatFulfillmentEvent(
      event({
        id: 'e2',
        type: 'tracking_updated',
        details: {
          previous: { carrier: 'ups', trackingNumber: '1Z111' },
          next: { carrier: 'fedex', trackingNumber: '7777' },
        },
      }),
    );
    expect(entry.title).toBe('Tracking updated');
    expect(entry.details).toContain('Carrier: UPS → FedEx');
    expect(entry.details).toContain('Tracking: 1Z111 → 7777');
  });

  it('describes an absent previous carrier in words, not as null', () => {
    const entry = formatFulfillmentEvent(
      event({
        id: 'e3',
        type: 'tracking_updated',
        details: { previous: {}, next: { carrier: 'ups', trackingNumber: '1Z' } },
      }),
    );
    expect(entry.details).toContain('Carrier: no carrier → UPS');
    expect(entry.details).toContain('Tracking: no tracking number → 1Z');
  });

  it('flags a failed email with its error and an error tone', () => {
    const entry = formatFulfillmentEvent(
      event({ id: 'e4', type: 'shipping_email_failed', details: { error: 'resend 500' } }),
    );
    expect(entry.title).toBe('Shipping email failed');
    expect(entry.tone).toBe('error');
    expect(entry.details).toContain('Error: resend 500');
  });

  it('names the actor', () => {
    const entry = formatFulfillmentEvent(
      event({ id: 'e5', type: 'shipping_email_sent', actorType: 'service', actorId: 'api-token' }),
    );
    expect(entry.actor).toBe('Service token (api-token)');
  });

  it('never leaks raw event JSON into the rendered strings', () => {
    const entries = formatFulfillmentTimeline([
      event({
        id: 'e1',
        type: 'shipment_created',
        details: { carrier: 'ups', trackingNumber: '1Z', trackingUrl: 'https://ups' },
      }),
      event({ id: 'e2', type: 'shipping_email_sent', details: { idempotencyKey: 'k/initial' } }),
    ]);
    const rendered = entries.flatMap((entry) => [entry.title, entry.actor, ...entry.details]).join(' ');
    expect(rendered).not.toContain('{');
    expect(rendered).not.toContain('idempotencyKey');
    expect(rendered).not.toContain('trackingUrl');
  });

  it('degrades gracefully on an unknown event type', () => {
    const entry = formatFulfillmentEvent(event({ id: 'e9', type: 'something_new' }));
    expect(entry.title).toBe('Fulfillment update');
    expect(entry.tone).toBe('info');
  });
});
```

- [ ] Run `npx vitest run tests/unit/fulfillment/queue-view-events.test.ts` — expect failure: `deriveEmailState is not exported`.
- [ ] Append to `lib/fulfillment/queue-view.ts`:

```ts
/** A fulfillment event as returned by GET /api/admin/orders/[id]/events. */
export interface FulfillmentEventLike {
  id: string;
  type: string;
  actorType?: string | null;
  actorId?: string | null;
  fromStatus?: string | null;
  toStatus?: string | null;
  details?: Record<string, unknown> | null;
  createdAt: string;
}

export type EmailMode = "retry" | "resend";

export interface EmailUiState {
  kind: "sent" | "failed" | "never_attempted";
  /** Matches POST /api/admin/orders/[id]/shipping-email's `mode` contract. */
  mode: EmailMode;
  actionLabel: string;
  message: string;
  lastError: string | null;
  lastAttemptAt: string | null;
}

const EMAIL_EVENT_TYPES = new Set([
  "shipping_email_sent",
  "shipping_email_failed",
  "shipping_email_resent",
]);

/**
 * `resend` is valid only once a `shipping_email_sent` event exists — that is
 * exactly the server's `wrong_mode` rule, so the button never sends a request
 * the route would 409.
 */
export function deriveEmailState(events: FulfillmentEventLike[]): EmailUiState {
  const emailEvents = events.filter((event) => EMAIL_EVENT_TYPES.has(event.type));
  const last = emailEvents.length ? emailEvents[emailEvents.length - 1] : null;
  const hasSent = emailEvents.some((event) => event.type === "shipping_email_sent");

  if (hasSent) {
    return {
      kind: "sent",
      mode: "resend",
      actionLabel: "Resend email",
      message: "Shipping email sent",
      lastError: null,
      lastAttemptAt: last?.createdAt ?? null,
    };
  }

  if (last?.type === "shipping_email_failed") {
    const error = typeof last.details?.error === "string" ? last.details.error : null;
    return {
      kind: "failed",
      mode: "retry",
      actionLabel: "Retry email",
      message: "Shipping email failed to send",
      lastError: error,
      lastAttemptAt: last.createdAt,
    };
  }

  return {
    kind: "never_attempted",
    mode: "retry",
    actionLabel: "Send email",
    message: "No shipping email sent yet",
    lastError: null,
    lastAttemptAt: null,
  };
}

export interface TimelineEntry {
  id: string;
  title: string;
  details: string[];
  actor: string;
  timestamp: string;
  tone: "info" | "success" | "error";
}

const ACTOR_LABELS: Record<string, string> = {
  admin: "Admin",
  service: "Service token",
  system: "System",
};

function actorLabel(event: FulfillmentEventLike): string {
  const base = ACTOR_LABELS[event.actorType ?? ""] ?? "Unknown actor";
  return event.actorId ? `${base} (${event.actorId})` : base;
}

function carrierText(value: unknown): string {
  const carrier = normalizeLegacyCarrier(value);
  return carrier ? CARRIER_LABELS[carrier] : "no carrier";
}

function trackingText(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : "no tracking number";
}

/**
 * Turns one audit row into display strings. The spec forbids rendering raw
 * event JSON, so every field is read individually and formatted in words —
 * unknown keys (idempotencyKey, trackingUrl, …) are deliberately not surfaced.
 */
export function formatFulfillmentEvent(event: FulfillmentEventLike): TimelineEntry {
  const details: string[] = [];
  const payload = (event.details ?? {}) as Record<string, unknown>;
  let title = "Fulfillment update";
  let tone: TimelineEntry["tone"] = "info";

  switch (event.type) {
    case "shipment_created": {
      title = "Marked shipped";
      tone = "success";
      details.push(`Carrier: ${carrierText(payload.carrier)}`);
      details.push(`Tracking: ${trackingText(payload.trackingNumber)}`);
      if (event.fromStatus && event.toStatus) {
        details.push(`Status: ${event.fromStatus} → ${event.toStatus}`);
      }
      break;
    }
    case "tracking_updated": {
      title = "Tracking updated";
      const previous = (payload.previous ?? {}) as Record<string, unknown>;
      const next = (payload.next ?? {}) as Record<string, unknown>;
      details.push(`Carrier: ${carrierText(previous.carrier)} → ${carrierText(next.carrier)}`);
      details.push(
        `Tracking: ${trackingText(previous.trackingNumber)} → ${trackingText(next.trackingNumber)}`,
      );
      break;
    }
    case "shipping_email_sent":
      title = "Shipping email sent";
      tone = "success";
      break;
    case "shipping_email_resent":
      title = "Shipping email resent";
      tone = "success";
      break;
    case "shipping_email_failed": {
      title = "Shipping email failed";
      tone = "error";
      if (typeof payload.error === "string" && payload.error.trim()) {
        details.push(`Error: ${payload.error.trim()}`);
      }
      break;
    }
    default:
      break;
  }

  return { id: event.id, title, details, actor: actorLabel(event), timestamp: event.createdAt, tone };
}

export function formatFulfillmentTimeline(events: FulfillmentEventLike[]): TimelineEntry[] {
  return events.map(formatFulfillmentEvent);
}
```

- [ ] Run `npx vitest run tests/unit/fulfillment/queue-view-events.test.ts` — expect all tests to pass.
- [ ] Run `npm run lint && npx tsc --noEmit` — expect clean.
- [ ] Commit:

```bash
git add lib/fulfillment/queue-view.ts tests/unit/fulfillment/queue-view-events.test.ts
git commit -m "feat(fulfillment): email-state + audit-timeline view-model (BMC-216D)"
```

---

### Task 6: Mark-shipped modal

**Files:**
- Create: `components/admin/orders/MarkShippedModal.tsx`

**Interfaces:**
- Produces: default export `MarkShippedModal`, `export interface MarkShippedSubmit { carrier: Carrier | null; trackingNumber: string | null }`
- Consumes: `sanitizeTrackingNumber`, `buildTrackingUrl` from `@/lib/fulfillment/tracking`; `CARRIER_LABELS` from `@/lib/fulfillment/queue-view`; `Dialog*` from `@/components/ui/dialog`

**Suggested agent:** sonnet — self-contained shadcn/ui dialog with local form state.

- [ ] Read `components/ui/dialog.tsx` and `components/ui/label.tsx` to confirm the exported names (`Dialog`, `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogDescription`, `DialogFooter`, `Label`).
- [ ] Create `components/admin/orders/MarkShippedModal.tsx`:

```tsx
"use client";

/**
 * BMC-216D: the only way an operator moves an order to `shipped`.
 *
 * Carrier and tracking are optional AS A PAIR — untracked shipments are valid,
 * but a tracking number without a carrier (or a carrier with no number) is not,
 * because the server derives the customer-facing tracking link from the pair.
 * The preview below uses the SAME buildTrackingUrl the server and email use, so
 * what the operator sees is what the customer gets.
 */
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertTriangle, Mail, RefreshCw, Truck } from "lucide-react";
import { buildTrackingUrl, sanitizeTrackingNumber } from "@/lib/fulfillment/tracking";
import { CARRIER_LABELS } from "@/lib/fulfillment/queue-view";
import type { Carrier } from "@/lib/fulfillment/types";

export interface MarkShippedSubmit {
  carrier: Carrier | null;
  trackingNumber: string | null;
}

interface MarkShippedModalProps {
  open: boolean;
  orderId: string;
  recipient: string;
  submitting: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: (input: MarkShippedSubmit) => void;
}

export default function MarkShippedModal({
  open,
  orderId,
  recipient,
  submitting,
  error,
  onCancel,
  onConfirm,
}: MarkShippedModalProps) {
  const [carrier, setCarrier] = useState<"" | Carrier>("");
  const [trackingInput, setTrackingInput] = useState("");

  const chosenCarrier: Carrier | null = carrier === "" ? null : carrier;
  const sanitized = sanitizeTrackingNumber(trackingInput);
  const hasTrackingText = trackingInput.trim().length > 0;
  const previewUrl = buildTrackingUrl(chosenCarrier, sanitized);

  const validationError = hasTrackingText && !sanitized
    ? "That tracking number is too long or contains unsupported characters."
    : hasTrackingText && !chosenCarrier
      ? "Choose a carrier so the customer gets a working tracking link."
      : !hasTrackingText && chosenCarrier
        ? "Enter a tracking number, or clear the carrier to ship without tracking."
        : null;

  const canSubmit = !submitting && !validationError;

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !submitting) onCancel(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Mark order #{orderId} shipped</DialogTitle>
          <DialogDescription>
            Recording the shipment for {recipient}. Carrier and tracking are optional — leave both
            blank to ship without tracking.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div>
            <Label htmlFor="mark-shipped-carrier" className="mb-2 block text-text-secondary">
              Carrier
            </Label>
            <select
              id="mark-shipped-carrier"
              value={carrier}
              disabled={submitting}
              onChange={(event) => setCarrier(event.target.value as "" | Carrier)}
              className="w-full rounded-md border admin-input px-3 py-2"
            >
              <option value="">No carrier (untracked)</option>
              <option value="ups">{CARRIER_LABELS.ups}</option>
              <option value="fedex">{CARRIER_LABELS.fedex}</option>
              <option value="other">{CARRIER_LABELS.other}</option>
            </select>
          </div>

          <div>
            <Label htmlFor="mark-shipped-tracking" className="mb-2 block text-text-secondary">
              Tracking number <span className="text-text-muted">(optional)</span>
            </Label>
            <Input
              id="mark-shipped-tracking"
              value={trackingInput}
              disabled={submitting}
              onChange={(event) => setTrackingInput(event.target.value)}
              className="admin-input"
              placeholder="e.g. 1Z999AA10123456784"
            />
          </div>

          <div className="rounded bg-surface p-3 text-sm text-text-secondary">
            <p className="font-medium text-text-primary">Customer tracking link</p>
            {previewUrl ? (
              <a
                href={previewUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="break-all text-primary-600 hover:underline"
              >
                {previewUrl}
              </a>
            ) : (
              <p>
                {chosenCarrier === "other"
                  ? "Other carriers show the tracking number with no link."
                  : "No tracking link — the customer will see the shipment without a carrier link."}
              </p>
            )}
          </div>

          <div className="flex items-start gap-2 rounded bg-state-info-bg p-3 text-sm text-text-secondary">
            <Mail className="mt-0.5 h-4 w-4 shrink-0 text-state-info" />
            <span>
              The customer will receive a shipping confirmation email as soon as this shipment is
              recorded.
            </span>
          </div>

          {validationError && (
            <p className="flex items-center text-sm text-state-error">
              <AlertTriangle className="mr-2 h-4 w-4" />
              {validationError}
            </p>
          )}
          {error && (
            <p className="flex items-center text-sm text-state-error">
              <AlertTriangle className="mr-2 h-4 w-4" />
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={submitting}>
            Cancel
          </Button>
          <Button
            onClick={() => onConfirm({ carrier: chosenCarrier, trackingNumber: sanitized })}
            disabled={!canSubmit}
            className="bg-primary-500 hover:bg-primary-600"
          >
            {submitting ? (
              <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Truck className="mr-2 h-4 w-4" />
            )}
            Confirm shipment &amp; email customer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] Run `npm run lint && npx tsc --noEmit` — expect clean. (No unit test: this is JSX over already-tested helpers; behaviour is covered manually in Task 12's checklist.)
- [ ] Commit:

```bash
git add components/admin/orders/MarkShippedModal.tsx
git commit -m "feat(admin): mark-shipped modal with derived tracking preview (BMC-216D)"
```

---

### Task 7: Edit-tracking modal

**Files:**
- Create: `components/admin/orders/EditTrackingModal.tsx`

**Interfaces:**
- Produces: default export `EditTrackingModal`, `export interface EditTrackingSubmit { carrier: Carrier; trackingNumber: string }`
- Consumes: `PATCH /api/admin/orders/[id]/tracking` request contract — **both** `carrier` and `trackingNumber` are required

**Suggested agent:** sonnet — sibling of Task 6 with a stricter validity rule.

- [ ] Create `components/admin/orders/EditTrackingModal.tsx`:

```tsx
"use client";

/**
 * BMC-216D: correct the carrier/tracking on an already-shipped order.
 *
 * PATCH /api/admin/orders/[id]/tracking requires a full valid pair, and it
 * never emails the customer — the copy below says so explicitly so the operator
 * is not surprised by silence.
 */
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertTriangle, Pencil, RefreshCw } from "lucide-react";
import { buildTrackingUrl, sanitizeTrackingNumber } from "@/lib/fulfillment/tracking";
import { CARRIER_LABELS } from "@/lib/fulfillment/queue-view";
import type { Carrier } from "@/lib/fulfillment/types";

export interface EditTrackingSubmit {
  carrier: Carrier;
  trackingNumber: string;
}

interface EditTrackingModalProps {
  open: boolean;
  orderId: string;
  initialCarrier: Carrier | null;
  initialTrackingNumber: string | null;
  submitting: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: (input: EditTrackingSubmit) => void;
}

export default function EditTrackingModal({
  open,
  orderId,
  initialCarrier,
  initialTrackingNumber,
  submitting,
  error,
  onCancel,
  onConfirm,
}: EditTrackingModalProps) {
  const [carrier, setCarrier] = useState<"" | Carrier>(initialCarrier ?? "");
  const [trackingInput, setTrackingInput] = useState(initialTrackingNumber ?? "");

  const chosenCarrier: Carrier | null = carrier === "" ? null : carrier;
  const sanitized = sanitizeTrackingNumber(trackingInput);
  const previewUrl = buildTrackingUrl(chosenCarrier, sanitized);

  const validationError = !chosenCarrier
    ? "Choose a carrier."
    : !sanitized
      ? "Enter a valid tracking number (1–100 characters)."
      : null;

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !submitting) onCancel(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit tracking for order #{orderId}</DialogTitle>
          <DialogDescription>
            Corrects the carrier and tracking number on a shipped order. This does not email the
            customer — use Resend email if they need the corrected link.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div>
            <Label htmlFor="edit-tracking-carrier" className="mb-2 block text-text-secondary">
              Carrier
            </Label>
            <select
              id="edit-tracking-carrier"
              value={carrier}
              disabled={submitting}
              onChange={(event) => setCarrier(event.target.value as "" | Carrier)}
              className="w-full rounded-md border admin-input px-3 py-2"
            >
              <option value="">Select a carrier</option>
              <option value="ups">{CARRIER_LABELS.ups}</option>
              <option value="fedex">{CARRIER_LABELS.fedex}</option>
              <option value="other">{CARRIER_LABELS.other}</option>
            </select>
          </div>

          <div>
            <Label htmlFor="edit-tracking-number" className="mb-2 block text-text-secondary">
              Tracking number
            </Label>
            <Input
              id="edit-tracking-number"
              value={trackingInput}
              disabled={submitting}
              onChange={(event) => setTrackingInput(event.target.value)}
              className="admin-input"
              placeholder="Enter tracking number"
            />
          </div>

          <div className="rounded bg-surface p-3 text-sm text-text-secondary">
            <p className="font-medium text-text-primary">Customer tracking link</p>
            {previewUrl ? (
              <a
                href={previewUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="break-all text-primary-600 hover:underline"
              >
                {previewUrl}
              </a>
            ) : (
              <p>No link for this carrier — the tracking number is shown on its own.</p>
            )}
          </div>

          {validationError && (
            <p className="flex items-center text-sm text-state-error">
              <AlertTriangle className="mr-2 h-4 w-4" />
              {validationError}
            </p>
          )}
          {error && (
            <p className="flex items-center text-sm text-state-error">
              <AlertTriangle className="mr-2 h-4 w-4" />
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={submitting}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              if (!chosenCarrier || !sanitized) return;
              onConfirm({ carrier: chosenCarrier, trackingNumber: sanitized });
            }}
            disabled={submitting || Boolean(validationError)}
            className="bg-primary-500 hover:bg-primary-600"
          >
            {submitting ? (
              <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Pencil className="mr-2 h-4 w-4" />
            )}
            Save tracking
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] Run `npm run lint && npx tsc --noEmit` — expect clean.
- [ ] Commit:

```bash
git add components/admin/orders/EditTrackingModal.tsx
git commit -m "feat(admin): edit-tracking modal for shipped orders (BMC-216D)"
```

---

### Task 8: Queue row component

**Files:**
- Create: `components/admin/orders/QueueOrderRow.tsx`
- Read (reference): `docs/money.md`

**Interfaces:**
- Produces: default export `QueueOrderRow` with props `{ order: AdminQueueOrder; emailState: EmailUiState | null; emailBusy: boolean; onMarkShipped; onEditTracking; onEmailAction }`
- Consumes: `deriveQueueRowState`, `AdminQueueOrder`, `EmailUiState` from `@/lib/fulfillment/queue-view`; `Money` from `@/lib/money`; `orderStatusConfig`/`defaultOrderStatusStyle` from `@/lib/ui/status-styles`

**Suggested agent:** sonnet — presentation over the tested view-model, but it renders money and must use `Money.format()`.

- [ ] Read `docs/money.md` — the API wire order carries `total_amount` as MACH money (MAJOR units), so display goes through `Money.fromMajor(...).format()`. Never `/100`.
- [ ] Create `components/admin/orders/QueueOrderRow.tsx`:

```tsx
"use client";

/**
 * BMC-216D: one order row in the admin fulfillment queue.
 *
 * All state decisions come from deriveQueueRowState / deriveEmailState — this
 * component only renders them. There is deliberately no inline status, carrier
 * or tracking editing here: every mutation goes through the guarded ship /
 * tracking / shipping-email endpoints.
 */
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Money } from "@/lib/money";
import { defaultOrderStatusStyle, orderStatusConfig } from "@/lib/ui/status-styles";
import { deriveQueueRowState } from "@/lib/fulfillment/queue-view";
import type { AdminQueueOrder, EmailMode, EmailUiState } from "@/lib/fulfillment/queue-view";
import type { OrderStatus } from "@/lib/types/order";
import {
  AlertTriangle,
  Calendar,
  ExternalLink,
  Mail,
  Package,
  Pencil,
  RefreshCw,
  Truck,
  User,
} from "lucide-react";

interface QueueOrderRowProps {
  order: AdminQueueOrder;
  emailState: EmailUiState | null;
  emailBusy: boolean;
  onMarkShipped: (order: AdminQueueOrder) => void;
  onEditTracking: (order: AdminQueueOrder) => void;
  onEmailAction: (order: AdminQueueOrder, mode: EmailMode) => void;
}

export default function QueueOrderRow({
  order,
  emailState,
  emailBusy,
  onMarkShipped,
  onEditTracking,
  onEmailAction,
}: QueueOrderRowProps) {
  const row = deriveQueueRowState(order);
  const statusStyle = orderStatusConfig[order.status as OrderStatus] ?? defaultOrderStatusStyle;
  const StatusIcon = statusStyle.icon;
  const recipient = order.shipping_address?.recipient || order.shipping_address?.company || "Guest";
  const email = order.shipping_address?.email || order.extensions?.email || null;
  const total = Money.fromMajor(
    order.total_amount.amount,
    order.total_amount.currency || order.currency_code,
  );
  const isShippedish = order.status === "shipped" || order.status === "delivered";

  return (
    <div className="space-y-3 p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <Link
            href={`/admin/orders/${order.id}`}
            className="font-medium text-text-primary hover:underline"
          >
            #{order.id}
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-text-secondary">
            <span className="flex items-center">
              <Calendar className="mr-1 h-3 w-3" />
              {order.created_at ? new Date(order.created_at).toLocaleDateString() : "—"}
            </span>
            <span className="flex items-center">
              <User className="mr-1 h-3 w-3" />
              {recipient}
            </span>
            {email && <span className="truncate">{email}</span>}
            <span className="flex items-center">
              <Package className="mr-1 h-3 w-3" />
              {order.items.length} items
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Badge variant={statusStyle.variant} className="text-xs">
            <StatusIcon className="mr-1 h-3 w-3" />
            {statusStyle.label}
          </Badge>
          <span className="text-lg font-semibold text-text-primary">{total.format()}</span>

          {row.action === "mark_shipped" && (
            <Button
              size="sm"
              onClick={() => onMarkShipped(order)}
              className="bg-primary-500 hover:bg-primary-600"
            >
              <Truck className="mr-2 h-4 w-4" />
              Mark shipped
            </Button>
          )}
          {row.action === "edit_tracking" && (
            <Button size="sm" variant="outline" onClick={() => onEditTracking(order)}>
              <Pencil className="mr-2 h-4 w-4" />
              Edit tracking
            </Button>
          )}
        </div>
      </div>

      {isShippedish && (
        <div className="rounded bg-surface p-3 text-sm">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-text-secondary">
            <span>
              Shipped{" "}
              <span className="text-text-primary">
                {row.shippedAt ? new Date(row.shippedAt).toLocaleString() : "—"}
              </span>
            </span>
            <span>
              Carrier <span className="text-text-primary">{row.carrierLabel ?? "not recorded"}</span>
            </span>
            <span>
              Tracking{" "}
              {row.trackingNumber ? (
                row.trackingUrl ? (
                  <a
                    href={row.trackingUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center text-primary-600 hover:underline"
                  >
                    {row.trackingNumber}
                    <ExternalLink className="ml-1 h-3 w-3" />
                  </a>
                ) : (
                  <span className="text-text-primary">{row.trackingNumber}</span>
                )
              ) : (
                <span className="text-text-primary">none</span>
              )}
            </span>
          </div>

          {emailState && (
            <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-border-default pt-3">
              <span
                className={`flex items-center text-sm ${
                  emailState.kind === "failed"
                    ? "text-state-error"
                    : emailState.kind === "sent"
                      ? "text-state-success"
                      : "text-text-secondary"
                }`}
              >
                {emailState.kind === "failed" ? (
                  <AlertTriangle className="mr-2 h-4 w-4" />
                ) : (
                  <Mail className="mr-2 h-4 w-4" />
                )}
                {emailState.message}
              </span>
              {emailState.lastError && (
                <span className="text-xs text-state-error">{emailState.lastError}</span>
              )}
              <Button
                size="sm"
                variant={emailState.kind === "failed" ? "default" : "outline"}
                disabled={emailBusy}
                onClick={() => onEmailAction(order, emailState.mode)}
              >
                {emailBusy ? (
                  <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Mail className="mr-2 h-4 w-4" />
                )}
                {emailState.actionLabel}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] Run `npm run lint && npx tsc --noEmit` — expect clean.
- [ ] Commit:

```bash
git add components/admin/orders/QueueOrderRow.tsx
git commit -m "feat(admin): fulfillment queue row with shipment + email status (BMC-216D)"
```

---

### Task 9: Queue client — data layer, tabs, search, pagination

**Files:**
- Create: `app/admin/orders/OrdersQueueClient.tsx`

**Interfaces:**
- Consumes: `GET /api/admin/orders?view&q&limit&offset` → `{ orders, total, counts, meta }`; `GET /api/admin/orders/[id]/events` → `{ events }`
- Produces: default export `OrdersQueueClient` (the whole queue UI; wired into `page.tsx` in Task 10)

**Suggested agent:** sonnet — React state/fetch orchestration over already-tested helpers.

- [ ] Create `app/admin/orders/OrdersQueueClient.tsx`:

```tsx
"use client";

/**
 * BMC-216D: the admin fulfillment queue.
 *
 * Replaces the old page's "load a page, then filter it in React" behaviour: the
 * view, search, sort, counts and pagination are all decided by
 * GET /api/admin/orders in SQL. The only mutations available here are the
 * guarded fulfillment endpoints — there is no generic status write.
 */
import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertTriangle,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  RefreshCw,
  Search,
} from "lucide-react";
import MarkShippedModal, { type MarkShippedSubmit } from "@/components/admin/orders/MarkShippedModal";
import EditTrackingModal, { type EditTrackingSubmit } from "@/components/admin/orders/EditTrackingModal";
import QueueOrderRow from "@/components/admin/orders/QueueOrderRow";
import {
  QUEUE_VIEWS,
  QUEUE_VIEW_LABELS,
  applyShipmentResult,
  buildQueueQueryString,
  deriveEmailState,
  deriveQueueRowState,
  formatTabCount,
  type AdminQueueOrder,
  type EmailMode,
  type EmailUiState,
  type FulfillmentEventLike,
  type QueueView,
} from "@/lib/fulfillment/queue-view";

const PAGE_SIZE = 20;
const EMPTY_COUNTS: Record<QueueView, number> = { awaiting: 0, shipped: 0, cancelled: 0, all: 0 };

interface AdminOrdersResponse {
  orders: AdminQueueOrder[];
  total: number;
  counts: Record<QueueView, number>;
}
interface EventsResponse {
  events: FulfillmentEventLike[];
}
interface MutationResponse {
  order?: AdminQueueOrder;
  email?: { attempted?: boolean; success?: boolean; error?: string };
  error?: string;
  code?: string;
  status?: string;
}

type Notice = { tone: "success" | "warning" | "error"; message: string };

export default function OrdersQueueClient() {
  const [view, setView] = useState<QueueView>("awaiting");
  const [searchInput, setSearchInput] = useState("");
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);

  const [orders, setOrders] = useState<AdminQueueOrder[]>([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<Record<QueueView, number>>(EMPTY_COUNTS);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  const [emailStates, setEmailStates] = useState<Record<string, EmailUiState>>({});
  const [emailBusyId, setEmailBusyId] = useState<string | null>(null);

  const [shipTarget, setShipTarget] = useState<AdminQueueOrder | null>(null);
  const [trackingTarget, setTrackingTarget] = useState<AdminQueueOrder | null>(null);
  const [modalBusy, setModalBusy] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  const fetchEmailState = useCallback(async (orderId: string): Promise<EmailUiState | null> => {
    try {
      const response = await fetch(`/api/admin/orders/${orderId}/events`);
      if (!response.ok) return null;
      const body = (await response.json()) as EventsResponse;
      return deriveEmailState(body.events ?? []);
    } catch {
      return null;
    }
  }, []);

  const loadEmailStates = useCallback(
    async (rows: AdminQueueOrder[]) => {
      const shipped = rows.filter((row) => row.status === "shipped" || row.status === "delivered");
      if (!shipped.length) {
        setEmailStates({});
        return;
      }
      const entries = await Promise.all(
        shipped.map(async (row) => {
          const state = await fetchEmailState(row.id);
          return state ? ([row.id, state] as const) : null;
        }),
      );
      setEmailStates(
        Object.fromEntries(entries.filter(Boolean) as Array<readonly [string, EmailUiState]>),
      );
    },
    [fetchEmailState],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const qs = buildQueueQueryString({ view, q: query, limit: PAGE_SIZE, offset });
      const response = await fetch(`/api/admin/orders?${qs}`);
      if (!response.ok) throw new Error(`Failed to load orders (${response.status})`);
      const body = (await response.json()) as AdminOrdersResponse;
      const rows = body.orders ?? [];
      setOrders(rows);
      setTotal(body.total ?? 0);
      setCounts(body.counts ?? EMPTY_COUNTS);
      await loadEmailStates(rows);
    } catch (error) {
      setOrders([]);
      setTotal(0);
      setLoadError(error instanceof Error ? error.message : "Failed to load orders");
    } finally {
      setLoading(false);
    }
  }, [view, query, offset, loadEmailStates]);

  useEffect(() => {
    load();
  }, [load]);

  const selectView = (next: QueueView) => {
    setView(next);
    setOffset(0);
  };

  const submitSearch = (event: React.FormEvent) => {
    event.preventDefault();
    setQuery(searchInput);
    setOffset(0);
  };

  const refreshEmailState = useCallback(
    async (orderId: string) => {
      const state = await fetchEmailState(orderId);
      if (state) setEmailStates((prev) => ({ ...prev, [orderId]: state }));
    },
    [fetchEmailState],
  );

  const handleShipConfirm = useCallback(
    async (input: MarkShippedSubmit) => {
      if (!shipTarget) return;
      setModalBusy(true);
      setModalError(null);
      try {
        const response = await fetch(`/api/admin/orders/${shipTarget.id}/ship`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...(input.carrier ? { carrier: input.carrier } : {}),
            ...(input.trackingNumber ? { trackingNumber: input.trackingNumber } : {}),
          }),
        });
        const body = (await response.json().catch(() => ({}))) as MutationResponse;
        if (!response.ok) {
          setModalError(
            body.error ??
              (body.code ? `${body.code}${body.status ? ` (order is ${body.status})` : ""}` : null) ??
              `Could not mark the order shipped (${response.status})`,
          );
          return;
        }

        const updated = body.order ?? { ...shipTarget, status: "shipped" };
        setOrders((prev) => applyShipmentResult(prev, view, updated));
        setCounts((prev) => ({
          ...prev,
          awaiting: Math.max(0, prev.awaiting - 1),
          shipped: prev.shipped + 1,
        }));
        if (view === "awaiting") setTotal((prev) => Math.max(0, prev - 1));
        setShipTarget(null);

        if (body.email?.attempted && !body.email.success) {
          setNotice({
            tone: "warning",
            message: `Order ${updated.id} is marked shipped, but the shipping email failed to send${
              body.email.error ? `: ${body.email.error}` : ""
            }. Open the Shipped tab and use Retry email.`,
          });
        } else if (body.email?.success) {
          setNotice({
            tone: "success",
            message: `Order ${updated.id} marked shipped and the shipping email was sent.`,
          });
        } else {
          setNotice({ tone: "success", message: `Order ${updated.id} marked shipped.` });
        }
        await refreshEmailState(updated.id);
      } catch (error) {
        setModalError(error instanceof Error ? error.message : "Could not mark the order shipped");
      } finally {
        setModalBusy(false);
      }
    },
    [shipTarget, view, refreshEmailState],
  );

  const handleTrackingConfirm = useCallback(
    async (input: EditTrackingSubmit) => {
      if (!trackingTarget) return;
      setModalBusy(true);
      setModalError(null);
      try {
        const response = await fetch(`/api/admin/orders/${trackingTarget.id}/tracking`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ carrier: input.carrier, trackingNumber: input.trackingNumber }),
        });
        const body = (await response.json().catch(() => ({}))) as MutationResponse;
        if (!response.ok) {
          setModalError(
            body.error ?? body.code ?? `Could not update tracking (${response.status})`,
          );
          return;
        }
        const updated = body.order ?? trackingTarget;
        setOrders((prev) => prev.map((row) => (row.id === updated.id ? updated : row)));
        setTrackingTarget(null);
        setNotice({
          tone: "success",
          message: `Tracking updated for order ${updated.id}. No email was sent.`,
        });
      } catch (error) {
        setModalError(error instanceof Error ? error.message : "Could not update tracking");
      } finally {
        setModalBusy(false);
      }
    },
    [trackingTarget],
  );

  const handleEmailAction = useCallback(
    async (order: AdminQueueOrder, mode: EmailMode) => {
      setEmailBusyId(order.id);
      try {
        const response = await fetch(`/api/admin/orders/${order.id}/shipping-email`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode }),
        });
        const body = (await response.json().catch(() => ({}))) as MutationResponse;
        if (!response.ok) {
          setNotice({
            tone: "error",
            message: body.error ?? body.code ?? `Email action failed (${response.status})`,
          });
        } else if (body.email?.success) {
          setNotice({ tone: "success", message: `Shipping email sent for order ${order.id}.` });
        } else {
          setNotice({
            tone: "error",
            message: `Shipping email for order ${order.id} failed${
              body.email?.error ? `: ${body.email.error}` : ""
            }.`,
          });
        }
        await refreshEmailState(order.id);
      } catch (error) {
        setNotice({
          tone: "error",
          message: error instanceof Error ? error.message : "Email action failed",
        });
      } finally {
        setEmailBusyId(null);
      }
    },
    [refreshEmailState],
  );

  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const firstShown = total === 0 ? 0 : offset + 1;
  const lastShown = Math.min(offset + PAGE_SIZE, total);

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="mb-2 text-2xl font-bold text-text-primary">Fulfillment</h1>
          <p className="text-text-secondary">Ship paid orders and keep customers informed</p>
        </div>
        <Button onClick={load} disabled={loading} className="bg-primary-500 hover:bg-primary-600">
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {notice && (
        <Card
          className={`admin-card flex items-start gap-3 p-4 ${
            notice.tone === "success"
              ? "border-state-success"
              : notice.tone === "warning"
                ? "border-state-warning"
                : "border-state-error"
          }`}
        >
          {notice.tone === "success" ? (
            <CheckCircle className="mt-0.5 h-5 w-5 shrink-0 text-state-success" />
          ) : (
            <AlertTriangle
              className={`mt-0.5 h-5 w-5 shrink-0 ${
                notice.tone === "warning" ? "text-state-warning" : "text-state-error"
              }`}
            />
          )}
          <p className="flex-1 text-sm text-text-secondary">{notice.message}</p>
          <Button variant="ghost" size="sm" onClick={() => setNotice(null)}>
            Dismiss
          </Button>
        </Card>
      )}

      <Card className="admin-card p-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-2">
            {QUEUE_VIEWS.map((candidate) => (
              <Button
                key={candidate}
                size="sm"
                variant={candidate === view ? "default" : "ghost"}
                onClick={() => selectView(candidate)}
                className={candidate === view ? "" : "text-text-secondary hover:text-text-primary"}
              >
                {QUEUE_VIEW_LABELS[candidate]}
                <span className="ml-2 rounded-full bg-surface px-2 py-0.5 text-xs text-text-secondary">
                  {formatTabCount(counts[candidate])}
                </span>
              </Button>
            ))}
          </div>

          <form onSubmit={submitSearch} className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-secondary" />
              <Input
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="Order number, recipient or email"
                className="admin-input w-72 pl-10"
              />
            </div>
            <Button type="submit" variant="secondary" size="sm">
              Search
            </Button>
            {query && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSearchInput("");
                  setQuery("");
                  setOffset(0);
                }}
              >
                Clear
              </Button>
            )}
          </form>
        </div>
      </Card>

      <Card className="admin-card">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <RefreshCw className="h-8 w-8 animate-spin text-primary-500" />
          </div>
        ) : loadError ? (
          <div className="p-8 text-center">
            <AlertTriangle className="mx-auto mb-4 h-12 w-12 text-state-error" />
            <h3 className="mb-2 text-lg font-medium text-text-secondary">Could not load orders</h3>
            <p className="text-text-muted">{loadError}</p>
          </div>
        ) : orders.length === 0 ? (
          <div className="p-8 text-center">
            <ClipboardList className="mx-auto mb-4 h-12 w-12 text-text-muted" />
            <h3 className="mb-2 text-lg font-medium text-text-secondary">
              Nothing in {QUEUE_VIEW_LABELS[view].toLowerCase()}
            </h3>
            <p className="text-text-muted">
              {query ? "No orders match that search." : "New paid orders will appear here."}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border-default">
            {orders.map((order) => (
              <QueueOrderRow
                key={order.id}
                order={order}
                emailState={emailStates[order.id] ?? null}
                emailBusy={emailBusyId === order.id}
                onMarkShipped={(target) => {
                  setModalError(null);
                  setShipTarget(target);
                }}
                onEditTracking={(target) => {
                  setModalError(null);
                  setTrackingTarget(target);
                }}
                onEmailAction={handleEmailAction}
              />
            ))}
          </div>
        )}
      </Card>

      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between rounded-lg border admin-card p-4">
          <div className="text-sm text-text-secondary">
            Showing{" "}
            <span className="font-medium text-text-primary">
              {firstShown}-{lastShown}
            </span>{" "}
            of <span className="font-medium text-text-primary">{total}</span> orders
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={offset === 0 || loading}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              className="text-text-secondary hover:text-text-primary"
            >
              <ChevronLeft className="h-4 w-4" />
              Previous
            </Button>
            <span className="text-sm text-text-secondary">
              Page <span className="font-medium text-text-primary">{page}</span> of{" "}
              <span className="font-medium text-text-primary">{totalPages}</span>
            </span>
            <Button
              variant="ghost"
              size="sm"
              disabled={offset + PAGE_SIZE >= total || loading}
              onClick={() => setOffset(offset + PAGE_SIZE)}
              className="text-text-secondary hover:text-text-primary"
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {shipTarget && (
        <MarkShippedModal
          key={`ship-${shipTarget.id}`}
          open
          orderId={shipTarget.id}
          recipient={
            shipTarget.shipping_address?.recipient || shipTarget.shipping_address?.company || "the customer"
          }
          submitting={modalBusy}
          error={modalError}
          onCancel={() => {
            setShipTarget(null);
            setModalError(null);
          }}
          onConfirm={handleShipConfirm}
        />
      )}

      {trackingTarget && (
        <EditTrackingModal
          key={`tracking-${trackingTarget.id}`}
          open
          orderId={trackingTarget.id}
          initialCarrier={deriveQueueRowState(trackingTarget).carrier}
          initialTrackingNumber={deriveQueueRowState(trackingTarget).trackingNumber}
          submitting={modalBusy}
          error={modalError}
          onCancel={() => {
            setTrackingTarget(null);
            setModalError(null);
          }}
          onConfirm={handleTrackingConfirm}
        />
      )}
    </div>
  );
}
```

- [ ] Run `npm run lint && npx tsc --noEmit` — expect clean. (`page.tsx` still renders the legacy UI; Task 10 swaps it.)
- [ ] Commit:

```bash
git add app/admin/orders/OrdersQueueClient.tsx
git commit -m "feat(admin): server-driven fulfillment queue client (BMC-216D)"
```

---

### Task 10: Replace the legacy queue page (removes the inline edit path)

**Files:**
- Modify (full replacement): `app/admin/orders/page.tsx` — deletes the client-side status/search filter (~:241-250), `updateOrderStatus` → `PUT /api/orders` (~:171-198), `handleEditSubmit` with its client-stamped `shipped_at`/`delivered_at` and `extensions.{carrier,trackingUrl}` (~:200-227), `generateTrackingUrl` (~:257-273) and the inline Edit panel (~:642-718)

**Interfaces:**
- Produces: `app/admin/orders/page.tsx` default export rendering `<OrdersQueueClient />`
- Removes: every admin caller of `PUT /api/orders`, all client-side tracking-URL construction

**Suggested agent:** sonnet — a small file, but the deletion must be complete and verified.

- [ ] Replace the entire contents of `app/admin/orders/page.tsx` with:

```tsx
/**
 * Admin fulfillment queue (BMC-216D).
 *
 * The previous implementation loaded a page of orders and filtered it in React
 * (so filters only ever saw the current page), and offered inline status /
 * carrier / tracking editing that wrote through PUT /api/orders with
 * browser-stamped shipped_at/delivered_at and a client-built tracking URL.
 * All of that is gone: filtering, sorting, counting and pagination now happen
 * in SQL behind GET /api/admin/orders, and the only mutations are the guarded
 * ship / tracking / shipping-email endpoints.
 */
import OrdersQueueClient from "./OrdersQueueClient";

export default function AdminOrdersPage() {
  return <OrdersQueueClient />;
}
```

- [ ] Verify the legacy path is gone:

```bash
rg -n "generateTrackingUrl|google.com/search\?q=track|shipped_at: new Date|method: \"PUT\"" app/admin components/admin || echo "clean"
```

  Expect `clean`. Any hit means a leftover — delete it.
- [ ] Run `npm run lint && npx tsc --noEmit` — expect clean.
- [ ] Manual check (`npm run preview:dev`, then the URL printed by `wrangler dev`, typically `http://localhost:8787`): open `/admin/orders`. Expect the **Awaiting shipment** tab selected by default with a count badge, four tabs, a search box, and no status dropdown or inline Edit pencil anywhere. Switching to **All** and paging past page 1 must keep the search term applied (results on page 2 still match).
- [ ] Commit:

```bash
git add app/admin/orders/page.tsx
git commit -m "refactor(admin): retire the inline order edit path for the SQL queue (BMC-216D)"
```

---

### Task 11: Fulfillment timeline card component

**Files:**
- Create: `components/admin/orders/FulfillmentTimeline.tsx`

**Interfaces:**
- Produces: default export `FulfillmentTimeline` with props `{ events: FulfillmentEventLike[]; loading: boolean; error: string | null }`
- Consumes: `formatFulfillmentTimeline` from `@/lib/fulfillment/queue-view`

**Suggested agent:** sonnet — presentation over the tested timeline formatter.

- [ ] Create `components/admin/orders/FulfillmentTimeline.tsx`:

```tsx
"use client";

/**
 * BMC-216D: fulfillment audit history for one order.
 *
 * Rendering is driven entirely by formatFulfillmentTimeline, which converts each
 * audit row into words. Raw event JSON must never reach the page.
 */
import { Card } from "@/components/ui/card";
import { AlertTriangle, CheckCircle, History, Info, RefreshCw } from "lucide-react";
import { formatFulfillmentTimeline, type FulfillmentEventLike } from "@/lib/fulfillment/queue-view";

interface FulfillmentTimelineProps {
  events: FulfillmentEventLike[];
  loading: boolean;
  error: string | null;
}

export default function FulfillmentTimeline({ events, loading, error }: FulfillmentTimelineProps) {
  const entries = formatFulfillmentTimeline(events);

  return (
    <Card className="admin-card p-6">
      <h3 className="mb-4 flex items-center text-lg font-semibold text-text-primary">
        <History className="mr-2 h-5 w-5 text-text-secondary" />
        Fulfillment History
      </h3>

      {loading ? (
        <div className="flex items-center py-4 text-sm text-text-secondary">
          <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
          Loading history…
        </div>
      ) : error ? (
        <p className="flex items-center text-sm text-state-error">
          <AlertTriangle className="mr-2 h-4 w-4" />
          {error}
        </p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-text-muted">
          No fulfillment actions recorded for this order yet.
        </p>
      ) : (
        <ol className="space-y-3">
          {entries.map((entry) => (
            <li
              key={entry.id}
              className={`rounded border-l-4 bg-surface p-4 ${
                entry.tone === "error"
                  ? "border-state-error"
                  : entry.tone === "success"
                    ? "border-state-success"
                    : "border-state-info"
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center font-medium text-text-primary">
                  {entry.tone === "error" ? (
                    <AlertTriangle className="mr-2 h-4 w-4 text-state-error" />
                  ) : entry.tone === "success" ? (
                    <CheckCircle className="mr-2 h-4 w-4 text-state-success" />
                  ) : (
                    <Info className="mr-2 h-4 w-4 text-state-info" />
                  )}
                  {entry.title}
                </span>
                <span className="text-xs text-text-secondary">
                  {new Date(entry.timestamp).toLocaleString()}
                </span>
              </div>
              {entry.details.length > 0 && (
                <ul className="mt-2 space-y-1 text-sm text-text-secondary">
                  {entry.details.map((detail) => (
                    <li key={detail}>{detail}</li>
                  ))}
                </ul>
              )}
              <p className="mt-2 text-xs text-text-muted">By {entry.actor}</p>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
```

- [ ] Run `npm run lint && npx tsc --noEmit` — expect clean.
- [ ] Commit:

```bash
git add components/admin/orders/FulfillmentTimeline.tsx
git commit -m "feat(admin): human-readable fulfillment history card (BMC-216D)"
```

---

### Task 12: Wire the timeline into the order detail page

**Files:**
- Modify: `app/admin/orders/[id]/page.tsx` — add the events fetch alongside `fetchOrder`/`fetchRefundPolicy` (~:128-173, `useEffect` ~:384-389) and render the card above the existing "Refund History" card (~:914)

**Interfaces:**
- Consumes: `GET /api/admin/orders/[id]/events` → `{ events: [...] }` (oldest first)
- Produces: no new exports

**Suggested agent:** sonnet — three surgical edits to a large existing client component.

- [ ] Add the import next to the existing `@/lib/money` import at the top of `app/admin/orders/[id]/page.tsx`:

```ts
import FulfillmentTimeline from "@/components/admin/orders/FulfillmentTimeline";
import type { FulfillmentEventLike } from "@/lib/fulfillment/queue-view";
```

- [ ] Add state + a fetcher immediately after the `refundPolicy` state block (before `const fetchOrder = useCallback(...)`):

```ts
  // BMC-216D: fulfillment audit history for this order.
  const [events, setEvents] = useState<FulfillmentEventLike[]>([]);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [eventsError, setEventsError] = useState<string | null>(null);

  const fetchEvents = useCallback(async () => {
    setEventsLoading(true);
    setEventsError(null);
    try {
      const response = await fetch(`/api/admin/orders/${orderId}/events`);
      if (!response.ok) throw new Error(`Could not load fulfillment history (${response.status})`);
      const data = (await response.json()) as { events?: FulfillmentEventLike[] };
      setEvents(data.events ?? []);
    } catch (error) {
      setEvents([]);
      setEventsError(error instanceof Error ? error.message : "Could not load fulfillment history");
    } finally {
      setEventsLoading(false);
    }
  }, [orderId]);
```

- [ ] Extend the existing mount effect so it also loads events:

```ts
  useEffect(() => {
    if (orderId) {
      fetchOrder();
      fetchRefundPolicy();
      fetchEvents();
    }
  }, [orderId, fetchOrder, fetchRefundPolicy, fetchEvents]);
```

- [ ] Render the card immediately before the `{/* Refund History */}` block:

```tsx
      {/* Fulfillment History (BMC-216D) */}
      <FulfillmentTimeline events={events} loading={eventsLoading} error={eventsError} />

```

- [ ] Run `npm run lint && npx tsc --noEmit` — expect clean.
- [ ] Manual check (`npm run preview:dev`): open `/admin/orders`, mark a paid `processing` order shipped **with** UPS + a tracking number, confirm it disappears from Awaiting and the Awaiting badge drops by one; open the **Shipped** tab and confirm the row shows shipped date, `UPS`, a clickable tracking link pointing at `ups.com`, the email status line, **Edit tracking** and **Retry/Resend email**; then open `/admin/orders/<that-id>` and confirm the Fulfillment History card lists "Marked shipped" with `Carrier: UPS`, `Tracking: …`, `Status: processing → shipped`, an actor and a timestamp — and **no** JSON braces anywhere.
- [ ] Commit:

```bash
git add app/admin/orders/[id]/page.tsx
git commit -m "feat(admin): fulfillment history on the order detail page (BMC-216D)"
```

---

## Verification

- [ ] `npm run lint` — clean.
- [ ] `npx tsc --noEmit` — clean.
- [ ] `npx vitest run` — the full unit suite passes (`vitest.config.ts` collects `tests/unit/**/*.test.{ts,tsx}`; this is what CI gates on).
- [ ] `npx vitest run tests/unit/fulfillment` — the five BMC-216D required cases are green:
  - awaiting excludes unpaid drafts (`admin-order-predicates.test.ts`)
  - filters run before pagination (`query-admin-orders.test.ts`)
  - oldest-first stable (both files)
  - search matches supported fields (both files)
  - shipment updates the visible queue (`queue-view.test.ts` → `applyShipmentResult`)
  - email failure displays retry state (`queue-view-events.test.ts` → `deriveEmailState`)
- [ ] `rg -n "generateTrackingUrl|google.com/search\?q=track" app components lib` returns nothing.
- [ ] `rg -n "api/orders\"" app/admin components/admin` returns nothing (no admin caller of the legacy generic order endpoint).
- [ ] `git diff --stat HEAD~12 -- app/api/orders/route.ts` shows **zero** changes — that route is ticket F's, not this one's.

**Manual checklist under `npm run preview:dev`** (URL from the `wrangler dev` banner, typically `http://localhost:8787`):

- [ ] `/admin/orders` opens on **Awaiting shipment** with counts on all four tabs, no status dropdown, no inline Edit pencil.
- [ ] Awaiting shows only paid `processing` orders, oldest first; an unpaid `pending` draft never appears (also not under **All**).
- [ ] Search a recipient name that exists only on page 2 of **All** — it is found (proving SQL-side filtering).
- [ ] **Mark shipped** modal: choosing UPS + a tracking number renders a `ups.com` preview link; choosing **Other** renders "no link" copy; the "customer will receive a shipping confirmation email" statement is present; confirming removes the row from Awaiting.
- [ ] With Resend unreachable (temporarily clear `RESEND_API_KEY` in `.dev.vars`), marking shipped still succeeds and shows the amber "marked shipped, but the shipping email failed" notice; the Shipped tab shows **Retry email** and it works once the key is restored.
- [ ] **Edit tracking** on a shipped order saves and shows "No email was sent."
- [ ] `/admin/orders/<id>` Fulfillment History card renders words only — no `{`, no `idempotencyKey`, no `trackingUrl`.

## Contract Deviations

None of the contracted names, paths or wire shapes changed. The following are additive clarifications where the contract was silent — record them on the ticket:

1. **`all` view is NULL-safe.** The contract writes `NOT (status='pending' AND payment_status!='paid')`; the implementation uses `NOT (status = 'pending' AND COALESCE(payment_status, 'pending') <> 'paid')`. Without `COALESCE`, a legacy row with `payment_status IS NULL` makes the inner `AND` evaluate to `NULL` and the row silently vanishes from **All**.
2. **Stable sort tiebreak.** `ORDER BY created_at ASC, id ASC` (awaiting) / `created_at DESC, id DESC` (others). The contract specifies only the `created_at` direction; the `id` tiebreak is what makes "oldest-first ordering is stable" true across pages when several orders share a timestamp.
3. **`counts` are scoped by `q`, not by `view`.** The contract specifies the `counts` object but not its scope. Scoping by the search term keeps each tab's badge equal to what the operator would actually see after switching to that tab.
4. **Search input is sanitized.** `q` is lowercased, has `%`, `_` and `\` stripped, and is truncated to 40 characters so the `%q%` pattern stays under D1's 50-character LIKE cap. The contract mandates `json_extract` over long LIKE guards but does not specify the bound.
5. **Recipient-name search keys.** Per the contract's instruction to inspect the real `Address` shape, `shipping_address` is a `MACHAddress` (`lib/types/mach/Address.ts`) whose recipient-name keys are `recipient` and **`company`**; both are searched, alongside `shipping_address.$.email` and `extensions.$.email`.
6. **Response carries a `meta` block.** `GET /api/admin/orders` returns the contracted `{ orders, total, counts }` plus `meta: { view, limit, offset }` so the client can confirm what the server actually applied after clamping.
7. **`Order.shipping_carrier`.** If BMC-216A did not already add it, Task 2 adds `shipping_carrier?: Carrier | null` to `lib/types/order.ts`. The contract says `Order` is "the existing row type"; the queue cannot type carrier display without the field.
8. **New file `lib/fulfillment/queue-view.ts`** (not in the contract's file table). The repo has `jsdom` configured but **no** `@testing-library/react` and zero `.test.tsx` files, and this ticket must not introduce a component-testing stack. All queue UI logic therefore lives in this pure module and is unit-tested there; `components/admin/orders/*` are thin JSX wrappers. `components/admin/orders/{MarkShippedModal,EditTrackingModal,QueueOrderRow,FulfillmentTimeline}.tsx` and `app/admin/orders/OrdersQueueClient.tsx` are likewise new files under the contract's `app/admin/orders/` (ticket D) ownership.
