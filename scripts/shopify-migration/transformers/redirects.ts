/**
 * Redirect Map Generator
 *
 * Generates URL redirect mappings from migrated data.
 * Maps old Shopify URLs to new Mercora URLs for SEO preservation.
 *
 * Source patterns (Shopify):
 *   /products/{handle}    -> /product/{slug}
 *   /collections/{handle} -> /category/{slug}
 *   /pages/{handle}       -> /{slug}
 *
 * next.config.ts handles structural pattern redirects (/products/:slug -> /product/:slug).
 * The D1 redirect_map handles slug-level mappings where slugs changed between platforms.
 */

import type { IdMap } from '../lib/id-map.js';
import type { RedirectMapEntry } from '../lib/types.js';

/**
 * Generate redirect map entries from all entity ID maps.
 *
 * For each entity type, reads the Shopify handle -> Mercora slug mappings
 * and produces RedirectMapEntry records for D1 insertion.
 */
export function generateRedirectMap(idMap: IdMap): RedirectMapEntry[] {
  const entries: RedirectMapEntry[] = [];

  // Products: /products/{shopifyHandle} -> /product/{mercoraSlug}
  const products = idMap.getAll('products');
  for (const [shopifyHandle, mercoraSlug] of products) {
    entries.push({
      source_path: `/products/${shopifyHandle}`,
      target_path: `/product/${mercoraSlug}`,
      status_code: 301,
      entity_type: 'product',
    });
  }

  // Collections/Categories: /collections/{shopifyHandle} -> /category/{mercoraSlug}
  const categories = idMap.getAll('categories');
  for (const [shopifyHandle, mercoraSlug] of categories) {
    entries.push({
      source_path: `/collections/${shopifyHandle}`,
      target_path: `/category/${mercoraSlug}`,
      status_code: 301,
      entity_type: 'collection',
    });
  }

  // Pages: /pages/{shopifyHandle} -> /{mercoraSlug}
  const pages = idMap.getAll('pages');
  for (const [shopifyHandle, mercoraSlug] of pages) {
    entries.push({
      source_path: `/pages/${shopifyHandle}`,
      target_path: `/${mercoraSlug}`,
      status_code: 301,
      entity_type: 'page',
    });
  }

  return entries;
}
