/**
 * Regression tests for BMC-158 — hardening PUT /api/orders (follow-up to
 * BMC-140). Two adjacent integrity gaps in the ORDERS_UPDATE-gated PUT handler:
 *
 *  1. Order `status` was freely settable to 'refunded'/'cancelled', producing
 *     inconsistent state (order 'refunded' while payment_status stays 'paid',
 *     no Stripe refund) and emailing a false notice. Those statuses belong
 *     exclusively to POST /api/orders/refund. validatePutOrderStatus() rejects
 *     them (and unknown statuses) with a discriminated result.
 *
 *  2. A wholesale `extensions` overwrite via PUT could rebind (or drop)
 *     `extensions.payment_intent_id`, which the refund route trusts to locate
 *     the PaymentIntent it refunds — a refund-fraud/integrity concern.
 *     protectPaymentIntentId() pins the stored value and forbids introducing
 *     one where none existed, while passing other extensions keys through.
 *
 * Exercises the pure helpers directly (no DB / Cloudflare bindings).
 */
import { describe, it, expect } from 'vitest';
import {
  validatePutOrderStatus,
  protectPaymentIntentId,
  VALID_ORDER_STATUSES,
  REFUND_OWNED_STATUSES,
} from '@/lib/utils/order-update-guards';

describe('validatePutOrderStatus', () => {
  it('accepts fulfillment statuses', () => {
    for (const status of ['pending', 'processing', 'shipped', 'delivered']) {
      expect(validatePutOrderStatus(status)).toEqual({ ok: true });
    }
  });

  it('rejects "refunded" with 422 and points to the refund route', () => {
    const result = validatePutOrderStatus('refunded');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(422);
      expect(result.error).toMatch(/refund/i);
    }
  });

  it('rejects "cancelled" with 422', () => {
    const result = validatePutOrderStatus('cancelled');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(422);
    }
  });

  it('rejects every refund-owned status', () => {
    for (const status of REFUND_OWNED_STATUSES) {
      const result = validatePutOrderStatus(status);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.status).toBe(422);
    }
  });

  it('rejects an unknown status with 400', () => {
    const result = validatePutOrderStatus('paid');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.error).toMatch(/must be one of/i);
    }
  });

  it('rejects non-string input with 400', () => {
    for (const bad of [undefined, null, 42, {}, ['shipped']]) {
      const result = validatePutOrderStatus(bad);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.status).toBe(400);
    }
  });

  it('only accepts statuses that are NOT refund-owned', () => {
    const accepted = VALID_ORDER_STATUSES.filter(
      (s) => validatePutOrderStatus(s).ok
    );
    expect(accepted).toEqual(['pending', 'processing', 'shipped', 'delivered']);
    for (const owned of REFUND_OWNED_STATUSES) {
      expect(accepted).not.toContain(owned);
    }
  });
});

describe('protectPaymentIntentId', () => {
  it('restores the stored PI id when the client tries to rebind it', () => {
    const out = protectPaymentIntentId(
      { payment_intent_id: 'pi_attacker', carrier: 'UPS' },
      { payment_intent_id: 'pi_real_123' }
    );
    expect(out.payment_intent_id).toBe('pi_real_123');
    // Other extensions keys pass through untouched.
    expect(out.carrier).toBe('UPS');
  });

  it('restores the stored PI id when the client drops it via a wholesale overwrite', () => {
    const out = protectPaymentIntentId(
      { carrier: 'FedEx' },
      { payment_intent_id: 'pi_real_123', carrier: 'UPS' }
    );
    expect(out.payment_intent_id).toBe('pi_real_123');
    expect(out.carrier).toBe('FedEx');
  });

  it('leaves the stored PI id when the client sends the same value', () => {
    const out = protectPaymentIntentId(
      { payment_intent_id: 'pi_real_123' },
      { payment_intent_id: 'pi_real_123' }
    );
    expect(out.payment_intent_id).toBe('pi_real_123');
  });

  it('strips a client-introduced PI id when the order never had one', () => {
    const out = protectPaymentIntentId(
      { payment_intent_id: 'pi_injected', note: 'x' },
      null
    );
    expect(out).not.toHaveProperty('payment_intent_id');
    expect(out.note).toBe('x');
  });

  it('strips a client-introduced PI id when stored extensions has no PI id', () => {
    const out = protectPaymentIntentId(
      { payment_intent_id: 'pi_injected' },
      { carrier: 'UPS' }
    );
    expect(out).not.toHaveProperty('payment_intent_id');
    expect(out.carrier).toBeUndefined(); // only the client's keys survive
  });

  it('parses a stored extensions JSON string', () => {
    const out = protectPaymentIntentId(
      { payment_intent_id: 'pi_attacker' },
      JSON.stringify({ payment_intent_id: 'pi_real_123' })
    );
    expect(out.payment_intent_id).toBe('pi_real_123');
  });

  it('parses a client extensions JSON string', () => {
    const out = protectPaymentIntentId(
      JSON.stringify({ payment_intent_id: 'pi_attacker', carrier: 'DHL' }),
      { payment_intent_id: 'pi_real_123' }
    );
    expect(out.payment_intent_id).toBe('pi_real_123');
    expect(out.carrier).toBe('DHL');
  });

  it('handles empty/absent client extensions but still pins the stored PI id', () => {
    const out = protectPaymentIntentId(null, { payment_intent_id: 'pi_real_123' });
    expect(out.payment_intent_id).toBe('pi_real_123');
  });

  it('ignores an empty-string stored PI id (treated as absent) and strips the client value', () => {
    const out = protectPaymentIntentId(
      { payment_intent_id: 'pi_injected' },
      { payment_intent_id: '' }
    );
    expect(out).not.toHaveProperty('payment_intent_id');
  });
});
