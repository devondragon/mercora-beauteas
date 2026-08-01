/**
 * BMC-216C — POST /api/admin/orders/[id]/shipping-email.
 *
 * The contract this pins:
 *  - retry is legal ONLY when nothing was ever sent, and reuses the stable
 *    `initial` key so a retry cannot double-send within Resend's window;
 *  - resend is legal ONLY after a recorded successful send, and mints a fresh
 *    key + a distinct `shipping_email_resent` event so the audit history can
 *    tell "the first one failed" from "the operator sent it again";
 *  - a failed send is HTTP 200 with success:false (the call worked, the send
 *    did not) plus a shipping_email_failed event — never a 5xx, and never a
 *    change to order state.
 *
 * D1 is never touched: the orders model and fulfillment service are mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const {
  sendMock,
  checkAdminPermissionsMock,
  getOrderByIdMock,
  listOrderEventsMock,
  recordEmailEventMock,
} = vi.hoisted(() => ({
  sendMock: vi.fn().mockResolvedValue({ data: { id: 'email-1' }, error: null }),
  checkAdminPermissionsMock: vi.fn().mockResolvedValue({ success: true, userId: 'user_admin_1' }),
  getOrderByIdMock: vi.fn(),
  listOrderEventsMock: vi.fn().mockResolvedValue([]),
  recordEmailEventMock: vi.fn().mockResolvedValue('evt-new'),
}));

vi.mock('resend', () => ({
  Resend: class {
    emails = { send: sendMock };
  },
}));

vi.mock('@/lib/auth/admin-middleware', () => ({
  checkAdminPermissions: checkAdminPermissionsMock,
}));

vi.mock('@/lib/models/mach/orders', () => ({
  getOrderById: getOrderByIdMock,
}));

vi.mock('@/lib/fulfillment/service', () => ({
  listOrderEvents: listOrderEventsMock,
  recordEmailEvent: recordEmailEventMock,
}));

import { POST } from '@/app/api/admin/orders/[id]/shipping-email/route';

/** See initial-shipping-email.test.ts — token.ts rejects secrets under 32 chars. */
const TEST_SECRET = 'unit-test-order-status-secret-0123456789';

function shippedOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ORD-1',
    status: 'shipped',
    payment_status: 'paid',
    currency_code: 'USD',
    total_amount: { amount: 2500, currency: 'USD', precision: 2 },
    items: [
      {
        product_id: 'p1',
        sku: 'SKU-1',
        quantity: 2,
        unit_price: { amount: 1250, currency: 'USD', precision: 2 },
        total_price: { amount: 2500, currency: 'USD', precision: 2 },
        product_name: 'Morning Blend',
      },
    ],
    shipping_address: {
      line1: '1 Tea Lane',
      city: 'Denver',
      region: 'CO',
      postal_code: '80202',
      country: 'US',
      recipient: 'Ada Lovelace',
      email: 'ada@example.com',
    },
    extensions: {},
    shipping_carrier: 'ups',
    tracking_number: '1Z999AA10123456784',
    ...overrides,
  };
}

function sentEvent(id = 'evt-sent-1') {
  return {
    id,
    order_id: 'ORD-1',
    event_type: 'shipping_email_sent',
    actor_type: 'admin',
    actor_id: 'user_admin_1',
    from_status: null,
    to_status: null,
    details: { idempotencyKey: 'shipping-confirmation/ORD-1/initial' },
    created_at: '2026-07-30T12:00:00.000Z',
  };
}

function post(mode: unknown, id = 'ORD-1') {
  const request = new NextRequest(
    `https://www.beauteas.com/api/admin/orders/${id}/shipping-email`,
    { method: 'POST', body: JSON.stringify({ mode }) },
  );
  return POST(request, { params: Promise.resolve({ id }) });
}

function sentKey(): string | undefined {
  return sendMock.mock.calls.at(-1)?.[1]?.idempotencyKey;
}

/**
 * The `initial` key folds in a payload digest (BMC-227 review fix), so it's
 * no longer a fixed literal — assert the stable prefix/shape instead of an
 * exact hash value.
 */
const INITIAL_KEY_RE = /^shipping-confirmation\/ORD-1\/initial\/[0-9a-f]{12}$/;

beforeEach(() => {
  vi.clearAllMocks();
  sendMock.mockResolvedValue({ data: { id: 'email-1' }, error: null });
  checkAdminPermissionsMock.mockResolvedValue({ success: true, userId: 'user_admin_1' });
  getOrderByIdMock.mockResolvedValue(shippedOrder());
  listOrderEventsMock.mockResolvedValue([]);
  recordEmailEventMock.mockResolvedValue('evt-new');
  process.env.ORDER_STATUS_SECRET = TEST_SECRET;
});

