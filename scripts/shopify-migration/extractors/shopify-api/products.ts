/**
 * Shopify API Product Extractor
 *
 * Fetches products with variants and images from the Shopify Admin REST API.
 */

import type { ExtractResult, ShopifyProduct } from '../../lib/types.js';
import type { ShopifyClient } from '../../lib/shopify-api.js';
import { logger } from '../../lib/logger.js';

/**
 * Extract products from Shopify Admin API.
 */
export async function extractProductsFromApi(
  client: ShopifyClient
): Promise<ExtractResult<ShopifyProduct>> {
  logger.info('Fetching products from Shopify API...');

  const products = await client.fetchProducts();

  logger.info(`Extracted ${products.length} products from API`);

  return {
    records: products,
    source: 'api',
    extractedAt: new Date().toISOString(),
  };
}
