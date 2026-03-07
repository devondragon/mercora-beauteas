/**
 * Page Migration Script
 *
 * Standalone script: npx tsx scripts/shopify-migration/migrate-pages.ts
 *
 * Extracts Shopify CMS pages, transforms with correct Unix timestamps,
 * and loads into D1 pages table.
 *
 * No prior migration dependencies required (pages are standalone).
 */

import { getConfig, type MigrationConfig } from './lib/config.js';
import { IdMap, idMap, DEFAULT_ID_MAP_PATH } from './lib/id-map.js';
import { MigrationLogger, logger } from './lib/logger.js';
import { ShopifyClient } from './lib/shopify-api.js';
import { extractPagesFromFile } from './extractors/file-based/pages.js';
import { extractPagesFromApi } from './extractors/shopify-api/pages.js';
import { transformPages } from './transformers/pages.js';
import { loadToD1 } from './loaders/d1-loader.js';
import type { ExtractResult, ShopifyPage } from './lib/types.js';

/**
 * Run page migration with provided config, idMap, and logger.
 * Importable by migrate-all.ts orchestrator.
 */
export async function migratePages(
  config: MigrationConfig,
  sharedIdMap: IdMap,
  sharedLogger: MigrationLogger
): Promise<void> {
  sharedLogger.setEntity('pages');
  sharedLogger.info('Starting page migration...');

  // --- EXTRACT ---
  let extracted: ExtractResult<ShopifyPage>;

  if (config.extractionMode === 'api') {
    if (!config.shopifyStoreUrl || !config.shopifyApiKey) {
      throw new Error('API mode requires SHOPIFY_STORE_URL and SHOPIFY_API_KEY');
    }
    const client = new ShopifyClient(
      config.shopifyStoreUrl,
      config.shopifyApiKey,
      config.shopifyApiVersion
    );
    extracted = await extractPagesFromApi(client);
  } else {
    extracted = extractPagesFromFile(config.dataDir);
  }

  sharedLogger.info(
    `Extracted ${extracted.records.length} pages (source: ${extracted.source})`
  );

  // --- TRANSFORM ---
  const transformed = transformPages(extracted.records);

  if (transformed.warnings.length > 0) {
    for (const warning of transformed.warnings) {
      sharedLogger.warn(warning);
    }
  }

  sharedLogger.info(
    `Transformed ${transformed.records.length} pages (${transformed.skipped.length} skipped)`
  );

  // --- LOAD TO D1 ---
  const loadResult = await loadToD1('pages', transformed.records, config);

  sharedLogger.info(
    `Loaded ${loadResult.inserted} pages (${loadResult.errors.length} errors)`
  );

  // --- Register in ID map for redirect map generation ---
  for (const page of extracted.records) {
    if (page.handle) {
      sharedIdMap.register('pages', page.handle, page.handle);
    }
  }

  // --- Report ---
  sharedLogger.addToReport('pages', {
    source: extracted.records.length,
    migrated: loadResult.inserted,
    skipped: transformed.skipped.length,
    errors: loadResult.errors.length,
  });

  sharedLogger.info('Page migration complete.');
}

async function main(): Promise<void> {
  const config = getConfig();

  // Load existing ID map (for saving page mappings)
  idMap.load(DEFAULT_ID_MAP_PATH);

  await migratePages(config, idMap, logger);

  // Save Updated ID Map (only in standalone mode)
  idMap.save(DEFAULT_ID_MAP_PATH);
  logger.info(`Updated ID map saved to ${DEFAULT_ID_MAP_PATH}`);

  const report = logger.generateReport();
  console.log('\n' + report);
}

// Run standalone when executed directly
const isMain = process.argv[1]?.includes('migrate-pages');
if (isMain) {
  main().catch((error) => {
    logger.error('Page migration failed', error);
    process.exit(1);
  });
}
