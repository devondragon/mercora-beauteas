/**
 * `canonicalizeOrderItemsDisplay` must resolve a line's thumbnail from the
 * catalog for BOTH stored image shapes.
 *
 * It used to take `primary_image` only when it was a plain string. The catalog
 * stores it as an OBJECT in both real shapes — flat `{url, alt_text}` from the
 * Shopify ETL and MACH `{file: {url}}` from the admin editor — so `imageUrl`
 * was left unset for effectively every product and the order confirmation email
 * rendered its grey "No Image" box where the product thumbnail belongs. Nothing
 * failed; the receipt was just quietly image-less.
 *
 * The function returns the bare R2 key on purpose: `getAbsoluteImageUrl` in
 * lib/utils/email.ts turns that into the width-100 CDN URL the email needs, so
 * emitting an absolute URL here would double-wrap it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/models/mach/products', () => ({
  getProduct: vi.fn(),
  getProductVariant: vi.fn(),
}));

vi.mock('@/lib/models/mach/giftCard', () => ({
  getGiftCardByCode: vi.fn(),
}));

import { canonicalizeOrderItemsDisplay } from '@/lib/services/order-pricing';
import { getProduct } from '@/lib/models/mach/products';

const LINE = { product_id: 'prod_morning', product_name: 'stale name', quantity: 1 };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('canonicalizeOrderItemsDisplay — line thumbnails', () => {
  it('resolves the flat ETL shape', async () => {
    vi.mocked(getProduct).mockResolvedValue({
      name: 'Clearly Calendula Morning',
      primary_image: { url: 'products/clearly-calendula-morning.jpg', alt_text: 'x' },
    } as any);

    const [item] = await canonicalizeOrderItemsDisplay([{ ...LINE }] as any);

    expect(item.imageUrl).toBe('products/clearly-calendula-morning.jpg');
    expect(item.product_name).toBe('Clearly Calendula Morning');
  });

  it('resolves the MACH shape the admin editor writes', async () => {
    vi.mocked(getProduct).mockResolvedValue({
      name: 'Clearly Calendula Morning',
      primary_image: {
        type: 'image',
        file: { url: 'products/clearly-calendula-morning.jpg', format: 'jpg' },
      },
    } as any);

    const [item] = await canonicalizeOrderItemsDisplay([{ ...LINE }] as any);

    expect(item.imageUrl).toBe('products/clearly-calendula-morning.jpg');
  });

  it('still accepts a bare string, and falls back to media', async () => {
    vi.mocked(getProduct).mockResolvedValue({
      name: 'X',
      primary_image: 'products/bare.jpg',
    } as any);
    expect((await canonicalizeOrderItemsDisplay([{ ...LINE }] as any))[0].imageUrl).toBe(
      'products/bare.jpg'
    );

    vi.mocked(getProduct).mockResolvedValue({
      name: 'X',
      media: [{ file: { url: 'products/from-media.jpg' } }],
    } as any);
    expect((await canonicalizeOrderItemsDisplay([{ ...LINE }] as any))[0].imageUrl).toBe(
      'products/from-media.jpg'
    );
  });

  it('returns a bare key, never an absolute URL, so the email can size it', async () => {
    vi.mocked(getProduct).mockResolvedValue({
      name: 'X',
      primary_image: { file: { url: 'products/x.jpg' } },
    } as any);

    const [item] = await canonicalizeOrderItemsDisplay([{ ...LINE }] as any);

    expect(item.imageUrl?.startsWith('http')).toBe(false);
    expect(item.imageUrl?.startsWith('/')).toBe(false);
  });

  it('leaves the line untouched when the product carries no image', async () => {
    vi.mocked(getProduct).mockResolvedValue({ name: 'X' } as any);

    const [item] = await canonicalizeOrderItemsDisplay([
      { ...LINE, imageUrl: 'client-supplied.jpg' },
    ] as any);

    // No catalog image to canonicalize against, so whatever the line already had
    // survives rather than being blanked.
    expect(item.imageUrl).toBe('client-supplied.jpg');
  });
});
