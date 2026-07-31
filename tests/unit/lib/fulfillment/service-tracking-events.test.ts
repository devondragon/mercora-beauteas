/**
 * BMC-216B — updateTracking / listOrderEvents / recordEmailEvent orchestration.
 *
 * updateTracking mirrors shipOrder's CAS discipline with `updated_at` as the
 * operation marker: guarded on status='shipped', batched with a conditional
 * tracking_updated insert that fires only when THIS request's update won, and
 * carries { previous, next } from the pre-read. The conditional insert is
 * builder-based (db.insert().select()), never db.run(sql\`...\`) — the
 * latter throws inside db.batch() on drizzle-orm 0.45.2's D1 driver.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { QueryBuilder } from "drizzle-orm/sqlite-core";

const h = vi.hoisted(() => ({
  state: {
    // db.select()...limit()/orderBy() responses, consumed in call order.
    selectResults: [] as unknown[][],
    batchResult: [[], { success: true }] as unknown[],
  },
  captured: {
    setArgs: [] as Record<string, unknown>[],
    // The guarded UPDATE's WHERE condition, rendered in-test to assert the
    // value-CAS is present (see renderedUpdateWhere).
    updateWhere: [] as unknown[],
    // db.insert(orderEvents).select(<this>) — a real, renderable drizzle
    // query builder (see `qb` below), captured for `.toSQL()` inspection.
    insertSelectQueries: [] as unknown[],
    batchStmts: [] as unknown[][],
    insertValues: [] as Record<string, unknown>[],
  },
}));

vi.mock("@/lib/db", () => {
  // Bindingless query builder — same rationale as service-ship.test.ts.
  const qb = new QueryBuilder();
  const db = {
    select: vi.fn((fields?: Record<string, unknown>) => {
      if (fields !== undefined) {
        // The conditional event insert's value-row select. Cast: the mock
        // only needs to forward whatever service.ts passed, not re-derive
        // drizzle's SelectedFields typing.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return qb.select(fields as any);
      }
      return {
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(async () => h.state.selectResults.shift() ?? []),
            orderBy: vi.fn(async () => h.state.selectResults.shift() ?? []),
          })),
        })),
      };
    }),
    update: vi.fn(() => ({
      set: vi.fn((values: Record<string, unknown>) => {
        h.captured.setArgs.push(values);
        return {
          where: vi.fn((condition: unknown) => {
            h.captured.updateWhere.push(condition);
            return {
              returning: vi.fn(() => ({ __stmt: "guarded-update" })),
            };
          }),
        };
      }),
    })),
    batch: vi.fn(async (stmts: unknown[]) => {
      h.captured.batchStmts.push(stmts);
      return h.state.batchResult;
    }),
    insert: vi.fn(() => ({
      select: vi.fn((selectQuery: unknown) => {
        h.captured.insertSelectQueries.push(selectQuery);
        return { __stmt: "conditional-event-insert" };
      }),
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
import { orders } from "@/lib/db/schema/order";
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

/**
 * The captured UPDATE condition is a bare drizzle SQL fragment; wrapping it in
 * a throwaway SELECT is the cheapest way to render it without a live dialect.
 */
function renderedUpdateWhere() {
  expect(h.captured.updateWhere).toHaveLength(1);
  return new QueryBuilder()
    .select()
    .from(orders)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .where(h.captured.updateWhere[0] as any)
    .toSQL();
}

function renderedInsert() {
  expect(h.captured.insertSelectQueries).toHaveLength(1);
  const query = h.captured.insertSelectQueries[0] as {
    toSQL: () => { sql: string; params: unknown[] };
  };
  return query.toSQL();
}

