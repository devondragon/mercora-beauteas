/**
 * Unit tests for toPublicProduct() (BMC-149 / M6).
 *
 * Guards that the storefront-facing projection strips internal-only variant
 * fields (cost, barcode, inventory) while preserving public fields (name,
 * price, images, etc). Pure module — no Cloudflare/D1 deps — safe for the
 * jsdom unit env.
 */
import { describe, it, expect } from 'vitest';
import { toPublicProduct } from '@/lib/models/mach/product-serializer';
import type { Product, ProductVariant } from '@/lib/types';

function makeVariant(overrides: Partial<ProductVariant> = {}): ProductVariant {
  return {
    id: 'var_1',
    sku: 'SKU-1',
    option_values: [{ option_id: 'size', value: 'M' }],
    price: { amount: 2500, currency: 'USD' },
    status: 'active',
    position: 0,
    cost: { amount: 900, currency: 'USD' },
    barcode: '012345678905',
    inventory: { track_inventory: true, quantity: 42, allow_backorder: false },
    media: [{ type: 'image', url: 'https://example.com/variant.jpg' } as any],
    attributes: { color: 'blue' },
    ...overrides,
  };
}

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 'prod_1',
    name: 'Clearly Calendula — Morning Blend',
    description: 'A soothing morning skincare tea.',
    status: 'active',
    slug: 'clearly-calendula-morning',
    brand: 'BeauTeas',
    categories: ['cat_tea'],
    tags: ['skincare', 'tea'],
    primary_image: { type: 'image', url: 'https://example.com/product.jpg' } as any,
    variants: [makeVariant()],
    ...overrides,
  };
}

describe('toPublicProduct (BMC-149)', () => {
  it('strips cost, barcode, and inventory from every variant', () => {
    const product = makeProduct();
    const publicProduct = toPublicProduct(product);

    expect(publicProduct.variants).toHaveLength(1);
    const [variant] = publicProduct.variants!;
    expect(variant).not.toHaveProperty('cost');
    expect(variant).not.toHaveProperty('barcode');
    expect(variant).not.toHaveProperty('inventory');
  });

  it('retains storefront-safe fields on the product and its variants', () => {
    const product = makeProduct();
    const publicProduct = toPublicProduct(product);

    expect(publicProduct.id).toBe(product.id);
    expect(publicProduct.name).toBe(product.name);
    expect(publicProduct.description).toBe(product.description);
    expect(publicProduct.status).toBe(product.status);
    expect(publicProduct.slug).toBe(product.slug);
    expect(publicProduct.categories).toEqual(product.categories);
    expect(publicProduct.primary_image).toEqual(product.primary_image);

    const [variant] = publicProduct.variants!;
    expect(variant.id).toBe('var_1');
    expect(variant.sku).toBe('SKU-1');
    expect(variant.price).toEqual({ amount: 2500, currency: 'USD' });
    expect(variant.status).toBe('active');
    expect(variant.media).toEqual(product.variants![0].media);
    expect(variant.attributes).toEqual({ color: 'blue' });
  });

  it('does not mutate the original product or variant objects', () => {
    const product = makeProduct();
    const original = JSON.parse(JSON.stringify(product));

    toPublicProduct(product);

    expect(product).toEqual(original);
  });

  it('handles products with no variants gracefully', () => {
    const product = makeProduct({ variants: undefined });
    const publicProduct = toPublicProduct(product);

    expect(publicProduct.variants).toBeUndefined();
  });

  it('strips internal fields from every variant when a product has several', () => {
    const product = makeProduct({
      variants: [
        makeVariant({ id: 'var_1', cost: { amount: 100, currency: 'USD' } }),
        makeVariant({ id: 'var_2', cost: { amount: 200, currency: 'USD' }, barcode: '999' }),
      ],
    });

    const publicProduct = toPublicProduct(product);

    expect(publicProduct.variants).toHaveLength(2);
    for (const variant of publicProduct.variants!) {
      expect(variant).not.toHaveProperty('cost');
      expect(variant).not.toHaveProperty('barcode');
      expect(variant).not.toHaveProperty('inventory');
    }
  });
});
