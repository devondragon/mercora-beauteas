/**
 * Gift Card schema (application-specific)
 *
 * Stored-value gift cards. `balance` is the source of truth used for
 * redemption; every change to it is mirrored by an append-only row in
 * gift_card_transactions, giving a full audit ledger per card.
 */

import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';

export const gift_cards = sqliteTable(
  'gift_cards',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `GC-${nanoid(10).toUpperCase()}`),
    code: text('code').notNull().unique(),
    initial_balance: integer('initial_balance').notNull(), // cents
    balance: integer('balance').notNull(), // cents, remaining
    currency: text('currency').notNull().default('USD'),
    status: text('status', {
      enum: ['active', 'redeemed', 'disabled', 'expired'],
    })
      .notNull()
      .default('active'),
    purchaser_customer_id: text('purchaser_customer_id'),
    purchaser_email: text('purchaser_email'),
    recipient_email: text('recipient_email'),
    recipient_name: text('recipient_name'),
    gift_message: text('gift_message'),
    order_id: text('order_id'),
    order_line_id: text('order_line_id'),
    expires_at: text('expires_at'),
    delivered_at: text('delivered_at'),
    created_at: text('created_at').default(sql`CURRENT_TIMESTAMP`),
    updated_at: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    codeIdx: index('idx_gift_cards_code').on(table.code),
    statusIdx: index('idx_gift_cards_status').on(table.status),
    orderIdx: index('idx_gift_cards_order').on(table.order_id),
    recipientIdx: index('idx_gift_cards_recipient').on(table.recipient_email),
  })
);

export const gift_card_transactions = sqliteTable(
  'gift_card_transactions',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `GCT-${nanoid(10).toUpperCase()}`),
    gift_card_id: text('gift_card_id').notNull(),
    type: text('type', {
      enum: ['issue', 'redeem', 'refund', 'adjust'],
    }).notNull(),
    amount: integer('amount').notNull(), // cents, signed (negative for redeem)
    balance_after: integer('balance_after').notNull(), // cents
    order_id: text('order_id'),
    customer_id: text('customer_id'),
    note: text('note'),
    created_at: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    cardIdx: index('idx_gift_card_tx_card').on(table.gift_card_id),
    orderIdx: index('idx_gift_card_tx_order').on(table.order_id),
  })
);

export type GiftCardRow = typeof gift_cards.$inferSelect;
export type GiftCardInsert = typeof gift_cards.$inferInsert;
export type GiftCardTransactionRow = typeof gift_card_transactions.$inferSelect;
export type GiftCardTransactionInsert = typeof gift_card_transactions.$inferInsert;
