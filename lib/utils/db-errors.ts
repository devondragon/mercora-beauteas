/**
 * Pure helpers for classifying D1/SQLite driver errors.
 *
 * This module has NO imports and no Cloudflare binding dependencies — it is
 * safe to import from anywhere, including `tests/unit/**` (jsdom env), which
 * must never pull in lib/db.ts or lib/models/** (those import
 * @opennextjs/cloudflare's getCloudflareContext() and belong in E2E /
 * @cloudflare/vitest-pool-workers instead — see vitest.config.ts).
 */

/**
 * True when an error (or any error in its `cause` chain) is a SQLite UNIQUE /
 * PRIMARY KEY constraint violation. Drizzle's D1 driver wraps the underlying
 * error as `"Failed query: …"` and tucks the original `SQLITE_CONSTRAINT_*`
 * text into `cause`, so matching only the top-level message can miss it. Walk
 * the chain and match the constraint text wherever it surfaces. (Shared by
 * lib/models/mach/subscriptions.ts and lib/models/mach/giftCard.ts.)
 */
export function isUniqueViolation(err: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current && !seen.has(current); depth++) {
    seen.add(current);
    const message =
      current instanceof Error ? current.message : typeof current === 'string' ? current : '';
    if (/unique constraint failed|sqlite_constraint_(unique|primarykey)|\bunique\b/i.test(message)) {
      return true;
    }
    current = current instanceof Error ? (current as { cause?: unknown }).cause : undefined;
  }
  return false;
}
