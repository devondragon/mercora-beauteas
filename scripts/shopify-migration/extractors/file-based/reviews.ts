/**
 * File-Based Review Extractor
 *
 * Reads Judge.me review data from CSV or JSON export files.
 * Filters to only 'ok' publication status reviews (skips spam/not-yet).
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readCsv, readJson } from '../../lib/csv-reader.js';
import type { ExtractResult, JudgeMeReview } from '../../lib/types.js';

/**
 * Normalize column names: lowercase, trim whitespace.
 * Handles minor variations in Judge.me CSV exports.
 */
function normalizeRow(row: Record<string, string>): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(row)) {
    normalized[key.toLowerCase().trim()] = value;
  }
  return normalized;
}

/**
 * Extract reviews from file (CSV or JSON).
 */
export function extractReviewsFromFile(
  dataDir: string
): ExtractResult<JudgeMeReview> {
  const jsonPath = join(dataDir, 'reviews.json');
  const csvPath = join(dataDir, 'reviews.csv');

  let allRecords: JudgeMeReview[];

  if (existsSync(jsonPath)) {
    allRecords = readJson<JudgeMeReview>(jsonPath);
  } else if (existsSync(csvPath)) {
    allRecords = readCsv<JudgeMeReview>(csvPath, (row) => {
      const n = normalizeRow(row);

      return {
        title: n['title'] || undefined,
        body: n['body'] || '',
        rating: parseInt(n['rating'] || '0', 10),
        review_date: n['review_date'] || n['created_at'] || undefined,
        reviewer_name: n['reviewer_name'] || n['reviewer'] || undefined,
        reviewer_email: n['reviewer_email'] || n['email'] || undefined,
        product_id: n['product_id'] || undefined,
        product_handle: n['product_handle'] || n['handle'] || undefined,
        reply: n['reply'] || undefined,
        picture_urls: n['picture_urls'] || n['pictures'] || undefined,
        source: n['source'] || undefined,
        status: n['publication status'] || n['status'] || 'ok',
      };
    });
  } else {
    throw new Error(
      `No review data file found. Expected ${jsonPath} or ${csvPath}`
    );
  }

  // Filter to only published reviews (status 'ok')
  const records = allRecords.filter((r) => {
    const status = (r.status || 'ok').toLowerCase().trim();
    return status === 'ok' || status === 'published';
  });

  return {
    records,
    source: 'file',
    extractedAt: new Date().toISOString(),
  };
}
