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
    const res = await PATCH(
      patch({ carrier: "ups", trackingNumber: "1Z" }),
      params,
    );
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
    const res = await PATCH(
      patch({ carrier: "dhl", trackingNumber: "1Z" }),
      params,
    );
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
    await PATCH(
      patch({ carrier: "fedex", trackingNumber: "999999999999" }),
      params,
    );
    expect(vi.mocked(sendInitialShippingEmail)).not.toHaveBeenCalled();
  });

  it("not_found -> 404", async () => {
    vi.mocked(updateTracking).mockResolvedValue({ outcome: "not_found" });
    const res = await PATCH(
      patch({ carrier: "ups", trackingNumber: "1Z" }),
      params,
    );
    expect(res.status).toBe(404);
  });

  it("not_shipped -> 409 { code: 'not_shipped', status }", async () => {
    vi.mocked(updateTracking).mockResolvedValue({
      outcome: "not_shipped",
      status: "processing",
    });
    const res = await PATCH(
      patch({ carrier: "ups", trackingNumber: "1Z" }),
      params,
    );
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({
      code: "not_shipped",
      status: "processing",
    });
  });
});
