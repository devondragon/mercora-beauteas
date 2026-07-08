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
import { toWireMoney } from '@/lib/money';

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

/**
 * Converts every stored (minor-unit) money field on a variant — price,
 * compare_at_price, cost — to the MACH wire shape (decimal major units +
 * precision) at the API response boundary (BMC-164). Internal callers keep
 * working with cents; only the serialized response emits `.toMach()`.
 */
function toWireVariant(variant: ProductVariant): ProductVariant {
  return {
    ...variant,
    price: toWireMoney(variant.price),
    ...(variant.compare_at_price !== undefined && variant.compare_at_price !== null
      ? { compare_at_price: toWireMoney(variant.compare_at_price) }
      : {}),
    ...(variant.cost !== undefined && variant.cost !== null
      ? { cost: toWireMoney(variant.cost) }
      : {}),
  };
}

/**
 * Converts every variant's money fields on a Product to the MACH wire shape.
 * Apply this last, immediately before serializing an API response — it does
 * not touch any other field and is safe to compose with toPublicProduct.
 */
export function toWireProduct(product: Product): Product {
  return {
    ...product,
    variants: product.variants?.map(toWireVariant),
  };
}
