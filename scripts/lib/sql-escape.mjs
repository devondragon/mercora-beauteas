/**
 * Shared SQL string-escaping helper for scripts that shell out to
 * `wrangler d1 execute --command` (no parameterized query support there).
 *
 * Both scripts/manage-tokens.ts and scripts/enrich-catalog.mjs previously
 * hand-rolled the identical `'${value.replace(/'/g, "''")}'` escaping
 * independently (BMC-157). Centralizing it here means a future edit to one
 * can't silently diverge from the other and reintroduce an injection bug.
 *
 * A plain `.mjs` module so it's importable both from Node ESM scripts and
 * from `.ts` scripts run via `tsx`.
 */

/**
 * Escape a value for use as a single-quoted SQL string literal: doubles
 * embedded single quotes and wraps the result in quotes.
 * @param {unknown} value
 * @returns {string}
 */
export function sqlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}
