/**
 * Regression test for BMC-200 — POST /api/tax derives its taxable base from
 * SERVER catalog prices, not the client-supplied `item.price`.
 *
 * The old code summed `item.price * item.quantity` from the request body in both
 * the fallback path and the Stripe Tax path, so a tampered `item.price` could
 * under-report the taxable amount and under-collect sales tax. The route now
 * recomputes each line's taxable amount from the catalog
 * (`computeCatalogLineCents`) and fails CLOSED (422) when a line can't be priced.
 *
 * Pure unit test (CI `npm test`): the rate limiter, the catalog seam's data
 * sources, and Stripe are mocked; `lib/services/order-pricing` is left real.
 * `@/lib/stripe` is fully mocked (it instantiates the Stripe SDK at import) —
 * the two amount helpers are reimplemented with the same dollars↔cents behavior.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/rate-limit', () => ({
  enforceRateLimit: vi.fn().mockResolvedValue(null),
  getClientIp: vi.fn().mockReturnValue('test-ip'),
}));

vi.mock('@/lib/models/mach/products', () => ({
  getProduct: vi.fn(),
  getProductVariant: vi.fn(),
}));

vi.mock('@/lib/stripe', () => ({
  calculateTax: vi.fn(),
  // dollars → cents / cents → dollars, matching the real Money-based helpers.
  formatAmountForStripe: (amount: number) => Math.round(amount * 100),
  formatAmountFromStripe: (amount: number) => Math.round(amount) / 100,
  isStripeConfigured: vi.fn().mockReturnValue(true),
}));

import { NextRequest } from 'next/server';
import { POST } from '@/app/api/tax/route';
import { getProductVariant, getProduct } from '@/lib/models/mach/products';
import { calculateTax } from '@/lib/stripe';
import { MAX_ORDER_LINE_ITEMS } from '@/lib/services/order-pricing';

// $25 tea variant (catalog price is 2500 cents).
const VARIANT_TEA = { id: 'var-tea-1', product_id: 'tea-1', price: { amount: 2500, currency: 'USD' } };

const address = { line1: '1 St', city: 'Town', region: 'CA', postal_code: '90210', country: 'US' };

function postRequest(body: unknown) {
  return new NextRequest('http://localhost/api/tax', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getProductVariant).mockImplementation(async (id: string) =>
    id === VARIANT_TEA.id ? (VARIANT_TEA as any) : null
  );
  vi.mocked(getProduct).mockResolvedValue(null as any);
});

describe('POST /api/tax taxable base (BMC-200)', () => {
  it('taxes the CATALOG subtotal on the fallback path, ignoring a tampered client price', async () => {
    // Client claims $999 each; catalog is $25 for a single unit. No shipping
    // address → fallback path (7%). Tax must be on $25, not $999.
    const res = await POST(
      postRequest({
        items: [{ productId: 'tea-1', variantId: 'var-tea-1', quantity: 1, price: 999 }],
      })
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      amount: number;
      calculated_by: string;
      breakdown: { subtotal: number; taxableAmount: number };
    };
    expect(body.calculated_by).toBe('fallback');
    expect(body.breakdown.subtotal).toBe(25); // catalog dollars, not 999
    expect(body.breakdown.taxableAmount).toBe(25);
    expect(body.amount).toBe(1.75); // 25 * 0.07
  });

  it('applies catalog quantity/price to the subtotal (3 × $25 = $75)', async () => {
    const res = await POST(
      postRequest({
        items: [{ productId: 'tea-1', variantId: 'var-tea-1', quantity: 3, price: 1 }],
      })
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { amount: number; breakdown: { subtotal: number } };
    expect(body.breakdown.subtotal).toBe(75);
    expect(body.amount).toBe(5.25); // 75 * 0.07
  });

  it('builds Stripe Tax line items from catalog cents, not the client price', async () => {
    vi.mocked(calculateTax).mockResolvedValue({ tax_amount_exclusive: 219 } as any);
    const res = await POST(
      postRequest({
        items: [{ productId: 'tea-1', variantId: 'var-tea-1', quantity: 1, price: 99900 }],
        shippingAddress: address,
        shippingCost: 0,
      })
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { amount: number; calculated_by: string };
    expect(body.calculated_by).toBe('stripe');
    expect(body.amount).toBe(2.19); // formatAmountFromStripe(219)

    // The Stripe line item amount is the catalog price in cents (2500), never the
    // tampered client price (99900 → would be 9,990,000 cents the old way).
    const params = vi.mocked(calculateTax).mock.calls[0][0] as any;
    expect(params.line_items).toHaveLength(1);
    expect(params.line_items[0].amount).toBe(2500);
  });

  it('fails closed (422) when a line cannot be priced from the catalog', async () => {
    // Unknown variant → pricing error → refuse to compute a tax base.
    const res = await POST(
      postRequest({
        items: [{ productId: 'tea-1', variantId: 'ghost', quantity: 1, price: 25 }],
        shippingAddress: address,
      })
    );
    expect(res.status).toBe(422);
    // Never reached Stripe with an unpriceable cart.
    expect(vi.mocked(calculateTax)).not.toHaveBeenCalled();
  });

  it('fails the whole cart closed (422) when one line among several cannot be priced', async () => {
    // A real tampering attempt mixes a legit item with a spoofed one. The bad
    // line must fail the ENTIRE request closed, not silently tax only the good
    // lines (which would under-collect).
    const res = await POST(
      postRequest({
        items: [
          { productId: 'tea-1', variantId: 'var-tea-1', quantity: 1, price: 25 },
          { productId: 'tea-1', variantId: 'ghost', quantity: 1, price: 1 },
        ],
        shippingAddress: address,
      })
    );
    expect(res.status).toBe(422);
    expect(vi.mocked(calculateTax)).not.toHaveBeenCalled();
  });

  it('fails closed (422) when a variant is smuggled under a mismatched product_id', async () => {
    // var-tea-1 belongs to tea-1, not expensive-product → binding check rejects.
    const res = await POST(
      postRequest({
        items: [{ productId: 'expensive-product', variantId: 'var-tea-1', quantity: 1, price: 1 }],
        shippingAddress: address,
      })
    );
    expect(res.status).toBe(422);
    expect(vi.mocked(calculateTax)).not.toHaveBeenCalled();
  });

  it('fails closed (422) on a zero-quantity line', async () => {
    const res = await POST(
      postRequest({
        items: [{ productId: 'tea-1', variantId: 'var-tea-1', quantity: 0, price: 25 }],
        shippingAddress: address,
      })
    );
    expect(res.status).toBe(422);
    expect(vi.mocked(calculateTax)).not.toHaveBeenCalled();
  });

  it('returns 503 (not a misleading 400) when a catalog read throws', async () => {
    // A transient D1 error is an infra failure, not a malformed request.
    vi.mocked(getProductVariant).mockRejectedValueOnce(new Error('D1 timeout'));
    const res = await POST(
      postRequest({
        items: [{ productId: 'tea-1', variantId: 'var-tea-1', quantity: 1, price: 25 }],
        shippingAddress: address,
      })
    );
    expect(res.status).toBe(503);
    expect(vi.mocked(calculateTax)).not.toHaveBeenCalled();
  });

  it('ignores a negative client shippingCost instead of zeroing out the tax', async () => {
    // No address → fallback path. A tampered negative shippingCost must not drag
    // the taxable base below the catalog subtotal.
    const res = await POST(
      postRequest({
        items: [{ productId: 'tea-1', variantId: 'var-tea-1', quantity: 1, price: 25 }],
        shippingCost: -100000,
      })
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { amount: number; breakdown: { taxableAmount: number } };
    expect(body.breakdown.taxableAmount).toBe(25); // clamped shipping (0) + $25 catalog
    expect(body.amount).toBe(1.75);
  });

  it('rejects an unreasonably large items array before pricing it', async () => {
    const many = Array.from({ length: MAX_ORDER_LINE_ITEMS + 1 }, () => ({
      productId: 'tea-1',
      variantId: 'var-tea-1',
      quantity: 1,
      price: 25,
    }));
    const res = await POST(postRequest({ items: many, shippingAddress: address }));
    expect(res.status).toBe(400);
    // Rejected BEFORE any catalog pricing happens.
    expect(vi.mocked(getProductVariant)).not.toHaveBeenCalled();
  });
});
