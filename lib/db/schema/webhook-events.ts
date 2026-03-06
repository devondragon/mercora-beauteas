import { sqliteTable, text, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const processed_webhook_events = sqliteTable(
  'processed_webhook_events',
  {
    event_id: text('event_id').primaryKey(),
    event_type: text('event_type').notNull(),
    processed_at: text('processed_at').default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    processedAtIdx: index('idx_processed_events_processed_at').on(table.processed_at),
  })
);

export type ProcessedWebhookEventRow = typeof processed_webhook_events.$inferSelect;
export type ProcessedWebhookEventInsert = typeof processed_webhook_events.$inferInsert;
