/**
 * Regression tests for BMC-158 / BMC-216F — hardening PUT /api/orders (follow-up
 * to BMC-140). Two adjacent integrity gaps in the ORDERS_UPDATE-gated PUT handler:
 *
 *  1. Fulfillment fields (`status`, `tracking_number`, `shipped_at`,
 *     `delivered_at`, `shipping_method`, tracking URLs) were freely settable,
 *     bypassing the fulfillment state machine and producing inconsistent state
 *     (order 'refunded' while payment_status stays 'paid', no Stripe refund).
 *     BMC-216F reduced the route to a metadata allowlist: validatePutOrderBody()
 *     rejects every one of those fields with a 400 naming the correct endpoint.
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
 *  3. BMC-230 closed two gaps left in (2). Merging protects keys the client
 *     OMITS, but a key the client SENDS still won the overlay — so `email`
 *     (the guest-order email of record the order-status token is signed over),
 *     `refunds`, `refunds_version`, and `restockedLineKeys` were all still
 *     client-writable. They are now dropped from the overlay alongside
 *     `carrier`/`trackingUrl`. And `external_references` was written wholesale
 *     with no guard at all, even though order creation dual-writes
 *     `payment_intent_id` into it and getOrderByPaymentIntentId OR-matches both
 *     columns — mergeExternalReferences() now merges + re-pins it.
 *
 * Exercises the pure helpers directly (no DB / Cloudflare bindings).
 */
