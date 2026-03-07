/**
 * Redirect Map Schema
 *
 * Stores old Shopify URL -> new Mercora URL mappings for SEO redirects.
 * Read by middleware for dynamic 301 redirects.
 */

import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const redirect_map = sqliteTable('redirect_map', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  source_path: text('source_path').notNull().unique(),
  target_path: text('target_path').notNull(),
  status_code: integer('status_code').notNull().default(301),
  entity_type: text('entity_type'), // 'product', 'collection', 'page'
  created_at: text('created_at').default('CURRENT_TIMESTAMP'),
});

export type InsertRedirectMap = typeof redirect_map.$inferInsert;
export type SelectRedirectMap = typeof redirect_map.$inferSelect;
