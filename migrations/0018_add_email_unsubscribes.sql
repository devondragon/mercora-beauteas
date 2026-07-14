-- BMC-184: CAN-SPAM unsubscribe suppression list.
--
-- One row per (email, scope) that has opted out of a class of commercial email.
-- Presence of a matching row = opted out; the review-reminder sender checks
-- this before sending. `scope` is 'review_reminders' today (the only marketing
-- email); 'all' is reserved for a future global marketing opt-out.
CREATE TABLE IF NOT EXISTS email_unsubscribes (
  email      TEXT NOT NULL,
  scope      TEXT NOT NULL DEFAULT 'all',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (email, scope)
);

CREATE INDEX IF NOT EXISTS email_unsubscribes_email_idx ON email_unsubscribes (email);
