/**
 * API-Based Customer Extractor
 *
 * Fetches customers from Shopify Admin REST API.
 */

import type { ShopifyClient } from '../../lib/shopify-api.js';
import type { ExtractResult, ShopifyCustomer } from '../../lib/types.js';

/**
 * Extract customers from Shopify Admin API.
 */
export async function extractCustomersFromApi(
  client: ShopifyClient
): Promise<ExtractResult<ShopifyCustomer>> {
  const records = await client.fetchCustomers();

  return {
    records,
    source: 'api',
    extractedAt: new Date().toISOString(),
  };
}