import { describe, it, expect } from 'vitest';
import {
  validatePutOrderBody,
  mergeExtensions,
  mergeExternalReferences,
  SERVER_OWNED_EXTENSION_KEYS,
} from '@/lib/utils/order-update-guards';

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

  it.each(['external_references', 'extensions', 'notes'])(
    'rejects a null-only "%s" body with 400 (a null overlay is a no-op write)',
    (field) => {
      const r = validatePutOrderBody({ orderId: 'O-1', [field]: null });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.status).toBe(400);
    }
  );

  it('accepts a null field when a real update rides alongside it', () => {
    expect(validatePutOrderBody({ orderId: 'O-1', notes: null, extensions: { g: 1 } }).ok).toBe(true);
  });

  it('accepts an empty-string notes clear (presence, not truthiness)', () => {
    expect(validatePutOrderBody({ orderId: 'O-1', notes: '' }).ok).toBe(true);
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
    // BMC-230: `refunds` is a server-owned key, so a client that SENDS it does
    // not win the overlay either — merging alone would have let this through.
    const out = merged({ refunds: [{ amount: 500 }, { amount: 999 }] }, stored);
    expect(out.refunds).toEqual([{ amount: 500 }]);
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

describe('mergeExtensions — client email stripping (BMC-230)', () => {
  // extensions.email is the guest-order email of record: getOrderCustomerEmail
  // prefers it over shipping_address.email, so it decides where the shipping /
  // refund emails go AND is the value createOrderStatusToken signs over. If a
  // PUT could overwrite it, an ORDERS_UPDATE holder would receive the guest's
  // emails carrying a token that verifies at /order-status/[id] for THEIR
  // address — a full guest-order takeover.
  it('strips a client-supplied email while keeping the stored one', () => {
    const out = merged(
      { email: 'attacker@evil.example', gift_note: 'hi' },
      { payment_intent_id: 'pi_real_123', email: 'customer@example.com' }
    );
    expect(out.email).toBe('customer@example.com');
    expect(out.gift_note).toBe('hi');
  });

  it('strips a client-supplied email when the order has none stored', () => {
    const out = merged({ email: 'attacker@evil.example' }, { payment_intent_id: 'pi_real_123' });
    expect(out).not.toHaveProperty('email');
  });

  it('strips a client email arriving as a JSON string too', () => {
    const out = merged(
      JSON.stringify({ email: 'attacker@evil.example', note: 'x' }),
      { email: 'customer@example.com' }
    );
    expect(out.email).toBe('customer@example.com');
    expect(out.note).toBe('x');
  });
});

describe('mergeExtensions — refund/restock bookkeeping keys (BMC-230)', () => {
  it('strips a client-supplied refunds_version so the refund CAS cannot be stalled or replayed', () => {
    const out = merged(
      { refunds_version: 0 },
      { payment_intent_id: 'pi_real_123', refunds_version: 7 }
    );
    expect(out.refunds_version).toBe(7);
  });

  it('strips a client-supplied restockedLineKeys so restock idempotency holds', () => {
    const out = merged(
      { restockedLineKeys: [] },
      { payment_intent_id: 'pi_real_123', restockedLineKeys: ['sku-1', 'sku-2'] }
    );
    expect(out.restockedLineKeys).toEqual(['sku-1', 'sku-2']);
  });
});

/**
 * BMC-230 review follow-up — the strip list must cover EVERY `extensions` key
 * that server code reads for a money, authorization, or idempotency decision.
 * The first revision listed six keys while the codebase read eleven, leaving
 * the over-refund floor, the MCP ownership predicate, the BMC-201 undercharge
 * guard and half of the restock idempotency pair client-writable.
 *
 * The table below is the audit result (grep over app/ + lib/ + components/ for
 * `extensions.<key>`, `extensions?.<key>`, bracket access and
 * `json_extract(… '$.key')`). If you add a server-owned extensions key, add it
 * here AND to SERVER_OWNED_EXTENSION_KEYS — the last test in this block fails
 * otherwise.
 */
describe('mergeExtensions — every server-read key is protected (BMC-230 review)', () => {
  const SERVER_READ_KEYS: Array<[key: string, stored: unknown, hostile: unknown]> = [
    // Money: the over-refund reject gate — Math.max(allRefunded, floor).
    ['stripe_amount_refunded', 2500, 0],
    // Authorization: getOwnedOrder compares this to the calling agent id.
    ['agent_id', 'agent-legit', 'agent-attacker'],
    // Undercharge guard: re-enforced by order-finalization at payment.
    ['expected_shipping_cents', 599, 0],
    ['expected_tax_cents', 210, 0],
    // Idempotency: unioned with restockedLineKeys in readUnavailableRestockKeys.
    ['restockInflightLineKeys', ['sku-2'], []],
    // Already covered above, re-pinned here so the set is enumerated in one place.
    ['carrier', 'ups', 'AttackerExpress'],
    ['trackingUrl', 'https://www.ups.com/track?t=1Z', 'https://evil.example/phish'],
    ['email', 'victim@example.com', 'attacker@example.com'],
    ['refunds', [{ amount: 500 }], []],
    ['refunds_version', 7, 0],
    ['restockedLineKeys', ['sku-1'], []],
  ];

  it.each(SERVER_READ_KEYS)(
    'keeps the stored "%s" when a client tries to overwrite it',
    (key, stored, hostile) => {
      const out = merged(
        { [key]: hostile, gift_note: 'innocent' },
        { payment_intent_id: 'pi_real_123', [key]: stored }
      );
      expect(out[key]).toEqual(stored);
      expect(out.gift_note).toBe('innocent'); // ordinary keys still apply
    }
  );

  it('strips every server-owned key in one hostile payload', () => {
    const stored = Object.fromEntries(SERVER_READ_KEYS.map(([k, s]) => [k, s]));
    const hostile = Object.fromEntries(SERVER_READ_KEYS.map(([k, , h]) => [k, h]));
    const out = merged(hostile, { payment_intent_id: 'pi_real_123', ...stored });

    const overwritten = SERVER_READ_KEYS.map(([k]) => k).filter(
      (k) => JSON.stringify(out[k]) !== JSON.stringify(stored[k])
    );
    expect(overwritten).toEqual([]);
  });

  it('SERVER_OWNED_EXTENSION_KEYS covers every key audited here', () => {
    for (const [key] of SERVER_READ_KEYS) {
      expect(SERVER_OWNED_EXTENSION_KEYS).toContain(key);
    }
  });

  it('also strips the snake_case tracking_url spelling (top-level rejects both)', () => {
    const out = merged({ tracking_url: 'https://evil.example/x' }, {});
    expect(out).not.toHaveProperty('tracking_url');
  });
});

describe('mergeExtensions / mergeExternalReferences — array-shaped client input', () => {
  // parseExtensionsInput explicitly treats a bare array as invalid input; a
  // corrupt CLIENT value is handled leniently (empty overlay), never a
  // stored-value drop — pin that an array literal (not just a stringified
  // array) follows the same "ignored, not honored" contract.
  it('mergeExtensions treats an array-literal client overlay as empty (stored keys survive untouched)', () => {
    const out = merged(['a', 'b'], { payment_intent_id: 'pi_real_123', refunds: [{ amount: 500 }] });
    expect(out.payment_intent_id).toBe('pi_real_123');
    expect(out.refunds).toEqual([{ amount: 500 }]);
  });

  it('mergeExternalReferences treats an array-literal client overlay as empty (stored PI id survives)', () => {
    const out = mergedRefs(['a', 'b'], { payment_intent_id: 'pi_real_123', erp: 'X-1' });
    expect(out.payment_intent_id).toBe('pi_real_123');
    expect(out.erp).toBe('X-1');
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

/** Unwrap a successful mergeExternalReferences result. */
function mergedRefs(incoming: unknown, current: unknown): Record<string, unknown> {
  const result = mergeExternalReferences(incoming, current);
  if (!result.ok) {
    throw new Error(`expected ok merge, got error: ${result.error}`);
  }
  return result.externalReferences;
}

describe('mergeExternalReferences — payment_intent_id pinning (BMC-230)', () => {
  // The PI id is dual-written to external_references AND extensions at order
  // creation, and getOrderByPaymentIntentId OR-matches both columns with
  // LIMIT 1 and no ORDER BY. A client-planted value here makes a second row
  // match a victim's PaymentIntent, so charge.refunded reconciliation can write
  // status='cancelled' / payment_status='refunded' onto the wrong order.
  it('strips a client-planted PI id when the order has none stored', () => {
    const out = mergedRefs({ payment_intent_id: 'pi_victim', erp: 'X-1' }, null);
    expect(out).not.toHaveProperty('payment_intent_id');
    expect(out.erp).toBe('X-1');
  });

  it('restores the stored PI id when the client tries to rebind it', () => {
    const out = mergedRefs(
      { payment_intent_id: 'pi_victim' },
      { payment_intent_id: 'pi_real_123' }
    );
    expect(out.payment_intent_id).toBe('pi_real_123');
  });

  it('keeps the stored PI id when the client omits it (no wholesale drop)', () => {
    const out = mergedRefs({ erp: 'X-2' }, { payment_intent_id: 'pi_real_123', erp: 'X-1' });
    expect(out.payment_intent_id).toBe('pi_real_123');
    expect(out.erp).toBe('X-2');
  });

  it('passes through ordinary cross-system references unchanged', () => {
    const out = mergedRefs({ erp: 'X-1', shopify_id: '99' }, null);
    expect(out).toEqual({ erp: 'X-1', shopify_id: '99' });
  });

  it('parses a stored JSON string', () => {
    const out = mergedRefs(
      { payment_intent_id: 'pi_victim' },
      JSON.stringify({ payment_intent_id: 'pi_real_123' })
    );
    expect(out.payment_intent_id).toBe('pi_real_123');
  });

  it('rejects (422) corrupt stored external_references rather than dropping the binding', () => {
    const result = mergeExternalReferences({ erp: 'X-1' }, '{ not valid json');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(422);
      expect(result.error).toMatch(/corrupt/i);
    }
  });
});
