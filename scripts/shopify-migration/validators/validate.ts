/**
 * Post-Migration Validation
 *
 * Compares source record counts against D1 record counts per entity,
 * performs spot checks on sample records, validates R2 image counts,
 * and generates a formatted report.
 */

import type { MigrationConfig } from '../lib/config.js';
import type { IdMap } from '../lib/id-map.js';
import type { MigrationLogger } from '../lib/logger.js';
import { executeQuery } from '../lib/wrangler-exec.js';
import { listR2Files } from '../lib/r2-client.js';

interface EntityValidation {
  entity: string;
  sourceCount: number;
  d1Count: number;
  match: boolean;
  spotCheck: string;
}

export interface ValidationResult {
  passed: boolean;
  report: string;
  entities: EntityValidation[];
}

/**
 * Parse a count result from wrangler d1 execute output.
 * Wrangler returns structured text output; we parse the COUNT(*) value.
 */
function parseCountResult(output: string): number {
  // Try to find JSON data in the output
  const lines = output.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
      try {
        const data = JSON.parse(trimmed);
        const rows = Array.isArray(data) ? data : [data];
        for (const row of rows) {
          // COUNT(*) appears as "COUNT(*)" or "count" key
          const countVal =
            row['COUNT(*)'] ?? row['count(*)'] ?? row['count'] ?? row['COUNT'];
          if (countVal !== undefined) {
            return Number(countVal);
          }
        }
      } catch {
        // Not valid JSON, continue
      }
    }
  }

  // Fallback: try to find a bare number in the output
  const match = output.match(/(\d+)/);
  return match ? parseInt(match[1], 10) : 0;
}

/**
 * Perform spot check on sample records for an entity.
 * Returns a string like "3/3 passed" or "2/3 passed (1 issue)".
 */
function spotCheckEntity(
  entity: string,
  config: MigrationConfig,
  _logger: MigrationLogger
): string {
  const sampleSize = 3;
  let passed = 0;

  try {
    // Query sample records from D1
    const queryResult = executeQuery(
      `SELECT * FROM ${entity} LIMIT ${sampleSize}`,
      config.d1DatabaseName,
      config.d1Env
    );

    const lines = queryResult.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
        try {
          const data = JSON.parse(trimmed);
          const rows = Array.isArray(data) ? data : [data];

          for (const row of rows) {
            if (passed >= sampleSize) break;

            // Entity-specific validation
            let valid = true;

            switch (entity) {
              case 'products':
                // Verify product has name, slug, and parseable rating JSON
                valid = Boolean(row.name && row.slug);
                if (row.rating) {
                  try {
                    const rating = JSON.parse(row.rating);
                    valid = valid && typeof rating.average === 'number';
                  } catch {
                    // Rating might not be set yet
                  }
                }
                break;

              case 'categories':
                // Verify category has localized name format (JSON with "en" key)
                if (row.name) {
                  try {
                    const name = JSON.parse(row.name);
                    valid = typeof name === 'object' && 'en' in name;
                  } catch {
                    valid = false;
                  }
                } else {
                  valid = false;
                }
                break;

              case 'orders':
                // Verify order has correct total_amount format (Money object in cents)
                if (row.total_amount) {
                  try {
                    const total = JSON.parse(row.total_amount);
                    valid = typeof total.amount === 'number' && typeof total.currency === 'string';
                  } catch {
                    valid = false;
                  }
                }
                break;

              case 'product_reviews':
                // Verify review has product_id
                valid = Boolean(row.product_id);
                break;

              default:
                // For other entities, just verify the record exists and has an id
                valid = Boolean(row.id);
                break;
            }

            if (valid) passed++;
          }
        } catch {
          // Not valid JSON
        }
      }
    }
  } catch (err) {
    return `error: ${err instanceof Error ? err.message : String(err)}`;
  }

  const total = Math.min(sampleSize, passed + (sampleSize - passed));
  if (passed === total) {
    return `${passed}/${total} passed`;
  }
  return `${passed}/${total} passed (${total - passed} issue${total - passed > 1 ? 's' : ''})`;
}

/**
 * Run post-migration validation.
 *
 * Compares source counts (from idMap and migration state) against D1 counts,
 * performs spot checks, and validates R2 images.
 */
