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
import { orderEvents, type OrderEventRow } from "@/lib/db/schema/order-events";
import { hydrateOrder } from "@/lib/models/mach/orders";
import type { Order } from "@/lib/types/order";
import {
  canEditTracking,
  decideShipment,
  type OrderFulfillmentSnapshot,
} from "./transitions";
import { buildTrackingUrl } from "./tracking";
import type { Actor, ShipmentInput } from "./types";

export type { OrderEventRow };

export type ShipOrderResult =
  | { outcome: "shipped"; order: Order; eventId: string } // fresh CAS win -> HTTP 201
  | { outcome: "already_shipped"; order: Order } // idempotent -> HTTP 200
  | { outcome: "not_found" } // -> 404
  | { outcome: "conflict"; order: Order } // -> 409 shipment_conflict
  | {
      outcome: "not_fulfillable";
      status: string;
      paymentStatus: string | null;
    }; // -> 409 not_fulfillable

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
  // design — it mirrors the spec's statement exactly and binds the json
  // `details` payload explicitly. Keep the WHERE clause on one line: the unit
  // tests assert the rendered text.
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
export async function listOrderEvents(
  orderId: string,
): Promise<OrderEventRow[]> {
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
  type:
    | "shipping_email_sent"
    | "shipping_email_failed"
    | "shipping_email_resent",
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
