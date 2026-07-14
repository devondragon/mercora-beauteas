import { sqliteTable, text, index, primaryKey } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

/**
 * CAN-SPAM unsubscribe suppression list (BMC-184).
 *
 * A row means `email` has opted out of the given `scope` of commercial email.
 * `scope` is 'review_reminders' today (the only marketing email); 'all' is
 * reserved for a future global opt-out. See
 * migrations/0018_add_email_unsubscribes.sql.
 */
export const email_unsubscribes = sqliteTable(
  'email_unsubscribes',
  {
    email: text('email').notNull(),
    scope: text('scope').notNull().default('all'),
    created_at: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.email, table.scope] }),
    emailIdx: index('email_unsubscribes_email_idx').on(table.email),
  })
);

export type EmailUnsubscribeRow = typeof email_unsubscribes.$inferSelect;
