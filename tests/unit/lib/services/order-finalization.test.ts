/**
 * Unit tests for finalizePaidOrder (BMC-167 + the moved BMC-131 charge gate).
 *
 * finalizePaidOrder is the single, shared "promote pending → paid" routine used
 * by BOTH writers that can finalize a storefront order — POST /api/orders (the
 * client fast-path) and the Stripe payment_intent.succeeded webhook. This test
 * pins the invariants that used to live split across the two route tests:
 *
 *  - BMC-131 charge gate: the captured cash must cover the CATALOG value of the
 *    goods, or the order is NOT promoted (permanent underpayment → { paid:false }).
 *  - H2: a THROW while pricing the catalog is TRANSIENT and must PROPAGATE (the
 *    callers turn it into a fail-closed-pending / Stripe-retry).
 *  - BMC-167 convergence: promotion is a guarded CAS (promoteOrderToPaid). Only
 *    the CAS WINNER runs the one-time side effects (gift-card fulfillment,
 *    confirmation email); a caller that LOSES the CAS (another writer already
 *    promoted) is an idempotent no-op — this is what makes client-first,
 *    webhook-first, and double-delivery all converge on ONE paid order.
 *  - H1: gift-card tender counted by the charge gate but not actually redeemed
 *    reverts the just-promoted order back to pending.
 *  - M4: a genuinely-captured but catalog-unpriceable order is flagged for review.
 *
 * order-pricing is left REAL (the charge gate itself is under test); the catalog,
 * gift-card, orders-model, gift-card-fulfillment and email seams are mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/models/mach/orders', () => ({
  promoteOrderToPaid: vi.fn(),
  markOrderUnpaid: vi.fn().mockResolvedValue({ id: 'WEB-GUEST-1' }),
  updateOrderNotes: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/services/gift-card-fulfillment', () => ({
  processGiftCardsForOrder: vi.fn().mockResolvedValue({ issued: 0, redeemed: 0, redeemedAmount: 0, errors: [] }),
  // BMC-186: the CAS-loser branch re-drives undelivered gift-card emails.
  retryUndeliveredGiftCards: vi.fn().mockResolvedValue({ retried: 0, errors: [] }),
}));

vi.mock('@/lib/services/order-confirmation', () => ({
  sendOrderConfirmationForOrder: vi.fn().mockResolvedValue(undefined),
}));

// BMC-178: the shared finalizer now decrements inventory on a CAS win. Mock the
// seam (it calls getDbAsync → getCloudflareContext, which is unavailable in the
// unit env) so this stays a pure unit test AND the decrement path is actually
// exercised/asserted rather than silently throwing into finalization's catch.
vi.mock('@/lib/services/inventory-adjustment', () => ({
  decrementStockForOrder: vi.fn().mockResolvedValue({ decremented: [], oversold: [] }),
  flagOversoldForReview: vi.fn().mockResolvedValue(undefined),
}));

// Catalog + gift-card seams the REAL order-pricing reads through.
vi.mock('@/lib/models/mach/products', () => ({
  getProduct: vi.fn(),
  getProductVariant: vi.fn(),
}));
vi.mock('@/lib/models/mach/giftCard', () => ({
  getGiftCardByCode: vi.fn(),
}));

// Coupon/promotion seams the REAL resolveCartDiscountCents reads through. Default
// to "not found" so a discounted order's coupon resolves to 0 — modelling a
// promotion that changed state between charge and finalization (BMC-177 review).
vi.mock('@/lib/models/mach/couponInstance', () => ({
  getCouponInstanceByCode: vi.fn().mockResolvedValue(null),
  validateCouponInstance: vi.fn(),
  // BMC-197: finalization redeems each applied cart-discount code on the CAS win.
  redeemCoupon: vi.fn().mockResolvedValue({ redeemed: true, usageCount: 1, status: 'used' }),
}));
vi.mock('@/lib/models/mach/promotions', () => ({
  getPromotionById: vi.fn().mockResolvedValue(null),
  checkTimeValidity: vi.fn(),
}));

import { finalizePaidOrder } from '@/lib/services/order-finalization';
import { promoteOrderToPaid, markOrderUnpaid, updateOrderNotes } from '@/lib/models/mach/orders';
import {
  processGiftCardsForOrder,
  retryUndeliveredGiftCards,
} from '@/lib/services/gift-card-fulfillment';
import { sendOrderConfirmationForOrder } from '@/lib/services/order-confirmation';
import { getProductVariant, getProduct } from '@/lib/models/mach/products';
import { getGiftCardByCode } from '@/lib/models/mach/giftCard';
import { decrementStockForOrder, flagOversoldForReview } from '@/lib/services/inventory-adjustment';
import { redeemCoupon, getCouponInstanceByCode, validateCouponInstance } from '@/lib/models/mach/couponInstance';
import { getPromotionById, checkTimeValidity } from '@/lib/models/mach/promotions';

const VARIANT_TEA = { id: 'var-tea-1', product_id: 'tea-1', price: { amount: 2500, currency: 'USD' } };

function order(overrides: Record<string, any> = {}): any {
  return {
    id: 'WEB-GUEST-1',
    status: 'pending',
    payment_status: 'pending',
    currency_code: 'USD',
    total_amount: { amount: 2500, currency: 'USD' },
    items: [{ product_id: 'tea-1', variant_id: 'var-tea-1', quantity: 1 }],
    extensions: null,
    ...overrides,
  };
}

/** promoteOrderToPaid mock helper: model a CAS win (row flipped) or loss. */
function casWin(promotedOrder: any) {
  return { promoted: true, order: { ...promotedOrder, status: 'processing', payment_status: 'paid' } };
}
function casLoseAlreadyPaid(o: any) {
  return { promoted: false, order: { ...o, status: 'processing', payment_status: 'paid' } };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getProductVariant).mockImplementation(async (id: string) =>
    id === VARIANT_TEA.id ? (VARIANT_TEA as any) : null
  );
  vi.mocked(getProduct).mockResolvedValue(null as any);
  vi.mocked(getGiftCardByCode).mockResolvedValue(null as any);
  vi.mocked(processGiftCardsForOrder).mockResolvedValue({ issued: 0, redeemed: 0, redeemedAmount: 0, errors: [] });
  vi.mocked(decrementStockForOrder).mockResolvedValue({ decremented: [], oversold: [] });
  vi.mocked(flagOversoldForReview).mockResolvedValue(undefined);
  vi.mocked(redeemCoupon).mockResolvedValue({ redeemed: true, usageCount: 1, status: 'used' });
});