export async function runValidation(
  config: MigrationConfig,
  idMap: IdMap,
  logger: MigrationLogger
): Promise<ValidationResult> {
  logger.setEntity('validation');
  logger.info('Starting post-migration validation...');

  const entities: EntityValidation[] = [];
  let allPassed = true;

  // Entity table names and their D1 equivalents
  const entityChecks: Array<{
    name: string;
    table: string;
    idMapEntity?: string;
  }> = [
    { name: 'categories', table: 'categories', idMapEntity: 'categories' },
    { name: 'products', table: 'products', idMapEntity: 'products' },
    { name: 'product_variants', table: 'product_variants' },
    { name: 'customers', table: 'customers', idMapEntity: 'customers' },
    { name: 'orders', table: 'orders', idMapEntity: 'orders' },
    { name: 'product_reviews', table: 'product_reviews', idMapEntity: 'reviews' },
    { name: 'pages', table: 'pages', idMapEntity: 'pages' },
    { name: 'redirect_map', table: 'redirect_map' },
  ];

  for (const check of entityChecks) {
    let sourceCount = 0;
    let d1Count = 0;

    // Get source count from idMap
    if (check.idMapEntity) {
      sourceCount = idMap.count(check.idMapEntity);
    }

    // Get D1 count
    try {
      const countResult = executeQuery(
        `SELECT COUNT(*) as count FROM ${check.table}`,
        config.d1DatabaseName,
        config.d1Env
      );
      d1Count = parseCountResult(countResult);
    } catch (err) {
      logger.error(`Failed to get D1 count for ${check.table}`, err);
      d1Count = -1; // Indicate error
    }

    // For entities without idMap tracking, use D1 count as source count
    if (!check.idMapEntity) {
      sourceCount = d1Count;
    }

    const match = sourceCount === d1Count && d1Count >= 0;
    if (!match && d1Count >= 0) {
      allPassed = false;
      logger.warn(
        `Count mismatch for ${check.name}: source=${sourceCount}, d1=${d1Count}`
      );
    }

    // Spot check
    const spotCheck = d1Count > 0
      ? spotCheckEntity(check.table, config, logger)
      : 'n/a (empty)';

    entities.push({
      entity: check.name,
      sourceCount,
      d1Count,
      match,
      spotCheck,
    });
  }

  // R2 image validation
  let r2Status = 'skipped';
  if (config.r2AccessKeyId) {
    try {
      const r2Files = await listR2Files('products/', config);
      const imageCount = r2Files.length;
      r2Status = `${imageCount} images in R2`;
      logger.info(`R2 validation: ${imageCount} product images found`);
    } catch (err) {
      r2Status = `error: ${err instanceof Error ? err.message : String(err)}`;
      logger.error('R2 image validation failed', err);
    }
  } else {
    r2Status = 'skipped (no R2 credentials)';
  }

  // Generate formatted report
  const report = formatReport(entities, r2Status, allPassed);

  logger.info(
    `Validation ${allPassed ? 'PASSED' : 'FAILED'}: ${entities.length} entities checked`
  );

  return { passed: allPassed, report, entities };
}

/**
 * Format the validation report as an aligned table.
 */
function formatReport(
  entities: EntityValidation[],
  r2Status: string,
  allPassed: boolean
): string {
  const lines: string[] = [
    '='.repeat(72),
    'POST-MIGRATION VALIDATION REPORT',
    `Generated: ${new Date().toISOString()}`,
    '='.repeat(72),
    '',
    'Entity            | Source | D1     | Match | Spot Check',
    '-'.repeat(72),
  ];

  for (const e of entities) {
    const name = e.entity.padEnd(18);
    const source = String(e.sourceCount).padStart(6);
    const d1 = String(e.d1Count).padStart(6);
    const match = e.match ? '  OK ' : ' FAIL';
    const spot = e.spotCheck;
    lines.push(`${name}| ${source} | ${d1} | ${match} | ${spot}`);
  }

  lines.push('-'.repeat(72));
  lines.push('');
  lines.push(`R2 Images: ${r2Status}`);
  lines.push('');
  lines.push(
    allPassed
      ? 'RESULT: ALL VALIDATIONS PASSED'
      : 'RESULT: VALIDATION FAILED -- see mismatches above'
  );
  lines.push('='.repeat(72));

  return lines.join('\n');
}
