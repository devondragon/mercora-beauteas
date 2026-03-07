/**
 * Customer Migration Script
 *
 * Standalone script: npx tsx scripts/shopify-migration/migrate-customers.ts
 *
 * Extracts Shopify customers, creates them in Clerk with skipPasswordRequirement,
 * transforms to Mercora format, and loads into D1 customers table.
 *
 * Requires: CLERK_SECRET_KEY environment variable for Clerk user creation.
 */

import { getConfig } from './lib/config.js';
import { idMap, DEFAULT_ID_MAP_PATH } from './lib/id-map.js';
import { logger } from './lib/logger.js';
import { ShopifyClient } from './lib/shopify-api.js';
import { extractCustomersFromFile } from './extractors/file-based/customers.js';
import { extractCustomersFromApi } from './extractors/shopify-api/customers.js';
import { transformCustomers } from './transformers/customers.js';
import { createClerkUsers } from './loaders/clerk-loader.js';
import type { ClerkUserResult } from './loaders/clerk-loader.js';
import { loadToD1 } from './loaders/d1-loader.js';
import type { ExtractResult, ShopifyCustomer } from './lib/types.js';

async function main(): Promise<void> {
  logger.setEntity('customers');
  logger.info('Starting customer migration...');

  const config = getConfig();

  // Load existing ID map (from prior migrations)
  idMap.load(DEFAULT_ID_MAP_PATH);
  logger.info(
    `Loaded ID map with ${idMap.count('categories')} category, ${idMap.count('products')} product mappings`
  );

  // --- EXTRACT ---
  let extracted: ExtractResult<ShopifyCustomer>;

  if (config.extractionMode === 'api') {
    if (!config.shopifyStoreUrl || !config.shopifyApiKey) {
      throw new Error('API mode requires SHOPIFY_STORE_URL and SHOPIFY_API_KEY');
    }
    const client = new ShopifyClient(
      config.shopifyStoreUrl,
      config.shopifyApiKey,
      config.shopifyApiVersion
    );
    extracted = await extractCustomersFromApi(client);
  } else {
    extracted = extractCustomersFromFile(config.dataDir);
  }

  logger.info(
    `Extracted ${extracted.records.length} customers (source: ${extracted.source})`
  );

  // --- CREATE IN CLERK ---
  if (!config.clerkSecretKey) {
    throw new Error(
      'CLERK_SECRET_KEY is required for customer migration. Set this environment variable.'
    );
  }

  const clerkInputs = extracted.records.map((c) => ({
    email: c.email,
    firstName: c.first_name,
    lastName: c.last_name,
    shopifyId: String(c.id),
  }));

  logger.info(`Creating ${clerkInputs.length} users in Clerk...`);
  const clerkResults = await createClerkUsers(clerkInputs, config.clerkSecretKey);

  const successfulClerk = clerkResults.filter(
    (r): r is ClerkUserResult => 'clerkUserId' in r
  );
  const failedClerk = clerkResults.filter((r) => 'error' in r);

  logger.info(
    `Clerk results: ${successfulClerk.length} created, ${failedClerk.length} failed`
  );

  // --- TRANSFORM ---
  const transformed = transformCustomers(
    extracted.records,
    successfulClerk,
    idMap
  );

  if (transformed.warnings.length > 0) {
    for (const warning of transformed.warnings) {
      logger.warn(warning);
    }
  }

  logger.info(
    `Transformed ${transformed.records.length} customers (${transformed.skipped.length} skipped)`
  );

  // --- LOAD TO D1 ---
  const loadResult = await loadToD1('customers', transformed.records, config);

  logger.info(
    `Loaded ${loadResult.inserted} customers (${loadResult.errors.length} errors)`
  );

  // --- Save Updated ID Map ---
  idMap.save(DEFAULT_ID_MAP_PATH);
  logger.info(`Updated ID map saved to ${DEFAULT_ID_MAP_PATH}`);

  // --- Report ---
  logger.addToReport('customers', {
    source: extracted.records.length,
    migrated: loadResult.inserted,
    skipped: transformed.skipped.length,
    errors: loadResult.errors.length + failedClerk.length,
  });

  const report = logger.generateReport();
  console.log('\n' + report);

  logger.info('Customer migration complete.');
}

main().catch((error) => {
  logger.error('Customer migration failed', error);
  process.exit(1);
});
