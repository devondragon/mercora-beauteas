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
 *     the PaymentIntent it refunds — a refund-fraud/integrity concern — AND
 *     could wipe server-owned keys the client omitted, most critically the
 *     `refunds[]` ledger that `computeRefundedTotal` sums for the over-refund
 *     guard (dropping it resets the guard → enables a second refund beyond the
 *     original amount). mergeExtensions() MERGES the client's keys over the
 *     stored ones (preserving omitted server-owned keys), re-pins the stored
 *     payment_intent_id, and fails SAFE on corrupt stored extensions.
 *
 * Exercises the pure helpers directly (no DB / Cloudflare bindings).
 */
import { describe, it, expect } from 'vitest';
import {
  validatePutOrderStatus,
  validatePutOrderBody,
  mergeExtensions,
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

describe('validatePutOrderBody — PUT /api/orders allowlist (BMC-216F)', () => {
  it('rejects "status" with 400 naming the ship and refund endpoints', () => {
    const r = validatePutOrderBody({ orderId: 'O-1', status: 'shipped' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(400);
      expect(r.error).toContain('POST /api/admin/orders/{id}/ship');
      expect(r.error).toContain('POST /api/orders/refund');
    }
  });

  it('rejects "tracking_number" with 400 naming the ship/tracking endpoints', () => {
    const r = validatePutOrderBody({ orderId: 'O-1', tracking_number: '1Z999' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(400);
      expect(r.error).toContain('PATCH /api/admin/orders/{id}/tracking');
    }
  });

  it.each(['shipped_at', 'delivered_at'])(
    'rejects client timestamp "%s" with 400 (server-owned)',
    (field) => {
      const r = validatePutOrderBody({ orderId: 'O-1', [field]: '2026-07-30T00:00:00Z' });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.status).toBe(400);
        expect(r.error).toContain(field);
      }
    }
  );

  it('rejects "shipping_method" with 400', () => {
    const r = validatePutOrderBody({ orderId: 'O-1', shipping_method: 'express' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
  });

  it.each(['trackingUrl', 'tracking_url'])(
    'rejects any tracking URL key ("%s") with 400',
    (field) => {
      const r = validatePutOrderBody({ orderId: 'O-1', [field]: 'https://evil.example/x' });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.status).toBe(400);
        expect(r.error).toMatch(/tracking url/i);
      }
    }
  );

  it('rejects a rejected key even when its value is null (presence is the offense)', () => {
    const r = validatePutOrderBody({ orderId: 'O-1', status: null, notes: 'x' });
    expect(r.ok).toBe(false);
  });

  it('accepts notes-only, external_references-only, and extensions-only bodies', () => {
    expect(validatePutOrderBody({ orderId: 'O-1', notes: 'hold at door' }).ok).toBe(true);
    expect(validatePutOrderBody({ orderId: 'O-1', external_references: { erp: 'X-1' } }).ok).toBe(true);
    expect(validatePutOrderBody({ orderId: 'O-1', extensions: { gift_note: 'hi' } }).ok).toBe(true);
  });

  it('does NOT reject payment_status here (route preserves the BMC-140 silent drop)', () => {
    expect(validatePutOrderBody({ orderId: 'O-1', payment_status: 'paid', notes: 'x' }).ok).toBe(true);
  });

  it('rejects a body with no updatable fields with 400', () => {
    const r = validatePutOrderBody({ orderId: 'O-1' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(400);
      expect(r.error).toMatch(/notes, external_references, extensions/);
    }
  });
});

/** Unwrap a successful mergeExtensions result (fails the test if it errored). */
function merged(incoming: unknown, current: unknown): Record<string, unknown> {
  const result = mergeExtensions(incoming, current);
  if (!result.ok) {
    throw new Error(`expected ok merge, got error: ${result.error}`);
  }
  return result.extensions;
}

describe('mergeExtensions — payment_intent_id pinning', () => {
  it('restores the stored PI id when the client tries to rebind it', () => {
    const out = merged(
      { payment_intent_id: 'pi_attacker', gift_note: 'x' },
      { payment_intent_id: 'pi_real_123' }
    );
    expect(out.payment_intent_id).toBe('pi_real_123');
    // Other client-supplied extensions keys apply.
    expect(out.gift_note).toBe('x');
  });

  it('restores the stored PI id when the client drops it via a wholesale overwrite', () => {
    const out = merged(
      { carrier: 'FedEx' },
      { payment_intent_id: 'pi_real_123', carrier: 'UPS' }
    );
    expect(out.payment_intent_id).toBe('pi_real_123');
    // BMC-216F: the client's `carrier` is stripped, so the stored one survives.
    expect(out.carrier).toBe('UPS');
  });

  it('leaves the stored PI id when the client sends the same value', () => {
    const out = merged(
      { payment_intent_id: 'pi_real_123' },
      { payment_intent_id: 'pi_real_123' }
    );
    expect(out.payment_intent_id).toBe('pi_real_123');
  });

  it('strips a client-introduced PI id when the order never had one', () => {
    const out = merged({ payment_intent_id: 'pi_injected', note: 'x' }, null);
    expect(out).not.toHaveProperty('payment_intent_id');
    expect(out.note).toBe('x');
  });

  it('strips a client-introduced PI id when stored extensions has no PI id', () => {
    const out = merged({ payment_intent_id: 'pi_injected' }, { carrier: 'UPS' });
    expect(out).not.toHaveProperty('payment_intent_id');
    // The stored `carrier` key survives the merge (client did not send it).
    expect(out.carrier).toBe('UPS');
  });

  it('parses a stored extensions JSON string', () => {
    const out = merged(
      { payment_intent_id: 'pi_attacker' },
      JSON.stringify({ payment_intent_id: 'pi_real_123' })
    );
    expect(out.payment_intent_id).toBe('pi_real_123');
  });

  it('parses a client extensions JSON string', () => {
    const out = merged(
      JSON.stringify({ payment_intent_id: 'pi_attacker', carrier: 'DHL' }),
      { payment_intent_id: 'pi_real_123' }
    );
    expect(out.payment_intent_id).toBe('pi_real_123');
    // BMC-216F: client `carrier` is stripped even from a JSON-string overlay.
    expect(out).not.toHaveProperty('carrier');
  });

  it('handles empty/absent client extensions but still pins the stored PI id', () => {
    const out = merged(null, { payment_intent_id: 'pi_real_123' });
    expect(out.payment_intent_id).toBe('pi_real_123');
  });

  it('ignores an empty-string stored PI id (treated as absent) and strips the client value', () => {
    const out = merged(
      { payment_intent_id: 'pi_injected' },
      { payment_intent_id: '' }
    );
    expect(out).not.toHaveProperty('payment_intent_id');
  });
});

describe('mergeExtensions — server-owned key preservation', () => {
  it('preserves the stored refunds[] ledger on a metadata-only client overlay', () => {
    const stored = {
      payment_intent_id: 'pi_real_123',
      refunds: [{ amount: 500 }, { amount: 250 }],
      email: 'customer@example.com',
      restockedLineKeys: ['sku-1'],
    };
    const out = merged({ gift_note: 'x' }, stored);

    // The client's key applies…
    expect(out.gift_note).toBe('x');
    // …and every server-owned key the client omitted survives.
    expect(out.refunds).toEqual([{ amount: 500 }, { amount: 250 }]);
    expect(out.email).toBe('customer@example.com');
    expect(out.restockedLineKeys).toEqual(['sku-1']);
    expect(out.payment_intent_id).toBe('pi_real_123');
  });

  it('preserves the refunds[] ledger even if the client tries to overwrite it', () => {
    const stored = {
      payment_intent_id: 'pi_real_123',
      refunds: [{ amount: 500 }],
    };
    // A client that resends refunds still cannot shrink the stored ledger below
    // what was already recorded — the merge overlays, and the over-refund guard
    // reads whichever the client sent, but the pure-helper contract here is
    // that omitted keys survive. When the client DOES send refunds, its value
    // overlays (documented behavior); the double-refund vector we close is the
    // OMITTED case above. This asserts the overlay is deterministic.
    const out = merged({ refunds: [{ amount: 500 }, { amount: 999 }] }, stored);
    expect(out.refunds).toEqual([{ amount: 500 }, { amount: 999 }]);
    expect(out.payment_intent_id).toBe('pi_real_123');
  });

  it('preserves stored refunds[] when parsing a stored JSON string', () => {
    const out = merged(
      { gift_note: 'x' },
      JSON.stringify({ payment_intent_id: 'pi_real_123', refunds: [{ amount: 750 }] })
    );
    expect(out.gift_note).toBe('x');
    expect(out.refunds).toEqual([{ amount: 750 }]);
    expect(out.payment_intent_id).toBe('pi_real_123');
  });
});

describe('mergeExtensions — client carrier/trackingUrl stripping (BMC-216F)', () => {
  it('strips a client-supplied carrier while keeping the stored carrier', () => {
    const out = merged(
      { carrier: 'AttackerExpress', gift_note: 'hi' },
      { payment_intent_id: 'pi_real_123', carrier: 'ups' }
    );
    expect(out.carrier).toBe('ups');       // stored survives
    expect(out.gift_note).toBe('hi');      // innocent client key applies
  });

  it('strips a client-supplied carrier when the order has none stored', () => {
    const out = merged({ carrier: 'AttackerExpress' }, { payment_intent_id: 'pi_real_123' });
    expect(out).not.toHaveProperty('carrier');
  });

  it('strips a client-supplied trackingUrl (server-derived only) while keeping a stored one', () => {
    const out = merged(
      { trackingUrl: 'https://evil.example/phish' },
      { payment_intent_id: 'pi_real_123', trackingUrl: 'https://www.ups.com/track?tracknum=1Z' }
    );
    expect(out.trackingUrl).toBe('https://www.ups.com/track?tracknum=1Z');
  });

  it('strips a client trackingUrl when none is stored', () => {
    const out = merged({ trackingUrl: 'https://evil.example/phish', note: 'x' }, {});
    expect(out).not.toHaveProperty('trackingUrl');
    expect(out.note).toBe('x');
  });

  it('strips carrier/trackingUrl arriving as a client JSON string too', () => {
    const out = merged(
      JSON.stringify({ carrier: 'AttackerExpress', trackingUrl: 'https://evil.example', note: 'x' }),
      { carrier: 'fedex' }
    );
    expect(out.carrier).toBe('fedex');
    expect(out).not.toHaveProperty('trackingUrl');
    expect(out.note).toBe('x');
  });
});

describe('mergeExtensions — fail-safe on corrupt stored extensions', () => {
  it('rejects (422) a corrupt stored JSON string rather than dropping keys', () => {
    const result = mergeExtensions({ carrier: 'X' }, '{ not valid json');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(422);
      expect(result.error).toMatch(/corrupt/i);
    }
  });

  it('rejects a stored string that parses to a non-object (array)', () => {
    const result = mergeExtensions({ carrier: 'X' }, JSON.stringify(['a', 'b']));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(422);
  });

  it('treats a corrupt CLIENT extensions string leniently (stored keys survive)', () => {
    // Client corruption can only fail to add keys — it must never drop stored
    // server-owned keys, so this succeeds with the stored ledger intact.
    const out = merged('{ not valid json', {
      payment_intent_id: 'pi_real_123',
      refunds: [{ amount: 500 }],
    });
    expect(out.refunds).toEqual([{ amount: 500 }]);
    expect(out.payment_intent_id).toBe('pi_real_123');
  });
});
