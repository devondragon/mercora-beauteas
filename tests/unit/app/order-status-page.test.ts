/**
 * BMC-216E — page-level contract for the signed guest order-status page.
 *
 * Token round-trip/tampering primitives are covered by ticket A's token tests;
 * this file pins the PAGE: that every failure funnels into notFound() (no
 * existence oracle), that the order is not even loaded before the cheap checks
 * pass, and that a VALID token renders only the minimal projection — no
 * address, total, payment reference, or internal note anywhere in the tree.
 *
 * jsdom unit env: the model layer and the rate limiter are mocked, so nothing
 * here touches a Cloudflare binding. The real token module is used (pure Web
 * Crypto) so the page's verify wiring is exercised, not stubbed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/models/mach/orders', () => ({ getOrderById: vi.fn() }));

vi.mock('@/lib/rate-limit', () => ({
  enforceRateLimit: vi.fn().mockResolvedValue(null),
  getClientIpFromHeaders: vi.fn().mockReturnValue('1.2.3.4'),
}));

vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue(new Headers({ 'CF-Connecting-IP': '1.2.3.4' })),
}));

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));

import OrderStatusPage from '@/app/order-status/[id]/page';
import { getOrderById } from '@/lib/models/mach/orders';
import { enforceRateLimit } from '@/lib/rate-limit';
import { createOrderStatusToken } from '@/lib/order-status/token';

const ORDER_ID = 'WEB-GUEST-1753900000000';
const EMAIL = 'guest@example.com';
// lib/order-status/token.ts enforces a 32-character minimum secret (anything
// shorter is treated as unset and fails closed), so the test secret must clear it.
const TEST_SECRET = 'page-test-secret-0123456789abcdef0123456789';

const shippedOrder = {
  id: ORDER_ID,
  customer_id: undefined,
  status: 'shipped',
  payment_status: 'paid',
  payment_method: 'stripe',
  total_amount: { amount: 4200, currency: 'USD' },
  currency_code: 'USD',
  shipping_address: {
    line1: '1 Secret St',
    city: 'Portland',
    region: 'OR',
    postal_code: '97201',
    country: 'US',
  },
  billing_address: { line1: '1 Secret St' },
  items: [
    { product_id: 'p1', sku: 'MB-1', product_name: 'Morning Blend', quantity: 2, unit_price: { amount: 2100, currency: 'USD' }, total_price: { amount: 4200, currency: 'USD' } },
  ],
  shipping_method: 'standard',
  notes: 'INTERNAL: fragile',
  external_references: { payment_intent_id: 'pi_secret_123' },
  extensions: { email: EMAIL },
  shipping_carrier: 'ups',
  tracking_number: '1Z999AA10123456784',
  shipped_at: '2026-07-28T18:00:00.000Z',
  delivered_at: null,
  created_at: '2026-07-25T12:00:00.000Z',
  updated_at: '2026-07-28T18:00:00.000Z',
} as never;

/** Walk a returned React element tree and collect every rendered string/number. */
function collectText(node: unknown, out: string[] = []): string[] {
  if (node === null || node === undefined || typeof node === 'boolean') return out;
  if (typeof node === 'string' || typeof node === 'number') {
    out.push(String(node));
    return out;
  }
  if (Array.isArray(node)) {
    for (const child of node) collectText(child, out);
    return out;
  }
  if (typeof node === 'object') {
    const props = (node as { props?: Record<string, unknown> }).props;
    if (props) for (const value of Object.values(props)) collectText(value, out);
  }
  return out;
}

function renderPage(token?: string, id = ORDER_ID) {
  return OrderStatusPage({
    params: Promise.resolve({ id }),
    searchParams: Promise.resolve(token === undefined ? {} : { token }),
  });
}

async function validToken(orderId = ORDER_ID, email = EMAIL): Promise<string> {
  const token = await createOrderStatusToken(orderId, email);
  if (!token) throw new Error('token creation failed — is ORDER_STATUS_SECRET set?');
  return token;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.ORDER_STATUS_SECRET = TEST_SECRET;
  vi.mocked(enforceRateLimit).mockResolvedValue(null);
  vi.mocked(getOrderById).mockResolvedValue(shippedOrder);
});

afterEach(() => {
  delete process.env.ORDER_STATUS_SECRET;
});

