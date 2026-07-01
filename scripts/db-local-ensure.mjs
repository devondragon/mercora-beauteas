#!/usr/bin/env node
/**
 * Ensure the LOCAL D1 database is ready for `npm run dev`.
 *
 * Runs automatically via the `predev` npm hook. Two steps:
 *   1. Apply all migrations to the local D1 (idempotent — wrangler tracks
 *      applied state in `d1_migrations`, so already-applied files are skipped).
 *   2. Seed the store catalog from data/d1/seed.sql, but ONLY when the DB is
 *      empty. Emptiness is detected via the `categories` table, which no
 *      migration populates — it is filled exclusively by seed.sql. This keeps
 *      the step non-destructive: local edits made through the admin UI survive
 *      restarts. For an explicit wipe + reload, use `npm run db:reset:local`.
 *
 * Why this exists: the local `.wrangler/state` D1 starts with zero tables
 * (migrations are normally applied `--remote`), so DB-backed routes 500 with
 * "no such table" until the local DB is set up. See CLAUDE.md / project memory.
 */
import { execFileSync } from "node:child_process";

const DB = "beauteas-db-dev";
const ENV = "dev";
const SEED_FILE = "data/d1/seed.sql";
// Table populated only by seed.sql (never by a migration) → reliable "seeded?" signal.
const SENTINEL_TABLE = "categories";

const tag = "[db:local]";

// No shell: args are passed directly to wrangler, so nothing is interpolated
// into a command string.
function wrangler(args, { capture = false } = {}) {
  return execFileSync("npx", ["wrangler", ...args], {
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
}

function countRows(table) {
  try {
    const out = wrangler(
      ["d1", "execute", DB, "--local", "--env", ENV, "--json", "--command", `SELECT count(*) AS n FROM ${table}`],
      { capture: true }
    );
    // With --json, stdout is a JSON array; slice from the first '[' to be safe.
    const json = JSON.parse(out.slice(out.indexOf("[")));
    return json?.[0]?.results?.[0]?.n ?? 0;
  } catch {
    // Table missing / query failed → treat as empty so we seed.
    return 0;
  }
}

console.log(`${tag} Applying migrations to local D1 (${DB})...`);
wrangler(["d1", "migrations", "apply", DB, "--local", "--env", ENV]);

const seeded = countRows(SENTINEL_TABLE);
if (seeded > 0) {
  console.log(`${tag} Seed data present (${seeded} ${SENTINEL_TABLE}) — skipping seed.`);
} else {
  console.log(`${tag} Local DB is empty — loading ${SEED_FILE}...`);
  wrangler(["d1", "execute", DB, "--local", "--env", ENV, "--file", SEED_FILE]);
  console.log(`${tag} Seed complete.`);
}
