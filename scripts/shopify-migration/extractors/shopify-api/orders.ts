/**
 * API-Based Order Extractor
 *
 * Fetches orders from Shopify Admin REST API (status=any for all historical orders).
 */

import type { ShopifyClient } from '../../lib/shopify-api.js';
import type { ExtractResult, ShopifyOrder } from '../../lib/types.js';

/**
 * Extract orders from Shopify Admin API.
 */
export async function extractOrdersFromApi(
  client: ShopifyClient
): Promise<ExtractResult<ShopifyOrder>> {
  const records = await client.fetchOrders();

  return {
    records,
    source: 'api',
    extractedAt: new Date().toISOString(),
  };
}
