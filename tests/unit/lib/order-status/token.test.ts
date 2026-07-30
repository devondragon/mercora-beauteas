// tests/unit/lib/order-status/token.test.ts
//
// Guest order-status bearer token (BMC-216A). Mirrors the unsubscribe-token
// tests: round trip, tampering, wrong scope (order/email), wrong secret,
// missing secret, and an over-length DoS guard. The token is the ONLY thing
// standing between a URL and a stranger's order, so every rejection path is
// asserted explicitly.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  MAX_ORDER_STATUS_TOKEN_LENGTH,
  isOrderStatusTokenConfigured,
  createOrderStatusToken,
  verifyOrderStatusToken,
} from '@/lib/order-status/token';
import { getOrderCustomerEmail } from '@/lib/orders/customer-email';

const SECRET = 'test-order-status-secret';
const ORDER_ID = 'order_abc123';
const EMAIL = 'person@example.com';

describe('order-status token', () => {
  beforeEach(() => {
    process.env.ORDER_STATUS_SECRET = SECRET;
  });
  afterEach(() => {
    delete process.env.ORDER_STATUS_SECRET;
  });

  it('round-trips a token for one order + email', async () => {
    const token = await createOrderStatusToken(ORDER_ID, EMAIL);
    expect(token).toBeTruthy();
    expect(await verifyOrderStatusToken(token!, ORDER_ID, EMAIL)).toBe(true);
  });

  it('normalizes email case/whitespace so the token is stable', async () => {
    const a = await createOrderStatusToken(ORDER_ID, '  Person@Example.COM ');
    const b = await createOrderStatusToken(ORDER_ID, EMAIL);
    expect(a).toBe(b);
    expect(await verifyOrderStatusToken(a!, ORDER_ID, '  PERSON@example.com  ')).toBe(true);
  });

  it('carries no email payload — the token is signature only', async () => {
    const token = (await createOrderStatusToken(ORDER_ID, EMAIL))!;
    expect(token).not.toContain('.');
    const decoded = Buffer.from(token.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    expect(decoded).not.toContain('example.com');
    expect(decoded).not.toContain(ORDER_ID);
  });

  it('rejects the token on a different order', async () => {
    const token = (await createOrderStatusToken(ORDER_ID, EMAIL))!;
    expect(await verifyOrderStatusToken(token, 'order_other', EMAIL)).toBe(false);
  });

  it('rejects the token for a different email', async () => {
    const token = (await createOrderStatusToken(ORDER_ID, EMAIL))!;
    expect(await verifyOrderStatusToken(token, ORDER_ID, 'attacker@example.com')).toBe(false);
  });

  it('rejects a tampered signature', async () => {
    const token = (await createOrderStatusToken(ORDER_ID, EMAIL))!;
    // Mutate the FIRST char — it maps to the high bits of signature byte 0, so
    // the decoded bytes definitely differ (the last char is partly padding).
    const flipped = (token[0] === 'A' ? 'B' : 'A') + token.slice(1);
    expect(await verifyOrderStatusToken(flipped, ORDER_ID, EMAIL)).toBe(false);
  });

  it('rejects malformed and wrong-length tokens', async () => {
    expect(await verifyOrderStatusToken('', ORDER_ID, EMAIL)).toBe(false);
    expect(await verifyOrderStatusToken('!!!not-base64!!!', ORDER_ID, EMAIL)).toBe(false);
    expect(await verifyOrderStatusToken('QUJD', ORDER_ID, EMAIL)).toBe(false); // valid base64, 3 bytes
  });

  it('rejects an over-long token without doing HMAC work (DoS guard)', async () => {
    const huge = 'a'.repeat(MAX_ORDER_STATUS_TOKEN_LENGTH + 1);
    expect(await verifyOrderStatusToken(huge, ORDER_ID, EMAIL)).toBe(false);
  });

  it('rejects a token signed with a different secret', async () => {
    const token = (await createOrderStatusToken(ORDER_ID, EMAIL))!;
    process.env.ORDER_STATUS_SECRET = 'a-different-secret';
    expect(await verifyOrderStatusToken(token, ORDER_ID, EMAIL)).toBe(false);
  });

  it('reports configuration state via isOrderStatusTokenConfigured', () => {
    expect(isOrderStatusTokenConfigured()).toBe(true);
    delete process.env.ORDER_STATUS_SECRET;
    expect(isOrderStatusTokenConfigured()).toBe(false);
    process.env.ORDER_STATUS_SECRET = '';
    expect(isOrderStatusTokenConfigured()).toBe(false);
  });

  it('fails closed when the secret is unset', async () => {
    delete process.env.ORDER_STATUS_SECRET;
    expect(await createOrderStatusToken(ORDER_ID, EMAIL)).toBeNull();

    process.env.ORDER_STATUS_SECRET = SECRET;
    const token = (await createOrderStatusToken(ORDER_ID, EMAIL))!;
    delete process.env.ORDER_STATUS_SECRET;
    expect(await verifyOrderStatusToken(token, ORDER_ID, EMAIL)).toBe(false);
  });

  it('mints no token for an empty email or empty order id', async () => {
    expect(await createOrderStatusToken(ORDER_ID, '')).toBeNull();
    expect(await createOrderStatusToken(ORDER_ID, '   ')).toBeNull();
    expect(await createOrderStatusToken('', EMAIL)).toBeNull();
  });

  it('mints no token for an order with no resolvable customer email', async () => {
    // Acceptance criterion: a token bound to an empty string would verify for
    // ANY email-less order, so the whole guest link must be suppressed.
    const emailless = { extensions: {}, shipping_address: {} };
    const resolved = getOrderCustomerEmail(emailless);
    expect(resolved).toBeNull();
    expect(await createOrderStatusToken(ORDER_ID, resolved ?? '')).toBeNull();
    expect(await verifyOrderStatusToken('anything', ORDER_ID, resolved ?? '')).toBe(false);
  });
});
