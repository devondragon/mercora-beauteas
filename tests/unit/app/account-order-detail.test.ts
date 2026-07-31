/**
 * BMC-216E — registered-customer order detail: ownership + shipment card.
 *
 * The ownership guard predates this ticket; these tests fence it so the new
 * shipment card cannot be the edit that weakens it. The shipment assertions pin
 * the three states that matter: linkable carrier, "other" carrier (number, no
 * link), and never-shipped (no card at all — only the status line).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MAX_TRACKING_LENGTH } from '@/lib/fulfillment/tracking';

vi.mock('@clerk/nextjs/server', () => ({ auth: vi.fn() }));
vi.mock('@/lib/models/mach/orders', () => ({ getOrderById: vi.fn() }));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));

import OrderDetailPage from '@/app/account/orders/[id]/page';
import { auth } from '@clerk/nextjs/server';
import { getOrderById } from '@/lib/models/mach/orders';

const ORDER_ID = 'WEB-user_owner-1753900000000';
const OWNER = 'user_owner';

const shippedOrder = {
  id: ORDER_ID,
  customer_id: OWNER,
  status: 'shipped',
  payment_status: 'paid',
  payment_method: 'stripe',
  total_amount: { amount: 4200, currency: 'USD' },
  currency_code: 'USD',
  shipping_address: { line1: '1 Main St', city: 'Portland', region: 'OR', postal_code: '97201', country: 'US' },
  items: [
    { product_id: 'p1', sku: 'MB-1', product_name: 'Morning Blend', quantity: 2, unit_price: { amount: 2100, currency: 'USD' }, total_price: { amount: 4200, currency: 'USD' } },
  ],
  shipping_carrier: 'ups',
  tracking_number: '1Z999AA10123456784',
  shipped_at: '2026-07-28T18:00:00.000Z',
  created_at: '2026-07-25T12:00:00.000Z',
} as never;

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

function renderPage() {
  return OrderDetailPage({ params: Promise.resolve({ id: ORDER_ID }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth).mockResolvedValue({ userId: OWNER } as never);
  vi.mocked(getOrderById).mockResolvedValue(shippedOrder);
});

describe('account order detail — ownership', () => {
  it('404s for an anonymous visitor', async () => {
    vi.mocked(auth).mockResolvedValue({ userId: null } as never);
    await expect(renderPage()).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('404s for a signed-in non-owner', async () => {
    vi.mocked(auth).mockResolvedValue({ userId: 'user_other' } as never);
    await expect(renderPage()).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('404s for a missing order', async () => {
    vi.mocked(getOrderById).mockResolvedValue(null);
    await expect(renderPage()).rejects.toThrow('NEXT_NOT_FOUND');
  });
});

describe('account order detail — shipment card', () => {
  it('shows shipped date, carrier, tracking number and a carrier link', async () => {
    const text = collectText(await renderPage()).join(' ');

    expect(text).toContain('Shipment');
    expect(text).toContain('UPS');
    expect(text).toContain('1Z999AA10123456784');
    expect(text).toContain('https://www.ups.com/track');
    expect(text).toContain('Track your package');
    // formatDate call-site wiring: the raw ISO timestamp must never reach the
    // customer — a mutation that skips formatDate() would still pass every
    // other assertion in this test.
    expect(text).toContain('Jul 28, 2026');
    expect(text).not.toContain('2026-07-28T18:00:00.000Z');
  });

  it('shows an "other" carrier tracking number with no link', async () => {
    vi.mocked(getOrderById).mockResolvedValue({
      ...(shippedOrder as object),
      shipping_carrier: 'other',
      tracking_number: 'DHL-123',
    } as never);

    const text = collectText(await renderPage()).join(' ');

    expect(text).toContain('DHL-123');
    expect(text).not.toContain('Track your package');
    expect(text).not.toContain('ups.com');
  });

  it('hides the shipment card entirely for an order that never shipped', async () => {
    vi.mocked(getOrderById).mockResolvedValue({
      ...(shippedOrder as object),
      status: 'processing',
      shipping_carrier: null,
      tracking_number: null,
      shipped_at: null,
    } as never);

    const text = collectText(await renderPage()).join(' ');

    expect(text).not.toContain('Shipment');
    expect(text).not.toContain('Track your package');
    // The status line still renders.
    expect(text).toContain('processing');
  });

  it('ignores a legacy extensions.trackingUrl', async () => {
    vi.mocked(getOrderById).mockResolvedValue({
      ...(shippedOrder as object),
      shipping_carrier: null,
      extensions: { trackingUrl: 'https://evil.example.com/track' },
    } as never);

    const text = collectText(await renderPage()).join(' ');

    expect(text).not.toContain('evil.example.com');
  });

  it('strips a bidi override embedded in a legacy tracking number before rendering', async () => {
    // Escape sequence rather than a literal invisible codepoint in the source:
    // a raw U+202E in a fixture is indistinguishable by eye from an already-clean
    // one (a reviewer can't tell lines apart in a diff), trips editor/lint
    // Unicode normalization silently, and is exactly how a fixture regresses to
    // a vacuous, sanitizer-identity input with no test failure to announce it.
    const RAW_BIDI = '1Z999\u202E48765432101AA999Z1';
    vi.mocked(getOrderById).mockResolvedValue({
      ...(shippedOrder as object),
      tracking_number: RAW_BIDI,
    } as never);

    const text = collectText(await renderPage()).join(' ');

    expect(text).toContain('1Z99948765432101AA999Z1');
    expect(text).not.toContain(RAW_BIDI);
    // The sink that matters: the stripped number also feeds the carrier link,
    // not just the displayed text.
    expect(text).not.toContain('%E2%80%AE');
  });

  it('drops an over-length tracking number and its link rather than rendering it', async () => {
    vi.mocked(getOrderById).mockResolvedValue({
      ...(shippedOrder as object),
      tracking_number: 'X'.repeat(MAX_TRACKING_LENGTH + 1),
    } as never);

    const text = collectText(await renderPage()).join(' ');

    // Positive anchor: the shipment card is still shown (just without a
    // tracking line), so a passing test isn't secretly relying on the card
    // failing to render at all.
    expect(text).toContain('Shipment');
    expect(text).toContain('UPS');
    // Catches truncation, not just a byte-identical 101-char match — a sanitizer
    // regressed to `.slice(0, MAX_TRACKING_LENGTH)` would pass a plain
    // `not.toContain('X'.repeat(101))` check.
    expect(text).not.toMatch(/X{20,}/);
    expect(text).not.toContain('Track your package');
  });
});
