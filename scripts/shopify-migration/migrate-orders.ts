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

import { getConfig, type MigrationConfig } from './lib/config.js';
import { IdMap, idMap, DEFAULT_ID_MAP_PATH } from './lib/id-map.js';
import { MigrationLogger, logger } from './lib/logger.js';
import { ShopifyClient } from './lib/shopify-api.js';
import { extractOrdersFromFile } from './extractors/file-based/orders.js';
import { extractOrdersFromApi } from './extractors/shopify-api/orders.js';
import { transformOrders } from './transformers/orders.js';
import { loadToD1 } from './loaders/d1-loader.js';
import type { ExtractResult, ShopifyOrder } from './lib/types.js';

/**
 * Run order migration with provided config, idMap, and logger.
 * Importable by migrate-all.ts orchestrator.
 */
export async function migrateOrders(
  config: MigrationConfig,
  sharedIdMap: IdMap,
  sharedLogger: MigrationLogger
): Promise<void> {
  sharedLogger.setEntity('orders');
  sharedLogger.info('Starting order migration...');

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

  sharedLogger.info(
    `Extracted ${extracted.records.length} orders (source: ${extracted.source})`
  );

  // --- TRANSFORM ---
  const transformed = transformOrders(extracted.records, sharedIdMap);

  if (transformed.warnings.length > 0) {
    for (const warning of transformed.warnings) {
      sharedLogger.warn(warning);
    }
  }

  sharedLogger.info(
    `Transformed ${transformed.records.length} orders (${transformed.skipped.length} skipped)`
  );

  // --- LOAD TO D1 ---
  const loadResult = await loadToD1('orders', transformed.records, config);

  sharedLogger.info(
    `Loaded ${loadResult.inserted} orders (${loadResult.errors.length} errors)`
  );

  // --- Report ---
  sharedLogger.addToReport('orders', {
    source: extracted.records.length,
    migrated: loadResult.inserted,
    skipped: transformed.skipped.length,
    errors: loadResult.errors.length,
  });

  sharedLogger.info('Order migration complete.');
}

async function main(): Promise<void> {
  const config = getConfig();

  // Load existing ID map (from prior migrations)
  idMap.load(DEFAULT_ID_MAP_PATH);
  logger.info(
    `Loaded ID map with ${idMap.count('customers')} customer, ${idMap.count('products')} product mappings`
  );

  await migrateOrders(config, idMap, logger);

  // Save Updated ID Map (only in standalone mode)
  idMap.save(DEFAULT_ID_MAP_PATH);
  logger.info(`Updated ID map saved to ${DEFAULT_ID_MAP_PATH}`);

  const report = logger.generateReport();
  console.log('\n' + report);
}

// Run standalone when executed directly
const isMain = process.argv[1]?.includes('migrate-orders');
if (isMain) {
  main().catch((error) => {
    logger.error('Order migration failed', error);
    process.exit(1);
  });
}
