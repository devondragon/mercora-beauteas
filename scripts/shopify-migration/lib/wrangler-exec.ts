/**
 * Wrangler D1 SQL Execution Helper
 *
 * Generates SQL statements and executes them via `wrangler d1 execute`.
 * Scripts cannot use Drizzle ORM directly (Cloudflare runtime deps).
 */

import { execFileSync } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';

/**
 * Execute SQL via wrangler d1 execute --file
 */
export function executeSql(sql: string, dbName: string, env: string = 'dev'): void {
  const tmpFile = `/tmp/migration-${Date.now()}.sql`;
  writeFileSync(tmpFile, sql, 'utf-8');

  try {
    execFileSync(
      'npx',
      ['wrangler', 'd1', 'execute', dbName, '--env', env, `--file=${tmpFile}`],
      { stdio: 'inherit' }
    );
  } finally {
    try {
      unlinkSync(tmpFile);
    } catch {
      // ignore cleanup errors
    }
  }
}

/**
 * Execute inline SQL query and return stdout (for validation COUNT queries)
 */
export function executeQuery(query: string, dbName: string, env: string = 'dev'): string {
  const result = execFileSync(
    'npx',
    ['wrangler', 'd1', 'execute', dbName, '--env', env, `--command=${query}`],
    { encoding: 'utf-8' }
  );
  return result;
}

/**
 * Escape a SQL value for safe insertion.
 * Handles null, number, boolean, string (apostrophe escaping), and JSON objects.
 */
export function escapeSqlValue(value: unknown): string {
  if (value === null || value === undefined) {
    return 'NULL';
  }

  if (typeof value === 'number') {
    return String(value);
  }

  if (typeof value === 'boolean') {
    return value ? '1' : '0';
  }

  if (typeof value === 'object') {
    // JSON objects -- stringify then escape the string
    const json = JSON.stringify(value);
    return `'${json.replace(/'/g, "''")}'`;
  }

  // String -- escape single quotes by doubling
  return `'${String(value).replace(/'/g, "''")}'`;
}

/**
 * Generate INSERT SQL statements, chunked at a given batch size.
 * D1 has a ~100KB SQL statement size limit, so we chunk to stay safe.
 */
export function generateInsertSql(
  table: string,
  records: Record<string, unknown>[],
  chunkSize: number = 50
): string {
  if (records.length === 0) return '';

  const columns = Object.keys(records[0]);
  const statements: string[] = [];

  for (let i = 0; i < records.length; i += chunkSize) {
    const chunk = records.slice(i, i + chunkSize);
    const values = chunk
      .map(
        (r) =>
          `(${columns.map((c) => escapeSqlValue(r[c])).join(', ')})`
      )
      .join(',\n');

    statements.push(
      `INSERT INTO ${table} (${columns.join(', ')}) VALUES\n${values};`
    );
  }

  return statements.join('\n\n');
}