beforeEach(() => {
  vi.clearAllMocks();
  h.captured.setArgs.length = 0;
  h.captured.updateWhere.length = 0;
  h.captured.insertSelectQueries.length = 0;
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
      [
        orderRow({
          shipping_carrier: "fedex",
          tracking_number: "999999999999",
          updated_at: FIXED_NOW,
        }),
      ],
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
    const { sql: text, params } = renderedInsert();
    expect(text).toMatch(/^select /i);
    expect(text).toMatch(/from "orders"/i);
    expect(text).toMatch(/"orders"\."status" = \? and "orders"\."updated_at" = \?/i);
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
    h.state.selectResults = [
      [orderRow({ status: "processing", shipped_at: null })],
    ];
    const result = await updateTracking("ORD-1", nextInput, actor);
    expect(result).toEqual({ outcome: "not_shipped", status: "processing" });
    expect(h.captured.batchStmts).toHaveLength(0);
    expect(h.captured.insertSelectQueries).toHaveLength(0);
  });

  it("lost race (zero-row CAS after shipped pre-read) -> re-read decides", async () => {
    h.state.selectResults = [[orderRow()], [orderRow({ status: "refunded" })]];
    h.state.batchResult = [[], { success: true }];
    const result = await updateTracking("ORD-1", nextInput, actor);
    expect(result).toEqual({ outcome: "not_shipped", status: "refunded" });
  });

  // The guard re-asserts the observed pair, so a concurrent corrector that
  // committed first makes this UPDATE match zero rows — without it both
  // writers pass `status='shipped'` and the loser's event records a
  // `previous` that was never the committed pre-state.
  it("value-CAS: the UPDATE re-asserts the pre-read carrier + tracking pair", async () => {
    h.state.selectResults = [[orderRow()]];
    h.state.batchResult = [
      [orderRow({ shipping_carrier: "fedex", tracking_number: "999999999999" })],
      { success: true },
    ];
    await updateTracking("ORD-1", nextInput, actor);
    const { sql: text, params } = renderedUpdateWhere();
    expect(text).toMatch(/"orders"\."shipping_carrier" = \?/i);
    expect(text).toMatch(/"orders"\."tracking_number" = \?/i);
    // The OBSERVED values, not the incoming ones.
    expect(params).toContain("ups");
    expect(params).toContain("1Z999AA10123456784");
  });

  it("value-CAS on an untracked shipment uses IS NULL, not `= NULL`", async () => {
    h.state.selectResults = [
      [orderRow({ shipping_carrier: null, tracking_number: null })],
    ];
    h.state.batchResult = [[orderRow()], { success: true }];
    const result = await updateTracking("ORD-1", nextInput, actor);
    expect(result.outcome).toBe("updated");
    const { sql: text } = renderedUpdateWhere();
    expect(text).toMatch(/"orders"\."shipping_carrier" is null/i);
    expect(text).toMatch(/"orders"\."tracking_number" is null/i);
    const { params } = renderedInsert();
    const details = params.find(
      (p) => typeof p === "string" && p.startsWith("{"),
    ) as string;
    expect(JSON.parse(details).previous).toEqual({
      carrier: null,
      trackingNumber: null,
    });
  });

  // A same-millisecond loser's `updated_at = <marker>` gate can still match the
  // winner's row; NOT EXISTS is what stops it appending a phantom second event.
  it("conditional insert is guarded by NOT EXISTS on this request's marker", async () => {
    h.state.selectResults = [[orderRow()]];
    h.state.batchResult = [[orderRow()], { success: true }];
    await updateTracking("ORD-1", nextInput, actor);
    const { sql: text, params } = renderedInsert();
    expect(text).toMatch(/not exists/i);
    expect(text).toMatch(/from "order_events"/i);
    expect(params.filter((p) => p === FIXED_NOW).length).toBeGreaterThan(1);
  });

  // Regression: returning {not_shipped, status: 'shipped'} here produced a
  // self-contradictory 409 body at the route.
  it("zero-row CAS but re-read still shipped -> conflict, never a contradictory not_shipped", async () => {
    h.state.selectResults = [
      [orderRow()],
      // Another corrector won first (or status ping-ponged back to shipped).
      [orderRow({ shipping_carrier: "usps", tracking_number: "OTHER" })],
    ];
    h.state.batchResult = [[], { success: true }];
    const result = await updateTracking("ORD-1", nextInput, actor);
    expect(result.outcome).toBe("conflict");
    if (result.outcome !== "conflict") return;
    expect(result.order.tracking_number).toBe("OTHER");
  });
});

describe("listOrderEvents", () => {
  it("returns rows oldest-first as provided by the ordered query", async () => {
    const rows = [
      {
        id: "evt-1",
        order_id: "ORD-1",
        event_type: "shipment_created",
        created_at: "2026-07-30T11:00:00.000Z",
      },
      {
        id: "evt-2",
        order_id: "ORD-1",
        event_type: "tracking_updated",
        created_at: "2026-07-30T12:00:00.000Z",
      },
    ];
    h.state.selectResults = [rows];
    await expect(listOrderEvents("ORD-1")).resolves.toEqual(rows);
  });
});

describe("recordEmailEvent", () => {
  it("appends the event with a RAW details object (json-mode column) and returns its id", async () => {
    const details = { idempotencyKey: "shipping-confirmation/ORD-1/initial" };
    const id = await recordEmailEvent(
      "ORD-1",
      "shipping_email_failed",
      actor,
      details,
    );
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
