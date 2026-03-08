/**
 * Product Migration Script
 *
 * Standalone script: npx tsx scripts/shopify-migration/migrate-products.ts
 *
 * Extracts Shopify products, transforms to Mercora products/variants/images,
 * loads products and variants into D1, and uploads images to R2.
 *
 * Requires: category migration to have run first (for category ID resolution).
 */

import { getConfig, type MigrationConfig } from './lib/config.js';
import { IdMap, idMap, DEFAULT_ID_MAP_PATH } from './lib/id-map.js';
import { MigrationLogger, logger } from './lib/logger.js';
import { ShopifyClient } from './lib/shopify-api.js';
import { extractProductsFromFile } from './extractors/file-based/products.js';
import { extractProductsFromApi } from './extractors/shopify-api/products.js';
import { transformProducts } from './transformers/products.js';
import { loadToD1 } from './loaders/d1-loader.js';
import { uploadImages } from './loaders/r2-loader.js';
import type { ExtractResult, ShopifyProduct } from './lib/types.js';

/**
 * Run product migration with provided config, idMap, and logger.
 * Importable by migrate-all.ts orchestrator.
 */
export async function migrateProducts(
  config: MigrationConfig,
  sharedIdMap: IdMap,
  sharedLogger: MigrationLogger
): Promise<void> {
  sharedLogger.setEntity('products');
  sharedLogger.info('Starting product migration...');

  // --- EXTRACT ---
  let extracted: ExtractResult<ShopifyProduct>;

  if (config.extractionMode === 'api') {
    if (!config.shopifyStoreUrl || !config.shopifyApiKey) {
      throw new Error('API mode requires SHOPIFY_STORE_URL and SHOPIFY_API_KEY');
    }
    const client = new ShopifyClient(
      config.shopifyStoreUrl,
      config.shopifyApiKey,
      config.shopifyApiVersion
    );
    extracted = await extractProductsFromApi(client);
  } else {
    extracted = extractProductsFromFile(config.dataDir);
  }

  sharedLogger.info(
    `Extracted ${extracted.records.length} products (source: ${extracted.source})`
  );

  // --- TRANSFORM ---
  const transformed = transformProducts(extracted.records, sharedIdMap);

  if (transformed.warnings.length > 0) {
    for (const warning of transformed.warnings) {
      sharedLogger.warn(warning);
    }
  }

  const totalVariants = transformed.records.reduce(
    (sum, r) => sum + r.variants.length,
    0
  );
  const totalImages = transformed.records.reduce(
    (sum, r) => sum + r.images.length,
    0
  );

  sharedLogger.info(
    `Transformed ${transformed.records.length} products, ${totalVariants} variants, ${totalImages} images (${transformed.skipped.length} skipped)`
  );

  // --- LOAD Products to D1 ---
  const productRecords = transformed.records.map((r) => r.product);
  const productResult = await loadToD1('products', productRecords, config);
  sharedLogger.info(
    `Loaded ${productResult.inserted} products (${productResult.errors.length} errors)`
  );

  // --- LOAD Variants to D1 ---
  const variantRecords = transformed.records.flatMap((r) => r.variants);
  const variantResult = await loadToD1('product_variants', variantRecords, config);
  sharedLogger.info(
    `Loaded ${variantResult.inserted} variants (${variantResult.errors.length} errors)`
  );

  // --- UPLOAD Images to R2 ---
  const allImages = transformed.records.flatMap((r) => r.images);
  let imageResult = { uploaded: 0, failed: [] as string[] };

  if (allImages.length > 0 && config.r2AccessKeyId) {
    sharedLogger.info(`Uploading ${allImages.length} images to R2...`);
    imageResult = await uploadImages(allImages, config);
    sharedLogger.info(
      `Uploaded ${imageResult.uploaded} images (${imageResult.failed.length} failed)`
    );
  } else if (allImages.length > 0) {
    sharedLogger.warn(
      'Skipping image upload: R2 credentials not configured. Set R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ACCOUNT_ID'
    );
  }

  // --- Report ---
  sharedLogger.addToReport('products', {
    source: extracted.records.length,
    migrated: productResult.inserted,
    skipped: transformed.skipped.length,
    errors: productResult.errors.length,
  });

  sharedLogger.addToReport('variants', {
    source: totalVariants,
    migrated: variantResult.inserted,
    skipped: 0,
    errors: variantResult.errors.length,
  });

  sharedLogger.addToReport('images', {
    source: totalImages,
    migrated: imageResult.uploaded,
    skipped: 0,
    errors: imageResult.failed.length,
  });

  sharedLogger.info('Product migration complete.');
}

async function main(): Promise<void> {
  const config = getConfig();

  // Load existing ID map (from prior category migration)
  idMap.load(DEFAULT_ID_MAP_PATH);
  const categoryCount = idMap.count('categories');
  logger.info(`Loaded ID map with ${categoryCount} category mappings`);

  await migrateProducts(config, idMap, logger);

  // Save Updated ID Map (only in standalone mode)
  idMap.save(DEFAULT_ID_MAP_PATH);
  logger.info(`Updated ID map saved to ${DEFAULT_ID_MAP_PATH}`);

  const report = logger.generateReport();
  console.log('\n' + report);

  logger.writeReport('scripts/shopify-migration/output/migration-report.txt');
}

// Run standalone when executed directly
const isMain = process.argv[1]?.includes('migrate-products');
if (isMain) {
  main().catch((error) => {
    logger.error('Product migration failed', error);
    process.exit(1);
  });
}
