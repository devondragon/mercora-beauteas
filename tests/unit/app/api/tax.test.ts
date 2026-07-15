/**
 * Regression test for BMC-187 — the tax fallback paths in POST /api/tax tax the
 * SAME base the real Stripe Tax path taxes (`subtotal + shippingCost`), so a
 * future edit can't silently revert either branch to `subtotal`-only and
 * undercharge tax.
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

const FALLBACK_RATE = 0.07;

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
  vi.mocked(getProduct).mockResolvedValue(null as any);
});

describe('POST /api/tax fallback taxable base (BMC-187)', () => {
  it('no-address fallback taxes subtotal + shipping', async () => {
    const res = await POST(postRequest({ items, shippingCost: 10 }));
    const body = (await res.json()) as TaxResponse;
    expect(body.calculated_by).toBe('fallback');
    expect(body.breakdown.taxableAmount).toBe(110); // 100 subtotal + 10 shipping
    expect(body.breakdown.taxAmount).toBeCloseTo(110 * FALLBACK_RATE, 5);
    expect(body.breakdown.total).toBeCloseTo(110 + 110 * FALLBACK_RATE, 5);
  });

  it('Stripe-error fallback taxes subtotal + shipping', async () => {
    vi.mocked(calculateTax).mockRejectedValue(new Error('stripe down'));
    const res = await POST(postRequest({ items, shippingAddress: address, shippingCost: 10 }));
    const body = (await res.json()) as TaxResponse;
    expect(body.calculated_by).toBe('fallback');
    expect(body.breakdown.taxableAmount).toBe(110);
    expect(body.breakdown.taxAmount).toBeCloseTo(110 * FALLBACK_RATE, 5);
  });
});
