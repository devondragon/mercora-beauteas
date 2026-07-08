/**
 * Unit tests for the shared checkout order-payload + pending-order snapshot
 * (BMC-165). Covers the body shaping used by BOTH the inline card path and the
 * redirect path, and the PaymentIntent-keyed localStorage snapshot that makes
 * the redirect return safe under concurrent checkouts.
 *
 * jsdom (vitest.config.ts) provides a real localStorage.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  buildCreateOrderBody,
  savePendingOrder,
  loadPendingOrder,
  clearPendingOrder,
} from '@/lib/checkout/order-payload';
import type { CartItem } from '@/lib/types/cartitem';

const item = (over: Partial<CartItem> = {}): CartItem =>
  ({
    productId: 'tea-1',
    variantId: 'var-1',
    price: 2500, // integer minor units
    quantity: 2,
    name: 'Clearly Calendula Morning',
    ...over,
  }) as CartItem;

const baseArgs = (over: Record<string, any> = {}) => ({
  orderId: 'WEB-GUEST-1000',
  paymentIntentId: 'pi_abc',
  items: [item()],
  shippingAddress: { line1: '1 Tea Rd', recipient: 'Jane', email: 'j@x.com' } as any,
  shippingOption: { label: 'Standard', cost: 500 } as any,
  appliedGiftCard: undefined,
  totals: { subtotal: 5000, shippingCost: 500, tax: 100, giftCardApplied: 0, totalBeforeGiftCard: 5600 },
  ...over,
});

describe('buildCreateOrderBody', () => {
  it('shapes the order body in integer minor units', () => {
    const body = buildCreateOrderBody(baseArgs() as any);
    expect(body.order_id).toBe('WEB-GUEST-1000');
    expect(body.currency_code).toBe('USD');
    expect(body.shipping_method).toBe('Standard');
    expect(body.extensions.payment_intent_id).toBe('pi_abc');
    expect(body.extensions.subtotal).toBe(5000);
    expect(body.extensions.shipping_cost).toBe(500);
    expect(body.extensions.tax_amount).toBe(100);
    // total_amount is the PRE-gift-card value, minor units.
    expect(body.total_amount.amount).toBe(5600);
    expect(body.items).toHaveLength(1);
    expect(body.items[0].unit_price.amount).toBe(2500);
    expect(body.items[0].total_price.amount).toBe(5000); // price * quantity
    expect(body.extensions).not.toHaveProperty('gift_card');
  });

  it('includes gift-card tender only when a gift card is applied', () => {
    const body = buildCreateOrderBody(
      baseArgs({
        appliedGiftCard: { code: 'GC-1', balance: 10000 },
        totals: { subtotal: 5000, shippingCost: 500, tax: 100, giftCardApplied: 2000, totalBeforeGiftCard: 5600 },
      }) as any
    );
    expect(body.extensions.gift_card).toEqual({ code: 'GC-1', amount: 2000 });
  });
});

describe('pending-order snapshot (keyed by PaymentIntent id)', () => {
  beforeEach(() => localStorage.clear());

  it('round-trips a snapshot for its PaymentIntent id', () => {
    savePendingOrder(buildCreateOrderBody(baseArgs() as any));
    const loaded = loadPendingOrder('pi_abc');
    expect(loaded?.orderId).toBe('WEB-GUEST-1000');
    expect(loaded?.body.extensions.payment_intent_id).toBe('pi_abc');
  });

  it('isolates concurrent checkouts: never returns another PI’s snapshot', () => {
    savePendingOrder(buildCreateOrderBody(baseArgs({ paymentIntentId: 'pi_A', orderId: 'WEB-GUEST-1' }) as any));
    savePendingOrder(buildCreateOrderBody(baseArgs({ paymentIntentId: 'pi_B', orderId: 'WEB-GUEST-2' }) as any));
    expect(loadPendingOrder('pi_A')?.orderId).toBe('WEB-GUEST-1');
    expect(loadPendingOrder('pi_B')?.orderId).toBe('WEB-GUEST-2');
    expect(loadPendingOrder('pi_missing')).toBeNull();
  });

  it('clearPendingOrder removes only the targeted snapshot', () => {
    savePendingOrder(buildCreateOrderBody(baseArgs({ paymentIntentId: 'pi_A' }) as any));
    savePendingOrder(buildCreateOrderBody(baseArgs({ paymentIntentId: 'pi_B' }) as any));
    clearPendingOrder('pi_A');
    expect(loadPendingOrder('pi_A')).toBeNull();
    expect(loadPendingOrder('pi_B')).not.toBeNull();
  });

  it('prunes the oldest snapshots beyond the retention cap', () => {
    let t = 1_700_000_000_000; // realistic epoch ms so TTL logic stays sane
    const spy = vi.spyOn(Date, 'now').mockImplementation(() => (t += 1000));
    for (let i = 0; i < 12; i++) {
      savePendingOrder(buildCreateOrderBody(baseArgs({ paymentIntentId: `pi_${i}`, orderId: `WEB-GUEST-${i}` }) as any));
    }
    // Freeze "now" just after the last save (well within TTL) for the loads.
    spy.mockReturnValue(t);
    // 12 saved, cap 10 → the two oldest evicted, newest retained.
    expect(loadPendingOrder('pi_0')).toBeNull();
    expect(loadPendingOrder('pi_1')).toBeNull();
    expect(loadPendingOrder('pi_11')).not.toBeNull();
    spy.mockRestore();
  });

  it('expires and purges a snapshot past its TTL (bounds abandoned PII)', () => {
    const spy = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    savePendingOrder(buildCreateOrderBody(baseArgs({ paymentIntentId: 'pi_old' }) as any));
    // Advance past the 6h TTL.
    spy.mockReturnValue(1_000_000 + 7 * 60 * 60 * 1000);
    expect(loadPendingOrder('pi_old')).toBeNull();
    // Stale entry is removed, not merely hidden.
    expect(localStorage.getItem('beauteas.pendingOrder.pi_old')).toBeNull();
    spy.mockRestore();
  });
});
