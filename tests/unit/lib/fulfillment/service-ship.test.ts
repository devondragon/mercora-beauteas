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
