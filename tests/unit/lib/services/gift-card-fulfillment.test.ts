/**
 * Unit tests for gift-card issuance delivery, focused on the BMC-186 retry gap.
 *
 * The bug: issuance idempotency used to key on card EXISTENCE, so a card that
 * was minted (purchaser charged) but whose delivery email failed would be
 * skipped on every re-run — the recipient never got the code. Delivery is now
 * tracked by `delivered_at`, so a re-run re-drives the email when it is null and
 * leaves an already-delivered card untouched.
 *
 * The giftCard model + email seams are mocked; the fulfillment orchestration
 * (issuance loop, retry decision) is the real code under test.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/models/mach/giftCard', () => ({
  createGiftCard: vi.fn(),
  getGiftCardByCode: vi.fn().mockResolvedValue(null),
  getGiftCardsByOrderId: vi.fn(),
  redeemGiftCard: vi.fn(),
  // Single-flight delivery claim: default to winning the claim.
  claimGiftCardForDelivery: vi.fn().mockResolvedValue(true),
  releaseGiftCardDeliveryClaim: vi.fn().mockResolvedValue(undefined),
  normalizeCode: (c: string) => c.trim().toUpperCase(),
}));

vi.mock('@/lib/utils/email', () => ({
  sendGiftCardDeliveryEmail: vi.fn(),
}));

vi.mock('@/lib/seo/metadata', () => ({
  BASE_URL: 'https://beauteas.com',
}));

vi.mock('@/lib/services/order-pricing', () => ({
  AMOUNT_TOLERANCE_CENTS: 5,
}));

import {
  processGiftCardsForOrder,
  retryUndeliveredGiftCards,
} from '@/lib/services/gift-card-fulfillment';
import {
  createGiftCard,
  getGiftCardsByOrderId,
  claimGiftCardForDelivery,
  releaseGiftCardDeliveryClaim,
} from '@/lib/models/mach/giftCard';
import { sendGiftCardDeliveryEmail } from '@/lib/utils/email';

const ORDER_ID = 'ORD-1';
const LINE_ID = `${ORDER_ID}#0#0`;

// A single-line gift-card order for $25.00, fully paid in cash.
function giftCardOrder(): any {
  return {
    id: ORDER_ID,
    currency_code: 'USD',
    customer_id: 'CUST-1',
    total_amount: { amount: 2500, currency: 'USD' },
    shipping_address: { recipient: 'Pat Purchaser', email: 'pat@example.com' },
    extensions: { email: 'pat@example.com' },
    items: [
      {
        product_id: 'gift-card',
        quantity: 1,
        unit_price: { amount: 2500, currency: 'USD' },
        total_price: { amount: 2500, currency: 'USD' },
        gift_card: { recipientEmail: 'rita@example.com', recipientName: 'Rita', message: 'Enjoy!' },
      },
    ],
  };
}

// A persisted gift_cards row for the order's single line.
function existingCard(overrides: Record<string, unknown> = {}): any {
  return {
    id: 'GC-1',
    code: 'BEAU-7K3M-9PQR-T4WX',
    initial_balance: 2500,
    balance: 2500,
    currency: 'USD',
    status: 'active',
    recipient_email: 'rita@example.com',
    recipient_name: 'Rita',
    gift_message: 'Enjoy!',
    order_id: ORDER_ID,
    order_line_id: LINE_ID,
    delivered_at: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // clearAllMocks resets call history but NOT implementations, so restore the
  // per-test-mutable defaults (single-flight claim wins unless a test overrides).
  vi.mocked(claimGiftCardForDelivery).mockResolvedValue(true);
  vi.mocked(releaseGiftCardDeliveryClaim).mockResolvedValue(undefined);
});

describe('processGiftCardsForOrder — delivery retry (BMC-186)', () => {
  it('re-drives the delivery email for an existing card whose email never landed', async () => {
    vi.mocked(getGiftCardsByOrderId).mockResolvedValue([existingCard({ delivered_at: null })]);
    vi.mocked(sendGiftCardDeliveryEmail).mockResolvedValue({ success: true, id: 're-1' });

    const result = await processGiftCardsForOrder(giftCardOrder(), { paidAmountCents: 2500 });

    // Never re-mints an existing card...
    expect(createGiftCard).not.toHaveBeenCalled();
    expect(result.issued).toBe(0);
    // ...but does claim then re-send the delivery email on success.
    expect(claimGiftCardForDelivery).toHaveBeenCalledWith('GC-1');
    expect(sendGiftCardDeliveryEmail).toHaveBeenCalledTimes(1);
    expect(sendGiftCardDeliveryEmail).toHaveBeenCalledWith(
      expect.objectContaining({ recipientEmail: 'rita@example.com', code: 'BEAU-7K3M-9PQR-T4WX' })
    );
    expect(releaseGiftCardDeliveryClaim).not.toHaveBeenCalled();
    expect(result.errors).toEqual([]);
  });

  it('does NOT re-send when the existing card was already delivered', async () => {
    vi.mocked(getGiftCardsByOrderId).mockResolvedValue([
      existingCard({ delivered_at: '2026-07-01T00:00:00Z' }),
    ]);

    const result = await processGiftCardsForOrder(giftCardOrder(), { paidAmountCents: 2500 });

    expect(createGiftCard).not.toHaveBeenCalled();
    expect(claimGiftCardForDelivery).not.toHaveBeenCalled();
    expect(sendGiftCardDeliveryEmail).not.toHaveBeenCalled();
    expect(result.issued).toBe(0);
  });

  it('records an error and RELEASES the claim when the retry email fails again', async () => {
    vi.mocked(getGiftCardsByOrderId).mockResolvedValue([existingCard({ delivered_at: null })]);
    vi.mocked(sendGiftCardDeliveryEmail).mockResolvedValue({ success: false, error: 'smtp down' });

    const result = await processGiftCardsForOrder(giftCardOrder(), { paidAmountCents: 2500 });

    expect(sendGiftCardDeliveryEmail).toHaveBeenCalledTimes(1);
    // Claim released so the failed delivery is retried later, not stuck "delivered".
    expect(releaseGiftCardDeliveryClaim).toHaveBeenCalledWith('GC-1');
    expect(result.errors.some((e) => e.includes('delivery retry failed'))).toBe(true);
  });

  it('does NOT send a second email when another writer already won the claim (single-flight)', async () => {
    vi.mocked(getGiftCardsByOrderId).mockResolvedValue([existingCard({ delivered_at: null })]);
    // Another writer (the finalize winner) claimed delivery first.
    vi.mocked(claimGiftCardForDelivery).mockResolvedValue(false);

    const result = await processGiftCardsForOrder(giftCardOrder(), { paidAmountCents: 2500 });

    expect(claimGiftCardForDelivery).toHaveBeenCalledWith('GC-1');
    expect(sendGiftCardDeliveryEmail).not.toHaveBeenCalled();
    expect(releaseGiftCardDeliveryClaim).not.toHaveBeenCalled();
    expect(result.errors).toEqual([]);
  });

  it('mints + delivers a fresh card when none exists for the line', async () => {
    vi.mocked(getGiftCardsByOrderId).mockResolvedValue([]);
    vi.mocked(createGiftCard).mockResolvedValue(existingCard({ delivered_at: null }));
    vi.mocked(sendGiftCardDeliveryEmail).mockResolvedValue({ success: true, id: 'new-1' });

    const result = await processGiftCardsForOrder(giftCardOrder(), { paidAmountCents: 2500 });

    expect(createGiftCard).toHaveBeenCalledTimes(1);
    expect(result.issued).toBe(1);
    expect(claimGiftCardForDelivery).toHaveBeenCalledWith('GC-1');
    expect(sendGiftCardDeliveryEmail).toHaveBeenCalledTimes(1);
    expect(result.errors).toEqual([]);
  });

  it('emails the FACE value (initial_balance), not the live redeemable balance', async () => {
    // Card was minted for $25 but has since been partially redeemed to $5.
    vi.mocked(getGiftCardsByOrderId).mockResolvedValue([
      existingCard({ delivered_at: null, initial_balance: 2500, balance: 500 }),
    ]);
    vi.mocked(sendGiftCardDeliveryEmail).mockResolvedValue({ success: true, id: 're-2' });

    await processGiftCardsForOrder(giftCardOrder(), { paidAmountCents: 2500 });

    expect(sendGiftCardDeliveryEmail).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 2500 })
    );
  });
});

describe('retryUndeliveredGiftCards — reachable retry path (BMC-186)', () => {
  it('re-drives every undelivered card and skips delivered ones', async () => {
    vi.mocked(getGiftCardsByOrderId).mockResolvedValue([
      existingCard({ id: 'GC-1', delivered_at: null }),
      existingCard({ id: 'GC-2', delivered_at: '2026-07-01T00:00:00Z' }),
    ]);
    vi.mocked(sendGiftCardDeliveryEmail).mockResolvedValue({ success: true, id: 're-1' });

    const result = await retryUndeliveredGiftCards(giftCardOrder());

    expect(result.retried).toBe(1);
    expect(sendGiftCardDeliveryEmail).toHaveBeenCalledTimes(1);
    expect(claimGiftCardForDelivery).toHaveBeenCalledWith('GC-1');
    expect(claimGiftCardForDelivery).not.toHaveBeenCalledWith('GC-2');
    expect(result.errors).toEqual([]);
  });

  it('does not count a delivery another writer already claimed (single-flight)', async () => {
    vi.mocked(getGiftCardsByOrderId).mockResolvedValue([existingCard({ delivered_at: null })]);
    vi.mocked(claimGiftCardForDelivery).mockResolvedValue(false);

    const result = await retryUndeliveredGiftCards(giftCardOrder());

    expect(sendGiftCardDeliveryEmail).not.toHaveBeenCalled();
    expect(result.retried).toBe(0);
    expect(result.errors).toEqual([]);
  });

  it('needs no payment context and never mints or redeems', async () => {
    vi.mocked(getGiftCardsByOrderId).mockResolvedValue([existingCard({ delivered_at: null })]);
    vi.mocked(sendGiftCardDeliveryEmail).mockResolvedValue({ success: true, id: 're-1' });

    await retryUndeliveredGiftCards(giftCardOrder());

    expect(createGiftCard).not.toHaveBeenCalled();
  });

  it('is a no-op for an order with no gift-card lines', async () => {
    const plainOrder = { ...giftCardOrder(), items: [{ product_id: 'tea-1', quantity: 1 }] };

    const result = await retryUndeliveredGiftCards(plainOrder);

    expect(result.retried).toBe(0);
    expect(getGiftCardsByOrderId).not.toHaveBeenCalled();
  });
});
