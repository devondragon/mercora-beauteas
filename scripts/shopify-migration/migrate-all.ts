/**
 * Migration Orchestrator
 *
 * Top-level script that runs all entity migrations in correct dependency order,
 * generates the redirect map, runs validation, and outputs a summary report.
 *
 * Usage:
 *   npx tsx scripts/shopify-migration/migrate-all.ts
 *   npx tsx scripts/shopify-migration/migrate-all.ts --entity=products
 *   npx tsx scripts/shopify-migration/migrate-all.ts --help
 */

import { readFileSync } from 'node:fs';
import { getConfig } from './lib/config.js';
import { IdMap, DEFAULT_ID_MAP_PATH } from './lib/id-map.js';
import { MigrationLogger } from './lib/logger.js';
import { executeSql } from './lib/wrangler-exec.js';
import { generateInsertSql } from './lib/wrangler-exec.js';
import { migrateCategories } from './migrate-categories.js';
import { migrateProducts } from './migrate-products.js';
import { migrateCustomers } from './migrate-customers.js';
import { migrateOrders } from './migrate-orders.js';
import { migrateReviews } from './migrate-reviews.js';
import { migratePages } from './migrate-pages.js';
import { generateRedirectMap } from './transformers/redirects.js';
import { runValidation } from './validators/validate.js';
import type { RedirectMapEntry } from './lib/types.js';

/** Parse CLI arguments */
function parseArgs(): { entity?: string; help: boolean } {
  const args = process.argv.slice(2);
  let entity: string | undefined;
  let help = false;

  for (const arg of args) {
    if (arg === '--help' || arg === '-h') {
      help = true;
    } else if (arg.startsWith('--entity=')) {
      entity = arg.split('=')[1];
    }
  }

  return { entity, help };
}

function printHelp(): void {
  console.log(`
Shopify to Mercora Migration Orchestrator

Usage:
  npx tsx scripts/shopify-migration/migrate-all.ts [options]

Options:
  --help, -h          Show this help message
  --entity=NAME       Run only a single entity migration

Available entities:
  categories          Shopify collections -> Mercora categories
  products            Shopify products/variants/images -> Mercora
  customers           Shopify customers -> Clerk + D1
  orders              Shopify orders -> D1 (requires customers, products)
  reviews             Judge.me reviews -> D1 (requires products)
  pages               Shopify CMS pages -> D1
  redirects           Generate redirect map from all ID mappings
  validate            Run post-migration validation

Environment Variables:
  EXTRACTION_MODE     'api' or 'file' (default: file)
  DATA_DIR            Path to Shopify export data (default: scripts/shopify-migration/data/)
  SHOPIFY_API_KEY     Shopify API key (required for API extraction mode)
  SHOPIFY_API_SECRET  Shopify API secret (required for API extraction mode)
  SHOPIFY_STORE_URL   Shopify store URL (required for API extraction mode)
  CLERK_SECRET_KEY    Clerk secret key (required for customer migration)
  R2_ACCESS_KEY_ID    R2 API token key ID (required for image upload)
  R2_SECRET_ACCESS_KEY R2 API token secret (required for image upload)
  R2_ACCOUNT_ID       Cloudflare account ID (required for image upload)
  D1_DATABASE_NAME    D1 database name (default: beauteas-db-dev)
  D1_ENV              Wrangler environment (default: dev)
`);
}

/** Available entity migrators */
const ENTITY_ORDER = [
  'schema',
  'categories',
  'products',
  'customers',
  'orders',
  'reviews',
  'pages',
  'redirects',
  'validate',
] as const;

type EntityName = (typeof ENTITY_ORDER)[number];

