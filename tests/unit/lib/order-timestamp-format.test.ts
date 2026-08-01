/**
 * Unit tests for the `orders` timestamp format invariant (BMC-228 follow-up F-10).
 *
 * `orders.created_at` used to hold TWO incompatible text encodings:
 *
 *   - `"2026-07-27 23:19:37"`      — SQLite's CURRENT_TIMESTAMP column default,
 *                                     which fired because buildOrderRecord
 *                                     omitted the column entirely.
 *   - `"2026-07-28T01:35:32.122Z"` — JS `new Date().toISOString()`, written by
 *                                     app/api/orders/route.ts.
 *
 * SQLite compares TEXT byte-wise and `' '` (0x20) sorts before `'T'` (0x54), so
 * EVERY space-encoded row sorts before EVERY ISO row regardless of the actual
 * instant. The admin fulfillment queue orders by `created_at ASC` (oldest-first)
 * and paginates on that order, so a mixed table can present a materially newer
 * order as "oldest" and scatter rows across the wrong pages.
 *
 * The second, quieter bug: consumers render with `new Date(created_at)`
 * (QueueOrderRow.tsx:79, admin/orders/[id]/page.tsx:480). V8 parses the
 * space-separated form as LOCAL time but the ISO form as UTC — so the same
 * instant renders as two different dates, and near midnight as two different
 * DAYS.
 *
 * ISO-8601-UTC is the canonical format, not a coin flip: `shipped_at` and
 * `updated_at` are already CAS markers compared for exact string equality
 * (lib/fulfillment/service.ts:156,331 and lib/payments/refund-ledger-store.ts:42)
 * against a JS-generated `new Date().toISOString()`. The DB layer must therefore
 * speak ISO, and the column default must never be the thing that writes a
 * timestamp.
 *
 * Migration 0024 normalizes the rows that already exist; these tests pin the
 * WRITER so the mix cannot re-form.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const insertValues = vi.fn();
const updateSet = vi.fn();

// The orders model calls getDbAsync() → getCloudflareContext(), unavailable in
// the unit env. Mock the db seam and capture what the model tries to write.
vi.mock("@/lib/db", () => ({
  getDbAsync: vi.fn(async () => ({
    insert: () => ({
      values: (record: unknown) => {
        insertValues(record);
        return {
          returning: async () => [makeRow(record as Record<string, unknown>)],
        };
      },
    }),
    update: () => ({
      set: (patch: unknown) => {
        updateSet(patch);
        return {
          where: () => ({
            returning: async () => [makeRow({})],
          }),
        };
      },
    }),
    batch: async (stmts: unknown[]) => stmts.map(() => [makeRow({})]),
  })),
}));

/** A minimal row shaped well enough for hydrateOrder to run. */
function makeRow(overrides: Record<string, unknown>) {
  return {
    id: "ORD-TEST-1",
    customer_id: "cus_1",
    status: "pending",
    total_amount: { amount: 2500, currency: "USD" },
    currency_code: "USD",
    shipping_address: null,
    billing_address: null,
    items: [],
    shipping_method: null,
    payment_method: null,
    payment_status: "pending",
    shipping_carrier: null,
    tracking_number: null,
    shipped_at: null,
    delivered_at: null,
    notes: null,
    external_references: null,
    extensions: null,
    created_at: "2026-07-28T01:35:32.122Z",
    updated_at: "2026-07-28T01:35:32.122Z",
    ...overrides,
  };
}

/** `2026-07-28T01:35:32.122Z` — exactly what `Date#toISOString` emits. */
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const baseOrder = {
  customer_id: "cus_1",
  total_amount: { amount: 2500, currency: "USD" },
  currency_code: "USD",
  items: [],
} as never;

beforeEach(() => {
  insertValues.mockClear();
  updateSet.mockClear();
});

