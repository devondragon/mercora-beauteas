/**
 * Regression test for BMC-187 — the free-shipping threshold in
 * POST /api/shipping-options is computed from SERVER catalog prices, not the
 * client-supplied `item.price`.
 *
 * The old code summed `item.price * item.quantity` from the request body, so a
 * tampered cart could inflate its total past the threshold and get free shipping
 * it hadn't earned. The route now recomputes the goods subtotal from the catalog
 * (`computeCatalogSubtotalCents`) and fails CLOSED (no free shipping) when a line
 * can't be priced.
 *
 * Pure unit test (CI `npm test`): settings + the catalog seam are mocked;
 * order-pricing is left real.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/rate-limit', () => ({
  enforceRateLimit: vi.fn().mockResolvedValue(null),
  getClientIp: vi.fn().mockReturnValue('test-ip'),
}));

vi.mock('@/lib/utils/settings', () => ({
  getSettings: vi.fn(),
}));

vi.mock('@/lib/models/mach/products', () => ({
  getProduct: vi.fn(),
  getProductVariant: vi.fn(),
}));

import { NextRequest } from 'next/server';
import { POST } from '@/app/api/shipping-options/route';
import { getSettings } from '@/lib/utils/settings';
import { getProductVariant, getProduct } from '@/lib/models/mach/products';
import { MAX_ORDER_LINE_ITEMS } from '@/lib/services/order-pricing';

// $25 tea variant (catalog price is 2500 cents).
const VARIANT_TEA = { id: 'var-tea-1', product_id: 'tea-1', price: { amount: 2500, currency: 'USD' } };

const address = { line1: '1 St', city: 'Town', region: 'CA', postal_code: '90210', country: 'US' };

function postRequest(body: unknown) {
  return new NextRequest('http://localhost/api/shipping-options', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function standardCost(res: Response): Promise<number> {
  const { options } = (await res.json()) as { options: Array<{ id: string; cost: number }> };
  return options.find((o) => o.id === 'standard')!.cost;
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default settings: rely on the route's built-in flat methods, $75 threshold,
  // standard free-shipping method.
  vi.mocked(getSettings).mockResolvedValue({} as any);
  vi.mocked(getProductVariant).mockImplementation(async (id: string) =>
    id === VARIANT_TEA.id ? (VARIANT_TEA as any) : null
  );
  vi.mocked(getProduct).mockResolvedValue(null as any);
});

describe('POST /api/shipping-options free-shipping threshold (BMC-187)', () => {
  it('does NOT grant free shipping when a tampered client price crosses the threshold but the catalog subtotal does not', async () => {
    // Client claims $999 each (would be $999 > $75), but the catalog price is
    // $25 for a single unit → real subtotal $25 < $75.
    const res = await POST(
      postRequest({
        address,
        items: [{ productId: 'tea-1', variantId: 'var-tea-1', quantity: 1, price: 99900 }],
      })
    );
    expect(res.status).toBe(200);
    expect(await standardCost(res)).toBe(5.99);
  });

  it('grants free shipping when the catalog subtotal genuinely meets the threshold', async () => {
    // `free_methods` stated explicitly — the module default is now empty, so
    // nothing is free unless an admin configured it. This pins the mechanic.
    vi.mocked(getSettings).mockImplementation(async (category?: string) =>
      (category === 'shipping' ? { 'shipping.free_methods': ['standard'] } : {}) as any
    );

    // 3 × $25 = $75 catalog → qualifies regardless of client price.
    const res = await POST(
      postRequest({
        address,
        items: [{ productId: 'tea-1', variantId: 'var-tea-1', quantity: 3, price: 1 }],
      })
    );
    expect(res.status).toBe(200);
    expect(await standardCost(res)).toBe(0);
  });

  it('fails closed (no free shipping) when a line cannot be priced from the catalog', async () => {
    // Unknown variant → pricing error → not eligible even with a huge quantity.
    const res = await POST(
      postRequest({
        address,
        items: [{ productId: 'tea-1', variantId: 'ghost', quantity: 100, price: 99900 }],
      })
    );
    expect(res.status).toBe(200);
    expect(await standardCost(res)).toBe(5.99);
  });

  it('rejects an unreasonably large items array before pricing it', async () => {
    const many = Array.from({ length: MAX_ORDER_LINE_ITEMS + 1 }, () => ({
      productId: 'tea-1',
      variantId: 'var-tea-1',
      quantity: 1,
    }));
    const res = await POST(postRequest({ address, items: many }));
    expect(res.status).toBe(400);
    // Rejected BEFORE any catalog pricing happens.
    expect(vi.mocked(getProductVariant)).not.toHaveBeenCalled();
  });
});
