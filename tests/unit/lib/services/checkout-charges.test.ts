/**
 * Unit tests for the shared checkout-charges seam (BMC-201).
 *
 * This module computes the SERVER's expected tax + shipping (cents) for a cart +
 * destination — the values `/api/payment-intent` folds into (and persists for)
 * the enforced charge floor, and the same Stripe-Tax-vs-fallback logic `/api/tax`
 * quotes the shopper with. These tests pin:
 *   - shipping is deterministic (standard / AK-HI surcharge / free over threshold);
 *   - tax uses Stripe Tax when usable, else the flat fallback on goods + shipping,
 *     with a distinct reason for no-address / stripe-error / not-configured;
 *   - the one-shot extras helper prices from the catalog and fails closed when a
 *     line is unpriceable (never spending a Stripe Tax call on a doomed cart).
 *
 * Pure unit test (CI `npm test`): Stripe + the catalog data sources are mocked;
 * `order-pricing` (calculateShipping / computeCatalogLineCents) is left real.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/stripe', () => ({
  calculateTax: vi.fn(),
  isStripeConfigured: vi.fn().mockReturnValue(true),
}));

vi.mock('@/lib/models/mach/products', () => ({
  getProduct: vi.fn(),
  getProductVariant: vi.fn(),
}));

import {
  computeExpectedShippingCents,
  computeExpectedTaxCents,
  computeExpectedChargeExtras,
  FALLBACK_TAX_RATE,
} from '@/lib/services/checkout-charges';
import { calculateTax, isStripeConfigured } from '@/lib/stripe';
import { getProductVariant, getProduct } from '@/lib/models/mach/products';

const VARIANT_TEA = { id: 'var-tea-1', product_id: 'tea-1', price: { amount: 2500, currency: 'USD' } };
const caAddress = { line1: '1 St', city: 'Town', region: 'CA', postal_code: '90210' } as any;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isStripeConfigured).mockReturnValue(true);
  vi.mocked(getProductVariant).mockImplementation(async (id: string) =>
    id === VARIANT_TEA.id ? (VARIANT_TEA as any) : null
  );
  vi.mocked(getProduct).mockResolvedValue(null as any);
});

describe('computeExpectedShippingCents', () => {
  it('charges standard $9.99 shipping under the free-shipping threshold', () => {
    expect(computeExpectedShippingCents(2500, caAddress)).toBe(999);
  });

  it('is free at/over the $100 threshold', () => {
    expect(computeExpectedShippingCents(10000, caAddress)).toBe(0);
    expect(computeExpectedShippingCents(15000, caAddress)).toBe(0);
  });

  it('applies the AK/HI surcharge ($19.99)', () => {
    expect(computeExpectedShippingCents(2500, { ...caAddress, region: 'AK' })).toBe(1999);
    expect(computeExpectedShippingCents(2500, { ...caAddress, region: 'HI' })).toBe(1999);
  });

  it('defaults to standard shipping when the address is missing', () => {
    expect(computeExpectedShippingCents(2500, null)).toBe(999);
  });
});

describe('computeExpectedTaxCents', () => {
  it('uses Stripe Tax when the address is usable, returning its cents verbatim', async () => {
    vi.mocked(calculateTax).mockResolvedValue({ tax_amount_exclusive: 219 } as any);
    const res = await computeExpectedTaxCents({ lineCents: [2500], shippingAddress: caAddress, shippingCents: 999 });
    expect(res).toEqual({ taxCents: 219, calculatedBy: 'stripe' });
    // Stripe Tax line item is the catalog cents; shipping is passed as shipping_cost.
    const params = vi.mocked(calculateTax).mock.calls[0][0] as any;
    expect(params.line_items[0].amount).toBe(2500);
    expect(params.shipping_cost.amount).toBe(999);
  });

  it('falls back to the flat rate (no_address) with no usable address, taxing goods + shipping', async () => {
    const res = await computeExpectedTaxCents({ lineCents: [2500], shippingAddress: undefined, shippingCents: 999 });
    expect(res.calculatedBy).toBe('fallback');
    expect(res.fallbackReason).toBe('no_address');
    expect(res.taxCents).toBe(Math.round((2500 + 999) * FALLBACK_TAX_RATE)); // 245
    expect(vi.mocked(calculateTax)).not.toHaveBeenCalled();
  });

  it('falls back (not_configured) without calling Stripe when Stripe is unconfigured', async () => {
    vi.mocked(isStripeConfigured).mockReturnValue(false);
    const res = await computeExpectedTaxCents({ lineCents: [2500], shippingAddress: caAddress, shippingCents: 999 });
    expect(res.calculatedBy).toBe('fallback');
    expect(res.fallbackReason).toBe('not_configured');
    expect(vi.mocked(calculateTax)).not.toHaveBeenCalled();
  });

  it('falls back (stripe_error) on a Stripe Tax failure rather than throwing', async () => {
    vi.mocked(calculateTax).mockRejectedValue(new Error('stripe down'));
    const res = await computeExpectedTaxCents({ lineCents: [2500], shippingAddress: caAddress, shippingCents: 999 });
    expect(res.calculatedBy).toBe('fallback');
    expect(res.fallbackReason).toBe('stripe_error');
    expect(res.taxCents).toBe(Math.round((2500 + 999) * FALLBACK_TAX_RATE));
  });
});

describe('computeExpectedChargeExtras', () => {
  const line = { product_id: 'tea-1', variant_id: 'var-tea-1', quantity: 1 };

  it('prices goods from the catalog and computes shipping + Stripe tax in one pass', async () => {
    vi.mocked(calculateTax).mockResolvedValue({ tax_amount_exclusive: 200 } as any);
    const extras = await computeExpectedChargeExtras([line], caAddress);
    expect(extras).toEqual({
      goodsCents: 2500,
      shippingCents: 999,
      taxCents: 200,
      taxCalculatedBy: 'stripe',
      priceable: true,
    });
  });

  it('fails closed (priceable: false) and skips the Stripe call when a line is unpriceable', async () => {
    const extras = await computeExpectedChargeExtras(
      [{ product_id: 'tea-1', variant_id: 'ghost', quantity: 1 }],
      caAddress
    );
    expect(extras.priceable).toBe(false);
    expect(extras.taxCents).toBe(0);
    expect(vi.mocked(calculateTax)).not.toHaveBeenCalled();
  });
});