describe("orders.created_at write format (F-10)", () => {
  it("createOrder writes created_at explicitly, in ISO-8601 UTC", async () => {
    const { createOrder } = await import("@/lib/models/mach/orders");
    await createOrder(baseOrder);

    const record = insertValues.mock.calls[0][0] as Record<string, unknown>;

    // Explicitly present — NOT delegated to the CURRENT_TIMESTAMP default,
    // which is what produced the space-separated encoding.
    expect(record).toHaveProperty("created_at");
    expect(record.created_at).toMatch(ISO_UTC);
  });

  it("createOrder writes updated_at in the same ISO-8601 UTC format", async () => {
    const { createOrder } = await import("@/lib/models/mach/orders");
    await createOrder(baseOrder);

    const record = insertValues.mock.calls[0][0] as Record<string, unknown>;
    expect(record).toHaveProperty("updated_at");
    expect(record.updated_at).toMatch(ISO_UTC);
  });

  it("createOrderPaid writes both timestamps in ISO-8601 UTC", async () => {
    const { createOrderPaid } = await import("@/lib/models/mach/orders");
    await createOrderPaid(baseOrder);

    const record = insertValues.mock.calls[0][0] as Record<string, unknown>;
    expect(record.created_at).toMatch(ISO_UTC);
    expect(record.updated_at).toMatch(ISO_UTC);
  });

  it("never emits the SQLite space-separated encoding", async () => {
    const { createOrder } = await import("@/lib/models/mach/orders");
    await createOrder(baseOrder);

    const record = insertValues.mock.calls[0][0] as Record<string, unknown>;
    expect(String(record.created_at)).not.toMatch(/^\d{4}-\d{2}-\d{2} /);
    expect(String(record.updated_at)).not.toMatch(/^\d{4}-\d{2}-\d{2} /);
  });

  it("does not hand Drizzle a raw CURRENT_TIMESTAMP SQL fragment for the timestamps", async () => {
    const { createOrder } = await import("@/lib/models/mach/orders");
    await createOrder(baseOrder);

    const record = insertValues.mock.calls[0][0] as Record<string, unknown>;
    // A Drizzle sql`` fragment is an object; an ISO timestamp is a string.
    // Asserting the type is what stops `sql`CURRENT_TIMESTAMP`` creeping back.
    expect(typeof record.created_at).toBe("string");
    expect(typeof record.updated_at).toBe("string");
  });
});

describe("Shopify ETL timestamp normalization (toIsoUtc)", () => {
  // The ETL is the third writer into orders.created_at. Shopify emits an OFFSET
  // form, which is neither of the two encodings migration 0024 reconciles — left
  // as-is it would re-seed the mix on the next run.
  it("resolves a timezone offset to UTC rather than passing it through", async () => {
    const { toIsoUtc } = await import(
      "../../../scripts/shopify-migration/lib/dates"
    );
    expect(toIsoUtc("2026-07-27T23:19:37-06:00")).toBe("2026-07-28T05:19:37.000Z");
    expect(toIsoUtc("2026-07-27T23:19:37+02:00")).toBe("2026-07-27T21:19:37.000Z");
  });

  it("pads an already-UTC value to the canonical millisecond form", async () => {
    const { toIsoUtc } = await import(
      "../../../scripts/shopify-migration/lib/dates"
    );
    expect(toIsoUtc("2026-07-29T10:00:00Z")).toBe("2026-07-29T10:00:00.000Z");
  });

  it("never emits the SQLite space-separated encoding", async () => {
    const { toIsoUtc } = await import(
      "../../../scripts/shopify-migration/lib/dates"
    );
    for (const input of [
      "2026-07-27T23:19:37-06:00",
      "2026-07-29T10:00:00Z",
      "2026-07-30",
      undefined,
      "not-a-date",
    ]) {
      expect(toIsoUtc(input)).toMatch(ISO_UTC);
    }
  });

  it("falls back to now for a missing or unparseable value instead of throwing", async () => {
    const { toIsoUtc } = await import(
      "../../../scripts/shopify-migration/lib/dates"
    );
    expect(() => toIsoUtc(undefined)).not.toThrow();
    expect(() => toIsoUtc("not-a-date")).not.toThrow();
    expect(toIsoUtc("not-a-date")).toMatch(ISO_UTC);
  });
});

describe("ISO-8601 UTC ordering invariant", () => {
  // This is the property the admin queue's `ORDER BY created_at ASC` depends on.
  it("sorts byte-wise in the same order as chronologically", () => {
    const instants = [
      new Date("2026-07-27T23:19:37.000Z"),
      new Date("2026-07-28T01:35:32.122Z"),
      new Date("2026-12-31T23:59:59.999Z"),
      new Date("2027-01-01T00:00:00.000Z"),
    ];
    const chronological = [...instants]
      .sort((a, b) => a.getTime() - b.getTime())
      .map((d) => d.toISOString());
    const byteWise = [...instants]
      .map((d) => d.toISOString())
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

    expect(byteWise).toEqual(chronological);
  });

  it("demonstrates the mixed-format bug this fix prevents", () => {
    // The OLD state of the table: a genuinely OLDER ISO row and a NEWER
    // space-encoded row. Byte-wise sort puts the newer row first.
    const olderIso = "2026-07-28T01:35:32.122Z"; // Jul 28 01:35 UTC
    const newerSpace = "2026-07-28 16:00:00"; // Jul 28 16:00 UTC — 14h LATER

    const byteWise = [olderIso, newerSpace].sort();
    expect(byteWise[0]).toBe(newerSpace); // wrong: the newer row sorts first

    // Normalized, the same two instants sort correctly.
    const normalized = [olderIso, "2026-07-28T16:00:00.000Z"].sort();
    expect(normalized[0]).toBe(olderIso);
  });
});
