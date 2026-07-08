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
import type { MachMoney } from '@/lib/money';
import { toWireMoney } from '@/lib/money';

/**
 * MACH wire-shaped variant (BMC-164 review follow-up). Structurally distinct
 * from `ProductVariant` — its money fields are `MachMoney` (decimal major
 * units + required precision), not the internal cents-shaped `Money`. This
 * lets `tsc` catch a wire value being fed back into a cents-typed DB-write
 * sink (createProductVariant/updateProductVariant/bulkUpdateVariantPrices),
 * which the old "reuse ProductVariant as the return type" approach couldn't.
 */
export type WireVariant = Omit<ProductVariant, 'price' | 'compare_at_price' | 'cost'> & {
  price: MachMoney;
  compare_at_price?: MachMoney;
  cost?: MachMoney;
};

/** MACH wire-shaped product: variants carry `WireVariant`, not `ProductVariant` (BMC-164). */
export type WireProduct = Omit<Product, 'variants'> & {
  variants?: WireVariant[];
};

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
function toWireVariant(variant: ProductVariant): WireVariant {
  // Destructure the cents-typed money fields out of `rest` first — spreading
  // `variant` directly (still carrying `Money`-typed price/compare_at_price/
  // cost) alongside the MachMoney overrides below defeats TS's structural
  // check on the conditional spreads and lets a `Money` slip through as
  // `MachMoney` uncaught.
  const { price, compare_at_price, cost, ...rest } = variant;
  return {
    ...rest,
    price: toWireMoney(price),
    ...(compare_at_price !== undefined && compare_at_price !== null
      ? { compare_at_price: toWireMoney(compare_at_price) }
      : {}),
    ...(cost !== undefined && cost !== null
      ? { cost: toWireMoney(cost) }
      : {}),
  };
}

/**
 * Converts every variant's money fields on a Product to the MACH wire shape.
 * Apply this last, immediately before serializing an API response — it does
 * not touch any other field and is safe to compose with toPublicProduct.
 */
export function toWireProduct(product: Product): WireProduct {
  return {
    ...product,
    variants: product.variants?.map(toWireVariant),
  };
}
