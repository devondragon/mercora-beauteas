/**
 * Category Migration Script
 *
 * Standalone script: npx tsx scripts/shopify-migration/migrate-categories.ts
 *
 * Extracts Shopify collections, transforms to Mercora categories,
 * and loads into D1. Saves ID map for downstream migrators.
 */

import { getConfig, type MigrationConfig } from './lib/config.js';
import { IdMap, idMap, DEFAULT_ID_MAP_PATH } from './lib/id-map.js';
import { MigrationLogger, logger } from './lib/logger.js';
import { ShopifyClient } from './lib/shopify-api.js';
import { extractCollectionsFromFile } from './extractors/file-based/collections.js';
import { extractCollectionsFromApi } from './extractors/shopify-api/collections.js';
import { transformCategories } from './transformers/categories.js';
import { loadToD1 } from './loaders/d1-loader.js';
import type { ExtractResult, ShopifyCollection } from './lib/types.js';

/**
 * Run category migration with provided config, idMap, and logger.
 * Importable by migrate-all.ts orchestrator.
 */
export async function migrateCategories(
  config: MigrationConfig,
  sharedIdMap: IdMap,
  sharedLogger: MigrationLogger
): Promise<void> {
  sharedLogger.setEntity('categories');
  sharedLogger.info('Starting category migration...');

  // --- EXTRACT ---
  let extracted: ExtractResult<ShopifyCollection>;

  if (config.extractionMode === 'api') {
    if (!config.shopifyStoreUrl || !config.shopifyApiKey) {
      throw new Error('API mode requires SHOPIFY_STORE_URL and SHOPIFY_API_KEY');
    }
    const client = new ShopifyClient(
      config.shopifyStoreUrl,
      config.shopifyApiKey,
      config.shopifyApiVersion
    );
    extracted = await extractCollectionsFromApi(client);
  } else {
    extracted = extractCollectionsFromFile(config.dataDir);
  }

  sharedLogger.info(
    `Extracted ${extracted.records.length} collections (source: ${extracted.source})`
  );

  // --- TRANSFORM ---
  const transformed = transformCategories(extracted.records, sharedIdMap);

  if (transformed.warnings.length > 0) {
    for (const warning of transformed.warnings) {
      sharedLogger.warn(warning);
    }
  }

  sharedLogger.info(
    `Transformed ${transformed.records.length} categories (${transformed.skipped.length} skipped)`
  );

  // --- LOAD ---
  const loadResult = await loadToD1('categories', transformed.records, config);

  sharedLogger.info(
    `Loaded ${loadResult.inserted} categories (${loadResult.errors.length} errors)`
  );

  // --- Report ---
  sharedLogger.addToReport('categories', {
    source: extracted.records.length,
    migrated: loadResult.inserted,
    skipped: transformed.skipped.length,
    errors: loadResult.errors.length,
  });

  sharedLogger.info('Category migration complete.');
}

async function main(): Promise<void> {
  const config = getConfig();
  await migrateCategories(config, idMap, logger);

  // Save ID Map (only in standalone mode)
  idMap.save(DEFAULT_ID_MAP_PATH);
  logger.info(`ID map saved to ${DEFAULT_ID_MAP_PATH}`);

  const report = logger.generateReport();
  console.log('\n' + report);
}

// Run standalone when executed directly
const isMain = process.argv[1]?.includes('migrate-categories');
if (isMain) {
  main().catch((error) => {
    logger.error('Category migration failed', error);
    process.exit(1);
  });
}
