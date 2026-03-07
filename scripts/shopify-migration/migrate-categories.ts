/**
 * Category Migration Script
 *
 * Standalone script: npx tsx scripts/shopify-migration/migrate-categories.ts
 *
 * Extracts Shopify collections, transforms to Mercora categories,
 * and loads into D1. Saves ID map for downstream migrators.
 */

import { getConfig } from './lib/config.js';
import { idMap, DEFAULT_ID_MAP_PATH } from './lib/id-map.js';
import { logger } from './lib/logger.js';
import { ShopifyClient } from './lib/shopify-api.js';
import { extractCollectionsFromFile } from './extractors/file-based/collections.js';
import { extractCollectionsFromApi } from './extractors/shopify-api/collections.js';
import { transformCategories } from './transformers/categories.js';
import { loadToD1 } from './loaders/d1-loader.js';
import type { ExtractResult, ShopifyCollection } from './lib/types.js';

async function main(): Promise<void> {
  logger.setEntity('categories');
  logger.info('Starting category migration...');

  const config = getConfig();

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

  logger.info(
    `Extracted ${extracted.records.length} collections (source: ${extracted.source})`
  );

  // --- TRANSFORM ---
  const transformed = transformCategories(extracted.records, idMap);

  if (transformed.warnings.length > 0) {
    for (const warning of transformed.warnings) {
      logger.warn(warning);
    }
  }

  logger.info(
    `Transformed ${transformed.records.length} categories (${transformed.skipped.length} skipped)`
  );

  // --- LOAD ---
  const loadResult = await loadToD1('categories', transformed.records, config);

  logger.info(
    `Loaded ${loadResult.inserted} categories (${loadResult.errors.length} errors)`
  );

  // --- Save ID Map ---
  idMap.save(DEFAULT_ID_MAP_PATH);
  logger.info(`ID map saved to ${DEFAULT_ID_MAP_PATH}`);

  // --- Report ---
  logger.addToReport('categories', {
    source: extracted.records.length,
    migrated: loadResult.inserted,
    skipped: transformed.skipped.length,
    errors: loadResult.errors.length,
  });

  const report = logger.generateReport();
  console.log('\n' + report);

  logger.info('Category migration complete.');
}

main().catch((error) => {
  logger.error('Category migration failed', error);
  process.exit(1);
});
