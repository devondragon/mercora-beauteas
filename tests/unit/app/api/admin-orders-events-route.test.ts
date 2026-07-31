/**
 * BMC-216B — GET /api/admin/orders/[id]/events.
 * Admin-gated audit read: unauthorized requests must not reach the service;
 * rows project to the contract's camelCase wire keys, oldest first.
 * order_events holds ONLY fulfillment events, so no refund-ledger/extension
 * data can leak through this projection.
 */
import { it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth/admin-middleware", () => ({
  checkAdminPermissions: vi.fn(),
}));
vi.mock("@/lib/fulfillment/service", () => ({
  listOrderEvents: vi.fn(),
}));
vi.mock("@/lib/models/mach/orders", () => ({
  getOrderById: vi.fn(),
}));

import { NextRequest } from "next/server";
import { GET } from "@/app/api/admin/orders/[id]/events/route";
import { checkAdminPermissions } from "@/lib/auth/admin-middleware";
import { listOrderEvents } from "@/lib/fulfillment/service";
import { getOrderById } from "@/lib/models/mach/orders";

const url = "http://localhost/api/admin/orders/ORD-1/events";
const params = { params: Promise.resolve({ id: "ORD-1" }) };

const existingOrder = { id: "ORD-1", status: "shipped" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(checkAdminPermissions).mockResolvedValue({
    success: true,
    userId: "user_2abc",
  });
  vi.mocked(getOrderById).mockResolvedValue(existingOrder as never);
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

it("404 when the order does not exist; events are never read", async () => {
  vi.mocked(getOrderById).mockResolvedValue(null);
  const res = await GET(new NextRequest(url), params);
  expect(res.status).toBe(404);
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
      details: {
        carrier: "ups",
        trackingNumber: "1Z",
        trackingUrl: "https://...",
      },
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
    details: {
      carrier: "ups",
      trackingNumber: "1Z",
      trackingUrl: "https://...",
    },
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

it("an unhandled service throw returns a clean JSON 500, not an opaque error", async () => {
  vi.mocked(listOrderEvents).mockRejectedValue(new Error("D1 unavailable"));
  const res = await GET(new NextRequest(url), params);
  expect(res.status).toBe(500);
  const body = (await res.json()) as { error: string };
  expect(body.error).toBeTruthy();
});
