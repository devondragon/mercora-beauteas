# BMC-216B: Fulfillment Service and APIs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the concurrency-safe shipment core of BMC-216 — a guarded-CAS `shipOrder`/`updateTracking` fulfillment service whose audit event can only be written by the CAS winner, plus the three admin routes (`ship`, `tracking`, `events`) with typed error responses and idempotent-retry behavior.

**Architecture:** `lib/fulfillment/service.ts` is a thin server-only orchestrator: all ship/idempotent/conflict decisions live in the already-tested pure `transitions.ts` module (ticket A); the service only composes a guarded `UPDATE … WHERE status='processing' AND payment_status='paid' RETURNING` with a conditional `INSERT INTO order_events … SELECT … WHERE shipped_at = <this request's timestamp>` inside one `db.batch()`, and on a zero-row CAS re-reads the order and branches via `decideShipment`. Routes authenticate with the existing `checkAdminPermissions`, derive the audit actor, and map service outcomes to the contract's wire shapes; the shipping email is called through a stub seam (`lib/fulfillment/shipping-email.ts`) that ticket C replaces.

**Tech Stack:** Next.js 15 App Router route handlers, Drizzle ORM ^0.45.2 on Cloudflare D1 (`db.batch()` — no transactions), Clerk via `lib/auth/admin-middleware.ts`, Vitest (jsdom, `tests/unit/**` only, `vi.mock` at module boundaries).

**Depends on:** BMC-216A (merged)
**Interface contract:** docs/superpowers/plans/2026-07-30-bmc-216-interfaces.md (binding)

## Global Constraints

- Tests live under `tests/unit/**` only (CI runs nothing else). Mock the model layer with `vi.mock("@/lib/models/…")` — unit tests must not touch Cloudflare bindings.
- `npm run lint` and `npx tsc --noEmit` must pass before every commit claim.
- Money: all monetary display/serialization through `lib/money` — never raw `*100`/`/100`.
- D1: `db.batch()` for atomic writes; no `db.transaction()`.
- Files kebab-case; components PascalCase; `@/*` path alias.
- Pure modules (`lib/fulfillment/tracking.ts`, `transitions.ts`, `lib/order-status/token.ts`, `lib/orders/customer-email.ts`) must import nothing from D1/Next/Clerk/Resend.
- Migration files: next free numbers `0022`, `0023` (owned by ticket A — **this ticket creates NO migrations**). Never renumber existing migrations. D1 LIKE patterns are capped at 50 chars.
- `ORDER_STATUS_SECRET` typing is hand-added to `cloudflare-env.d.ts` — never regenerate that file wholesale (not touched by this ticket).

## Key Design Decisions (read before implementing)

