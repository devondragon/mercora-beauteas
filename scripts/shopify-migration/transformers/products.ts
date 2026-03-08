/**
 * Product Transformer
 *
 * Transforms Shopify products, variants, and images to Mercora format.
 *
 * Key transformations:
 * - Price: decimal string "14.99" -> Money { amount: 1499, currency: "USD" }
 * - IDs: prod_{slugified_handle}, variant_{product_slug}_{sku_suffix}
 * - Images: Shopify CDN -> R2 key (products/{slug}.{ext})
 * - All JSON fields: JSON.stringify()'d for SQL insertion
 */

import type {
  ShopifyProduct,
  MercoraProductInsert,
  MercoraVariantInsert,
  TransformResult,
} from '../lib/types.js';
import type { IdMap } from '../lib/id-map.js';
import { logger } from '../lib/logger.js';

export interface ProductTransformOutput {
  product: MercoraProductInsert;
  variants: MercoraVariantInsert[];
  images: Array<{ sourceUrl: string; r2Key: string }>;
}

/**
 * Slugify a handle for use in IDs
 */
function slugifyForId(handle: string): string {
  return handle
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

/**
 * Convert Shopify decimal price string to Mercora Money object (cents).
 */
function toMoney(priceStr: string | null | undefined): { amount: number; currency: string } | null {
  if (!priceStr) return null;
  const parsed = parseFloat(priceStr);
  if (isNaN(parsed)) return null;
  return {
    amount: Math.round(parsed * 100),
    currency: 'USD',
  };
}

/**
 * Get file extension from a URL
 */
function getExtension(url: string): string {
  const match = url.match(/\.(\w+)(?:\?|$)/);
  return match?.[1]?.toLowerCase() ?? 'jpg';
}

/**
 * Generate a variant SKU suffix for the variant ID.
 */
function skuSuffix(variant: { sku?: string; option1?: string | null; position?: number }): string {
  if (variant.sku) {
    // Use last part of SKU (after last dash)
    const parts = variant.sku.split('-');
    return parts[parts.length - 1].toLowerCase().replace(/[^a-z0-9]/g, '');
  }
  if (variant.option1) {
    return variant.option1.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 10);
  }
  return String(variant.position ?? 1);
}

/**
 * Transform Shopify products to Mercora format.
 */
