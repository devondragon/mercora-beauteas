import { describe, it, expect, vi, beforeEach } from 'vitest';

// The service imports getDbAsync (Cloudflare-bound) and the products model at the
// top level. Mock both so this stays a pure unit test per vitest.config.ts —
// checkStockAvailability + the pure decision helpers never touch D1.
vi.mock('@/lib/db', () => ({ getDbAsync: vi.fn() }));
vi.mock('@/lib/models/mach/products', () => ({
  getProductVariant: vi.fn(),
  getProduct: vi.fn(),
}));

import {
  planLineAdjustment,
  normalizeInventory,
  checkStockAvailability,
  selectRestockLines,
  lineRestockKey,
  type NormalizedInventory,
} from '@/lib/services/inventory-adjustment';
import { getProductVariant, getProduct } from '@/lib/models/mach/products';

const variant = (id: string, inventory: unknown, product_id = 'prod') => ({
  id,
  product_id,
  inventory,
});

beforeEach(() => {
  vi.mocked(getProductVariant).mockReset();
  vi.mocked(getProduct).mockReset();
});

describe('planLineAdjustment', () => {
  const inv = (o: Partial<NormalizedInventory>): NormalizedInventory => ({
    track_inventory: false,
    allow_backorder: false,
    quantity: 0,
    ...o,
  });

  it('skips when inventory is null/undefined', () => {
    expect(planLineAdjustment(null)).toBe('skip');
    expect(planLineAdjustment(undefined)).toBe('skip');
  });

  it('skips an untracked variant (made-to-order / unlimited)', () => {
    expect(planLineAdjustment(inv({ track_inventory: false, quantity: 0 }))).toBe('skip');
  });

  it('decrements a tracked, non-backorderable variant', () => {
    expect(planLineAdjustment(inv({ track_inventory: true, allow_backorder: false }))).toBe(
      'decrement'
    );
  });

  it('backorders a tracked, backorderable variant', () => {
    expect(planLineAdjustment(inv({ track_inventory: true, allow_backorder: true }))).toBe(
      'backorder'
    );
  });
});

describe('normalizeInventory', () => {
  it('passes through an object with real booleans', () => {
    expect(
      normalizeInventory({ track_inventory: true, allow_backorder: false, quantity: 42 })
    ).toEqual({ track_inventory: true, allow_backorder: false, quantity: 42 });
  });

  it("coerces SQLite's 1/0 JSON booleans", () => {
    expect(
      normalizeInventory({ track_inventory: 1, allow_backorder: 1, quantity: 3 })
    ).toEqual({ track_inventory: true, allow_backorder: true, quantity: 3 });
  });

  it('parses a JSON string', () => {
    expect(
      normalizeInventory('{"track_inventory":true,"quantity":7,"allow_backorder":false}')
    ).toEqual({ track_inventory: true, allow_backorder: false, quantity: 7 });
  });

  it('treats a bare number as a quantity (untracked)', () => {
    expect(normalizeInventory(5)).toEqual({
      track_inventory: false,
      allow_backorder: false,
      quantity: 5,
    });
  });

  it('defaults null/malformed to untracked, zero quantity', () => {
    expect(normalizeInventory(null)).toEqual({
      track_inventory: false,
      allow_backorder: false,
      quantity: 0,
    });
    expect(normalizeInventory('not json')).toEqual({
      track_inventory: false,
      allow_backorder: false,
      quantity: 0,
    });
  });

  it('truncates a fractional or non-finite quantity to a safe integer', () => {
    expect(normalizeInventory({ track_inventory: true, quantity: 4.9 }).quantity).toBe(4);
    expect(normalizeInventory({ track_inventory: true, quantity: 'x' }).quantity).toBe(0);
  });
});

