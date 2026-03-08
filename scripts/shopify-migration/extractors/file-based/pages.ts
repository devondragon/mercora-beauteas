/**
 * File-Based Page Extractor
 *
 * Reads Shopify CMS page data from JSON or CSV export files.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readCsv, readJson } from '../../lib/csv-reader.js';
import type { ExtractResult, ShopifyPage } from '../../lib/types.js';

/**
 * Extract pages from file (JSON or CSV).
 */
export function extractPagesFromFile(
  dataDir: string
): ExtractResult<ShopifyPage> {
  const jsonPath = join(dataDir, 'pages.json');
  const csvPath = join(dataDir, 'pages.csv');

  let records: ShopifyPage[];

  if (existsSync(jsonPath)) {
    records = readJson<ShopifyPage>(jsonPath);
  } else if (existsSync(csvPath)) {
    records = readCsv<ShopifyPage>(csvPath, (row) => {
      return {
        id: row['Id'] || row['id'] || '',
        title: row['Title'] || row['title'] || '',
        handle: row['Handle'] || row['handle'] || '',
        body_html: row['Body HTML'] || row['body_html'] || row['Body'] || '',
        author: row['Author'] || row['author'] || undefined,
        published_at:
          row['Published At'] || row['published_at'] || undefined,
        created_at: row['Created At'] || row['created_at'] || undefined,
        updated_at: row['Updated At'] || row['updated_at'] || undefined,
        template_suffix:
          row['Template Suffix'] || row['template_suffix'] || undefined,
      };
    });
  } else {
    throw new Error(
      `No page data file found. Expected ${jsonPath} or ${csvPath}`
    );
  }

  return {
    records,
    source: 'file',
    extractedAt: new Date().toISOString(),
  };
}
