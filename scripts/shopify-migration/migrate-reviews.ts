/**
 * Review Migration Script
 *
 * Standalone script: npx tsx scripts/shopify-migration/migrate-reviews.ts
 *
 * Extracts Judge.me reviews from file, transforms with product ID resolution,
 * loads into D1 product_reviews table, then recalculates product aggregate ratings.
 *
 * Requires: product migration to have run first (for product ID mappings).
 */

import { getConfig, type MigrationConfig } from './lib/config.js';
import { IdMap, idMap, DEFAULT_ID_MAP_PATH } from './lib/id-map.js';
import { MigrationLogger, logger } from './lib/logger.js';
import { extractReviewsFromFile } from './extractors/file-based/reviews.js';
import { transformReviews } from './transformers/reviews.js';
import { loadToD1 } from './loaders/d1-loader.js';
import { executeQuery, executeSql } from './lib/wrangler-exec.js';

/**
 * Recalculate product aggregate ratings after review import.
 *
 * For each unique product_id in migrated reviews:
 *   1. Query rating distribution from D1
 *   2. Calculate average and distribution
 *   3. UPDATE products SET rating = '{json}' WHERE id = '{product_id}'
 */
async function recalculateProductRatings(
  productIds: string[],
  config: MigrationConfig,
  ratingLogger: MigrationLogger
): Promise<number> {
  let updatedCount = 0;

  for (const productId of productIds) {
    try {
      // Query review counts grouped by rating
      const queryResult = executeQuery(
        `SELECT rating, COUNT(*) as count FROM product_reviews WHERE product_id = '${productId.replace(/'/g, "''")}' AND status = 'published' GROUP BY rating`,
        config.d1DatabaseName,
        config.d1Env
      );

      // Parse the query output to extract rating distribution
      // wrangler d1 execute returns structured output
      const distribution: Record<number, number> = {};
      let totalCount = 0;
      let ratingSum = 0;

      // Parse wrangler output (JSON lines format)
      const lines = queryResult.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        // Try to parse JSON array format from wrangler output
        if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
          try {
            const data = JSON.parse(trimmed);
            const rows = Array.isArray(data) ? data : [data];
            for (const row of rows) {
              if (row.rating !== undefined && row.count !== undefined) {
                const r = Number(row.rating);
                const c = Number(row.count);
                if (r >= 1 && r <= 5 && c > 0) {
                  distribution[r] = c;
                  totalCount += c;
                  ratingSum += r * c;
                }
              }
            }
          } catch {
            // Not valid JSON, skip
          }
        }
      }

      if (totalCount === 0) {
        ratingLogger.warn(`No published reviews found for product ${productId}`);
        continue;
      }

      const average = Number((ratingSum / totalCount).toFixed(2));

      // Build rating JSON matching NormalizedProductRating format
      const ratingJson = JSON.stringify({
        average,
        count: totalCount,
        distribution,
      });

      // Update product rating
      const updateSql = `UPDATE products SET rating = '${ratingJson.replace(/'/g, "''")}' WHERE id = '${productId.replace(/'/g, "''")}';`;
      executeSql(updateSql, config.d1DatabaseName, config.d1Env);

      updatedCount++;
      ratingLogger.info(
        `Updated rating for ${productId}: avg=${average}, count=${totalCount}`
      );
    } catch (err) {
      ratingLogger.error(`Failed to recalculate rating for ${productId}`, err);
    }
  }

  return updatedCount;
}

/**
 * Run review migration with provided config, idMap, and logger.
 * Importable by migrate-all.ts orchestrator.
 */
export async function migrateReviews(
  config: MigrationConfig,
  sharedIdMap: IdMap,
  sharedLogger: MigrationLogger
): Promise<void> {
  sharedLogger.setEntity('reviews');
  sharedLogger.info('Starting review migration...');

  // --- EXTRACT ---
  // Reviews are always file-based (Judge.me export)
  const extracted = extractReviewsFromFile(config.dataDir);

  sharedLogger.info(`Extracted ${extracted.records.length} reviews (source: file)`);

  // --- TRANSFORM ---
  const transformed = transformReviews(extracted.records, sharedIdMap);

  if (transformed.warnings.length > 0) {
    for (const warning of transformed.warnings) {
      sharedLogger.warn(warning);
    }
  }

  sharedLogger.info(
    `Transformed ${transformed.records.length} reviews (${transformed.skipped.length} skipped)`
  );

  // --- LOAD TO D1 ---
  const loadResult = await loadToD1(
    'product_reviews',
    transformed.records,
    config
  );

  sharedLogger.info(
    `Loaded ${loadResult.inserted} reviews (${loadResult.errors.length} errors)`
  );

  // --- RECALCULATE PRODUCT RATINGS ---
  // Collect unique product IDs from migrated reviews
  const uniqueProductIds = [
    ...new Set(transformed.records.map((r) => r.product_id)),
  ];

  sharedLogger.info(
    `Recalculating ratings for ${uniqueProductIds.length} products...`
  );
  const ratingsUpdated = await recalculateProductRatings(
    uniqueProductIds,
    config,
    sharedLogger
  );
  sharedLogger.info(`Updated ratings for ${ratingsUpdated} products`);

  // --- Report ---
  sharedLogger.addToReport('reviews', {
    source: extracted.records.length,
    migrated: loadResult.inserted,
    skipped: transformed.skipped.length,
    errors: loadResult.errors.length,
  });

  sharedLogger.info('Review migration complete.');
}

async function main(): Promise<void> {
  const config = getConfig();

  // Load existing ID map (from prior migrations)
  idMap.load(DEFAULT_ID_MAP_PATH);
  logger.info(
    `Loaded ID map with ${idMap.count('products')} product, ${idMap.count('customers')} customer mappings`
  );

  await migrateReviews(config, idMap, logger);

  // Save Updated ID Map (only in standalone mode)
  idMap.save(DEFAULT_ID_MAP_PATH);
  logger.info(`Updated ID map saved to ${DEFAULT_ID_MAP_PATH}`);

  const report = logger.generateReport();
  console.log('\n' + report);
}

// Run standalone when executed directly
const isMain = process.argv[1]?.includes('migrate-reviews');
if (isMain) {
  main().catch((error) => {
    logger.error('Review migration failed', error);
    process.exit(1);
  });
}
