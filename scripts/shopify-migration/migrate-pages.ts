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

import { getConfig } from './lib/config.js';
import { idMap, DEFAULT_ID_MAP_PATH } from './lib/id-map.js';
import { logger } from './lib/logger.js';
import { ShopifyClient } from './lib/shopify-api.js';
import { extractPagesFromFile } from './extractors/file-based/pages.js';
import { extractPagesFromApi } from './extractors/shopify-api/pages.js';
import { transformPages } from './transformers/pages.js';
import { loadToD1 } from './loaders/d1-loader.js';
import type { ExtractResult, ShopifyPage } from './lib/types.js';

async function main(): Promise<void> {
  logger.setEntity('pages');
  logger.info('Starting page migration...');

  const config = getConfig();

  // Load existing ID map (for saving page mappings)
  idMap.load(DEFAULT_ID_MAP_PATH);

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

  logger.info(
    `Extracted ${extracted.records.length} pages (source: ${extracted.source})`
  );

  // --- TRANSFORM ---
  const transformed = transformPages(extracted.records);

  if (transformed.warnings.length > 0) {
    for (const warning of transformed.warnings) {
      logger.warn(warning);
    }
  }

  logger.info(
    `Transformed ${transformed.records.length} pages (${transformed.skipped.length} skipped)`
  );

  // --- LOAD TO D1 ---
  const loadResult = await loadToD1('pages', transformed.records, config);

  logger.info(
    `Loaded ${loadResult.inserted} pages (${loadResult.errors.length} errors)`
  );

  // --- Register in ID map for redirect map generation ---
  for (const page of extracted.records) {
    if (page.handle) {
      idMap.register('pages', page.handle, page.handle);
    }
  }

  // --- Save Updated ID Map ---
  idMap.save(DEFAULT_ID_MAP_PATH);
  logger.info(`Updated ID map saved to ${DEFAULT_ID_MAP_PATH}`);

  // --- Report ---
  logger.addToReport('pages', {
    source: extracted.records.length,
    migrated: loadResult.inserted,
    skipped: transformed.skipped.length,
    errors: loadResult.errors.length,
  });

  const report = logger.generateReport();
  console.log('\n' + report);

  logger.info('Page migration complete.');
}

main().catch((error) => {
  logger.error('Page migration failed', error);
  process.exit(1);
});
