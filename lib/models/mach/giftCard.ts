/**
 * Gift Card Model — generate / balance / redeem
 *
 * Stored-value gift cards backed by an append-only ledger
 * (gift_card_transactions). The `balance` column on gift_cards is the source
 * of truth for redemption; it is only ever changed via a guarded conditional
 * UPDATE so the balance can never go negative, even under concurrent redeems.
 */

import { getDbAsync } from '@/lib/db';
import { gift_cards, gift_card_transactions } from '@/lib/db/schema/gift-card';
import type { GiftCardRow } from '@/lib/db/schema/gift-card';
import { eq, and, gte, desc } from 'drizzle-orm';
import { sql } from 'drizzle-orm';

// Unambiguous alphabet (no 0/O/1/I) for human-readable codes.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/**
 * Generate a formatted gift card code, e.g. `BEAU-7K3M-9PQR-T4WX`.
 */
export function generateGiftCardCode(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  const chars = Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]);
  const groups = [
    chars.slice(0, 4).join(''),
    chars.slice(4, 8).join(''),
    chars.slice(8, 12).join(''),
  ];
  return `BEAU-${groups.join('-')}`;
}

export interface CreateGiftCardInput {
  amount: number; // cents
  currency?: string;
  purchaserCustomerId?: string | null;
  purchaserEmail?: string | null;
  recipientEmail?: string | null;
  recipientName?: string | null;
  giftMessage?: string | null;
  orderId?: string | null;
  orderLineId?: string | null;
  expiresAt?: string | null;
}

/**
 * Issue a new gift card and record the opening `issue` ledger entry.
 * Retries on the (astronomically unlikely) event of a code collision.
 */
export async function createGiftCard(input: CreateGiftCardInput): Promise<GiftCardRow> {
  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    throw new Error('Gift card amount must be a positive integer (cents)');
  }

  const db = await getDbAsync();
  const currency = input.currency ?? 'USD';

  // Retry up to 5 times on a code-collision UNIQUE constraint only. Any other
  // error (including a failed ledger insert) propagates immediately — we never
  // silently swallow errors that could leave a card without its opening entry.
  // The card + ledger inserts are wrapped in a transaction so they are atomic:
  // if the ledger insert fails, the card row is rolled back too.
  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateGiftCardCode();
    try {
      const card = await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(gift_cards)
          .values({
            code,
            initial_balance: input.amount,
            balance: input.amount,
            currency,
            status: 'active',
            purchaser_customer_id: input.purchaserCustomerId ?? null,
            purchaser_email: input.purchaserEmail ?? null,
            recipient_email: input.recipientEmail ?? null,
            recipient_name: input.recipientName ?? null,
            gift_message: input.giftMessage ?? null,
            order_id: input.orderId ?? null,
            order_line_id: input.orderLineId ?? null,
            expires_at: input.expiresAt ?? null,
          })
          .returning();

        await tx.insert(gift_card_transactions).values({
          gift_card_id: row.id,
          type: 'issue',
          amount: input.amount,
          balance_after: input.amount,
          order_id: input.orderId ?? null,
          customer_id: input.purchaserCustomerId ?? null,
          note: 'Gift card issued',
        });

        return row;
      });

      return card;
    } catch (err) {
      // Only retry on a UNIQUE constraint collision on the `code` column.
      // All other errors are real failures — let them propagate.
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('UNIQUE') || msg.includes('unique')) {
        lastError = err;
        continue;
      }
      throw err;
    }
  }
  throw new Error(
    `Failed to create gift card after retries: ${
      lastError instanceof Error ? lastError.message : 'unknown error'
    }`
  );
}

export async function getGiftCardByCode(code: string): Promise<GiftCardRow | null> {
  const db = await getDbAsync();
  const [card] = await db
    .select()
    .from(gift_cards)
    .where(eq(gift_cards.code, normalizeCode(code)))
    .limit(1);
  return card ?? null;
}

export async function getGiftCardById(id: string): Promise<GiftCardRow | null> {
  const db = await getDbAsync();
  const [card] = await db.select().from(gift_cards).where(eq(gift_cards.id, id)).limit(1);
  return card ?? null;
}

/**
 * All gift cards issued for a given purchase order (issuance idempotency).
 */
export async function getGiftCardsByOrderId(orderId: string): Promise<GiftCardRow[]> {
  const db = await getDbAsync();
  return db.select().from(gift_cards).where(eq(gift_cards.order_id, orderId));
}

export async function getGiftCardTransactions(giftCardId: string) {
  const db = await getDbAsync();
  return db
    .select()
    .from(gift_card_transactions)
    .where(eq(gift_card_transactions.gift_card_id, giftCardId))
    .orderBy(desc(gift_card_transactions.created_at));
}

export interface GiftCardValidationResult {
  valid: boolean;
  reason?: string;
  id?: string;
  code?: string;
  balance?: number; // cents
  currency?: string;
}

/**
 * Read-only check used by the checkout redemption input. Reports the real
 * server-side balance — the client never gets to assert it.
 */