describe('guest order-status page — fail-closed flow', () => {
  it('404s when no token is supplied, without loading the order', async () => {
    await expect(renderPage()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(getOrderById).not.toHaveBeenCalled();
  });

  it('404s when the caller is rate limited, without loading the order', async () => {
    vi.mocked(enforceRateLimit).mockResolvedValue({ status: 429 } as never);
    await expect(renderPage(await validToken())).rejects.toThrow('NEXT_NOT_FOUND');
    expect(getOrderById).not.toHaveBeenCalled();
  });

  it('rate limits on PUBLIC_RATE_LIMITER keyed by client IP', async () => {
    await renderPage(await validToken());
    expect(enforceRateLimit).toHaveBeenCalledWith('PUBLIC_RATE_LIMITER', 'order-status:1.2.3.4');
  });

  it('404s for an unknown order id', async () => {
    vi.mocked(getOrderById).mockResolvedValue(null);
    await expect(renderPage(await validToken())).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('404s when the order has no resolvable customer email', async () => {
    vi.mocked(getOrderById).mockResolvedValue({
      ...(shippedOrder as object),
      extensions: {},
      shipping_address: { line1: '1 Secret St' },
    } as never);
    await expect(renderPage(await validToken())).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('404s for a tampered token', async () => {
    const token = await validToken();
    const tampered = token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A');
    await expect(renderPage(tampered)).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('404s for a token minted for a DIFFERENT order (no cross-order replay)', async () => {
    const otherToken = await validToken('WEB-GUEST-9999999999999', EMAIL);
    await expect(renderPage(otherToken)).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('404s for a repeated ?token= param (array value)', async () => {
    const token = await validToken();
    await expect(
      OrderStatusPage({
        params: Promise.resolve({ id: ORDER_ID }),
        searchParams: Promise.resolve({ token: [token, token] as never }),
      }),
    ).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('404s when ORDER_STATUS_SECRET is unset (fail closed)', async () => {
    const token = await validToken();
    delete process.env.ORDER_STATUS_SECRET;
    await expect(renderPage(token)).rejects.toThrow('NEXT_NOT_FOUND');
  });
});

describe('guest order-status page — valid token renders the minimal projection', () => {
  it('renders order number, status, shipment and item names', async () => {
    const text = collectText(await renderPage(await validToken())).join(' ');

    expect(text).toContain(ORDER_ID);
    expect(text).toContain('shipped');
    expect(text).toContain('Morning Blend');
    expect(text).toContain('1Z999AA10123456784');
    expect(text).toContain('UPS');
    expect(text).toContain('https://www.ups.com/track');
  });

  it('renders NOTHING outside the allowlist', async () => {
    const text = collectText(await renderPage(await validToken())).join(' ');

    for (const forbidden of [
      'Secret St',
      'Portland',
      '97201',
      'pi_secret_123',
      'INTERNAL',
      EMAIL,
      '$42.00',
      '4200',
      'stripe',
    ]) {
      expect(text).not.toContain(forbidden);
    }
  });

  it('omits the shipment block for an order that has not shipped', async () => {
    vi.mocked(getOrderById).mockResolvedValue({
      ...(shippedOrder as object),
      status: 'processing',
      shipping_carrier: null,
      tracking_number: null,
      shipped_at: null,
    } as never);

    const text = collectText(await renderPage(await validToken())).join(' ');

    expect(text).toContain('processing');
    expect(text).not.toContain('Shipment');
    expect(text).not.toContain('Track your package');
  });

  it('shows an "other" carrier tracking number with no carrier link', async () => {
    vi.mocked(getOrderById).mockResolvedValue({
      ...(shippedOrder as object),
      shipping_carrier: 'other',
      tracking_number: 'DHL-123',
    } as never);

    const text = collectText(await renderPage(await validToken())).join(' ');

    expect(text).toContain('DHL-123');
    expect(text).not.toContain('Track your package');
    expect(text).not.toContain('ups.com');
    expect(text).not.toContain('fedex.com');
  });
});

describe('guest order-status page — metadata hardening', () => {
  it('is noindex and no-referrer so the bearer token never leaks', async () => {
    const { metadata } = await import('@/app/order-status/[id]/page');
    expect(metadata.robots).toMatchObject({ index: false, follow: false });
    expect(metadata.referrer).toBe('no-referrer');
  });
});