export function transformProducts(
  products: ShopifyProduct[],
  idMap: IdMap
): TransformResult<ShopifyProduct, ProductTransformOutput> {
  const records: ProductTransformOutput[] = [];
  const skipped: Array<{ record: ShopifyProduct; reason: string }> = [];
  const warnings: string[] = [];
  const resultIdMap = new Map<string, string>();
  const now = new Date().toISOString();

  for (const shopifyProduct of products) {
    if (!shopifyProduct.handle) {
      skipped.push({ record: shopifyProduct, reason: 'Missing handle' });
      continue;
    }

    const productSlug = slugifyForId(shopifyProduct.handle);
    const productId = `prod_${productSlug}`;
    const shopifyId = String(shopifyProduct.id);

    // Register in ID map
    idMap.register('products', shopifyId, productId);
    idMap.register('products', shopifyProduct.handle, productId);
    resultIdMap.set(shopifyId, productId);

    // --- Transform Images ---
    const images: Array<{ sourceUrl: string; r2Key: string }> = [];
    const mediaObjects: Array<{ url: string; alt_text: string }> = [];

    for (let imgIdx = 0; imgIdx < shopifyProduct.images.length; imgIdx++) {
      const img = shopifyProduct.images[imgIdx];
      const ext = getExtension(img.src);
      const suffix = imgIdx === 0 ? '' : `-${imgIdx + 1}`;
      const r2Key = `products/${shopifyProduct.handle}${suffix}.${ext}`;

      images.push({ sourceUrl: img.src, r2Key });
      mediaObjects.push({
        url: r2Key,
        alt_text: img.alt ?? `${shopifyProduct.title}`,
      });
    }

    const primaryImage = mediaObjects.length > 0 ? mediaObjects[0] : null;

    // --- Transform Options ---
    let optionsJson: string | null = null;
    if (shopifyProduct.options && shopifyProduct.options.length > 0) {
      const mercoraOptions = shopifyProduct.options.map((opt) => ({
        id: opt.name.toLowerCase().replace(/\s+/g, '_'),
        name: opt.name,
        type: 'select' as const,
        values: opt.values.map((v) => ({
          id: v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
          value: v,
        })),
      }));
      optionsJson = JSON.stringify(mercoraOptions);
    }

    // --- Transform Tags ---
    const tags = shopifyProduct.tags
      ? shopifyProduct.tags.split(',').map((t) => t.trim()).filter(Boolean)
      : [];

    // --- Transform Categories ---
    // Resolve Shopify collection handles to Mercora category IDs via idMap
    const categories: string[] = [];
    // Categories are typically assigned separately in Shopify;
    // we'll rely on the ID map being populated by prior category migration

    // --- SEO ---
    let seo: string | null = null;
    if (shopifyProduct.seo_title || shopifyProduct.seo_description) {
      seo = JSON.stringify({
        meta_title: shopifyProduct.seo_title ?? shopifyProduct.title,
        meta_description: shopifyProduct.seo_description ?? '',
      });
    }

    // --- Status mapping ---
    let status = 'active';
    const shopifyStatus = shopifyProduct.status?.toLowerCase();
    if (shopifyStatus === 'draft') status = 'draft';
    else if (shopifyStatus === 'archived') status = 'archived';

    // --- Transform Variants ---
    const mercoraVariants: MercoraVariantInsert[] = [];
    let firstVariantId: string | null = null;

    for (const variant of shopifyProduct.variants) {
      const suffix = skuSuffix(variant);
      const variantId = `variant_${productSlug}_${suffix}`;
      if (!firstVariantId) firstVariantId = variantId;

      // Build option_values array
      const optionValues: Array<{ option_id: string; value: string }> = [];
      if (shopifyProduct.options) {
        for (let optIdx = 0; optIdx < shopifyProduct.options.length; optIdx++) {
          const opt = shopifyProduct.options[optIdx];
          const key = `option${optIdx + 1}` as 'option1' | 'option2' | 'option3';
          const value = variant[key];
          if (value) {
            optionValues.push({
              option_id: opt.name.toLowerCase().replace(/\s+/g, '_'),
              value,
            });
          }
        }
      }

      const price = toMoney(variant.price);
      if (!price) {
        warnings.push(
          `Invalid price for variant ${variant.sku} of ${shopifyProduct.handle}`
        );
        continue;
      }

      const mercoraVariant: MercoraVariantInsert = {
        id: variantId,
        product_id: productId,
        sku: variant.sku || `${shopifyProduct.handle}-${variant.position ?? 1}`,
        status: 'active',
        position: variant.position ?? 1,
        option_values: JSON.stringify(optionValues),
        price: JSON.stringify(price),
        compare_at_price: variant.compare_at_price
          ? JSON.stringify(toMoney(variant.compare_at_price))
          : null,
        cost: null,
        weight: variant.grams
          ? JSON.stringify({ value: variant.grams, unit: 'g' })
          : null,
        dimensions: null,
        barcode: variant.barcode || null,
        inventory: JSON.stringify({
          track_inventory: true,
          quantity: variant.inventory_quantity ?? 0,
          allow_backorder: variant.inventory_policy === 'continue',
        }),
        tax_category: 'food',
        shipping_required: variant.requires_shipping !== false,
        media: JSON.stringify([]),
        attributes: null,
        created_at: variant.created_at ?? now,
        updated_at: now,
      };

      mercoraVariants.push(mercoraVariant);
    }

    // --- Build Product ---
    const mercoraProduct: MercoraProductInsert = {
      id: productId,
      name: shopifyProduct.title,
      description: shopifyProduct.body_html
        ? JSON.stringify({ en: shopifyProduct.body_html })
        : null,
      type: shopifyProduct.product_type || null,
      status,
      slug: shopifyProduct.handle,
      brand: shopifyProduct.vendor ?? 'BeauTeas',
      categories: categories.length > 0 ? JSON.stringify(categories) : null,
      tags: tags.length > 0 ? JSON.stringify(tags) : null,
      options: optionsJson,
      default_variant_id: firstVariantId,
      fulfillment_type: 'physical',
      tax_category: 'food',
      primary_image: primaryImage ? JSON.stringify(primaryImage) : null,
      media: mediaObjects.length > 0 ? JSON.stringify(mediaObjects) : null,
      seo,
      rating: null,
      related_products: null,
      external_references: JSON.stringify({ shopify_id: shopifyId }),
      extensions: JSON.stringify({
        vendor: shopifyProduct.vendor ?? null,
        product_type: shopifyProduct.product_type ?? null,
      }),
      created_at: shopifyProduct.created_at ?? now,
      updated_at: now,
    };

    records.push({
      product: mercoraProduct,
      variants: mercoraVariants,
      images,
    });

    logger.info(
      `Transformed product: ${shopifyProduct.title} -> ${productId} (${mercoraVariants.length} variants, ${images.length} images)`
    );
  }

  if (skipped.length > 0) {
    warnings.push(`${skipped.length} products skipped`);
  }

  return { records, idMap: resultIdMap, skipped, warnings };
}
