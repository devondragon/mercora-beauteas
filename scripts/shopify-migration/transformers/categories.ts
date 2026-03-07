/**
 * Category Transformer
 *
 * Transforms Shopify collections to Mercora category format.
 * CRITICAL: Wraps name/description/slug in localization format: {"en": value}
 */

import type {
  ShopifyCollection,
  MercoraCategoryInsert,
  TransformResult,
} from '../lib/types.js';
import type { IdMap } from '../lib/id-map.js';
import { logger } from '../lib/logger.js';

/**
 * Slugify a handle for use as a category ID
 */
function slugifyForId(handle: string): string {
  return handle
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

/**
 * Transform Shopify collections to Mercora categories.
 *
 * - Generates descriptive IDs: cat_{slugified_handle}
 * - Wraps name/description/slug in localization JSON: {"en": value}
 * - Stores shopify_id in externalReferences
 */
export function transformCategories(
  collections: ShopifyCollection[],
  idMap: IdMap
): TransformResult<ShopifyCollection, MercoraCategoryInsert> {
  const records: MercoraCategoryInsert[] = [];
  const skipped: Array<{ record: ShopifyCollection; reason: string }> = [];
  const warnings: string[] = [];
  const resultIdMap = new Map<string, string>();
  const now = new Date().toISOString();

  for (let i = 0; i < collections.length; i++) {
    const collection = collections[i];

    if (!collection.handle) {
      skipped.push({ record: collection, reason: 'Missing handle' });
      continue;
    }

    const mercoraId = `cat_${slugifyForId(collection.handle)}`;
    const shopifyId = String(collection.id ?? collection.handle);

    // Register in ID map (by both numeric ID and handle for cross-referencing)
    idMap.register('categories', shopifyId, mercoraId);
    idMap.register('categories', collection.handle, mercoraId);
    resultIdMap.set(shopifyId, mercoraId);

    // Build primary image from collection image
    let primaryImage: string | null = null;
    if (collection.image?.src) {
      primaryImage = JSON.stringify({
        url: `categories/${slugifyForId(collection.handle)}.${getExtension(collection.image.src)}`,
        alt_text: collection.image.alt ?? `${collection.title} category`,
      });
    }

    const category: MercoraCategoryInsert = {
      id: mercoraId,
      // CRITICAL: Localized JSON format for name, description, slug
      name: JSON.stringify({ en: collection.title }),
      description: collection.body_html
        ? JSON.stringify({ en: collection.body_html })
        : null,
      slug: collection.handle,
      status: collection.published_at ? 'active' : 'inactive',
      parent_id: null,
      position: i + 1,
      path: `/${collection.handle}`,
      external_references: JSON.stringify({
        shopify_id: shopifyId,
      }),
      created_at: collection.published_at ?? now,
      updated_at: now,
      children: JSON.stringify([]),
      product_count: collection.products_count ?? 0,
      attributes: JSON.stringify({}),
      tags: JSON.stringify([]),
      primary_image: primaryImage,
      media: null,
      seo: null,
      extensions: JSON.stringify({}),
    };

    records.push(category);
    logger.info(`Transformed category: ${collection.title} -> ${mercoraId}`);
  }

  if (skipped.length > 0) {
    warnings.push(`${skipped.length} collections skipped`);
  }

  return { records, idMap: resultIdMap, skipped, warnings };
}

/**
 * Get file extension from URL
 */
function getExtension(url: string): string {
  const match = url.match(/\.(\w+)(?:\?|$)/);
  return match?.[1]?.toLowerCase() ?? 'png';
}