describe('finalizePaidOrder', () => {
  it('BMC-131: underpayment does NOT promote and reports a reason (permanent)', async () => {
    const res = await finalizePaidOrder({ order: order(), paidAmountCents: 50, sendEmail: true });
    expect(res.paid).toBe(false);
    expect(res.reason).toBeTruthy();
    expect(vi.mocked(promoteOrderToPaid)).not.toHaveBeenCalled();
    expect(vi.mocked(processGiftCardsForOrder)).not.toHaveBeenCalled();
    expect(vi.mocked(sendOrderConfirmationForOrder)).not.toHaveBeenCalled();
  });

  it('H2: a transient catalog error PROPAGATES (caller decides retry / fail-closed)', async () => {
    vi.mocked(getProductVariant).mockRejectedValue(new Error('D1 unavailable'));
    await expect(finalizePaidOrder({ order: order(), paidAmountCents: 2999, sendEmail: true })).rejects.toThrow(
      'D1 unavailable'
    );
    expect(vi.mocked(promoteOrderToPaid)).not.toHaveBeenCalled();
  });

  it('CAS WIN: sufficient capture promotes, fulfils gift cards, and emails ONCE', async () => {
    vi.mocked(promoteOrderToPaid).mockResolvedValue(casWin(order()) as any);
    const res = await finalizePaidOrder({ order: order(), paidAmountCents: 2999, sendEmail: true });
    expect(res).toMatchObject({ paid: true, promotedByUs: true });
    expect(vi.mocked(promoteOrderToPaid)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(processGiftCardsForOrder)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendOrderConfirmationForOrder)).toHaveBeenCalledTimes(1);
    // BMC-178: the CAS winner decrements inventory exactly once, with the order's lines.
    expect(vi.mocked(decrementStockForOrder)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(decrementStockForOrder).mock.calls[0][0]).toEqual(order().items);
  });

  it('BMC-178: an oversold line (race at capture) flags the order for review but stays paid + emails', async () => {
    vi.mocked(promoteOrderToPaid).mockResolvedValue(casWin(order()) as any);
    const oversold = [
      { variant_id: 'var-tea-1', product_id: 'tea-1', product_name: 'Calendula Tea', requested: 2, available: 1 },
    ];
    vi.mocked(decrementStockForOrder).mockResolvedValue({ decremented: [], oversold });
    const res = await finalizePaidOrder({ order: order(), paidAmountCents: 2999, sendEmail: true });
    // Money is captured — the order stays paid and still emails; the shortfall is
    // handed to flagOversoldForReview (which appends the NEEDS REVIEW note).
    expect(res).toMatchObject({ paid: true, promotedByUs: true });
    expect(vi.mocked(flagOversoldForReview)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(flagOversoldForReview).mock.calls[0][0]).toMatchObject({ orderId: 'WEB-GUEST-1', oversold });
    expect(vi.mocked(sendOrderConfirmationForOrder)).toHaveBeenCalledTimes(1);
  });

  it('BMC-167 convergence: LOSING the CAS (already promoted) runs NO one-time side effects, still reports paid', async () => {
    // Another writer (client POST or a prior webhook delivery) already flipped
    // the row → our conditional UPDATE matches 0 rows. We must NOT re-fulfil
    // (mint/redeem) or re-email the confirmation, but the order IS paid, so
    // report success.
    vi.mocked(promoteOrderToPaid).mockResolvedValue(casLoseAlreadyPaid(order()) as any);
    const res = await finalizePaidOrder({ order: order(), paidAmountCents: 2999, sendEmail: true });
    expect(res).toMatchObject({ paid: true, promotedByUs: false });
    expect(vi.mocked(processGiftCardsForOrder)).not.toHaveBeenCalled();
    expect(vi.mocked(sendOrderConfirmationForOrder)).not.toHaveBeenCalled();
  });

  it('BMC-186: the CAS loser re-drives undelivered gift-card deliveries (reachable retry)', async () => {
    // The loser owns the one reliably-reached "re-run": it re-drives any
    // gift-card delivery email the winner failed to send (idempotent, keyed on
    // delivered_at), without re-minting/redeeming or re-sending the order email.
    vi.mocked(promoteOrderToPaid).mockResolvedValue(casLoseAlreadyPaid(order()) as any);
    const res = await finalizePaidOrder({ order: order(), paidAmountCents: 2999, sendEmail: true });
    expect(res).toMatchObject({ paid: true, promotedByUs: false });
    expect(vi.mocked(retryUndeliveredGiftCards)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(processGiftCardsForOrder)).not.toHaveBeenCalled();
    expect(vi.mocked(sendOrderConfirmationForOrder)).not.toHaveBeenCalled();
  });

  it('H1: gift-card tender counted but not redeemed reverts to pending and skips the email', async () => {
    const gcOrder = order({ extensions: { gift_card: { code: 'GC-1', amount: 2500 } } });
    vi.mocked(getGiftCardByCode).mockResolvedValue({ code: 'GC-1', status: 'active', balance: 2500 } as any);
    vi.mocked(promoteOrderToPaid).mockResolvedValue(casWin(gcOrder) as any);
    // Redemption applies nothing (lost balance race).
    vi.mocked(processGiftCardsForOrder).mockResolvedValue({ issued: 0, redeemed: 0, redeemedAmount: 0, errors: ['insufficient balance'] });

    const res = await finalizePaidOrder({ order: gcOrder, paidAmountCents: 0, sendEmail: true });
    expect(res).toMatchObject({ paid: false, reverted: true, promotedByUs: true });
    expect(vi.mocked(markOrderUnpaid)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(markOrderUnpaid).mock.calls[0][0]).toBe('WEB-GUEST-1');
    expect(vi.mocked(sendOrderConfirmationForOrder)).not.toHaveBeenCalled();
  });

  it('H1 revert FAILURE: markOrderUnpaid throws → finalization does NOT throw, returns a review-flagged reason', async () => {
    // The order is already CAS-promoted to paid; the tender didn't redeem AND the
    // revert write fails. Finalization must NOT throw (that would 500 the webhook
    // into an infinite retry / error the client) — it surfaces a manual-review
    // reason the caller records instead.
    const gcOrder = order({ extensions: { gift_card: { code: 'GC-1', amount: 2500 } } });
    vi.mocked(getGiftCardByCode).mockResolvedValue({ code: 'GC-1', status: 'active', balance: 2500 } as any);
    vi.mocked(promoteOrderToPaid).mockResolvedValue(casWin(gcOrder) as any);
    vi.mocked(processGiftCardsForOrder).mockResolvedValue({ issued: 0, redeemed: 0, redeemedAmount: 0, errors: ['insufficient balance'] });
    vi.mocked(markOrderUnpaid).mockRejectedValue(new Error('D1 unavailable'));

    const res = await finalizePaidOrder({ order: gcOrder, paidAmountCents: 0, sendEmail: true });
    expect(res.paid).toBe(false);
    expect(res.reverted).toBe(false); // the revert did NOT succeed
    expect(res.reason).toMatch(/MANUAL REVIEW REQUIRED/);
    expect(vi.mocked(sendOrderConfirmationForOrder)).not.toHaveBeenCalled();
  });

  it('M4: a captured but catalog-unpriceable order is flagged for manual review', async () => {
    // Unknown variant → the catalog cannot price the goods.
    const res = await finalizePaidOrder({
      order: order({ items: [{ product_id: 'tea-1', variant_id: 'ghost', quantity: 1 }] }),
      paidAmountCents: 2999,
      sendEmail: true,
    });
    expect(res.paid).toBe(false);
    expect(vi.mocked(promoteOrderToPaid)).not.toHaveBeenCalled();
    expect(vi.mocked(updateOrderNotes)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(updateOrderNotes).mock.calls[0][1]).toMatch(/NEEDS REVIEW/);
  });

  it('BMC-177: a captured DISCOUNTED order whose coupon dropped is flagged for review, not silently stuck', async () => {
    // The coupon/promotion changed state (paused / window elapsed) between charge
    // and finalization → resolveCartDiscountCents recomputes 0 (coupon not found),
    // so the correctly-discounted capture ($18.75 of $25 goods) now reads as
    // underpaying. The customer paid what they were quoted, so this must be flagged
    // for manual review rather than left silently pending with money captured.
    const discountedOrder = order({ extensions: { discount_codes: ['SAVE25'] } });
    const res = await finalizePaidOrder({ order: discountedOrder, paidAmountCents: 1875, sendEmail: true });
    expect(res.paid).toBe(false);
    expect(vi.mocked(promoteOrderToPaid)).not.toHaveBeenCalled();
    expect(vi.mocked(updateOrderNotes)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(updateOrderNotes).mock.calls[0][1]).toMatch(/NEEDS REVIEW/);
  });

  it('BMC-201 THE EXPLOIT: a capture that omits the persisted tax/shipping does NOT promote', async () => {
    // The pending order was stamped (at PI creation) with server-computed
    // expected shipping ($9.99) + tax ($2.00). A client that paid only the goods
    // ($25.00) — bypassing /api/tax, or resubmitting amount with taxAmount:0 —
    // must NOT be promoted: floor = 2500 + 999 + 200 = 3699c > 2500c captured.
    const taxedOrder = order({ extensions: { expected_shipping_cents: 999, expected_tax_cents: 200 } });
    const res = await finalizePaidOrder({ order: taxedOrder, paidAmountCents: 2500, sendEmail: true });
    expect(res.paid).toBe(false);
    expect(res.reason).toMatch(/shipping 999c, tax 200c/);
    expect(vi.mocked(promoteOrderToPaid)).not.toHaveBeenCalled();
    expect(vi.mocked(sendOrderConfirmationForOrder)).not.toHaveBeenCalled();
  });

  it('BMC-201: a capture covering goods + persisted shipping + tax IS promoted', async () => {
    // Honest checkout: captured $36.99 covers goods $25 + shipping $9.99 + tax
    // $2.00 (the persisted figures). The floor clears and the order promotes.
    const taxedOrder = order({ extensions: { expected_shipping_cents: 999, expected_tax_cents: 200 } });
    vi.mocked(promoteOrderToPaid).mockResolvedValue(casWin(taxedOrder) as any);
    const res = await finalizePaidOrder({ order: taxedOrder, paidAmountCents: 3699, sendEmail: true });
    expect(res).toMatchObject({ paid: true, promotedByUs: true });
    expect(vi.mocked(promoteOrderToPaid)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendOrderConfirmationForOrder)).toHaveBeenCalledTimes(1);
  });

  it('BMC-201: a malformed persisted expected_tax_cents falls back to the goods-only floor (never NaN-passes)', async () => {
    // A non-numeric persisted value must coerce to 0, not NaN (NaN comparisons are
    // always false → would silently pass every floor). Here goods $25 with a junk
    // tax field → floor is goods-only ($25), so a $29.99 capture promotes.
    const junkOrder = order({ extensions: { expected_tax_cents: 'lots', expected_shipping_cents: null } });
    vi.mocked(promoteOrderToPaid).mockResolvedValue(casWin(junkOrder) as any);
    const res = await finalizePaidOrder({ order: junkOrder, paidAmountCents: 2999, sendEmail: true });
    expect(res).toMatchObject({ paid: true, promotedByUs: true });
  });

  it('does not email when sendEmail is false, even on a CAS win', async () => {
    vi.mocked(promoteOrderToPaid).mockResolvedValue(casWin(order()) as any);
    const res = await finalizePaidOrder({ order: order(), paidAmountCents: 2999, sendEmail: false });
    expect(res.promotedByUs).toBe(true);
    expect(vi.mocked(sendOrderConfirmationForOrder)).not.toHaveBeenCalled();
  });

  // ── BMC-197: coupon redemption at finalization ────────────────────────────
  describe('BMC-197 coupon redemption', () => {
    // A discounted order carrying two applied cart-discount codes. Priced so the
    // capture clears the (goods-only) floor and the order promotes.
    const codedOrder = () => order({ extensions: { discount_codes: ['SAVE25', 'WELCOME15'] }, customer_id: 'cust-9' });

    it('redeems each applied code exactly once on the CAS win, keyed to the order', async () => {
      vi.mocked(promoteOrderToPaid).mockResolvedValue(casWin(codedOrder()) as any);
      const res = await finalizePaidOrder({ order: codedOrder(), paidAmountCents: 2999, sendEmail: true });
      expect(res).toMatchObject({ paid: true, promotedByUs: true });
      expect(vi.mocked(redeemCoupon)).toHaveBeenCalledTimes(2);
      expect(vi.mocked(redeemCoupon).mock.calls[0][0]).toBe('SAVE25');
      expect(vi.mocked(redeemCoupon).mock.calls[1][0]).toBe('WELCOME15');
      // Order-keyed + customer carried through for the audit record.
      expect(vi.mocked(redeemCoupon).mock.calls[0][1]).toMatchObject({ orderId: 'WEB-GUEST-1', customerId: 'cust-9' });
    });

    it('attributes the recomputed discount to the usage record when a single code was applied', async () => {
      // One code + a resolvable coupon → the floor recomputes the discount, which
      // is attributed to that code's audit record as MACH money.
      const oneCode = order({ extensions: { discount_codes: ['SAVE25'] } });
      vi.mocked(promoteOrderToPaid).mockResolvedValue(casWin(oneCode) as any);
      // Make the real charge gate resolve a 25%-off cart coupon so discountCents > 0.
      vi.mocked(getCouponInstanceByCode).mockResolvedValue({ id: 'ci', code: 'SAVE25', promotion_id: 'p25', status: 'active' } as any);
      vi.mocked(validateCouponInstance).mockReturnValue({ isValid: true, canBeUsed: true, errors: [], warnings: [] } as any);
      vi.mocked(getPromotionById).mockResolvedValue({ id: 'p25', type: 'cart', status: 'active', rules: { actions: [{ type: 'percentage_discount', value: 25 }] } } as any);
      vi.mocked(checkTimeValidity).mockReturnValue(true as any);

      await finalizePaidOrder({ order: oneCode, paidAmountCents: 2999, sendEmail: true });
      expect(vi.mocked(redeemCoupon)).toHaveBeenCalledTimes(1);
      // 25% of $25.00 goods = $6.25 → MACH money.
      expect(vi.mocked(redeemCoupon).mock.calls[0][1]).toMatchObject({
        discountAmount: { amount: 6.25, currency: 'USD' },
      });
    });

    it('omits discount_amount when multiple codes are applied (avoids misattributing the total)', async () => {
      // No resolvable coupon needed — with 2 codes, discount_amount is omitted
      // regardless of the recomputed total.
      vi.mocked(getCouponInstanceByCode).mockResolvedValue(null as any);
      const twoCodes = order({ extensions: { discount_codes: ['SAVE25', 'TENOFF'] } });
      vi.mocked(promoteOrderToPaid).mockResolvedValue(casWin(twoCodes) as any);
      await finalizePaidOrder({ order: twoCodes, paidAmountCents: 2999, sendEmail: true });
      expect(vi.mocked(redeemCoupon).mock.calls[0][1]).toMatchObject({ discountAmount: undefined });
      expect(vi.mocked(redeemCoupon).mock.calls[1][1]).toMatchObject({ discountAmount: undefined });
    });

    it('does NOT redeem when the order carries no discount codes', async () => {
      vi.mocked(promoteOrderToPaid).mockResolvedValue(casWin(order()) as any);
      await finalizePaidOrder({ order: order(), paidAmountCents: 2999, sendEmail: true });
      expect(vi.mocked(redeemCoupon)).not.toHaveBeenCalled();
    });

    it('does NOT redeem when this writer LOSES the CAS (another writer owns the side effects)', async () => {
      vi.mocked(promoteOrderToPaid).mockResolvedValue(casLoseAlreadyPaid(codedOrder()) as any);
      await finalizePaidOrder({ order: codedOrder(), paidAmountCents: 2999, sendEmail: true });
      expect(vi.mocked(redeemCoupon)).not.toHaveBeenCalled();
    });

    it('does NOT redeem when a gift-card tender revert bounces the order back to pending (H1)', async () => {
      // The order is CAS-promoted but reverts (tender counted, not redeemed). The
      // redemption block sits AFTER the H1 return, so a reverted order never
      // redeems its codes.
      const gcCoded = order({
        extensions: { gift_card: { code: 'GC-1', amount: 2500 }, discount_codes: ['SAVE25'] },
      });
      vi.mocked(getGiftCardByCode).mockResolvedValue({ code: 'GC-1', status: 'active', balance: 2500 } as any);
      vi.mocked(promoteOrderToPaid).mockResolvedValue(casWin(gcCoded) as any);
      vi.mocked(processGiftCardsForOrder).mockResolvedValue({ issued: 0, redeemed: 0, redeemedAmount: 0, errors: ['insufficient balance'] });
      // The revert write succeeds here (clearAllMocks doesn't restore the factory
      // impl a prior test may have set to reject).
      vi.mocked(markOrderUnpaid).mockResolvedValue({ id: 'WEB-GUEST-1' } as any);
      const res = await finalizePaidOrder({ order: gcCoded, paidAmountCents: 0, sendEmail: true });
      expect(res).toMatchObject({ paid: false, reverted: true });
      expect(vi.mocked(redeemCoupon)).not.toHaveBeenCalled();
    });

    it('is best-effort: a redemption throw never breaks finalization (payment already captured)', async () => {
      vi.mocked(promoteOrderToPaid).mockResolvedValue(casWin(codedOrder()) as any);
      vi.mocked(redeemCoupon).mockRejectedValue(new Error('D1 unavailable'));
      const res = await finalizePaidOrder({ order: codedOrder(), paidAmountCents: 2999, sendEmail: true });
      // Still promoted + emailed despite the redemption failure.
      expect(res).toMatchObject({ paid: true, promotedByUs: true });
      expect(vi.mocked(sendOrderConfirmationForOrder)).toHaveBeenCalledTimes(1);
    });
  });
});