1. **Conditional event insert = raw `sql\`\`` via `db.run()` inside `db.batch()` — NOT Drizzle insert-from-select.** Verified: installed drizzle-orm ^0.45.2 *does* support insert-from-select (`SQLiteInsertBase.select(...)`, `node_modules/drizzle-orm/sqlite-core/query-builders/insert.d.ts:41-44`), but the plan deliberately uses a raw statement because (a) it matches the spec's literal `INSERT INTO order_events … SELECT … FROM orders WHERE id = ? AND status='shipped' AND shipped_at = ?` statement exactly, (b) the json-mode `details` column's object serialization does not flow through select fragments (we bind `JSON.stringify(details)` explicitly — the stored bytes are identical to what Drizzle's json-mode write produces), and (c) the rendered SQL text + bound params are directly assertable in unit tests via `new SQLiteSyncDialect().sqlToQuery(capturedSql)`. `db.run(sql\`…\`)` returns a `SQLiteRaw`, which satisfies `BatchItem` (`node_modules/drizzle-orm/batch.d.ts:3` — `BatchItem = RunnableQuery`). If TypeScript rejects the heterogeneous batch tuple, use the existing variadic-cast idiom `db.batch(statements as [any, ...any[]])` from `lib/recommendations/batch/rebuild.ts:99` and type the destructured first result explicitly as `(typeof orders.$inferSelect)[]`.
2. **`shipped_at` is the operation marker.** One `const now = new Date().toISOString()` per request is written to `shipped_at` *and* `updated_at` *and* used as the `AND shipped_at = ?` guard on the event insert — so the event fires iff THIS request's CAS won. `updateTracking` uses the same pattern with `updated_at` as the marker.
3. **`db.batch()` update+audit shape** copies `lib/models/mach/subscriptions.ts:100-143` (rationale comment at :100-113); the guarded-CAS zero-row/re-read/branch shape copies `promoteOrderToPaid` (`lib/models/mach/orders.ts:206-236`, guarded update at :221-225).
4. **Service tests mock `@/lib/db`** (a hand-rolled chainable fake), not the Workers pool — they assert *orchestration*: which statements were batched together, the marker in the rendered SQL, and zero-row branch selection. The decision matrix itself is A's test surface; do not re-test it exhaustively here.
5. **Actor derivation is inline in each route** (3 lines) and verified through the service-call arguments in route tests: Clerk `userId` → `{ type: "admin", id: userId }`; `isServiceToken` → `{ type: "service", id: "api-token" }`.
6. **`hydrateOrder` gets exported** (one-word change, `lib/models/mach/orders.ts:435`) so the service returns the same `Order` shape every other order API returns.

---

### Task 1: Preflight — verify the BMC-216A surface and export `hydrateOrder`

**Files:**
- Modify: `lib/models/mach/orders.ts` (line 435: `function hydrateOrder(` → `export function hydrateOrder(`)
- Modify (contingent, see steps): `lib/db/schema/order.ts` (~line 50), `lib/types/order.ts` (~line 65), `lib/models/mach/orders.ts` (~line 451)

**Interfaces:**
- Consumes (must exist from ticket A): `lib/fulfillment/types.ts` (`CARRIERS`, `Carrier`, `ORDER_EVENT_TYPES`, `OrderEventType`, `ActorType`, `Actor`, `ShipmentInput`), `lib/fulfillment/tracking.ts` (`MAX_TRACKING_LENGTH`, `normalizeCarrier`, `normalizeLegacyCarrier`, `sanitizeTrackingNumber`, `buildTrackingUrl`), `lib/fulfillment/transitions.ts` (`OrderFulfillmentSnapshot`, `parseShipmentInput`, `shipmentDataEqual`, `ShipDecision`, `decideShipment`, `canEditTracking`), `lib/db/schema/order-events.ts` (`orderEvents`, re-exported from `lib/db/schema/index.ts`), `orders.shipping_carrier` column.
- Produces: `export function hydrateOrder(orderRecord: typeof orders.$inferSelect): Order`

**Suggested agent:** sonnet — verification plus surgical one-line edits; needs judgment on the contingent fixes but no complex logic.

- [ ] Confirm ticket A is merged and its exports match the contract:
  ```bash
  grep -n "export" lib/fulfillment/types.ts lib/fulfillment/tracking.ts lib/fulfillment/transitions.ts lib/db/schema/order-events.ts
  grep -n "order-events" lib/db/schema/index.ts
  grep -rn "shipping_carrier" lib/db/schema/order.ts lib/types/order.ts lib/models/mach/orders.ts
  ls migrations/0022* migrations/0023*
  ```
  Every symbol in **Consumes** above must exist with the contract's exact name. If any is missing or renamed, **STOP and escalate** — do not rename or re-implement A's surface (contract rule). Record the discrepancy under `## Contract Deviations` in this plan file.
- [ ] Contingent fixes (only where the grep above came back empty — A's acceptance criteria imply these already exist; note under `## Contract Deviations` if you have to touch any):
  - `lib/db/schema/order.ts` — if `shipping_carrier` is absent, add after line 50 (`tracking_number`): `shipping_carrier: text("shipping_carrier"),` (schema only — migration `0022` is A's; never create it here).
  - `lib/types/order.ts` — if absent, add to the `Order` interface after `tracking_number?: string;` (~line 65): `shipping_carrier?: string | null;`
  - `lib/models/mach/orders.ts` — if `hydrateOrder` does not map it, add after line 451 (`tracking_number` mapping): `shipping_carrier: orderRecord.shipping_carrier ?? undefined,`
- [ ] Export `hydrateOrder` — in `lib/models/mach/orders.ts` line 435 change:
  ```ts
  function hydrateOrder(orderRecord: typeof orders.$inferSelect): Order {
  ```
  to:
  ```ts
  export function hydrateOrder(orderRecord: typeof orders.$inferSelect): Order {
  ```
- [ ] Check whether A exported an `OrderEventRow` type from `lib/db/schema/order-events.ts` (`grep -n "OrderEventRow" lib/db/schema/order-events.ts lib/fulfillment/*.ts`). Note the result — Task 3 either imports it or defines `export type OrderEventRow = typeof orderEvents.$inferSelect;` in `lib/fulfillment/service.ts`.
- [ ] Run gates:
  ```bash
  npm run lint && npx tsc --noEmit && npm test
  ```
  Expect: all pass (baseline green; A's unit tests already in the suite).
- [ ] Commit:
  ```bash
  git add lib/models/mach/orders.ts lib/db/schema/order.ts lib/types/order.ts
  git commit -m "refactor(orders): export hydrateOrder for the fulfillment service (BMC-216B)"
  ```

---

### Task 2: Shipping-email seam stub

**Files:**
- Create: `lib/fulfillment/shipping-email.ts`
- Test: `tests/unit/lib/fulfillment/shipping-email-stub.test.ts`

**Interfaces:**
- Produces (contract, binding — ticket C replaces the *body* only, never the signature):
  ```ts
  export interface InitialShippingEmailResult {
    attempted: boolean;
    success: boolean;
    error?: string;
    eventId?: string;
  }
  export function sendInitialShippingEmail(order: Order, actor: Actor): Promise<InitialShippingEmailResult>;
  ```

**Suggested agent:** haiku — a fixed-return stub file plus one trivial test; no decisions to make.

- [ ] Write the failing test at `tests/unit/lib/fulfillment/shipping-email-stub.test.ts`:
  ```ts
  /**
   * BMC-216B — B↔C seam stub. Ticket C replaces the body of
   * sendInitialShippingEmail; until then it must report a truthful
   * "no email was attempted" result and never throw.
   */
  import { describe, it, expect } from "vitest";
  import { sendInitialShippingEmail } from "@/lib/fulfillment/shipping-email";
  import type { Order } from "@/lib/types/order";

  const order = {
    id: "ORD-1",
    status: "shipped",
    payment_status: "paid",
    total_amount: { amount: 2500, currency: "USD" },
    currency_code: "USD",
    items: [],
  } as unknown as Order;

  describe("sendInitialShippingEmail (BMC-216B stub)", () => {
    it("resolves { attempted: false, success: false } without throwing", async () => {
      await expect(
        sendInitialShippingEmail(order, { type: "admin", id: "user_1" }),
      ).resolves.toEqual({ attempted: false, success: false });
    });

    it("resolves the same for a service actor", async () => {
      await expect(
        sendInitialShippingEmail(order, { type: "service", id: "api-token" }),
      ).resolves.toEqual({ attempted: false, success: false });
    });
  });
  ```
- [ ] Run it — expect module-not-found failure:
  ```bash
  npx vitest run tests/unit/lib/fulfillment/shipping-email-stub.test.ts
  ```
  Expected: `Cannot find module '@/lib/fulfillment/shipping-email'` (or "Failed to resolve import").
- [ ] Create `lib/fulfillment/shipping-email.ts`:
  ```ts
  import type { Order } from "@/lib/types/order";
  import type { Actor } from "./types";

  export interface InitialShippingEmailResult {
    attempted: boolean;
    success: boolean;
    error?: string;
    eventId?: string; // shipping_email_sent / shipping_email_failed event
  }

  /**
   * STUB — BMC-216B ships this seam so the ship route compiles and returns a
   * truthful `email` result. Ticket BMC-216C replaces THIS BODY (signature is
   * pinned by the interface contract) with the real build-data + Resend send +
   * recordEmailEvent audit write. Contract: never throws — email failure must
   * never look like a shipment failure.
   */
  export async function sendInitialShippingEmail(
    _order: Order,
    _actor: Actor,
  ): Promise<InitialShippingEmailResult> {
    return { attempted: false, success: false };
  }
  ```
- [ ] Run to pass:
  ```bash
  npx vitest run tests/unit/lib/fulfillment/shipping-email-stub.test.ts
  ```
  Expected: 2 tests pass.
- [ ] Gates and commit:
  ```bash
  npm run lint && npx tsc --noEmit
  git add lib/fulfillment/shipping-email.ts tests/unit/lib/fulfillment/shipping-email-stub.test.ts
  git commit -m "feat(fulfillment): add sendInitialShippingEmail seam stub for ticket C (BMC-216B)"
  ```

---

### Task 3: `shipOrder` — guarded CAS + conditional audit event in one `db.batch()`

**Files:**
- Create: `lib/fulfillment/service.ts`
- Test: `tests/unit/lib/fulfillment/service-ship.test.ts`

**Interfaces:**
- Consumes: `getDbAsync` (`@/lib/db`), `orders` (`@/lib/db/schema/order`), `orderEvents` (`@/lib/db/schema/order-events`), `hydrateOrder` (`@/lib/models/mach/orders`), `decideShipment`/`canEditTracking`/`OrderFulfillmentSnapshot` (`@/lib/fulfillment/transitions`), `buildTrackingUrl` (`@/lib/fulfillment/tracking`), `Actor`/`ShipmentInput` (`@/lib/fulfillment/types`).
- Produces (contract, binding):
  ```ts
  export type ShipOrderResult =
    | { outcome: "shipped"; order: Order; eventId: string }
    | { outcome: "already_shipped"; order: Order }
    | { outcome: "not_found" }
    | { outcome: "conflict"; order: Order }
    | { outcome: "not_fulfillable"; status: string; paymentStatus: string | null };
  export function shipOrder(orderId: string, input: ShipmentInput, actor: Actor): Promise<ShipOrderResult>;
  ```

**Suggested agent:** opus — this is the concurrency-critical CAS/batch core; the marker semantics, batch composition, and zero-row branching must be exactly right.

- [ ] Write the failing test at `tests/unit/lib/fulfillment/service-ship.test.ts`:
  ```ts
  /**
   * BMC-216B — shipOrder orchestration tests.
   *
   * The pure decision matrix (decideShipment, shipmentDataEqual) is ticket A's
   * test surface. These tests mock @/lib/db and assert ORCHESTRATION:
   *  - the guarded update and the conditional event insert go through ONE
   *    db.batch() call, in that order;
   *  - the event insert is keyed on THIS request's shipped_at marker (rendered
   *    SQL + params inspected via SQLiteSyncDialect.sqlToQuery), so a losing
   *    CAS can never write a shipment_created event;
   *  - server timestamps only, and no payment/refund/inventory fields in SET;
   *  - the zero-row CAS re-read selects the correct outcome branch.
   */
  import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
  import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";

  const h = vi.hoisted(() => ({
    state: {
      // per-statement results returned by db.batch(): [updateRows, runResult]
      batchResult: [[], { success: true }] as unknown[],
      // rows returned by db.select().from().where().limit()
      rereadRows: [] as unknown[],
    },
    captured: {
      setArgs: [] as Record<string, unknown>[],
      runSql: [] as unknown[],
      batchStmts: [] as unknown[][],
    },
  }));

  vi.mock("@/lib/db", () => {
    const db = {
      update: vi.fn(() => ({
        set: vi.fn((values: Record<string, unknown>) => {
          h.captured.setArgs.push(values);
          return {
            where: vi.fn(() => ({
              returning: vi.fn(() => ({ __stmt: "guarded-update" })),
            })),
          };
        }),
      })),
      run: vi.fn((q: unknown) => {
        h.captured.runSql.push(q);
        return { __stmt: "conditional-event-insert" };
      }),
      batch: vi.fn(async (stmts: unknown[]) => {
        h.captured.batchStmts.push(stmts);
        return h.state.batchResult;
      }),
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(async () => h.state.rereadRows),
          })),
        })),
      })),
      insert: vi.fn(() => ({ values: vi.fn(async () => undefined) })),
    };
    return { getDb: vi.fn(() => db), getDbAsync: vi.fn(async () => db) };
  });

  import { shipOrder } from "@/lib/fulfillment/service";
  import type { ShipmentInput } from "@/lib/fulfillment/types";

  const FIXED_NOW = "2026-07-30T12:00:00.000Z";
  const actor = { type: "admin" as const, id: "user_2abc" };
  const trackedInput: ShipmentInput = {
    carrier: "ups",
    trackingNumber: "1Z999AA10123456784",
  };

  function orderRow(overrides: Record<string, unknown> = {}) {
    return {
      id: "ORD-1",
      customer_id: "cus_1",
      status: "processing",
      payment_status: "paid",
      total_amount: { amount: 2500, currency: "USD" },
      currency_code: "USD",
      shipping_address: null,
      billing_address: null,
      items: [],
      shipping_method: "standard",
      payment_method: "card",
      notes: null,
      external_references: null,
      extensions: null,
      created_at: "2026-07-29T00:00:00.000Z",
      updated_at: "2026-07-29T00:00:00.000Z",
      shipped_at: null,
      delivered_at: null,
      tracking_number: null,
      shipping_carrier: null,
      ...overrides,
    };
  }

  const dialect = new SQLiteSyncDialect();
  function renderedInsert() {
    expect(h.captured.runSql).toHaveLength(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return dialect.sqlToQuery(h.captured.runSql[0] as any);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    h.captured.setArgs.length = 0;
    h.captured.runSql.length = 0;
    h.captured.batchStmts.length = 0;
    h.state.batchResult = [[], { success: true }];
    h.state.rereadRows = [];
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  describe("shipOrder — CAS win", () => {
    const wonRow = () =>
      orderRow({
        status: "shipped",
        shipped_at: FIXED_NOW,
        updated_at: FIXED_NOW,
        shipping_carrier: "ups",
        tracking_number: "1Z999AA10123456784",
      });

    it("batches guarded update + conditional event insert atomically, in order", async () => {
      h.state.batchResult = [[wonRow()], { success: true }];
      const result = await shipOrder("ORD-1", trackedInput, actor);
      expect(result.outcome).toBe("shipped");
      expect(h.captured.batchStmts).toHaveLength(1);
      expect(h.captured.batchStmts[0]).toEqual([
        { __stmt: "guarded-update" },
        { __stmt: "conditional-event-insert" },
      ]);
    });

    it("writes only server timestamps: shipped_at === updated_at === this request's instant", async () => {
      h.state.batchResult = [[wonRow()], { success: true }];
      await shipOrder("ORD-1", trackedInput, actor);
      expect(h.captured.setArgs[0]).toMatchObject({
        status: "shipped",
        shipping_carrier: "ups",
        tracking_number: "1Z999AA10123456784",
        shipped_at: FIXED_NOW,
        updated_at: FIXED_NOW,
      });
      // Refund/payment/inventory fields must be untouched: SET has exactly these keys.
      expect(Object.keys(h.captured.setArgs[0]).sort()).toEqual([
        "shipped_at",
        "shipping_carrier",
        "status",
        "tracking_number",
        "updated_at",
      ]);
    });

    it("keys the event insert on this request's shipped_at operation marker", async () => {
      h.state.batchResult = [[wonRow()], { success: true }];
      const result = await shipOrder("ORD-1", trackedInput, actor);
      const { sql: text, params } = renderedInsert();
      expect(text).toMatch(/INSERT INTO order_events/i);
      expect(text).toMatch(/SELECT/i);
      expect(text).toMatch(/FROM orders/i);
      expect(text).toMatch(/status = 'shipped' AND shipped_at = \?/i);
      expect(params).toContain("ORD-1");
      expect(params).toContain(FIXED_NOW);
      expect(params).toContain("admin");
      expect(params).toContain("user_2abc");
      expect(params).toContain("shipment_created");
      if (result.outcome === "shipped") {
        expect(params).toContain(result.eventId);
      }
      const details = params.find(
        (p) => typeof p === "string" && p.startsWith("{"),
      ) as string;
      expect(JSON.parse(details)).toEqual({
        carrier: "ups",
        trackingNumber: "1Z999AA10123456784",
        trackingUrl:
          "https://www.ups.com/track?loc=en_US&tracknum=1Z999AA10123456784",
      });
    });

    it("supports an untracked shipment (null carrier/tracking, null trackingUrl)", async () => {
      h.state.batchResult = [
        [orderRow({ status: "shipped", shipped_at: FIXED_NOW })],
        { success: true },
      ];
      const untracked: ShipmentInput = { carrier: null, trackingNumber: null };
      const result = await shipOrder("ORD-1", untracked, actor);
      expect(result.outcome).toBe("shipped");
      expect(h.captured.setArgs[0]).toMatchObject({
        shipping_carrier: null,
        tracking_number: null,
      });
      const { params } = renderedInsert();
      const details = params.find(
        (p) => typeof p === "string" && p.startsWith("{"),
      ) as string;
      expect(JSON.parse(details)).toEqual({
        carrier: null,
        trackingNumber: null,
        trackingUrl: null,
      });
    });

    it("returns the hydrated order and a fresh UUID eventId", async () => {
      h.state.batchResult = [[wonRow()], { success: true }];
      const result = await shipOrder("ORD-1", trackedInput, actor);
      expect(result.outcome).toBe("shipped");
      if (result.outcome !== "shipped") return;
      expect(result.order.status).toBe("shipped");
      expect(result.order.shipped_at).toBe(FIXED_NOW);
      expect(result.order.tracking_number).toBe("1Z999AA10123456784");
      expect(result.eventId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    });
  });

  describe("shipOrder — zero-row CAS re-read branches", () => {
    it("missing order -> not_found (single batch attempt, no event possible)", async () => {
      h.state.rereadRows = [];
      const result = await shipOrder("ORD-missing", trackedInput, actor);
      expect(result).toEqual({ outcome: "not_found" });
      expect(h.captured.batchStmts).toHaveLength(1);
    });

    it("shipped with identical data (case-insensitive tracking) -> already_shipped", async () => {
      h.state.rereadRows = [
        orderRow({
          status: "shipped",
          shipped_at: "2026-07-30T11:00:00.000Z",
          shipping_carrier: "ups",
          tracking_number: "1z999aa10123456784",
        }),
      ];
      const result = await shipOrder("ORD-1", trackedInput, actor);
      expect(result.outcome).toBe("already_shipped");
      if (result.outcome !== "already_shipped") return;
      expect(result.order.status).toBe("shipped");
    });

    it("shipped with different data -> conflict", async () => {
      h.state.rereadRows = [
        orderRow({
          status: "shipped",
          shipped_at: "2026-07-30T11:00:00.000Z",
          shipping_carrier: "fedex",
          tracking_number: "999999999999",
        }),
      ];
      const result = await shipOrder("ORD-1", trackedInput, actor);
      expect(result.outcome).toBe("conflict");
    });

    it("processing but unpaid -> not_fulfillable with current status/paymentStatus", async () => {
      h.state.rereadRows = [
        orderRow({ status: "processing", payment_status: "pending" }),
      ];
      const result = await shipOrder("ORD-1", trackedInput, actor);
      expect(result).toEqual({
        outcome: "not_fulfillable",
        status: "processing",
        paymentStatus: "pending",
      });
    });

    it.each(["pending", "delivered", "cancelled", "refunded"])(
      "%s order -> not_fulfillable",
      async (status) => {
        h.state.rereadRows = [orderRow({ status })];
        const result = await shipOrder("ORD-1", trackedInput, actor);
        expect(result.outcome).toBe("not_fulfillable");
      },
    );

    it("re-read paradox (still processing+paid) -> not_fulfillable, never a false shipped", async () => {
      // CAS matched zero rows yet the re-read shows fulfillable: defensively
      // unreachable, must NOT be reported as a win (no event was written).
      h.state.rereadRows = [orderRow()];
      const result = await shipOrder("ORD-1", trackedInput, actor);
      expect(result).toEqual({
        outcome: "not_fulfillable",
        status: "processing",
        paymentStatus: "paid",
      });
    });
  });
  ```
- [ ] Run it — expect module-not-found failure:
  ```bash
  npx vitest run tests/unit/lib/fulfillment/service-ship.test.ts
  ```
  Expected: `Cannot find module '@/lib/fulfillment/service'`.
- [ ] Create `lib/fulfillment/service.ts` (shipOrder only; Task 4 appends the rest):
  ```ts
  /**
   * BMC-216B — server-only fulfillment persistence.
   *
   * Thin orchestrator: ALL ship/idempotent/conflict decisions live in the pure
   * transitions module. This file only composes the guarded CAS with its
   * conditional audit event via db.batch() — the same update+audit batch shape
   * as lib/models/mach/subscriptions.ts, and the same guarded-CAS zero-row
   * re-read shape as promoteOrderToPaid (lib/models/mach/orders.ts).
   *
   * Concurrency invariants:
   *  - Only a paid `processing` order can flip to `shipped` (WHERE guard).
   *  - `shipped_at` = THIS request's `new Date().toISOString()` and doubles as
   *    the operation marker: the event INSERT…SELECT is guarded on
   *    `shipped_at = <marker>`, so a losing CAS writes NO shipment_created row.
   *  - D1 has no db.transaction(); db.batch() is the atomic primitive.
   */
  import { and, asc, eq, sql } from "drizzle-orm";
  import { getDbAsync } from "@/lib/db";
  import { orders } from "@/lib/db/schema/order";
  import { orderEvents } from "@/lib/db/schema/order-events";
  import { hydrateOrder } from "@/lib/models/mach/orders";
  import type { Order } from "@/lib/types/order";
  import {
    canEditTracking,
    decideShipment,
    type OrderFulfillmentSnapshot,
  } from "./transitions";
  import { buildTrackingUrl } from "./tracking";
  import type { Actor, ShipmentInput } from "./types";

  // If ticket A already exports OrderEventRow from lib/db/schema/order-events,
  // import and re-export that instead of defining it here (Task 1 finding).
  export type OrderEventRow = typeof orderEvents.$inferSelect;

  export type ShipOrderResult =
    | { outcome: "shipped"; order: Order; eventId: string } // fresh CAS win -> HTTP 201
    | { outcome: "already_shipped"; order: Order } // idempotent -> HTTP 200
    | { outcome: "not_found" } // -> 404
    | { outcome: "conflict"; order: Order } // -> 409 shipment_conflict
    | { outcome: "not_fulfillable"; status: string; paymentStatus: string | null }; // -> 409 not_fulfillable

  function toSnapshot(row: typeof orders.$inferSelect): OrderFulfillmentSnapshot {
    return {
      status: row.status,
      payment_status: row.payment_status ?? null,
      shipping_carrier: row.shipping_carrier ?? null,
      tracking_number: row.tracking_number ?? null,
    };
  }

  export async function shipOrder(
    orderId: string,
    input: ShipmentInput,
    actor: Actor,
  ): Promise<ShipOrderResult> {
    const db = await getDbAsync();

    // Server-owned operation timestamp AND the CAS marker (see module doc).
    const now = new Date().toISOString();
    const eventId = crypto.randomUUID();
    const trackingUrl = buildTrackingUrl(input.carrier, input.trackingNumber);
    const details = JSON.stringify({
      carrier: input.carrier,
      trackingNumber: input.trackingNumber,
      trackingUrl,
    });

    // Guarded CAS: only a paid, processing order can flip to shipped. The SET
    // list is exhaustive on purpose — payment/refund/inventory fields are owned
    // by other services and must never appear here.
    const guardedUpdate = db
      .update(orders)
      .set({
        status: "shipped",
        shipping_carrier: input.carrier,
        tracking_number: input.trackingNumber,
        shipped_at: now,
        updated_at: now,
      })
      .where(
        and(
          eq(orders.id, orderId),
          eq(orders.status, "processing"),
          eq(orders.payment_status, "paid"),
        ),
      )
      .returning();

    // Conditional audit insert, same batch: fires ONLY when this request's
    // update won (shipped_at equals this request's exact marker). Raw SQL by
    // design — see plan "Key Design Decisions" #1. Keep the WHERE clause on one
    // line: the unit tests assert the rendered text.
    const conditionalEventInsert = db.run(sql`
      INSERT INTO order_events (id, order_id, event_type, actor_type, actor_id, from_status, to_status, details, created_at)
      SELECT ${eventId}, ${orderId}, ${"shipment_created"}, ${actor.type}, ${actor.id}, ${"processing"}, ${"shipped"}, ${details}, ${now}
      FROM orders
      WHERE id = ${orderId} AND status = 'shipped' AND shipped_at = ${now}
    `);

    const [updatedRows] = await db.batch([guardedUpdate, conditionalEventInsert]);

    if (updatedRows.length > 0) {
      return { outcome: "shipped", order: hydrateOrder(updatedRows[0]), eventId };
    }

    // Zero-row CAS: re-read and let the pure transition module decide why.
    const [current] = await db
      .select()
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1);
    if (!current) return { outcome: "not_found" };

    const decision = decideShipment(toSnapshot(current), input);
    switch (decision.kind) {
      case "idempotent":
        return { outcome: "already_shipped", order: hydrateOrder(current) };
      case "conflict":
        return { outcome: "conflict", order: hydrateOrder(current) };
      case "not_fulfillable":
        return {
          outcome: "not_fulfillable",
          status: decision.status,
          paymentStatus: decision.paymentStatus,
        };
      case "ship":
        // Defensively unreachable: the CAS matched zero rows yet the re-read
        // shows processing+paid. No supported transition returns an order to
        // processing, so surface a retryable 409 rather than a false success —
        // no event row was written for this request.
        return {
          outcome: "not_fulfillable",
          status: current.status,
          paymentStatus: current.payment_status ?? null,
        };
    }
  }
  ```
  Note: `canEditTracking`/`asc` are imported now for Task 4; if `tsc` flags them unused before Task 4 lands, defer those two imports to Task 4 instead.
- [ ] Run to pass:
  ```bash
  npx vitest run tests/unit/lib/fulfillment/service-ship.test.ts
  ```
  Expected: all 12 tests pass. If TypeScript rejects the heterogeneous `db.batch([...])` tuple, apply the `lib/recommendations/batch/rebuild.ts:99` idiom: `const [updatedRows] = (await db.batch([guardedUpdate, conditionalEventInsert] as [any, ...any[]])) as [(typeof orders.$inferSelect)[], unknown];`
- [ ] Gates and commit:
  ```bash
  npm run lint && npx tsc --noEmit
  git add lib/fulfillment/service.ts tests/unit/lib/fulfillment/service-ship.test.ts
  git commit -m "feat(fulfillment): shipOrder guarded CAS with conditional audit event in one db.batch (BMC-216B)"
  ```

---

### Task 4: `updateTracking`, `listOrderEvents`, `recordEmailEvent`

**Files:**
- Modify: `lib/fulfillment/service.ts` (append after `shipOrder`)
- Test: `tests/unit/lib/fulfillment/service-tracking-events.test.ts`

**Interfaces:**
- Produces (contract, binding):
  ```ts
  export type UpdateTrackingResult =
    | { outcome: "updated"; order: Order; eventId: string }
    | { outcome: "not_found" }
    | { outcome: "not_shipped"; status: string }; // -> 409
  export function updateTracking(orderId: string, input: ShipmentInput, actor: Actor): Promise<UpdateTrackingResult>;
  export function listOrderEvents(orderId: string): Promise<OrderEventRow[]>;
  export function recordEmailEvent(
    orderId: string,
    type: "shipping_email_sent" | "shipping_email_failed" | "shipping_email_resent",
    actor: Actor,
    details: Record<string, unknown>,
  ): Promise<string>;
  ```

**Suggested agent:** opus — same CAS-marker/batch discipline as Task 3 (tracking correction reuses the conditional-insert pattern with `updated_at` as the marker), plus the previous/next audit payload.

- [ ] Write the failing test at `tests/unit/lib/fulfillment/service-tracking-events.test.ts`:
  ```ts
  /**
   * BMC-216B — updateTracking / listOrderEvents / recordEmailEvent orchestration.
   *
   * updateTracking mirrors shipOrder's CAS discipline with `updated_at` as the
   * operation marker: guarded on status='shipped', batched with a conditional
   * tracking_updated insert that fires only when THIS request's update won, and
   * carries { previous, next } from the pre-read.
   */
  import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
  import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";

  const h = vi.hoisted(() => ({
    state: {
      // db.select()...limit()/orderBy() responses, consumed in call order.
      selectResults: [] as unknown[][],
      batchResult: [[], { success: true }] as unknown[],
    },
    captured: {
      setArgs: [] as Record<string, unknown>[],
      runSql: [] as unknown[],
      batchStmts: [] as unknown[][],
      insertValues: [] as Record<string, unknown>[],
    },
  }));

  vi.mock("@/lib/db", () => {
    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(async () => h.state.selectResults.shift() ?? []),
            orderBy: vi.fn(async () => h.state.selectResults.shift() ?? []),
          })),
        })),
      })),
      update: vi.fn(() => ({
        set: vi.fn((values: Record<string, unknown>) => {
          h.captured.setArgs.push(values);
          return {
            where: vi.fn(() => ({
              returning: vi.fn(() => ({ __stmt: "guarded-update" })),
            })),
          };
        }),
      })),
      run: vi.fn((q: unknown) => {
        h.captured.runSql.push(q);
        return { __stmt: "conditional-event-insert" };
      }),
      batch: vi.fn(async (stmts: unknown[]) => {
        h.captured.batchStmts.push(stmts);
        return h.state.batchResult;
      }),
      insert: vi.fn(() => ({
        values: vi.fn(async (values: Record<string, unknown>) => {
          h.captured.insertValues.push(values);
        }),
      })),
    };
    return { getDb: vi.fn(() => db), getDbAsync: vi.fn(async () => db) };
  });

  import {
    listOrderEvents,
    recordEmailEvent,
    updateTracking,
  } from "@/lib/fulfillment/service";
  import type { ShipmentInput } from "@/lib/fulfillment/types";

  const FIXED_NOW = "2026-07-30T12:00:00.000Z";
  const actor = { type: "admin" as const, id: "user_2abc" };
  const nextInput: ShipmentInput = {
    carrier: "fedex",
    trackingNumber: "999999999999",
  };

  function orderRow(overrides: Record<string, unknown> = {}) {
    return {
      id: "ORD-1",
      customer_id: "cus_1",
      status: "shipped",
      payment_status: "paid",
      total_amount: { amount: 2500, currency: "USD" },
      currency_code: "USD",
      shipping_address: null,
      billing_address: null,
      items: [],
      shipping_method: "standard",
      payment_method: "card",
      notes: null,
      external_references: null,
      extensions: null,
      created_at: "2026-07-29T00:00:00.000Z",
      updated_at: "2026-07-30T11:00:00.000Z",
      shipped_at: "2026-07-30T11:00:00.000Z",
      delivered_at: null,
      tracking_number: "1Z999AA10123456784",
      shipping_carrier: "ups",
      ...overrides,
    };
  }

  const dialect = new SQLiteSyncDialect();

  beforeEach(() => {
    vi.clearAllMocks();
    h.captured.setArgs.length = 0;
    h.captured.runSql.length = 0;
    h.captured.batchStmts.length = 0;
    h.captured.insertValues.length = 0;
    h.state.selectResults = [];
    h.state.batchResult = [[], { success: true }];
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  describe("updateTracking", () => {
    it("guards on status='shipped', batches update + conditional tracking_updated event", async () => {
      h.state.selectResults = [[orderRow()]];
      h.state.batchResult = [
        [orderRow({ shipping_carrier: "fedex", tracking_number: "999999999999", updated_at: FIXED_NOW })],
        { success: true },
      ];
      const result = await updateTracking("ORD-1", nextInput, actor);
      expect(result.outcome).toBe("updated");
      if (result.outcome !== "updated") return;
      expect(result.order.tracking_number).toBe("999999999999");
      expect(result.eventId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
      expect(h.captured.batchStmts).toHaveLength(1);
      expect(h.captured.batchStmts[0]).toEqual([
        { __stmt: "guarded-update" },
        { __stmt: "conditional-event-insert" },
      ]);
      // SET touches ONLY carrier/tracking/updated_at — never status/shipped_at.
      expect(Object.keys(h.captured.setArgs[0]).sort()).toEqual([
        "shipping_carrier",
        "tracking_number",
        "updated_at",
      ]);
      expect(h.captured.setArgs[0].updated_at).toBe(FIXED_NOW);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { sql: text, params } = dialect.sqlToQuery(h.captured.runSql[0] as any);
      expect(text).toMatch(/INSERT INTO order_events/i);
      expect(text).toMatch(/status = 'shipped' AND updated_at = \?/i);
      expect(params).toContain("tracking_updated");
      expect(params).toContain(FIXED_NOW);
      const details = params.find(
        (p) => typeof p === "string" && p.startsWith("{"),
      ) as string;
      expect(JSON.parse(details)).toEqual({
        previous: { carrier: "ups", trackingNumber: "1Z999AA10123456784" },
        next: { carrier: "fedex", trackingNumber: "999999999999" },
      });
    });

    it("missing order -> not_found without touching the batch", async () => {
      h.state.selectResults = [[]];
      const result = await updateTracking("ORD-missing", nextInput, actor);
      expect(result).toEqual({ outcome: "not_found" });
      expect(h.captured.batchStmts).toHaveLength(0);
    });

    it("non-shipped order -> not_shipped with current status, no batch, no event", async () => {
      h.state.selectResults = [[orderRow({ status: "processing", shipped_at: null })]];
      const result = await updateTracking("ORD-1", nextInput, actor);
      expect(result).toEqual({ outcome: "not_shipped", status: "processing" });
      expect(h.captured.batchStmts).toHaveLength(0);
      expect(h.captured.runSql).toHaveLength(0);
    });

    it("lost race (zero-row CAS after shipped pre-read) -> re-read decides", async () => {
      h.state.selectResults = [[orderRow()], [orderRow({ status: "refunded" })]];
      h.state.batchResult = [[], { success: true }];
      const result = await updateTracking("ORD-1", nextInput, actor);
      expect(result).toEqual({ outcome: "not_shipped", status: "refunded" });
    });
  });

  describe("listOrderEvents", () => {
    it("returns rows oldest-first as provided by the ordered query", async () => {
      const rows = [
        { id: "evt-1", order_id: "ORD-1", event_type: "shipment_created", created_at: "2026-07-30T11:00:00.000Z" },
        { id: "evt-2", order_id: "ORD-1", event_type: "tracking_updated", created_at: "2026-07-30T12:00:00.000Z" },
      ];
      h.state.selectResults = [rows];
      await expect(listOrderEvents("ORD-1")).resolves.toEqual(rows);
    });
  });

  describe("recordEmailEvent", () => {
    it("appends the event with a RAW details object (json-mode column) and returns its id", async () => {
      const details = { idempotencyKey: "shipping-confirmation/ORD-1/initial" };
      const id = await recordEmailEvent("ORD-1", "shipping_email_failed", actor, details);
      expect(h.captured.insertValues).toHaveLength(1);
      const values = h.captured.insertValues[0];
      expect(values).toMatchObject({
        id,
        order_id: "ORD-1",
        event_type: "shipping_email_failed",
        actor_type: "admin",
        actor_id: "user_2abc",
        from_status: null,
        to_status: null,
        created_at: FIXED_NOW,
      });
      // Contract: json-mode Drizzle columns receive raw objects, never strings.
      expect(values.details).toBe(details);
    });
  });
  ```
- [ ] Run it — expect failure:
  ```bash
  npx vitest run tests/unit/lib/fulfillment/service-tracking-events.test.ts
  ```
  Expected: `updateTracking`/`listOrderEvents`/`recordEmailEvent` are not exported from `@/lib/fulfillment/service`.
- [ ] Append to `lib/fulfillment/service.ts` (after `shipOrder`):
  ```ts
  export type UpdateTrackingResult =
    | { outcome: "updated"; order: Order; eventId: string }
    | { outcome: "not_found" }
    | { outcome: "not_shipped"; status: string }; // -> 409

  /**
   * Tracking correction — allowed only after shipment (canEditTracking).
   * Same CAS discipline as shipOrder with `updated_at` as the operation marker;
   * the tracking_updated event carries the pre-read previous values.
   * Requires a full valid pair (carrier + trackingNumber) — enforced by the
   * route before calling.
   */
  export async function updateTracking(
    orderId: string,
    input: ShipmentInput,
    actor: Actor,
  ): Promise<UpdateTrackingResult> {
    const db = await getDbAsync();

    // Pre-read: previous values for the audit event + friendly status check.
    const [current] = await db
      .select()
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1);
    if (!current) return { outcome: "not_found" };
    if (!canEditTracking(toSnapshot(current))) {
      return { outcome: "not_shipped", status: current.status };
    }

    const now = new Date().toISOString(); // updated_at doubles as the CAS marker
    const eventId = crypto.randomUUID();
    const details = JSON.stringify({
      previous: {
        carrier: current.shipping_carrier ?? null,
        trackingNumber: current.tracking_number ?? null,
      },
      next: { carrier: input.carrier, trackingNumber: input.trackingNumber },
    });

    const guardedUpdate = db
      .update(orders)
      .set({
        shipping_carrier: input.carrier,
        tracking_number: input.trackingNumber,
        updated_at: now,
      })
      .where(and(eq(orders.id, orderId), eq(orders.status, "shipped")))
      .returning();

    const conditionalEventInsert = db.run(sql`
      INSERT INTO order_events (id, order_id, event_type, actor_type, actor_id, from_status, to_status, details, created_at)
      SELECT ${eventId}, ${orderId}, ${"tracking_updated"}, ${actor.type}, ${actor.id}, NULL, NULL, ${details}, ${now}
      FROM orders
      WHERE id = ${orderId} AND status = 'shipped' AND updated_at = ${now}
    `);

    const [updatedRows] = await db.batch([guardedUpdate, conditionalEventInsert]);
    if (updatedRows.length > 0) {
      return { outcome: "updated", order: hydrateOrder(updatedRows[0]), eventId };
    }

    // Lost a race between pre-read and batch (e.g. a refund flipped the status).
    const [reread] = await db
      .select()
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1);
    if (!reread) return { outcome: "not_found" };
    return { outcome: "not_shipped", status: reread.status };
  }

  /** Oldest-first fulfillment events for one order (stable tie-break on id). */
  export async function listOrderEvents(orderId: string): Promise<OrderEventRow[]> {
    const db = await getDbAsync();
    return db
      .select()
      .from(orderEvents)
      .where(eq(orderEvents.order_id, orderId))
      .orderBy(asc(orderEvents.created_at), asc(orderEvents.id));
  }

  /** Append-only email audit event writer (consumed by ticket C). */
  export async function recordEmailEvent(
    orderId: string,
    type: "shipping_email_sent" | "shipping_email_failed" | "shipping_email_resent",
    actor: Actor,
    details: Record<string, unknown>,
  ): Promise<string> {
    const db = await getDbAsync();
    const id = crypto.randomUUID();
    await db.insert(orderEvents).values({
      id,
      order_id: orderId,
      event_type: type,
      actor_type: actor.type,
      actor_id: actor.id,
      from_status: null,
      to_status: null,
      details, // raw object — the json-mode column serializes it (contract rule)
      created_at: new Date().toISOString(),
    });
    return id;
  }
  ```
- [ ] Run both service test files to pass:
  ```bash
  npx vitest run tests/unit/lib/fulfillment/service-ship.test.ts tests/unit/lib/fulfillment/service-tracking-events.test.ts
  ```
  Expected: all pass.
- [ ] Gates and commit:
  ```bash
  npm run lint && npx tsc --noEmit
  git add lib/fulfillment/service.ts tests/unit/lib/fulfillment/service-tracking-events.test.ts
  git commit -m "feat(fulfillment): updateTracking CAS, listOrderEvents, recordEmailEvent (BMC-216B)"
  ```

---

### Task 5: `POST /api/admin/orders/[id]/ship` route

**Files:**
- Create: `app/api/admin/orders/[id]/ship/route.ts`
- Test: `tests/unit/app/api/admin-orders-ship-route.test.ts`

**Interfaces:**
- Consumes: `checkAdminPermissions` (`@/lib/auth/admin-middleware`), `parseShipmentInput` (real, pure), `normalizeCarrier`/`buildTrackingUrl` (real, pure), `shipOrder` (mocked in tests), `sendInitialShippingEmail` (mocked in tests).
- Produces (contract wire): `201`/`200` → `{ order, tracking: { carrier, trackingNumber, trackingUrl }, email, eventId }`; `400 { error }`; `401 { error }`; `404 { error }`; `409 { code: "shipment_conflict" | "not_fulfillable", status, paymentStatus }`.

**Suggested agent:** sonnet — route boilerplate mapping typed service outcomes to pinned wire shapes; conventions are fully specified.

- [ ] Write the failing test at `tests/unit/app/api/admin-orders-ship-route.test.ts`:
  ```ts
  /**
   * BMC-216B — POST /api/admin/orders/[id]/ship.
   * Service + email seam are mocked; parseShipmentInput/buildTrackingUrl are the
   * real pure modules (ticket A). Mocking admin-middleware keeps
   * @clerk/nextjs/server out of the module graph; mocking the service keeps
   * lib/db / @opennextjs/cloudflare out of it (same pattern as
   * tests/unit/app/api/categories-auth.test.ts).
   */
  import { describe, it, expect, vi, beforeEach } from "vitest";

  vi.mock("@/lib/auth/admin-middleware", () => ({
    checkAdminPermissions: vi.fn(),
  }));
  vi.mock("@/lib/fulfillment/service", () => ({
    shipOrder: vi.fn(),
  }));
  vi.mock("@/lib/fulfillment/shipping-email", () => ({
    sendInitialShippingEmail: vi.fn(),
  }));

  import { NextRequest } from "next/server";
  import { POST } from "@/app/api/admin/orders/[id]/ship/route";
  import { checkAdminPermissions } from "@/lib/auth/admin-middleware";
  import { shipOrder } from "@/lib/fulfillment/service";
  import { sendInitialShippingEmail } from "@/lib/fulfillment/shipping-email";

  const url = "http://localhost/api/admin/orders/ORD-1/ship";
  const params = { params: Promise.resolve({ id: "ORD-1" }) };

  function post(body?: unknown) {
    return new NextRequest(url, {
      method: "POST",
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: { "content-type": "application/json" },
    });
  }

  const shippedOrder = {
    id: "ORD-1",
    status: "shipped",
    payment_status: "paid",
    shipping_carrier: "ups",
    tracking_number: "1Z999AA10123456784",
    shipped_at: "2026-07-30T12:00:00.000Z",
    total_amount: { amount: 2500, currency: "USD" },
    currency_code: "USD",
    items: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(checkAdminPermissions).mockResolvedValue({
      success: true,
      userId: "user_2abc",
    });
    vi.mocked(sendInitialShippingEmail).mockResolvedValue({
      attempted: false,
      success: false,
    });
  });

  describe("auth and input validation", () => {
    it("401 when admin check denies; service never called", async () => {
      vi.mocked(checkAdminPermissions).mockResolvedValue({
        success: false,
        error: "Authentication required. Please sign in.",
      });
      const res = await POST(post({}), params);
      expect(res.status).toBe(401);
      expect(vi.mocked(shipOrder)).not.toHaveBeenCalled();
    });

    it("400 for tracking number without carrier; service never called", async () => {
      const res = await POST(post({ trackingNumber: "1Z999AA10123456784" }), params);
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBeTruthy();
      expect(vi.mocked(shipOrder)).not.toHaveBeenCalled();
    });

    it("400 for carrier without tracking number", async () => {
      const res = await POST(post({ carrier: "ups" }), params);
      expect(res.status).toBe(400);
      expect(vi.mocked(shipOrder)).not.toHaveBeenCalled();
    });

    it("400 for an unknown carrier", async () => {
      const res = await POST(post({ carrier: "usps", trackingNumber: "123" }), params);
      expect(res.status).toBe(400);
    });
  });

  describe("actor derivation", () => {
    it("Clerk admin -> { type: 'admin', id: userId }", async () => {
      vi.mocked(shipOrder).mockResolvedValue({ outcome: "not_found" });
      await POST(post({}), params);
      expect(vi.mocked(shipOrder)).toHaveBeenCalledWith(
        "ORD-1",
        { carrier: null, trackingNumber: null },
        { type: "admin", id: "user_2abc" },
      );
    });

    it("ADMIN_VECTORIZE_TOKEN -> { type: 'service', id: 'api-token' }", async () => {
      vi.mocked(checkAdminPermissions).mockResolvedValue({
        success: true,
        userId: "admin-service",
        isServiceToken: true,
      });
      vi.mocked(shipOrder).mockResolvedValue({ outcome: "not_found" });
      await POST(post({}), params);
      expect(vi.mocked(shipOrder)).toHaveBeenCalledWith(
        "ORD-1",
        { carrier: null, trackingNumber: null },
        { type: "service", id: "api-token" },
      );
    });
  });

  describe("outcome mapping", () => {
    it("fresh CAS win -> 201 with order, derived tracking link, email result, eventId", async () => {
      vi.mocked(shipOrder).mockResolvedValue({
        outcome: "shipped",
        order: shippedOrder as never,
        eventId: "evt-1",
      });
      vi.mocked(sendInitialShippingEmail).mockResolvedValue({
        attempted: true,
        success: false,
        error: "resend down",
      });
      const res = await POST(
        post({ carrier: "ups", trackingNumber: "1Z999AA10123456784" }),
        params,
      );
      expect(res.status).toBe(201);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.eventId).toBe("evt-1");
      expect(body.tracking).toEqual({
        carrier: "ups",
        trackingNumber: "1Z999AA10123456784",
        trackingUrl:
          "https://www.ups.com/track?loc=en_US&tracknum=1Z999AA10123456784",
      });
      // Email failure never demotes the 201 — shipment already committed.
      expect(body.email).toEqual({
        attempted: true,
        success: false,
        error: "resend down",
      });
      expect(vi.mocked(sendInitialShippingEmail)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(sendInitialShippingEmail)).toHaveBeenCalledWith(
        shippedOrder,
        { type: "admin", id: "user_2abc" },
      );
    });

    it("empty body is a valid untracked shipment request", async () => {
      vi.mocked(shipOrder).mockResolvedValue({
        outcome: "shipped",
        order: { ...shippedOrder, shipping_carrier: null, tracking_number: null } as never,
        eventId: "evt-2",
      });
      const res = await POST(post(), params); // no body at all
      expect(res.status).toBe(201);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.tracking).toEqual({
        carrier: null,
        trackingNumber: null,
        trackingUrl: null,
      });
    });

    it("idempotent retry -> 200, NO new email attempt, eventId null", async () => {
      vi.mocked(shipOrder).mockResolvedValue({
        outcome: "already_shipped",
        order: shippedOrder as never,
      });
      const res = await POST(
        post({ carrier: "ups", trackingNumber: "1Z999AA10123456784" }),
        params,
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.email).toEqual({ attempted: false, success: false });
      expect(body.eventId).toBeNull();
      expect(vi.mocked(sendInitialShippingEmail)).not.toHaveBeenCalled();
    });

    it("not_found -> 404", async () => {
      vi.mocked(shipOrder).mockResolvedValue({ outcome: "not_found" });
      const res = await POST(post({}), params);
      expect(res.status).toBe(404);
    });

    it("conflict -> 409 { code: 'shipment_conflict' }", async () => {
      vi.mocked(shipOrder).mockResolvedValue({
        outcome: "conflict",
        order: shippedOrder as never,
      });
      const res = await POST(post({ carrier: "fedex", trackingNumber: "999" }), params);
      expect(res.status).toBe(409);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.code).toBe("shipment_conflict");
      expect(body.status).toBe("shipped");
      expect(vi.mocked(sendInitialShippingEmail)).not.toHaveBeenCalled();
    });

    it("not_fulfillable -> 409 with current status/paymentStatus", async () => {
      vi.mocked(shipOrder).mockResolvedValue({
        outcome: "not_fulfillable",
        status: "processing",
        paymentStatus: "pending",
      });
      const res = await POST(post({}), params);
      expect(res.status).toBe(409);
      await expect(res.json()).resolves.toEqual({
        code: "not_fulfillable",
        status: "processing",
        paymentStatus: "pending",
      });
    });
  });
  ```
- [ ] Run it — expect failure:
  ```bash
  npx vitest run tests/unit/app/api/admin-orders-ship-route.test.ts
  ```
  Expected: `Cannot find module '@/app/api/admin/orders/[id]/ship/route'`.
- [ ] Create `app/api/admin/orders/[id]/ship/route.ts`:
  ```ts
  import { NextRequest, NextResponse } from "next/server";
  import { checkAdminPermissions } from "@/lib/auth/admin-middleware";
  import { shipOrder } from "@/lib/fulfillment/service";
  import { sendInitialShippingEmail } from "@/lib/fulfillment/shipping-email";
  import { buildTrackingUrl, normalizeCarrier } from "@/lib/fulfillment/tracking";
  import { parseShipmentInput } from "@/lib/fulfillment/transitions";
  import type { Actor } from "@/lib/fulfillment/types";
  import type { Order } from "@/lib/types/order";

  /** Derived at the response boundary — tracking URLs are never stored. */
  function trackingProjection(order: Order) {
    const carrier = normalizeCarrier(order.shipping_carrier ?? null);
    const trackingNumber = order.tracking_number ?? null;
    return {
      carrier,
      trackingNumber,
      trackingUrl: buildTrackingUrl(carrier, trackingNumber),
    };
  }

  /**
   * POST /api/admin/orders/[id]/ship (BMC-216B)
   *
   * The ONLY writer of processing+paid -> shipped. Timestamps are server-owned;
   * the body may carry nothing (untracked) or a full carrier+tracking pair.
   * Email is a best-effort side effect AFTER the shipment commit — a failed
   * send is reported in the 201 body, never a rollback.
   */
  export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
  ) {
    const auth = await checkAdminPermissions(request);
    if (!auth.success) {
      return NextResponse.json(
        { error: auth.error ?? "Unauthorized" },
        { status: 401 },
      );
    }
    const { id } = await params;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      body = {}; // absent/empty body = valid untracked shipment
    }
    const parsed = parseShipmentInput(body);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const actor: Actor = auth.isServiceToken
      ? { type: "service", id: "api-token" }
      : { type: "admin", id: auth.userId ?? null };

    const result = await shipOrder(id, parsed.input, actor);

    switch (result.outcome) {
      case "shipped": {
        const email = await sendInitialShippingEmail(result.order, actor);
        return NextResponse.json(
          {
            order: result.order,
            tracking: trackingProjection(result.order),
            email,
            eventId: result.eventId,
          },
          { status: 201 },
        );
      }
      case "already_shipped":
        // Idempotent identical retry: no new event, no second email attempt.
        return NextResponse.json(
          {
            order: result.order,
            tracking: trackingProjection(result.order),
            email: { attempted: false, success: false },
            eventId: null,
          },
          { status: 200 },
        );
      case "not_found":
        return NextResponse.json({ error: "Order not found" }, { status: 404 });
      case "conflict":
        return NextResponse.json(
          {
            code: "shipment_conflict",
            status: result.order.status,
            paymentStatus: result.order.payment_status ?? null,
          },
          { status: 409 },
        );
      case "not_fulfillable":
        return NextResponse.json(
          {
            code: "not_fulfillable",
            status: result.status,
            paymentStatus: result.paymentStatus,
          },
          { status: 409 },
        );
    }
  }
  ```
- [ ] Run to pass:
  ```bash
  npx vitest run tests/unit/app/api/admin-orders-ship-route.test.ts
  ```
  Expected: all 11 tests pass.
- [ ] Gates and commit:
  ```bash
  npm run lint && npx tsc --noEmit
  git add "app/api/admin/orders/[id]/ship/route.ts" tests/unit/app/api/admin-orders-ship-route.test.ts
  git commit -m "feat(api): POST /api/admin/orders/[id]/ship shipment endpoint (BMC-216B)"
  ```

---

### Task 6: `PATCH /api/admin/orders/[id]/tracking` route

**Files:**
- Create: `app/api/admin/orders/[id]/tracking/route.ts`
- Test: `tests/unit/app/api/admin-orders-tracking-route.test.ts`

**Interfaces:**
- Consumes: `checkAdminPermissions`, `parseShipmentInput` (real), `normalizeCarrier`/`buildTrackingUrl` (real), `updateTracking` (mocked in tests).
- Produces (contract wire): request `{ carrier, trackingNumber }` **both required**; `200 { order, tracking, eventId }`; `400`/`401`; `404`; `409 { code: "not_shipped", status }`. Never sends email.

**Suggested agent:** sonnet — route boilerplate against a pinned contract.

- [ ] Write the failing test at `tests/unit/app/api/admin-orders-tracking-route.test.ts`:
  ```ts
  /**
   * BMC-216B — PATCH /api/admin/orders/[id]/tracking.
   * Both fields required; valid only for shipped orders; NEVER sends email.
   */
  import { describe, it, expect, vi, beforeEach } from "vitest";

  vi.mock("@/lib/auth/admin-middleware", () => ({
    checkAdminPermissions: vi.fn(),
  }));
  vi.mock("@/lib/fulfillment/service", () => ({
    updateTracking: vi.fn(),
  }));
  vi.mock("@/lib/fulfillment/shipping-email", () => ({
    sendInitialShippingEmail: vi.fn(),
  }));

  import { NextRequest } from "next/server";
  import { PATCH } from "@/app/api/admin/orders/[id]/tracking/route";
  import { checkAdminPermissions } from "@/lib/auth/admin-middleware";
  import { updateTracking } from "@/lib/fulfillment/service";
  import { sendInitialShippingEmail } from "@/lib/fulfillment/shipping-email";

  const url = "http://localhost/api/admin/orders/ORD-1/tracking";
  const params = { params: Promise.resolve({ id: "ORD-1" }) };

  function patch(body?: unknown) {
    return new NextRequest(url, {
      method: "PATCH",
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: { "content-type": "application/json" },
    });
  }

  const updatedOrder = {
    id: "ORD-1",
    status: "shipped",
    payment_status: "paid",
    shipping_carrier: "fedex",
    tracking_number: "999999999999",
    total_amount: { amount: 2500, currency: "USD" },
    currency_code: "USD",
    items: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(checkAdminPermissions).mockResolvedValue({
      success: true,
      userId: "user_2abc",
    });
  });

  describe("auth and validation", () => {
    it("401 when admin check denies; service never called", async () => {
      vi.mocked(checkAdminPermissions).mockResolvedValue({
        success: false,
        error: "Authentication required. Please sign in.",
      });
      const res = await PATCH(patch({ carrier: "ups", trackingNumber: "1Z" }), params);
      expect(res.status).toBe(401);
      expect(vi.mocked(updateTracking)).not.toHaveBeenCalled();
    });

    it("400 when both fields are absent (untracked is NOT valid here)", async () => {
      const res = await PATCH(patch({}), params);
      expect(res.status).toBe(400);
      expect(vi.mocked(updateTracking)).not.toHaveBeenCalled();
    });

    it("400 for tracking number without carrier", async () => {
      const res = await PATCH(patch({ trackingNumber: "1Z" }), params);
      expect(res.status).toBe(400);
    });

    it("400 for an unknown carrier", async () => {
      const res = await PATCH(patch({ carrier: "dhl", trackingNumber: "1Z" }), params);
      expect(res.status).toBe(400);
    });
  });

  describe("outcome mapping", () => {
    it("updated -> 200 { order, tracking, eventId } and derives the fedex link", async () => {
      vi.mocked(updateTracking).mockResolvedValue({
        outcome: "updated",
        order: updatedOrder as never,
        eventId: "evt-9",
      });
      const res = await PATCH(
        patch({ carrier: "fedex", trackingNumber: "999999999999" }),
        params,
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.eventId).toBe("evt-9");
      expect(body.tracking).toEqual({
        carrier: "fedex",
        trackingNumber: "999999999999",
        trackingUrl: "https://www.fedex.com/fedextrack/?trknbr=999999999999",
      });
      expect(vi.mocked(updateTracking)).toHaveBeenCalledWith(
        "ORD-1",
        { carrier: "fedex", trackingNumber: "999999999999" },
        { type: "admin", id: "user_2abc" },
      );
    });

    it("never sends email on tracking correction", async () => {
      vi.mocked(updateTracking).mockResolvedValue({
        outcome: "updated",
        order: updatedOrder as never,
        eventId: "evt-9",
      });
      await PATCH(patch({ carrier: "fedex", trackingNumber: "999999999999" }), params);
      expect(vi.mocked(sendInitialShippingEmail)).not.toHaveBeenCalled();
    });

    it("not_found -> 404", async () => {
      vi.mocked(updateTracking).mockResolvedValue({ outcome: "not_found" });
      const res = await PATCH(patch({ carrier: "ups", trackingNumber: "1Z" }), params);
      expect(res.status).toBe(404);
    });

    it("not_shipped -> 409 { code: 'not_shipped', status }", async () => {
      vi.mocked(updateTracking).mockResolvedValue({
        outcome: "not_shipped",
        status: "processing",
      });
      const res = await PATCH(patch({ carrier: "ups", trackingNumber: "1Z" }), params);
      expect(res.status).toBe(409);
      await expect(res.json()).resolves.toEqual({
        code: "not_shipped",
        status: "processing",
      });
    });
  });
  ```
- [ ] Run it — expect module-not-found failure:
  ```bash
  npx vitest run tests/unit/app/api/admin-orders-tracking-route.test.ts
  ```
- [ ] Create `app/api/admin/orders/[id]/tracking/route.ts`:
  ```ts
  import { NextRequest, NextResponse } from "next/server";
  import { checkAdminPermissions } from "@/lib/auth/admin-middleware";
  import { updateTracking } from "@/lib/fulfillment/service";
  import { buildTrackingUrl, normalizeCarrier } from "@/lib/fulfillment/tracking";
  import { parseShipmentInput } from "@/lib/fulfillment/transitions";
  import type { Actor } from "@/lib/fulfillment/types";

  /**
   * PATCH /api/admin/orders/[id]/tracking (BMC-216B)
   *
   * Tracking correction for an already-shipped order. Unlike /ship, BOTH fields
   * are required — a correction always states the full new pair. Never emails
   * the customer (resend is an explicit, separate action — ticket C).
   */
  export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
  ) {
    const auth = await checkAdminPermissions(request);
    if (!auth.success) {
      return NextResponse.json(
        { error: auth.error ?? "Unauthorized" },
        { status: 401 },
      );
    }
    const { id } = await params;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      body = {};
    }
    const parsed = parseShipmentInput(body);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    if (parsed.input.carrier === null || parsed.input.trackingNumber === null) {
      return NextResponse.json(
        { error: "carrier and trackingNumber are both required" },
        { status: 400 },
      );
    }

    const actor: Actor = auth.isServiceToken
      ? { type: "service", id: "api-token" }
      : { type: "admin", id: auth.userId ?? null };

    const result = await updateTracking(id, parsed.input, actor);

    switch (result.outcome) {
      case "updated": {
        const carrier = normalizeCarrier(result.order.shipping_carrier ?? null);
        const trackingNumber = result.order.tracking_number ?? null;
        return NextResponse.json(
          {
            order: result.order,
            tracking: {
              carrier,
              trackingNumber,
              trackingUrl: buildTrackingUrl(carrier, trackingNumber),
            },
            eventId: result.eventId,
          },
          { status: 200 },
        );
      }
      case "not_found":
        return NextResponse.json({ error: "Order not found" }, { status: 404 });
      case "not_shipped":
        return NextResponse.json(
          { code: "not_shipped", status: result.status },
          { status: 409 },
        );
    }
  }
  ```
- [ ] Run to pass:
  ```bash
  npx vitest run tests/unit/app/api/admin-orders-tracking-route.test.ts
  ```
  Expected: all 8 tests pass.
- [ ] Gates and commit:
  ```bash
  npm run lint && npx tsc --noEmit
  git add "app/api/admin/orders/[id]/tracking/route.ts" tests/unit/app/api/admin-orders-tracking-route.test.ts
  git commit -m "feat(api): PATCH /api/admin/orders/[id]/tracking correction endpoint (BMC-216B)"
  ```

---

### Task 7: `GET /api/admin/orders/[id]/events` route

**Files:**
- Create: `app/api/admin/orders/[id]/events/route.ts`
- Test: `tests/unit/app/api/admin-orders-events-route.test.ts`

**Interfaces:**
- Consumes: `checkAdminPermissions`, `listOrderEvents` (mocked in tests).
- Produces (contract wire): `200 { "events": [{ id, type, actorType, actorId, fromStatus, toStatus, details, createdAt }] }` — oldest first, fulfillment events only; `401 { error }`.

**Suggested agent:** sonnet — pure projection route; the snake→camel wire mapping must match the contract keys exactly.

- [ ] Write the failing test at `tests/unit/app/api/admin-orders-events-route.test.ts`:
  ```ts
  /**
   * BMC-216B — GET /api/admin/orders/[id]/events.
   * Admin-gated audit read: unauthorized requests must not reach the service;
   * rows project to the contract's camelCase wire keys, oldest first.
   * order_events holds ONLY fulfillment events, so no refund-ledger/extension
   * data can leak through this projection.
   */
  import { describe, it, expect, vi, beforeEach } from "vitest";

  vi.mock("@/lib/auth/admin-middleware", () => ({
    checkAdminPermissions: vi.fn(),
  }));
  vi.mock("@/lib/fulfillment/service", () => ({
    listOrderEvents: vi.fn(),
  }));

  import { NextRequest } from "next/server";
  import { GET } from "@/app/api/admin/orders/[id]/events/route";
  import { checkAdminPermissions } from "@/lib/auth/admin-middleware";
  import { listOrderEvents } from "@/lib/fulfillment/service";

  const url = "http://localhost/api/admin/orders/ORD-1/events";
  const params = { params: Promise.resolve({ id: "ORD-1" }) };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(checkAdminPermissions).mockResolvedValue({
      success: true,
      userId: "user_2abc",
    });
  });

  it("401 when admin check denies; events are never read", async () => {
    vi.mocked(checkAdminPermissions).mockResolvedValue({
      success: false,
      error: "Authentication required. Please sign in.",
    });
    const res = await GET(new NextRequest(url), params);
    expect(res.status).toBe(401);
    expect(vi.mocked(listOrderEvents)).not.toHaveBeenCalled();
  });

  it("200 with rows projected to contract wire keys, order preserved (oldest first)", async () => {
    vi.mocked(listOrderEvents).mockResolvedValue([
      {
        id: "evt-1",
        order_id: "ORD-1",
        event_type: "shipment_created",
        actor_type: "admin",
        actor_id: "user_2abc",
        from_status: "processing",
        to_status: "shipped",
        details: { carrier: "ups", trackingNumber: "1Z", trackingUrl: "https://..." },
        created_at: "2026-07-30T11:00:00.000Z",
      },
      {
        id: "evt-2",
        order_id: "ORD-1",
        event_type: "tracking_updated",
        actor_type: "service",
        actor_id: "api-token",
        from_status: null,
        to_status: null,
        details: {
          previous: { carrier: "ups", trackingNumber: "1Z" },
          next: { carrier: "fedex", trackingNumber: "99" },
        },
        created_at: "2026-07-30T12:00:00.000Z",
      },
    ] as never);
    const res = await GET(new NextRequest(url), params);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { events: Record<string, unknown>[] };
    expect(vi.mocked(listOrderEvents)).toHaveBeenCalledWith("ORD-1");
    expect(body.events).toHaveLength(2);
    expect(body.events[0]).toEqual({
      id: "evt-1",
      type: "shipment_created",
      actorType: "admin",
      actorId: "user_2abc",
      fromStatus: "processing",
      toStatus: "shipped",
      details: { carrier: "ups", trackingNumber: "1Z", trackingUrl: "https://..." },
      createdAt: "2026-07-30T11:00:00.000Z",
    });
    expect(body.events[1].type).toBe("tracking_updated");
  });

  it("200 with an empty list for an order with no events", async () => {
    vi.mocked(listOrderEvents).mockResolvedValue([]);
    const res = await GET(new NextRequest(url), params);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ events: [] });
  });
  ```
- [ ] Run it — expect module-not-found failure:
  ```bash
  npx vitest run tests/unit/app/api/admin-orders-events-route.test.ts
  ```
- [ ] Create `app/api/admin/orders/[id]/events/route.ts`:
  ```ts
  import { NextRequest, NextResponse } from "next/server";
  import { checkAdminPermissions } from "@/lib/auth/admin-middleware";
  import { listOrderEvents } from "@/lib/fulfillment/service";

  /**
   * GET /api/admin/orders/[id]/events (BMC-216B)
   *
   * Fulfillment audit history, oldest first. order_events contains only
   * fulfillment events — refund-ledger details and server-owned extension data
   * live elsewhere and are not reachable through this projection.
   */
  export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
  ) {
    const auth = await checkAdminPermissions(request);
    if (!auth.success) {
      return NextResponse.json(
        { error: auth.error ?? "Unauthorized" },
        { status: 401 },
      );
    }
    const { id } = await params;

    const rows = await listOrderEvents(id);
    return NextResponse.json({
      events: rows.map((row) => ({
        id: row.id,
        type: row.event_type,
        actorType: row.actor_type,
        actorId: row.actor_id,
        fromStatus: row.from_status,
        toStatus: row.to_status,
        details: row.details,
        createdAt: row.created_at,
      })),
    });
  }
  ```
- [ ] Run to pass:
  ```bash
  npx vitest run tests/unit/app/api/admin-orders-events-route.test.ts
  ```
  Expected: all 3 tests pass.
- [ ] Gates and commit:
  ```bash
  npm run lint && npx tsc --noEmit
  git add "app/api/admin/orders/[id]/events/route.ts" tests/unit/app/api/admin-orders-events-route.test.ts
  git commit -m "feat(api): GET /api/admin/orders/[id]/events audit history endpoint (BMC-216B)"
  ```

---

## Verification

Run the full gate set from the repo root (all must pass before claiming BMC-216B complete):

```bash
npm run lint          # ESLint (next/core-web-vitals)
npx tsc --noEmit      # strict typecheck
npm test              # full unit suite: vitest run over tests/unit/** (the only tests CI executes)
```

Then verify the BMC-216B acceptance criteria map to passing tests:

- **Only paid `processing` orders ship** → `service-ship.test.ts` "processing but unpaid" + `it.each` status matrix + the SET/WHERE assertions.
- **Competing requests produce one CAS winner** → the guarded `WHERE status='processing' AND payment_status='paid'` + zero-row branch tests (`already_shipped`/`conflict`).
- **A failed CAS cannot produce a shipment event** → the marker assertion (`status = 'shipped' AND shipped_at = ?` in the rendered conditional insert) + "re-read paradox" test (no event, no false success).
- **Server timestamps only** → fake-timer assertions that `shipped_at`/`updated_at`/event `created_at` all equal this request's instant; route tests show the body can never carry a timestamp (parseShipmentInput accepts only carrier/trackingNumber).
- **Refund/payment/inventory fields untouched** → the exhaustive `Object.keys(setArgs).sort()` assertions in both service test files.

Also confirm no migration files were created (`git status migrations/` must be clean — `0022`/`0023` belong to ticket A).

## Contract Deviations

None require renaming — the following are recorded clarifications/decisions within the contract's latitude (update this section during execution if the Task 1 preflight uncovers a genuine A-surface mismatch, and escalate instead of renaming):

1. **Conditional event insert is raw `sql\`\`` via `db.run()`**, not Drizzle insert-from-select — even though drizzle-orm ^0.45.2 supports insert-from-select (`SQLiteInsertBase.select`, verified in `node_modules/drizzle-orm/sqlite-core/query-builders/insert.d.ts:41-44`). Rationale in "Key Design Decisions" #1. The contract specifies the statement shape, not the builder API, so this is compliant.
2. **`200` idempotent-retry response returns `"eventId": null`.** The contract's combined 201/200 JSON example shows an `eventId`, but the binding `ShipOrderResult` type gives `already_shipped` no `eventId` (no new event is written on an idempotent retry). The typed contract wins; the example is read as illustrating the 201 case.
3. **`OrderEventRow`** is defined as `export type OrderEventRow = typeof orderEvents.$inferSelect;` in `lib/fulfillment/service.ts` unless ticket A already exports it from `lib/db/schema/order-events.ts` (Task 1 checks; if A exports it, import/re-export instead of redefining).
4. **`details` in the two conditional raw-SQL inserts is bound as `JSON.stringify(...)` text.** The contract's "pass raw objects, never pre-stringified" rule governs the Drizzle json-mode column path — which `recordEmailEvent` follows — and a raw-SQL bind necessarily supplies the serialized form; the stored bytes are identical.
5. **`hydrateOrder` is exported** from `lib/models/mach/orders.ts` (one-word change; that file is not in the contract's modified-files list) so service results carry the same `Order` shape as every other order API.
6. **`409 shipment_conflict` bodies include `status`/`paymentStatus`** derived from the conflicting order row, matching the contract's error example `{ "code": ..., "status": ..., "paymentStatus": ... }`.

### Recorded during execution (BMC-226)

7. **`CARRIERS` shipped as `["ups", "fedex", "usps", "other"]`, not the contract's `["ups", "fedex", "other"]`.** This is ticket A's deliberate, already-merged decision (BeauTeas ships UPS/FedEx/USPS — see the `0022` header and the CLAUDE.md migration note), and `buildTrackingUrl` has a real USPS branch. No rename or re-implementation was needed, so this is not an escalation — but it invalidated one plan test fixture: Task 5's "400 for an unknown carrier" case used `carrier: "usps"`, which is now **valid** input. The test uses `"dhl"` instead (DHL is deliberately not a code and normalizes to `other`), and a companion test asserts `usps` is accepted end-to-end so this can't silently regress.
8. **`OrderEventRow` is imported from `lib/db/schema/order-events.ts`** (ticket A exports it, as the contract addendum requires) and re-exported from `lib/fulfillment/service.ts` for consumers — the plan's fallback local definition was not needed.
9. **No `db.batch()` tuple cast was required.** `tsc --noEmit` accepts the heterogeneous `db.batch([guardedUpdate, conditionalEventInsert])` directly, so the `rebuild.ts:99` `as [any, ...any[]]` idiom was dropped in favor of the fully-typed call (the destructured update rows keep their inferred row type).
10. **Tasks 3 and 4 landed in one commit** (both write `lib/fulfillment/service.ts`); each was still TDD'd and gated separately. Cosmetic deviation from the plan's per-task commit granularity.
11. **The "only writer of `processing+paid -> shipped`" claim was softened to match repo reality.** The legacy `PUT /api/orders` (`app/api/orders/route.ts:534`) still accepts client-supplied `status`, `shipped_at` and `tracking_number` and is what the current admin UI calls, so this route is the *correct* path, not yet the *enforced* one. Closing that hole is BMC-230 (ticket F) per the contract; the route and service doc comments now say so explicitly rather than asserting an invariant the repo violates.
