-- 0021_add_external_refund_restock_setting.sql (BMC-213)
--
-- Seeds the admin setting that decides whether a refund issued OUTSIDE the app
-- (Stripe Dashboard) also restores inventory when the `charge.refunded` webhook
-- reconciles it into the order's refund ledger.
--
-- Default TRUE = parity with an app-initiated refund, which always restocks.
-- Turn it off if Dashboard refunds are typically goodwill gestures where the
-- goods were never returned — restocking those would inflate on-hand above what
-- was actually sold. Only FULL external refunds ever restock; a partial one
-- carries no line attribution (Stripe refunds an amount, not items), so guessing
-- which lines came back would reintroduce the phantom-stock bug BMC-178 closed.
--
-- Data-only and idempotent: INSERT OR IGNORE leaves an operator's existing
-- choice untouched on re-run.

INSERT OR IGNORE INTO admin_settings (key, value, category, description, data_type)
VALUES (
  'refund.restock_on_external_refund',
  'true',
  'refund',
  'Restock inventory when a full refund is issued outside the app (e.g. Stripe Dashboard)',
  'boolean'
);
