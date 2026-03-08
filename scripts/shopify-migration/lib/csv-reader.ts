/**
 * CSV and JSON File Reader Utilities
 *
 * Reads Shopify export files (CSV and JSON) for file-based extraction.
 */

import { readFileSync } from 'node:fs';
import { parse } from 'csv-parse/sync';

/**
 * Read a CSV file and parse into typed records.
 *
 * @param filePath - Path to the CSV file
 * @param transform - Optional transform function to apply to each row
 * @returns Array of parsed records
 */
export function readCsv<T = Record<string, string>>(
  filePath: string,
  transform?: (row: Record<string, string>) => T
): T[] {
  const content = readFileSync(filePath, 'utf-8');
  const records = parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as Record<string, string>[];

  if (transform) {
    return records.map(transform);
  }

  return records as unknown as T[];
}

/**
 * Read a JSON file and parse into typed records.
 *
 * @param filePath - Path to the JSON file
 * @returns Array of parsed records
 */
export function readJson<T>(filePath: string): T[] {
  const content = readFileSync(filePath, 'utf-8');
  const data = JSON.parse(content);

  // Handle both array and { entity: [...] } formats
  if (Array.isArray(data)) {
    return data as T[];
  }

  // Check common wrapper keys
  const keys = Object.keys(data);
  if (keys.length === 1 && Array.isArray(data[keys[0]])) {
    return data[keys[0]] as T[];
  }

  // Single object -- wrap in array
  return [data as T];
}
