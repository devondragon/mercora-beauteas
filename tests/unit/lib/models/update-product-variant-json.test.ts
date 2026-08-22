/**
 * Regression test for the variant-write path in `updateProduct`.
 *
 * Every JSON-shaped column on `product_variants` is declared `mode: 'json'`
 * (lib/db/schema/products.ts), so Drizzle serializes the value on write. This
 * loop used to `JSON.stringify` each value first, so Drizzle stringified the
 * string again and the column ended up holding a JSON *text* scalar
 * (`"{\"quantity\":250}"`) instead of an object.
 *
 * Why that is worth a test rather than a comment: every JavaScript reader in
 * this codebase recovers from it (`parseInventoryField`, `parseMoneyField`,
 * `priceToCents`, `Money.fromStored` all re-parse a string starting with `{`),
 * so nothing errored and nothing looked wrong on the storefront. The damage was
 * only visible from SQL — `json_extract(inventory, '$.quantity')` is NULL for a
 * text scalar, which the guarded stock decrement in
 * lib/services/inventory-adjustment.ts coalesces to 0, so it matched zero rows
 * and every sale of an affected variant was flagged oversold while its stock
 * never moved. The BeauTeas repair migration for the rows this wrote (`0033`)
 * lives on the `goob` branch and was not backfilled to `main`.
 *
 * The assertion is therefore on the exact TYPE handed to Drizzle, which is the
 * only layer where the bug is observable.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../lib/db', () => ({
  getDbAsync: vi.fn(),
}));

import { updateProduct } from '@/lib/models/mach/products';
import { getDbAsync } from '@/lib/db';

let variantSets: any[] = [];

function makeDb() {
  return {
    update: vi.fn().mockImplementation((table: any) => ({
      set: vi.fn().mockImplementation((row: any) => {
        // The product UPDATE and the variant UPDATE both land here; only the
        // variant write carries these columns.
        if ('inventory' in row || 'price' in row || 'option_values' in row) {
          variantSets.push(row);
        }
        return { where: vi.fn().mockResolvedValue(undefined) };
      }),
    })),
    select: vi.fn().mockImplementation(() => ({
      from: vi.fn().mockImplementation(() => ({
        where: vi.fn().mockResolvedValue([]),
      })),
    })),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  variantSets = [];
  vi.mocked(getDbAsync).mockResolvedValue(makeDb() as any);
});

const INVENTORY = { track_inventory: true, quantity: 144, allow_backorder: false };
const PRICE = { amount: 300, currency: 'USD' };

describe('updateProduct — variant JSON columns', () => {
  it('hands Drizzle OBJECTS, never pre-stringified JSON', async () => {
    await updateProduct('prod_evening', {
      name: 'Clearly Calendula Evening',
      variants: [
        {
          id: 'variant_evening',
          inventory: INVENTORY,
          price: PRICE,
          compare_at_price: { amount: 2000, currency: 'USD' },
          option_values: [{ option_id: 'size', value: 'One box' }],
          media: [{ type: 'image' }],
        } as any,
      ],
    } as any);

    expect(variantSets).toHaveLength(1);
    const written = variantSets[0];

    // The bug: `typeof written.inventory === 'string'`.
    expect(typeof written.inventory).toBe('object');
    expect(written.inventory).toEqual(INVENTORY);
    expect(typeof written.price).toBe('object');
    expect(written.price).toEqual(PRICE);
    expect(typeof written.compare_at_price).toBe('object');
    expect(Array.isArray(written.option_values)).toBe(true);
    expect(Array.isArray(written.media)).toBe(true);
  });

  it('still writes scalar columns as scalars', async () => {
    await updateProduct('prod_evening', {
      name: 'Clearly Calendula Evening',
      variants: [
        {
          id: 'variant_evening',
          inventory: INVENTORY,
          sku: 'BTCCE1',
          status: 'active',
          position: 1,
          shipping_required: true,
        } as any,
      ],
    } as any);

    const written = variantSets[0];
    expect(written.sku).toBe('BTCCE1');
    expect(written.status).toBe('active');
    expect(written.position).toBe(1);
    // Booleans persist as SQLite integers on this column.
    expect(written.shipping_required).toBe(1);
  });

  it('omits columns the caller did not supply', async () => {
    // The loop is additive: a partial variant update must not null out the
    // columns it says nothing about.
    await updateProduct('prod_evening', {
      name: 'Clearly Calendula Evening',
      variants: [{ id: 'variant_evening', inventory: INVENTORY } as any],
    } as any);

    const written = variantSets[0];
    expect(written).not.toHaveProperty('price');
    expect(written).not.toHaveProperty('media');
    expect(written).not.toHaveProperty('cost');
  });
});
