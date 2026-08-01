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

/** Sends a body that is present but not valid JSON — distinct from no body. */
function postMalformed(raw: string) {
  return new NextRequest(url, {
    method: "POST",
    body: raw,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Internal (minor-unit) projection, exactly as hydrateOrder returns it —
 * total 2500 cents = $25.00, one line at 1250 cents = $12.50 each.
 */
const shippedOrder = {
  id: "ORD-1",
  status: "shipped",
  payment_status: "paid",
  shipping_carrier: "ups",
  tracking_number: "1Z999AA10123456784",
  shipped_at: "2026-07-30T12:00:00.000Z",
  total_amount: { amount: 2500, currency: "USD" },
  currency_code: "USD",
  items: [
    {
      product_id: "tea-morning",
      quantity: 2,
      unit_price: { amount: 1250, currency: "USD" },
      total_price: { amount: 2500, currency: "USD" },
    },
  ],
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
    const res = await POST(
      post({ trackingNumber: "1Z999AA10123456784" }),
      params,
    );
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
    // "dhl" is deliberately NOT a carrier code (BMC-225 decision: BeauTeas
    // ships UPS/FedEx/USPS; anything else is recorded as "other").
    const res = await POST(
      post({ carrier: "dhl", trackingNumber: "123" }),
      params,
    );
    expect(res.status).toBe(400);
  });

  it("400 for a present-but-malformed JSON body; service never called (does NOT become an untracked shipment)", async () => {
    const res = await POST(postMalformed("{not valid json"), params);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Invalid request body");
    expect(vi.mocked(shipOrder)).not.toHaveBeenCalled();
  });

  it("accepts usps — it is a real carrier code in lib/fulfillment/types.ts", async () => {
    vi.mocked(shipOrder).mockResolvedValue({ outcome: "not_found" });
    const res = await POST(
      post({ carrier: "usps", trackingNumber: "9400111899223197428490" }),
      params,
    );
    expect(res.status).toBe(404); // reached the service, so input was valid
    expect(vi.mocked(shipOrder)).toHaveBeenCalledWith(
      "ORD-1",
      { carrier: "usps", trackingNumber: "9400111899223197428490" },
      { type: "admin", id: "user_2abc" },
    );
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

  it("email seam throwing does NOT turn an already-committed shipment into a 500", async () => {
    vi.mocked(shipOrder).mockResolvedValue({
      outcome: "shipped",
      order: shippedOrder as never,
      eventId: "evt-3",
    });
    vi.mocked(sendInitialShippingEmail).mockRejectedValue(
      new Error("resend threw"),
    );
    const res = await POST(
      post({ carrier: "ups", trackingNumber: "1Z999AA10123456784" }),
      params,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.email).toEqual({
      attempted: true,
      success: false,
      error: "Send failed",
    });
    expect(body.eventId).toBe("evt-3");
  });

  it("empty body is a valid untracked shipment request", async () => {
    vi.mocked(shipOrder).mockResolvedValue({
      outcome: "shipped",
      order: {
        ...shippedOrder,
        shipping_carrier: null,
        tracking_number: null,
      } as never,
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
    const res = await POST(
      post({ carrier: "fedex", trackingNumber: "999" }),
      params,
    );
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

  it("an unhandled service throw returns a clean JSON 500, not an opaque error", async () => {
    vi.mocked(shipOrder).mockRejectedValue(new Error("D1 unavailable"));
    const res = await POST(
      post({ carrier: "ups", trackingNumber: "1Z999AA10123456784" }),
      params,
    );
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBeTruthy();
  });
});

/**
 * BMC-233 — the serialized `order` must be the MACH wire shape (major units,
 * `precision`), not hydrateOrder's internal cents projection. Dropping the
 * toWireOrder() call renders every total 100x (the BMC-179 bug).
 */
describe("wire-shaped money on the response boundary (BMC-233)", () => {
  const wireExpectations = {
    total_amount: { amount: 25, currency: "USD", precision: 2 },
    items: [
      expect.objectContaining({
        product_id: "tea-morning",
        unit_price: { amount: 12.5, currency: "USD", precision: 2 },
        total_price: { amount: 25, currency: "USD", precision: 2 },
      }),
    ],
  };

  it("201 shipped -> order.total_amount and each line are major-unit MachMoney", async () => {
    vi.mocked(shipOrder).mockResolvedValue({
      outcome: "shipped",
      order: shippedOrder as never,
      eventId: "evt-1",
    });
    const res = await POST(
      post({ carrier: "ups", trackingNumber: "1Z999AA10123456784" }),
      params,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.order).toEqual(expect.objectContaining(wireExpectations));
  });

  it("200 already_shipped emits the same wire shape as the 201", async () => {
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
    expect(body.order).toEqual(expect.objectContaining(wireExpectations));
  });

  it("the email seam still receives the INTERNAL cents order, not the wire one", async () => {
    vi.mocked(shipOrder).mockResolvedValue({
      outcome: "shipped",
      order: shippedOrder as never,
      eventId: "evt-1",
    });
    await POST(
      post({ carrier: "ups", trackingNumber: "1Z999AA10123456784" }),
      params,
    );
    // Same object identity: the conversion happens at NextResponse.json only,
    // so nothing internal starts seeing major units.
    expect(vi.mocked(sendInitialShippingEmail)).toHaveBeenCalledWith(
      shippedOrder,
      { type: "admin", id: "user_2abc" },
    );
    expect(shippedOrder.total_amount).toEqual({ amount: 2500, currency: "USD" });
  });
});
