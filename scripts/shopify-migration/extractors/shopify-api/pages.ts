/**
 * API-Based Page Extractor
 *
 * Fetches pages from Shopify Admin REST API.
 */

import type { ShopifyClient } from '../../lib/shopify-api.js';
import type { ExtractResult, ShopifyPage } from '../../lib/types.js';

/**
 * Extract pages from Shopify Admin API.
 */
export async function extractPagesFromApi(
  client: ShopifyClient
): Promise<ExtractResult<ShopifyPage>> {
  const records = await client.fetchPages();

  return {
    records,
    source: 'api',
    extractedAt: new Date().toISOString(),
  };
}
