/**
 * Regression tests for the launch tax fallback: discounted merchandise only at
 * 3.25% in Colorado, zero elsewhere, with shipping excluded from fallback tax.
 *
 * Two fallback branches are covered:
 *  - no usable shipping address → early fallback
 *  - Stripe Tax call throws → catch-branch fallback
 *
 * Pure unit test (CI `npm test`): Stripe + rate-limit seams are mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/rate-limit', () => ({
  enforceRateLimit: vi.fn().mockResolvedValue(null),
  getClientIp: vi.fn().mockReturnValue('test-ip'),
}));

vi.mock('@/lib/stripe', () => ({
  calculateTax: vi.fn(),
  formatAmountForStripe: vi.fn((a: number) => Math.round(a * 100)),
  formatAmountFromStripe: vi.fn((a: number) => a / 100),
  isStripeConfigured: vi.fn().mockReturnValue(true),
}));

// The taxable base is now derived from the catalog (BMC-200), so mock the catalog
// seam's data sources — otherwise the route reaches the real getCloudflareContext().
vi.mock('@/lib/models/mach/products', () => ({
  getProduct: vi.fn(),
  getProductVariant: vi.fn(),
}));

import { NextRequest } from 'next/server';
import { POST } from '@/app/api/tax/route';
import { calculateTax } from '@/lib/stripe';
import { getProductVariant, getProduct } from '@/lib/models/mach/products';

const COLORADO_FALLBACK_RATE = 0.0325;

// $100 variant (catalog price 10000 cents) — matches the base this test asserts.
const VARIANT = { id: 'var-1', product_id: 'tea-1', price: { amount: 10000, currency: 'USD' } };

function postRequest(body: unknown) {
  return new NextRequest('http://localhost/api/tax', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

interface TaxResponse {
  calculated_by: string;
  amount: number;
  breakdown: { subtotal: number; shippingCost: number; taxableAmount: number; taxAmount: number; total: number };
}

const items = [{ productId: 'tea-1', variantId: 'var-1', price: 100, quantity: 1 }];
const address = { line1: '1 St', city: 'Town', region: 'CA', postal_code: '90210' };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getProductVariant).mockImplementation(async (id: string) =>
    id === VARIANT.id ? (VARIANT as any) : null
  );
  vi.mocked(getProduct).mockResolvedValue({ id: 'tea-1', type: 'Tea Bags', tax_category: 'food' } as any);
});

describe('POST /api/tax launch fallback policy', () => {
  it('rejects an explicit non-US destination', async () => {
    const res = await POST(postRequest({
      items,
      shippingAddress: { ...address, country: 'CA', region: 'ON', postal_code: 'M5V 2T6' },
      shippingCost: 10,
    }));
    expect(res.status).toBe(400);
  });

  it('outside Colorado fallback is zero', async () => {
    const res = await POST(postRequest({ items, shippingAddress: { ...address, postal_code: '' }, shippingCost: 10 }));
    const body = (await res.json()) as TaxResponse;
    expect(body.calculated_by).toBe('fallback');
    expect(body.breakdown.taxableAmount).toBe(110); // 100 subtotal + 10 shipping
    expect(body.breakdown.taxAmount).toBe(0);
  });

  it('Stripe-error fallback in Colorado taxes discounted goods only', async () => {
    vi.mocked(calculateTax).mockRejectedValue(new Error('stripe down'));
    const res = await POST(postRequest({ items, shippingAddress: { ...address, region: 'co' }, shippingCost: 10 }));
    const body = (await res.json()) as TaxResponse;
    expect(body.calculated_by).toBe('fallback');
    expect(body.breakdown.taxableAmount).toBe(110);
    expect(body.breakdown.taxAmount).toBeCloseTo(100 * COLORADO_FALLBACK_RATE, 5);
  });
});
