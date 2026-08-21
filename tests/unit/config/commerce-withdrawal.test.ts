/**
 * A merchant archiving a product must actually stop it selling (GOOB).
 *
 * `isPubliclyPurchasableProduct` is already the withdrawal seam — the PDP
 * (`app/product/[slug]/page.tsx:122`) and the sitemap both call it to keep
 * launch-disabled gift cards off the storefront. Before this change it only
 * knew about gift cards, so archiving the going-out-of-business bundle SKUs
 * left them rendering a working PDP and priceable server-side.
 *
 * Missing status must read as ACTIVE. Both status columns default to 'active',
 * but a NULL row must never take the entire catalog offline.
 */
import { describe, it, expect } from 'vitest';
import {
  isActiveStatus,
  isPubliclyPurchasableProduct,
  isSellableVariant,
} from '@/lib/config/commerce';

describe('isActiveStatus', () => {
  it('treats an explicit active status as active', () => {
    expect(isActiveStatus('active')).toBe(true);
  });

  it('treats missing status as active so a NULL row cannot dark the catalog', () => {
    expect(isActiveStatus(undefined)).toBe(true);
    expect(isActiveStatus(null)).toBe(true);
    expect(isActiveStatus('')).toBe(true);
  });

  it('treats every other status as withdrawn', () => {
    expect(isActiveStatus('archived')).toBe(false);
    expect(isActiveStatus('inactive')).toBe(false);
    expect(isActiveStatus('draft')).toBe(false);
    expect(isActiveStatus('discontinued')).toBe(false);
  });
});

describe('isPubliclyPurchasableProduct — status', () => {
  it('keeps an active tea product purchasable', () => {
    expect(
      isPubliclyPurchasableProduct({ id: 'tea-1', slug: 'morning', status: 'active' })
    ).toBe(true);
  });

  it('keeps a product with no status purchasable', () => {
    expect(isPubliclyPurchasableProduct({ id: 'tea-1', slug: 'morning' })).toBe(true);
  });

  it('withdraws an archived product', () => {
    expect(
      isPubliclyPurchasableProduct({
        id: 'bundle-1',
        slug: 'clearly-calendula-sample-pack',
        status: 'archived',
      })
    ).toBe(false);
  });

  it('still withdraws a launch-disabled gift card regardless of status', () => {
    expect(
      isPubliclyPurchasableProduct({ id: 'gift-card', slug: 'gift-card', status: 'active' })
    ).toBe(false);
  });
});

describe('isSellableVariant', () => {
  it('accepts an active variant', () => {
    expect(isSellableVariant({ status: 'active' })).toBe(true);
  });

  it('accepts a variant with no status', () => {
    expect(isSellableVariant({})).toBe(true);
  });

  it('rejects a discontinued variant', () => {
    expect(isSellableVariant({ status: 'discontinued' })).toBe(false);
  });

  it('rejects a null variant', () => {
    expect(isSellableVariant(null)).toBe(false);
    expect(isSellableVariant(undefined)).toBe(false);
  });
});
