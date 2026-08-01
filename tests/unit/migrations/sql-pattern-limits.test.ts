/**
 * Guards every migration against D1's LIKE/GLOB pattern-length limit.
 *
 * D1 runs on workerd's SQLite build, which sets SQLITE_LIMIT_LIKE_PATTERN_LENGTH
 * to 50 bytes. A longer pattern does not degrade or warn — the statement fails
 * outright with "LIKE or GLOB pattern too complex: SQLITE_ERROR".
 *
 * This is a nasty failure mode for a migration specifically:
 *   - `npm test` and `tsc` cannot see it; a .sql file is never type-checked.
 *   - Plain `sqlite3` has a 50,000-byte default limit, so the pattern works
 *     fine on a local fixture and only fails on D1.
 *   - `npm run deploy:*` auto-applies pending migrations before the build and
 *     ABORTS the deploy on failure, so an over-long pattern doesn't just break
 *     its own migration — it blocks deploying anything at all.
 *
 * Migration 0024 shipped with a ~92-byte GLOB on exactly this trap and could
 * never have applied to any environment. This test is what makes that a
 * one-time mistake.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** workerd's SQLITE_LIMIT_LIKE_PATTERN_LENGTH. */
const D1_LIKE_PATTERN_MAX_BYTES = 50;

const MIGRATIONS_DIR = join(process.cwd(), "migrations");

/**
 * Pull out every single-quoted literal used as the right-hand side of a LIKE or
 * GLOB. Deliberately simple — it only needs to see the literal form migrations
 * actually use.
 */
function findPatternLiterals(sql: string): string[] {
  const found: string[] = [];
  const re = /\b(?:NOT\s+)?(?:LIKE|GLOB)\s+'((?:[^']|'')*)'/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(sql)) !== null) {
    found.push(match[1].replace(/''/g, "'"));
  }
  return found;
}

describe("migration SQL respects D1's LIKE/GLOB pattern limit", () => {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));

  it("finds migration files to check", () => {
    // Stops the suite silently passing if the directory moves.
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)("%s uses no over-long LIKE/GLOB pattern", (file) => {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    for (const pattern of findPatternLiterals(sql)) {
      expect(
        Buffer.byteLength(pattern, "utf8"),
        `${file} has a ${Buffer.byteLength(pattern, "utf8")}-byte LIKE/GLOB pattern; ` +
          `D1 rejects anything over ${D1_LIKE_PATTERN_MAX_BYTES} bytes with ` +
          `"LIKE or GLOB pattern too complex". Pattern: ${pattern}`,
      ).toBeLessThanOrEqual(D1_LIKE_PATTERN_MAX_BYTES);
    }
  });
});

describe("the guard above can actually fail", () => {
  // Without these, the test above would pass just as happily against a detector
  // that never matches anything.
  const HISTORICAL_BAD_PATTERN =
    "[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z";

  it("extracts the pattern from a GLOB comparison", () => {
    const sql = `UPDATE orders SET x = 1 WHERE created_at NOT GLOB '${HISTORICAL_BAD_PATTERN}';`;
    expect(findPatternLiterals(sql)).toEqual([HISTORICAL_BAD_PATTERN]);
  });

  it("flags the pattern migration 0024 originally shipped with", () => {
    expect(Buffer.byteLength(HISTORICAL_BAD_PATTERN, "utf8")).toBeGreaterThan(
      D1_LIKE_PATTERN_MAX_BYTES,
    );
  });

  it("extracts LIKE patterns too, case-insensitively", () => {
    const sql = "SELECT 1 WHERE a like 'abc%' AND b NOT LIKE '____-__-__';";
    expect(findPatternLiterals(sql)).toEqual(["abc%", "____-__-__"]);
  });

  it("accepts a pattern that is exactly at the limit", () => {
    const atLimit = "_".repeat(D1_LIKE_PATTERN_MAX_BYTES);
    const sql = `SELECT 1 WHERE a LIKE '${atLimit}';`;
    const [found] = findPatternLiterals(sql);
    expect(Buffer.byteLength(found, "utf8")).toBe(D1_LIKE_PATTERN_MAX_BYTES);
  });
});
