/**
 * Shopify API Collection Extractor
 *
 * Fetches both custom_collections and smart_collections via Shopify Admin REST API.
 */

import type { ExtractResult, ShopifyCollection } from '../../lib/types.js';
import type { ShopifyClient } from '../../lib/shopify-api.js';
import { logger } from '../../lib/logger.js';

/**
 * Extract collections from Shopify Admin API.
 */
export async function extractCollectionsFromApi(
  client: ShopifyClient
): Promise<ExtractResult<ShopifyCollection>> {
  logger.info('Fetching collections from Shopify API...');

  const collections = await client.fetchCollections();

  logger.info(`Extracted ${collections.length} collections from API`);

  return {
    records: collections,
    source: 'api',
    extractedAt: new Date().toISOString(),
  };
}