export async function validateGiftCardForRedemption(
  code: string
): Promise<GiftCardValidationResult> {
  const card = await getGiftCardByCode(code);
  if (!card) {
    return { valid: false, reason: 'Gift card not found' };
  }
  if (card.status === 'disabled') {
    return { valid: false, reason: 'This gift card has been disabled' };
  }
  if (card.status === 'redeemed' || card.balance <= 0) {
    return { valid: false, reason: 'This gift card has no remaining balance' };
  }
  if (card.expires_at && new Date(card.expires_at).getTime() < Date.now()) {
    return { valid: false, reason: 'This gift card has expired' };
  }
  return {
    valid: true,
    id: card.id,
    code: card.code,
    balance: card.balance,
    currency: card.currency,
  };
}

export interface RedeemGiftCardInput {
  code: string;
  amount: number; // cents requested to apply
  orderId?: string | null;
  customerId?: string | null;
}

export interface RedeemGiftCardResult {
  success: boolean;
  applied: number; // cents actually applied
  remaining: number; // cents balance after redemption
  giftCardId?: string;
  error?: string;
  alreadyRedeemed?: boolean;
}

/**
 * Atomically redeem up to `amount` cents from a gift card.
 *
 * Safety properties:
 * - The decrement uses a guarded UPDATE (`balance >= applied AND status = active`),
 *   so the balance can never go negative regardless of concurrent callers.
 * - Idempotent per (gift card, order): if a redeem entry already exists for the
 *   same order it is treated as already applied and not double-charged. This lets
 *   both the Stripe webhook and the order-creation path call it safely.
 */
export async function redeemGiftCard(input: RedeemGiftCardInput): Promise<RedeemGiftCardResult> {
  const { code, orderId = null, customerId = null } = input;
  const requested = Math.floor(input.amount);
  if (!Number.isFinite(requested) || requested <= 0) {
    return { success: false, applied: 0, remaining: 0, error: 'Invalid redemption amount' };
  }

  const db = await getDbAsync();

  const card = await getGiftCardByCode(code);
  if (!card) {
    return { success: false, applied: 0, remaining: 0, error: 'Gift card not found' };
  }

  // Idempotency: if we already redeemed against this order, don't do it again.
  if (orderId) {
    const [existing] = await db
      .select()
      .from(gift_card_transactions)
      .where(
        and(
          eq(gift_card_transactions.gift_card_id, card.id),
          eq(gift_card_transactions.order_id, orderId),
          eq(gift_card_transactions.type, 'redeem')
        )
      )
      .limit(1);
    if (existing) {
      const fresh = await getGiftCardById(card.id);
      return {
        success: true,
        applied: Math.abs(existing.amount),
        remaining: fresh?.balance ?? card.balance,
        giftCardId: card.id,
        alreadyRedeemed: true,
      };
    }
  }

  // Attempt the guarded decrement, retrying once if a concurrent redeem moved
  // the balance out from under us.
  for (let attempt = 0; attempt < 2; attempt++) {
    const current = attempt === 0 ? card : await getGiftCardById(card.id);
    if (!current || current.status === 'disabled') {
      return { success: false, applied: 0, remaining: 0, error: 'Gift card is not redeemable' };
    }
    if (current.balance <= 0) {
      return { success: false, applied: 0, remaining: 0, error: 'Gift card has no remaining balance' };
    }

    const applied = Math.min(requested, current.balance);
    const newBalance = current.balance - applied;

    const updated = await db
      .update(gift_cards)
      .set({
        balance: newBalance,
        status: newBalance <= 0 ? 'redeemed' : 'active',
        updated_at: sql`CURRENT_TIMESTAMP`,
      })
      .where(
        and(
          eq(gift_cards.id, current.id),
          eq(gift_cards.balance, current.balance), // optimistic guard
          eq(gift_cards.status, 'active')
        )
      )
      .returning();

    if (updated.length === 0) {
      continue; // lost the race — re-read and retry once
    }

    await db.insert(gift_card_transactions).values({
      gift_card_id: current.id,
      type: 'redeem',
      amount: -applied,
      balance_after: newBalance,
      order_id: orderId,
      customer_id: customerId,
      note: orderId ? `Redeemed against order ${orderId}` : 'Redeemed',
    });

    return {
      success: true,
      applied,
      remaining: newBalance,
      giftCardId: current.id,
    };
  }

  return {
    success: false,
    applied: 0,
    remaining: 0,
    error: 'Could not redeem gift card, please try again',
  };
}

/**
 * Record that the recipient delivery email has been sent.
 */
export async function markGiftCardDelivered(id: string): Promise<void> {
  const db = await getDbAsync();
  await db
    .update(gift_cards)
    .set({ delivered_at: sql`CURRENT_TIMESTAMP`, updated_at: sql`CURRENT_TIMESTAMP` })
    .where(eq(gift_cards.id, id));
}

/** Normalize user-entered codes (trim + uppercase). */
export function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}
