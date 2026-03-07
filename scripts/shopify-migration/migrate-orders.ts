/**
 * Order Migration Script
 *
 * Standalone script: npx tsx scripts/shopify-migration/migrate-orders.ts
 *
 * Extracts Shopify orders, transforms with customer/product ID resolution,
 * and loads into D1 orders table as read-only historical records.
 *
 * Requires: customer and product migrations to have run first (for ID mappings).
 */

import { getConfig } from './lib/config.js';
import { idMap, DEFAULT_ID_MAP_PATH } from './lib/id-map.js';
import { logger } from './lib/logger.js';
import { ShopifyClient } from './lib/shopify-api.js';
import { extractOrdersFromFile } from './extractors/file-based/orders.js';
import { extractOrdersFromApi } from './extractors/shopify-api/orders.js';
import { transformOrders } from './transformers/orders.js';
import { loadToD1 } from './loaders/d1-loader.js';
import type { ExtractResult, ShopifyOrder } from './lib/types.js';

async function main(): Promise<void> {
  logger.setEntity('orders');
  logger.info('Starting order migration...');

  const config = getConfig();

  // Load existing ID map (from prior migrations)
  idMap.load(DEFAULT_ID_MAP_PATH);
  logger.info(
    `Loaded ID map with ${idMap.count('customers')} customer, ${idMap.count('products')} product mappings`
  );

  // --- EXTRACT ---
  let extracted: ExtractResult<ShopifyOrder>;

  if (config.extractionMode === 'api') {
    if (!config.shopifyStoreUrl || !config.shopifyApiKey) {
      throw new Error('API mode requires SHOPIFY_STORE_URL and SHOPIFY_API_KEY');
    }
    const client = new ShopifyClient(
      config.shopifyStoreUrl,
      config.shopifyApiKey,
      config.shopifyApiVersion
    );
    extracted = await extractOrdersFromApi(client);
  } else {
    extracted = extractOrdersFromFile(config.dataDir);
  }

  logger.info(
    `Extracted ${extracted.records.length} orders (source: ${extracted.source})`
  );

  // --- TRANSFORM ---
  const transformed = transformOrders(extracted.records, idMap);

  if (transformed.warnings.length > 0) {
    for (const warning of transformed.warnings) {
      logger.warn(warning);
    }
  }

  logger.info(
    `Transformed ${transformed.records.length} orders (${transformed.skipped.length} skipped)`
  );

  // --- LOAD TO D1 ---
  const loadResult = await loadToD1('orders', transformed.records, config);

  logger.info(
    `Loaded ${loadResult.inserted} orders (${loadResult.errors.length} errors)`
  );

  // --- Save Updated ID Map ---
  idMap.save(DEFAULT_ID_MAP_PATH);
  logger.info(`Updated ID map saved to ${DEFAULT_ID_MAP_PATH}`);

  // --- Report ---
  logger.addToReport('orders', {
    source: extracted.records.length,
    migrated: loadResult.inserted,
    skipped: transformed.skipped.length,
    errors: loadResult.errors.length,
  });

  const report = logger.generateReport();
  console.log('\n' + report);

  logger.info('Order migration complete.');
}

main().catch((error) => {
  logger.error('Order migration failed', error);
  process.exit(1);
});
