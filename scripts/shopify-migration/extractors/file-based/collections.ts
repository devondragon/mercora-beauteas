/**
 * File-Based Collection Extractor
 *
 * Reads Shopify collections from JSON or CSV export files.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ExtractResult, ShopifyCollection } from '../../lib/types.js';
import { readJson, readCsv } from '../../lib/csv-reader.js';
import { logger } from '../../lib/logger.js';

/**
 * Extract collections from file (JSON preferred, CSV fallback).
 */
export function extractCollectionsFromFile(
  dataDir: string
): ExtractResult<ShopifyCollection> {
  const jsonPath = join(dataDir, 'collections.json');
  const csvPath = join(dataDir, 'collections.csv');

  let records: ShopifyCollection[];

  if (existsSync(jsonPath)) {
    logger.info(`Reading collections from JSON: ${jsonPath}`);
    records = readJson<ShopifyCollection>(jsonPath);
  } else if (existsSync(csvPath)) {
    logger.info(`Reading collections from CSV: ${csvPath}`);
    records = readCsv<ShopifyCollection>(csvPath, (row) => ({
      id: row['id'] ?? row['ID'] ?? '',
      title: row['Title'] ?? row['title'] ?? '',
      handle: row['Handle'] ?? row['handle'] ?? '',
      body_html: row['Body (HTML)'] ?? row['body_html'] ?? row['Description'] ?? '',
      image: row['Image Src']
        ? { src: row['Image Src'], alt: row['Image Alt Text'] ?? null }
        : null,
      published_at: row['Published'] === 'true' ? new Date().toISOString() : null,
    }));
  } else {
    throw new Error(
      `No collections data file found. Expected ${jsonPath} or ${csvPath}`
    );
  }

  logger.info(`Extracted ${records.length} collections from file`);

  return {
    records,
    source: 'file',
    extractedAt: new Date().toISOString(),
  };
}
