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
  listRecentOrderEvents: vi.fn(),
}));
vi.mock("@/lib/models/mach/orders", () => ({
  getOrderById: vi.fn(),
}));

// The route resolves admin actor ids to a human label via admin_users so the
// timeline doesn't render a raw Clerk id. Mock the db seam and let each test
// decide what the lookup returns.
const adminLookup = vi.fn();
vi.mock("@/lib/db", () => ({
  getDbAsync: vi.fn(async () => ({
    select: () => ({ from: () => ({ where: () => adminLookup() }) }),
  })),
}));

import { NextRequest } from "next/server";
import { GET } from "@/app/api/admin/orders/[id]/events/route";
import { checkAdminPermissions } from "@/lib/auth/admin-middleware";
import { listRecentOrderEvents } from "@/lib/fulfillment/service";
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
  adminLookup.mockResolvedValue([]);
});

it("401 when admin check denies; events are never read", async () => {
  vi.mocked(checkAdminPermissions).mockResolvedValue({
    success: false,
    error: "Authentication required. Please sign in.",
  });
  const res = await GET(new NextRequest(url), params);
  expect(res.status).toBe(401);
  expect(vi.mocked(listRecentOrderEvents)).not.toHaveBeenCalled();
});

it("404 when the order does not exist; events are never read", async () => {
  vi.mocked(getOrderById).mockResolvedValue(null);
  const res = await GET(new NextRequest(url), params);
  expect(res.status).toBe(404);
  expect(vi.mocked(listRecentOrderEvents)).not.toHaveBeenCalled();
});

it("200 with rows projected to contract wire keys, served oldest first", async () => {
  // The bounded service read is NEWEST first (so the cap drops the oldest
  // events); the wire contract stays oldest first, so the route reverses.
  vi.mocked(listRecentOrderEvents).mockResolvedValue([
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
  ] as never);
  const res = await GET(new NextRequest(url), params);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { events: Record<string, unknown>[] };
  expect(vi.mocked(listRecentOrderEvents)).toHaveBeenCalledWith("ORD-1", 100);
  expect(body.events).toHaveLength(2);
  expect(body.events[0]).toEqual({
    id: "evt-1",
    type: "shipment_created",
    actorType: "admin",
    actorId: "user_2abc",
    fromStatus: "processing",
    toStatus: "shipped",
    actorLabel: null,
    details: {
      carrier: "ups",
      trackingNumber: "1Z",
      trackingUrl: "https://...",
    },
    createdAt: "2026-07-30T11:00:00.000Z",
  });
  expect(body.events[1].type).toBe("tracking_updated");
});

it("reads a default-bounded page of 100 when no limit is given", async () => {
  vi.mocked(listRecentOrderEvents).mockResolvedValue([]);
  await GET(new NextRequest(url), params);
  expect(vi.mocked(listRecentOrderEvents)).toHaveBeenCalledWith("ORD-1", 100);
});

it("honors a valid ?limit within the cap", async () => {
  vi.mocked(listRecentOrderEvents).mockResolvedValue([]);
  const res = await GET(new NextRequest(`${url}?limit=5`), params);
  expect(res.status).toBe(200);
  expect(vi.mocked(listRecentOrderEvents)).toHaveBeenCalledWith("ORD-1", 5);
});

it("caps ?limit at 500", async () => {
  vi.mocked(listRecentOrderEvents).mockResolvedValue([]);
  const res = await GET(new NextRequest(`${url}?limit=9999`), params);
  expect(res.status).toBe(200);
  expect(vi.mocked(listRecentOrderEvents)).toHaveBeenCalledWith("ORD-1", 500);
});

it.each(["abc", "0", "-3", "2.5", ""])(
  "rejects invalid ?limit=%s with 400 before reading events",
  async (bad) => {
    const res = await GET(new NextRequest(`${url}?limit=${bad}`), params);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("limit");
    expect(vi.mocked(listRecentOrderEvents)).not.toHaveBeenCalled();
  },
);

it("resolves an admin actor to their display name", async () => {
  adminLookup.mockResolvedValue([
    { userId: "user_2abc", email: "devon@justblackmagic.com", displayName: "Devon Hillard" },
  ]);
  vi.mocked(listRecentOrderEvents).mockResolvedValue([
    {
      id: "evt-1",
      event_type: "shipment_created",
      actor_type: "admin",
      actor_id: "user_2abc",
      details: null,
      created_at: "2026-07-30T11:00:00.000Z",
    },
  ] as never);
  const res = await GET(new NextRequest(url), params);
  const body = (await res.json()) as { events: Record<string, unknown>[] };
  expect(body.events[0].actorLabel).toBe("Devon Hillard");
});

it("falls back to the admin's email when no display name is set", async () => {
  adminLookup.mockResolvedValue([
    { userId: "user_2abc", email: "devon@justblackmagic.com", displayName: null },
  ]);
  vi.mocked(listRecentOrderEvents).mockResolvedValue([
    {
      id: "evt-1",
      event_type: "shipment_created",
      actor_type: "admin",
      actor_id: "user_2abc",
      details: null,
      created_at: "2026-07-30T11:00:00.000Z",
    },
  ] as never);
  const res = await GET(new NextRequest(url), params);
  const body = (await res.json()) as { events: Record<string, unknown>[] };
  expect(body.events[0].actorLabel).toBe("devon@justblackmagic.com");
});

it("still returns the audit history when the actor lookup fails", async () => {
  // A cosmetic label must never cost the operator their audit trail.
  adminLookup.mockRejectedValue(new Error("D1 unavailable"));
  vi.mocked(listRecentOrderEvents).mockResolvedValue([
    {
      id: "evt-1",
      event_type: "shipment_created",
      actor_type: "admin",
      actor_id: "user_2abc",
      details: null,
      created_at: "2026-07-30T11:00:00.000Z",
    },
  ] as never);
  const res = await GET(new NextRequest(url), params);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { events: Record<string, unknown>[] };
  expect(body.events).toHaveLength(1);
  expect(body.events[0].actorLabel).toBeNull();
});

it("does not query admin_users when no event has an admin actor", async () => {
  vi.mocked(listRecentOrderEvents).mockResolvedValue([
    {
      id: "evt-1",
      event_type: "shipping_email_sent",
      actor_type: "service",
      actor_id: "api-token",
      details: null,
      created_at: "2026-07-30T11:00:00.000Z",
    },
  ] as never);
  await GET(new NextRequest(url), params);
  expect(adminLookup).not.toHaveBeenCalled();
});

it("200 with an empty list for an order with no events", async () => {
  vi.mocked(listRecentOrderEvents).mockResolvedValue([]);
  const res = await GET(new NextRequest(url), params);
  expect(res.status).toBe(200);
  await expect(res.json()).resolves.toEqual({ events: [] });
});

it("an unhandled service throw returns a clean JSON 500, not an opaque error", async () => {
  vi.mocked(listRecentOrderEvents).mockRejectedValue(new Error("D1 unavailable"));
  const res = await GET(new NextRequest(url), params);
  expect(res.status).toBe(500);
  const body = (await res.json()) as { error: string };
  expect(body.error).toBeTruthy();
});