async function main(): Promise<void> {
  const { entity, help } = parseArgs();

  if (help) {
    printHelp();
    return;
  }

  const config = getConfig();
  const idMap = new IdMap();
  const migrationLogger = new MigrationLogger('orchestrator');

  // Load existing ID map (from any prior runs)
  idMap.load(DEFAULT_ID_MAP_PATH);

  const startTime = Date.now();
  migrationLogger.info('Starting full migration pipeline...');
  migrationLogger.info(`Extraction mode: ${config.extractionMode}`);

  // Determine which entities to run
  const entitiesToRun: EntityName[] = entity
    ? [entity as EntityName]
    : [...ENTITY_ORDER];

  const results: Array<{ entity: string; status: 'success' | 'error' | 'skipped'; error?: string }> = [];

  for (const entityName of entitiesToRun) {
    migrationLogger.info(`\n${'='.repeat(60)}`);
    migrationLogger.info(`Running: ${entityName}`);
    migrationLogger.info('='.repeat(60));

    try {
      switch (entityName) {
        case 'schema': {
          // Apply D1 migration for redirect_map table
          migrationLogger.setEntity('schema');
          migrationLogger.info('Applying redirect_map D1 migration...');
          const migrationSql = readFileSync(
            'migrations/0008_add_redirect_map.sql',
            'utf-8'
          );
          executeSql(migrationSql, config.d1DatabaseName, config.d1Env);
          migrationLogger.info('Schema migration applied.');
          results.push({ entity: entityName, status: 'success' });
          break;
        }

        case 'categories': {
          await migrateCategories(config, idMap, migrationLogger);
          idMap.save(DEFAULT_ID_MAP_PATH);
          results.push({ entity: entityName, status: 'success' });
          break;
        }

        case 'products': {
          await migrateProducts(config, idMap, migrationLogger);
          idMap.save(DEFAULT_ID_MAP_PATH);
          results.push({ entity: entityName, status: 'success' });
          break;
        }

        case 'customers': {
          await migrateCustomers(config, idMap, migrationLogger);
          idMap.save(DEFAULT_ID_MAP_PATH);
          results.push({ entity: entityName, status: 'success' });
          break;
        }

        case 'orders': {
          await migrateOrders(config, idMap, migrationLogger);
          idMap.save(DEFAULT_ID_MAP_PATH);
          results.push({ entity: entityName, status: 'success' });
          break;
        }

        case 'reviews': {
          await migrateReviews(config, idMap, migrationLogger);
          idMap.save(DEFAULT_ID_MAP_PATH);
          results.push({ entity: entityName, status: 'success' });
          break;
        }

        case 'pages': {
          await migratePages(config, idMap, migrationLogger);
          idMap.save(DEFAULT_ID_MAP_PATH);
          results.push({ entity: entityName, status: 'success' });
          break;
        }

        case 'redirects': {
          migrationLogger.setEntity('redirects');
          migrationLogger.info('Generating redirect map...');

          const redirectEntries = generateRedirectMap(idMap);
          migrationLogger.info(
            `Generated ${redirectEntries.length} redirect entries`
          );

          if (redirectEntries.length > 0) {
            // Convert to Record<string, unknown>[] for SQL generation
            const records = redirectEntries.map((entry: RedirectMapEntry) => ({
              source_path: entry.source_path,
              target_path: entry.target_path,
              status_code: entry.status_code,
              entity_type: entry.entity_type,
            }));

            const insertSql = generateInsertSql('redirect_map', records);
            if (insertSql) {
              executeSql(insertSql, config.d1DatabaseName, config.d1Env);
              migrationLogger.info(
                `Loaded ${redirectEntries.length} redirect entries to D1`
              );
            }
          }

          migrationLogger.addToReport('redirect_map', {
            source: redirectEntries.length,
            migrated: redirectEntries.length,
            skipped: 0,
            errors: 0,
          });

          results.push({ entity: entityName, status: 'success' });
          break;
        }

        case 'validate': {
          const validation = await runValidation(config, idMap, migrationLogger);
          if (!validation.passed) {
            migrationLogger.warn('Validation found mismatches -- see report');
          }
          console.log('\n' + validation.report);
          results.push({ entity: entityName, status: validation.passed ? 'success' : 'error' });
          break;
        }

        default: {
          migrationLogger.warn(`Unknown entity: ${entityName}`);
          results.push({ entity: entityName, status: 'skipped' });
          break;
        }
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      migrationLogger.error(`Failed to migrate ${entityName}: ${msg}`, error);
      results.push({ entity: entityName, status: 'error', error: msg });

      // Save idMap progress even on failure
      idMap.save(DEFAULT_ID_MAP_PATH);
      migrationLogger.info('ID map saved after error -- continuing with next entity...');
    }
  }

  // --- Final Summary ---
  const elapsed = Math.round((Date.now() - startTime) / 1000);
  const successCount = results.filter((r) => r.status === 'success').length;
  const errorCount = results.filter((r) => r.status === 'error').length;

  console.log('\n' + '='.repeat(60));
  console.log('MIGRATION SUMMARY');
  console.log('='.repeat(60));
  console.log(`Duration: ${elapsed}s`);
  console.log(`Entities: ${successCount} succeeded, ${errorCount} failed`);
  console.log('');

  for (const r of results) {
    const icon = r.status === 'success' ? '[OK]' : r.status === 'error' ? '[FAIL]' : '[SKIP]';
    const detail = r.error ? ` -- ${r.error}` : '';
    console.log(`  ${icon} ${r.entity}${detail}`);
  }

  console.log('');

  // Write migration report
  const report = migrationLogger.generateReport();
  migrationLogger.writeReport('scripts/shopify-migration/output/migration-report.txt');
  console.log(report);

  // Exit with error code if any failures
  if (errorCount > 0) {
    console.log(`\nWARNING: ${errorCount} entities failed. Check logs above.`);
    process.exit(1);
  }

  console.log('\nAll migrations completed successfully.');
}

main().catch((error) => {
  console.error('Migration orchestrator failed:', error);
  process.exit(1);
});
