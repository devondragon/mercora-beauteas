/**
 * Regression test for BMC-167 (M1) — GET /api/orders hides unpaid drafts.
 *
 * Since a server-side `pending` order is now persisted at PaymentIntent
 * creation, every abandoned checkout-past-shipping leaves a phantom draft.
 * Those must NOT pollute operational list reads (admin fulfillment queue,
 * customer order history), so GET /api/orders excludes `payment_status =
 * 'pending'` by default. `?includePending=true` opts back in, and a specific
 * `?orderId=` lookup always returns the exact order.
 *
 * Pure unit test: Clerk auth, the D1 layer, and the order-finalization / catalog
 * seams are mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@clerk/nextjs/server', () => ({
  auth: vi.fn().mockResolvedValue({ userId: 'user_1' }),
  currentUser: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/db', () => ({ getDbAsync: vi.fn() }));
vi.mock('@/lib/stripe', () => ({ retrievePaymentIntent: vi.fn() }));
vi.mock('@/lib/services/order-finalization', () => ({ finalizePaidOrder: vi.fn() }));
vi.mock('@/lib/models/mach/customer', () => ({ getCustomer: vi.fn(), createCustomer: vi.fn() }));
vi.mock('@/lib/models/mach/products', () => ({ getProduct: vi.fn(), getProductVariant: vi.fn() }));

import { NextRequest } from 'next/server';
import { GET } from '@/app/api/orders/route';
import { getDbAsync } from '@/lib/db';
import { auth } from '@clerk/nextjs/server';

function orderRow(id: string, payment_status: string, status: string) {
  return {
    id,
    customer_id: 'user_1',
    status,
    payment_status,
    total_amount: { amount: 2500, currency: 'USD' },
    currency_code: 'USD',
    items: [],
    shipping_address: null,
    billing_address: null,
    external_references: null,
    extensions: null,
    created_at: '2026-07-10T00:00:00Z',
    updated_at: '2026-07-10T00:00:00Z',
  };
}

const ROWS = [
  orderRow('WEB-U-PAID', 'paid', 'processing'),
  orderRow('WEB-U-PENDING', 'pending', 'pending'),
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth).mockResolvedValue({ userId: 'user_1' } as any);
  vi.mocked(getDbAsync).mockResolvedValue({
    select: () => ({ from: () => ({ orderBy: () => Promise.resolve(ROWS) }) }),
  } as any);
});

function getRequest(qs: string) {
  return new NextRequest(`http://localhost/api/orders?${qs}`);
}

describe('GET /api/orders unpaid-draft filter (BMC-167 M1)', () => {
  it('excludes unpaid pending drafts by default', async () => {
    const res = await GET(getRequest('userId=user_1'));
    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.meta.total).toBe(1);
    const body = JSON.stringify(json.data);
    expect(body).toContain('WEB-U-PAID');
    expect(body).not.toContain('WEB-U-PENDING');
  });

  it('includes pending drafts when ?includePending=true', async () => {
    const res = await GET(getRequest('userId=user_1&includePending=true'));
    const json = (await res.json()) as any;
    expect(json.meta.total).toBe(2);
    expect(JSON.stringify(json.data)).toContain('WEB-U-PENDING');
  });

  it('a specific ?orderId= lookup still returns the exact order even if pending', async () => {
    const res = await GET(getRequest('userId=user_1&orderId=WEB-U-PENDING'));
    const json = (await res.json()) as any;
    expect(json.meta.total).toBe(1);
    expect(JSON.stringify(json.data)).toContain('WEB-U-PENDING');
  });
});