describe('POST /api/admin/orders/[id]/shipping-email', () => {
  it('rejects an unauthenticated caller with 401 and sends nothing', async () => {
    checkAdminPermissionsMock.mockResolvedValueOnce({ success: false, error: 'Auth required' });

    const res = await post('retry');

    expect(res.status).toBe(401);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('rejects an unknown mode with 400', async () => {
    const res = await post('blast');

    expect(res.status).toBe(400);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('returns 404 for a missing order', async () => {
    getOrderByIdMock.mockResolvedValueOnce(null);

    const res = await post('retry');

    expect(res.status).toBe(404);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('returns 409 not_shipped for a processing order', async () => {
    getOrderByIdMock.mockResolvedValueOnce(shippedOrder({ status: 'processing' }));

    const res = await post('retry');

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ code: 'not_shipped', status: 'processing' });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('retry with no prior send reuses the initial key and records shipping_email_sent', async () => {
    const res = await post('retry');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ email: { success: true }, eventId: 'evt-new' });
    expect(sentKey()).toMatch(INITIAL_KEY_RE);
    expect(recordEmailEventMock).toHaveBeenCalledWith(
      'ORD-1',
      'shipping_email_sent',
      { type: 'admin', id: 'user_admin_1' },
      { idempotencyKey: sentKey() },
    );
  });

  it('retry after a successful send is a 409 wrong_mode', async () => {
    listOrderEventsMock.mockResolvedValueOnce([sentEvent()]);

    const res = await post('retry');

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ code: 'wrong_mode' });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('retry after a prior RESEND is also a 409 wrong_mode', async () => {
    // A resent order has, by construction, already had a successful send.
    // Recognizing only `shipping_email_sent` would reopen retry on it.
    listOrderEventsMock.mockResolvedValueOnce([
      { ...sentEvent('evt-resent-1'), event_type: 'shipping_email_resent' },
    ]);

    const res = await post('retry');

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ code: 'wrong_mode' });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('a prior FAILED send leaves retry legal', async () => {
    listOrderEventsMock.mockResolvedValueOnce([
      { ...sentEvent('evt-failed-1'), event_type: 'shipping_email_failed' },
    ]);

    const res = await post('retry');

    expect(res.status).toBe(200);
    expect(sentKey()).toMatch(INITIAL_KEY_RE);
  });

  it('resend without a prior send is a 409 wrong_mode', async () => {
    const res = await post('resend');

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ code: 'wrong_mode' });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('resend after a successful send mints a unique key and records shipping_email_resent', async () => {
    listOrderEventsMock.mockResolvedValue([sentEvent()]);

    const res = await post('resend');
    expect(res.status).toBe(200);
    const firstKey = sentKey();

    expect(firstKey).toMatch(/^shipping-confirmation\/ORD-1\/resend\/.+/);
    expect(recordEmailEventMock).toHaveBeenCalledWith(
      'ORD-1',
      'shipping_email_resent',
      { type: 'admin', id: 'user_admin_1' },
      { idempotencyKey: firstKey, resendOfEventId: 'evt-sent-1' },
    );

    await post('resend');
    const secondKey = sentKey();
    expect(secondKey).toMatch(/^shipping-confirmation\/ORD-1\/resend\/.+/);
    expect(secondKey).not.toBe(firstKey);
  });

  it('a failed send is 200 with success:false and a shipping_email_failed event', async () => {
    sendMock.mockResolvedValueOnce({ data: null, error: { message: 'domain not verified' } });
    recordEmailEventMock.mockResolvedValueOnce('evt-fail-1');

    const res = await post('retry');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      email: { success: false, error: 'domain not verified' },
      eventId: 'evt-fail-1',
    });
    expect(recordEmailEventMock).toHaveBeenCalledWith(
      'ORD-1',
      'shipping_email_failed',
      { type: 'admin', id: 'user_admin_1' },
      { idempotencyKey: expect.stringMatching(INITIAL_KEY_RE), error: 'domain not verified' },
    );
  });

  it('represents a concurrent_idempotent_requests 409 distinctly and non-critically', async () => {
    // A retry raced the in-flight original send. The original may have been
    // delivered — the route must not claim success, but must not page either.
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    sendMock.mockResolvedValueOnce({
      data: null,
      error: {
        message: 'Concurrent requests with the same idempotency key.',
        name: 'concurrent_idempotent_requests',
      },
    });
    recordEmailEventMock.mockResolvedValueOnce('evt-conc-1');

    const res = await post('retry');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      email: {
        success: false,
        error: 'Concurrent requests with the same idempotency key.',
        errorCode: 'concurrent_idempotent_requests',
      },
      eventId: 'evt-conc-1',
    });
    expect(recordEmailEventMock).toHaveBeenCalledWith(
      'ORD-1',
      'shipping_email_failed',
      { type: 'admin', id: 'user_admin_1' },
      {
        idempotencyKey: expect.stringMatching(INITIAL_KEY_RE),
        error: 'Concurrent requests with the same idempotency key.',
        errorCode: 'concurrent_idempotent_requests',
        concurrentDuplicate: true,
      },
    );
    // No [critical] line — that marker is what the observability tail worker
    // pages on; this failure class must stay a warn-level diagnostic.
    const criticalLines = errorSpy.mock.calls.filter((c) => String(c[0]).includes('[critical]'));
    expect(criticalLines).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(
      'email.shipping_email_concurrent_duplicate',
      expect.stringContaining('"orderId":"ORD-1"'),
    );

    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('records a failed event when the order has no customer email', async () => {
    getOrderByIdMock.mockResolvedValueOnce(
      shippedOrder({
        extensions: {},
        shipping_address: {
          line1: '1 Tea Lane',
          city: 'Denver',
          region: 'CO',
          postal_code: '80202',
          country: 'US',
          recipient: 'Ada Lovelace',
        },
      }),
    );
    recordEmailEventMock.mockResolvedValueOnce('evt-fail-2');

    const res = await post('retry');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      email: { success: false, error: 'no_customer_email' },
      eventId: 'evt-fail-2',
    });
    expect(sendMock).not.toHaveBeenCalled();
    // No payload to digest with nobody to send to — a fixed marker key, not
    // the digest-bearing initial key format.
    expect(recordEmailEventMock).toHaveBeenCalledWith(
      'ORD-1',
      'shipping_email_failed',
      { type: 'admin', id: 'user_admin_1' },
      { idempotencyKey: 'shipping-confirmation/ORD-1/initial/no-recipient', error: 'no_customer_email' },
    );
  });

  it('a failed RESEND is 200 with success:false, a resend-shaped key, and a shipping_email_failed event', async () => {
    listOrderEventsMock.mockResolvedValueOnce([sentEvent()]);
    sendMock.mockResolvedValueOnce({ data: null, error: { message: 'domain not verified' } });
    recordEmailEventMock.mockResolvedValueOnce('evt-fail-resend-1');

    const res = await post('resend');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      email: { success: false, error: 'domain not verified' },
      eventId: 'evt-fail-resend-1',
    });
    // Must record shipping_email_failed — not shipping_email_resent — and
    // carry the resend key format, or a failed resend would render
    // indistinguishable from a delivered one in the audit history.
    expect(recordEmailEventMock).toHaveBeenCalledWith(
      'ORD-1',
      'shipping_email_failed',
      { type: 'admin', id: 'user_admin_1' },
      {
        idempotencyKey: expect.stringMatching(/^shipping-confirmation\/ORD-1\/resend\/.+/),
        error: 'domain not verified',
      },
    );
  });

  it('records a failed event with a resend key when a resend target has no customer email', async () => {
    listOrderEventsMock.mockResolvedValueOnce([sentEvent()]);
    getOrderByIdMock.mockResolvedValueOnce(
      shippedOrder({
        extensions: {},
        shipping_address: {
          line1: '1 Tea Lane',
          city: 'Denver',
          region: 'CO',
          postal_code: '80202',
          country: 'US',
          recipient: 'Ada Lovelace',
        },
      }),
    );
    recordEmailEventMock.mockResolvedValueOnce('evt-fail-resend-2');

    const res = await post('resend');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      email: { success: false, error: 'no_customer_email' },
      eventId: 'evt-fail-resend-2',
    });
    expect(sendMock).not.toHaveBeenCalled();
    expect(recordEmailEventMock).toHaveBeenCalledWith(
      'ORD-1',
      'shipping_email_failed',
      { type: 'admin', id: 'user_admin_1' },
      {
        idempotencyKey: expect.stringMatching(/^shipping-confirmation\/ORD-1\/resend\/.+/),
        error: 'no_customer_email',
      },
    );
  });

  it('attributes the audit event to the service token identity', async () => {
    checkAdminPermissionsMock.mockResolvedValueOnce({
      success: true,
      userId: 'admin-service',
      isServiceToken: true,
    });

    await post('retry');

    expect(recordEmailEventMock).toHaveBeenCalledWith(
      'ORD-1',
      'shipping_email_sent',
      { type: 'service', id: 'api-token' },
      { idempotencyKey: expect.stringMatching(INITIAL_KEY_RE) },
    );
  });
});
