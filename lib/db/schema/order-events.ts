// lib/db/schema/order-events.ts - Fulfillment audit log (BMC-216)

import { sqliteTable, text, index } from "drizzle-orm/sqlite-core";
import { orders } from "./order";

/**
 * Append-oriented fulfillment audit trail. One row per fulfillment action;
 * rows are never updated or deleted (except by the order's ON DELETE CASCADE).
 *
 * `details` is a JSON-mode column: pass RAW OBJECTS to Drizzle, never
 * pre-stringified JSON, or the value lands double-encoded.
 *
 * See migrations/0023_add_order_events.sql.
 */
export const orderEvents = sqliteTable(
  "order_events",
  {
    id: text("id").primaryKey(), // crypto.randomUUID()
    order_id: text("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    event_type: text("event_type").notNull(), // OrderEventType
    actor_type: text("actor_type").notNull(), // ActorType
    actor_id: text("actor_id"), // Clerk user ID / "api-token" / null
    from_status: text("from_status"),
    to_status: text("to_status"),
    details: text("details", { mode: "json" }),
    created_at: text("created_at").notNull(), // ISO 8601 with milliseconds
  },
  (t) => ({
    orderCreatedIdx: index("order_events_order_id_created_at_idx").on(t.order_id, t.created_at),
    eventTypeCreatedIdx: index("order_events_event_type_created_at_idx").on(
      t.event_type,
      t.created_at
    ),
  })
);

export type OrderEventRow = typeof orderEvents.$inferSelect;
