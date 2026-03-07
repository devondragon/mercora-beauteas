/**
 * D1 Loader
 *
 * Loads transformed records into Cloudflare D1 via wrangler CLI.
 */

import type { LoadResult } from '../lib/types.js';
import type { MigrationConfig } from '../lib/config.js';
import { executeSql, generateInsertSql } from '../lib/wrangler-exec.js';
import { logger } from '../lib/logger.js';

/**
 * Load records into a D1 table.
 *
 * Clears existing demo data first (matching known prefixes),
 * then inserts new records in chunks.
 */
export async function loadToD1<T extends object>(
  table: string,
  records: T[],
  config: MigrationConfig
): Promise<LoadResult> {
  const result: LoadResult = {
    entity: table,
    inserted: 0,
    skipped: 0,
    errors: [],
  };

  if (records.length === 0) {
    logger.warn(`No records to load into ${table}`);
    return result;
  }

  try {
    // Clear existing demo data using known prefixes
    const prefixMap: Record<string, string[]> = {
      products: ['prod_'],
      product_variants: ['variant_'],
      categories: ['cat_'],
    };

    const prefixes = prefixMap[table];
    if (prefixes) {
      const deleteClauses = prefixes
        .map((p) => `id LIKE '${p}%'`)
        .join(' OR ');
      const deleteSql = `DELETE FROM ${table} WHERE ${deleteClauses};`;
      logger.info(`Clearing existing demo data from ${table}...`);
      executeSql(deleteSql, config.d1DatabaseName, config.d1Env);
    }

    // Generate and execute INSERT SQL
    const insertSql = generateInsertSql(table, records as unknown as Record<string, unknown>[]);
    if (insertSql) {
      logger.info(`Inserting ${records.length} records into ${table}...`);
      executeSql(insertSql, config.d1DatabaseName, config.d1Env);
      result.inserted = records.length;
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to load ${table}`, error);
    result.errors.push({ id: table, error: msg });
  }

  return result;
}
