/**
 * Storefront-safe product projection (BMC-149).
 *
 * Pure, dependency-free module (type-only imports) so it can be unit-tested
 * directly in the jsdom test env without pulling in Cloudflare/D1 bindings.
 *
 * Non-admin API responses must never leak internal-only variant fields
 * (cost, barcode, raw inventory/stock counts) to storefront/public callers.
 */
import type { Product, ProductVariant } from '@/lib/types';

/**
 * Strips internal-only fields from a single variant: cost (COGS), barcode,
 * and inventory (raw stock counts/backorder details).
 */
function toPublicVariant(variant: ProductVariant): ProductVariant {
  const { cost, barcode, inventory, ...publicVariant } = variant;
  return publicVariant;
}

/**
 * Projects a Product down to storefront-safe fields for public (non-admin)
 * responses. Removes cost/barcode/inventory from every variant. All other
 * product fields (name, price, images, description, etc.) are preserved.
 */
export function toPublicProduct(product: Product): Product {
  return {
    ...product,
    variants: product.variants?.map(toPublicVariant),
  };
}
