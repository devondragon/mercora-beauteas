-- Migration: 0023_add_order_events
-- Date: 2026-07-30
-- Ticket: BMC-216A
--
-- Append-oriented fulfillment audit log. One row per fulfillment action:
-- shipment_created, tracking_updated, shipping_email_sent,
-- shipping_email_failed, shipping_email_resent.
--
-- Rows are written by the fulfillment service (BMC-216B/C) — the shipment
-- event is inserted in the same db.batch() as the guarded order UPDATE, via an
-- INSERT ... SELECT keyed on that request's exact shipped_at timestamp, so a
-- lost CAS cannot produce a false audit entry.
--
-- `details` holds JSON metadata (Drizzle json mode; per event type:
--   shipment_created   { carrier, trackingNumber, trackingUrl }
--   tracking_updated   { previous: {...}, next: {...} }
--   shipping_email_*   { idempotencyKey, error?, resendOfEventId? }
-- ). No status CHECK constraint on event_type: the vocabulary lives in
-- lib/fulfillment/types.ts and will grow (carrier webhooks, Rolo) without a
-- table rebuild, which SQLite makes expensive.
CREATE TABLE IF NOT EXISTS order_events (
  id          TEXT PRIMARY KEY NOT NULL,
  order_id    TEXT NOT NULL,
  event_type  TEXT NOT NULL,
  actor_type  TEXT NOT NULL,
  actor_id    TEXT,
  from_status TEXT,
  to_status   TEXT,
  details     TEXT,
  created_at  TEXT NOT NULL,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
);

-- Timeline read for one order (admin detail page), oldest first.
CREATE INDEX IF NOT EXISTS order_events_order_id_created_at_idx
  ON order_events (order_id, created_at);

-- Cross-order scans by kind (e.g. "which shipments failed to email?").
CREATE INDEX IF NOT EXISTS order_events_event_type_idx
  ON order_events (event_type);