describe('checkStockAvailability', () => {
  it('passes when a tracked variant has enough on hand', async () => {
    vi.mocked(getProductVariant).mockResolvedValue(
      variant('v1', { track_inventory: true, quantity: 5, allow_backorder: false }) as any
    );
    const res = await checkStockAvailability([{ variant_id: 'v1', quantity: 3 }]);
    expect(res.ok).toBe(true);
    expect(res.shortfalls).toEqual([]);
  });

  it('passes when requested exactly equals on hand (boundary)', async () => {
    vi.mocked(getProductVariant).mockResolvedValue(
      variant('v1', { track_inventory: true, quantity: 3, allow_backorder: false }) as any
    );
    const res = await checkStockAvailability([{ variant_id: 'v1', quantity: 3 }]);
    expect(res.ok).toBe(true);
  });

  it('reports a shortfall when a tracked variant lacks stock', async () => {
    vi.mocked(getProductVariant).mockResolvedValue(
      variant('v1', { track_inventory: true, quantity: 2, allow_backorder: false }, 'prodA') as any
    );
    const res = await checkStockAvailability([
      { variant_id: 'v1', product_id: 'prodA', quantity: 3, product_name: 'Steel Mug' },
    ]);
    expect(res.ok).toBe(false);
    expect(res.shortfalls).toEqual([
      {
        variant_id: 'v1',
        product_id: 'prodA',
        product_name: 'Steel Mug',
        requested: 3,
        available: 2,
      },
    ]);
  });

  it('allows a backorderable variant regardless of on hand', async () => {
    vi.mocked(getProductVariant).mockResolvedValue(
      variant('v1', { track_inventory: true, quantity: 0, allow_backorder: true }) as any
    );
    const res = await checkStockAvailability([{ variant_id: 'v1', quantity: 10 }]);
    expect(res.ok).toBe(true);
  });

  it('allows an untracked variant regardless of on hand', async () => {
    vi.mocked(getProductVariant).mockResolvedValue(
      variant('v1', { track_inventory: false, quantity: 0 }) as any
    );
    const res = await checkStockAvailability([{ variant_id: 'v1', quantity: 99 }]);
    expect(res.ok).toBe(true);
  });

  it('skips gift-card lines without a catalog lookup', async () => {
    const res = await checkStockAvailability([{ product_id: 'gift-card', quantity: 100 }]);
    expect(res.ok).toBe(true);
    expect(getProductVariant).not.toHaveBeenCalled();
  });

  it('does not fail on a line whose variant cannot be resolved', async () => {
    vi.mocked(getProductVariant).mockResolvedValue(null as any);
    const res = await checkStockAvailability([{ variant_id: 'gone', quantity: 3 }]);
    expect(res.ok).toBe(true);
  });

  it('flags only the insufficient lines in a mixed cart', async () => {
    vi.mocked(getProductVariant).mockImplementation(async (id: string) => {
      if (id === 'ok') return variant('ok', { track_inventory: true, quantity: 10, allow_backorder: false }) as any;
      if (id === 'short') return variant('short', { track_inventory: true, quantity: 1, allow_backorder: false }) as any;
      if (id === 'backorder') return variant('backorder', { track_inventory: true, quantity: 0, allow_backorder: true }) as any;
      return null as any;
    });
    const res = await checkStockAvailability([
      { variant_id: 'ok', quantity: 2 },
      { variant_id: 'short', quantity: 5 },
      { variant_id: 'backorder', quantity: 8 },
    ]);
    expect(res.ok).toBe(false);
    expect(res.shortfalls.map((s) => s.variant_id)).toEqual(['short']);
  });

  it('aggregates demand across multiple lines of the SAME variant (2 + 2 > stock 3 fails)', async () => {
    vi.mocked(getProductVariant).mockResolvedValue(
      variant('v1', { track_inventory: true, quantity: 3, allow_backorder: false }) as any
    );
    const res = await checkStockAvailability([
      { variant_id: 'v1', quantity: 2 },
      { variant_id: 'v1', quantity: 2 },
    ]);
    expect(res.ok).toBe(false);
    expect(res.shortfalls).toHaveLength(1);
    expect(res.shortfalls[0]).toMatchObject({ variant_id: 'v1', requested: 4, available: 3 });
  });

  it('aggregated same-variant demand that fits stock passes (2 + 1 <= stock 3)', async () => {
    vi.mocked(getProductVariant).mockResolvedValue(
      variant('v1', { track_inventory: true, quantity: 3, allow_backorder: false }) as any
    );
    const res = await checkStockAvailability([
      { variant_id: 'v1', quantity: 2 },
      { variant_id: 'v1', quantity: 1 },
    ]);
    expect(res.ok).toBe(true);
  });
});

describe('lineRestockKey', () => {
  it('builds the admin UI composite key, defaulting a missing variant', () => {
    expect(lineRestockKey({ product_id: 'p1', variant_id: 'v1' })).toBe('p1-v1');
    expect(lineRestockKey({ product_id: 'p1' })).toBe('p1-default');
    expect(lineRestockKey({ productId: 'p1', variantId: 'v1' })).toBe('p1-v1');
  });
});

describe('selectRestockLines', () => {
  const orderItems = [
    { product_id: 'p1', variant_id: 'v1', quantity: 1 },
    { product_id: 'p2', variant_id: 'v2', quantity: 1 },
  ];

  it('full refund with no prior restock selects every line', () => {
    const { lines, keys } = selectRestockLines(orderItems, {
      fullRefund: true,
      refundedItemKeys: [],
      alreadyRestockedKeys: [],
    });
    expect(keys).toEqual(['p1-v1', 'p2-v2']);
    expect(lines).toHaveLength(2);
  });

  it('partial refund selects only the composite-key-matched lines', () => {
    const { keys } = selectRestockLines(orderItems, {
      fullRefund: false,
      refundedItemKeys: ['p1-v1'],
      alreadyRestockedKeys: [],
    });
    expect(keys).toEqual(['p1-v1']);
  });

  it('partial refund also matches a bare product id', () => {
    const { keys } = selectRestockLines(orderItems, {
      fullRefund: false,
      refundedItemKeys: ['p2'],
      alreadyRestockedKeys: [],
    });
    expect(keys).toEqual(['p2-v2']);
  });

  it('CRITICAL regression: full refund AFTER a partial does NOT re-restock the already-restocked line', () => {
    // p1 was restocked by a prior partial refund; the follow-up full refund must
    // restore only p2, never p1 again (else on-hand inflates above what was sold).
    const { lines, keys } = selectRestockLines(orderItems, {
      fullRefund: true,
      refundedItemKeys: [],
      alreadyRestockedKeys: ['p1-v1'],
    });
    expect(keys).toEqual(['p2-v2']);
    expect(lines).toHaveLength(1);
  });

  it('repeated partial re-selecting the same line does not restock it twice', () => {
    const { keys } = selectRestockLines(orderItems, {
      fullRefund: false,
      refundedItemKeys: ['p1-v1'],
      alreadyRestockedKeys: ['p1-v1'],
    });
    expect(keys).toEqual([]);
  });

  it('falls back to the default variant when a line has only a product_id', async () => {
    vi.mocked(getProduct).mockResolvedValue({
      id: 'prodX',
      default_variant_id: 'dv',
      variants: [
        variant('dv', { track_inventory: true, quantity: 1, allow_backorder: false }, 'prodX'),
        variant('other', { track_inventory: true, quantity: 99, allow_backorder: false }, 'prodX'),
      ],
    } as any);
    const res = await checkStockAvailability([{ product_id: 'prodX', quantity: 4 }]);
    expect(res.ok).toBe(false);
    expect(res.shortfalls[0].variant_id).toBe('dv');
  });
});
