/**
 * Pure planning helpers for scripts/d1-migrate.mjs (BMC-239).
 *
 * Deliberately free of child_process/fs so the unit suite can cover the three
 * places where a silent bug would let a deploy land on an unmigrated DB:
 *   1. which databases a deploy target expands to (the dev *preview* DB has
 *      been forgotten by hand before — see docs/database-migrations.md),
 *   2. whether `wrangler d1 migrations list` output was actually understood,
 *   3. that the --preview / --env flags survive into the wrangler argv.
 */

/**
 * Deploy target -> every remote D1 database that must be migrated before the
 * Worker for that env goes live. Database names are the wrangler.jsonc
 * `database_name` values; `--env` selects the real database_id, and --preview
 * selects the dev `preview_database_id`.
 */
export const DEPLOY_TARGETS = {
  dev: [
    { label: "dev", database: "beauteas-db-dev", wranglerEnv: "dev", preview: false },
    {
      label: "dev preview",
      database: "beauteas-db-dev",
      wranglerEnv: "dev",
      preview: true,
      // `wrangler d1 export` has no --preview flag (unlike migrations
      // list/apply), so the preview DB can only be exported by addressing its
      // ID directly. Mirrors `preview_database_id` in wrangler.jsonc — the unit
      // suite asserts the two stay in sync.
      exportDatabaseId: "0a037b06-421c-484e-8b17-140a5741c1ef",
    },
  ],
  production: [
    { label: "production", database: "beauteas-db", wranglerEnv: "production", preview: false },
  ],
};

export const DEPLOY_TARGET_NAMES = Object.keys(DEPLOY_TARGETS);

/** Deploy targets whose backup must be durably stored off the deploy machine. */
const REQUIRES_DURABLE_BACKUP = new Set(["production"]);

export function resolveTargets(envName) {
  const targets = DEPLOY_TARGETS[envName];
  if (!targets) {
    throw new Error(
      `Unknown --env "${envName}". Expected one of: ${DEPLOY_TARGET_NAMES.join(", ")}`,
    );
  }
  return targets;
}

export function requiresDurableBackup(envName) {
  return REQUIRES_DURABLE_BACKUP.has(envName);
}

// Migration filenames are `NNNN_name.sql` (migrations/0001_initial_schema.sql …).
// Two files share the 0010 prefix, so this must not assume prefix uniqueness.
const MIGRATION_FILENAME = /\b(\d{4}_[A-Za-z0-9._-]*?\.sql)\b/g;
const UP_TO_DATE = /No migrations to apply!/i;

/**
 * Interpret `wrangler d1 migrations list` output.
 *
 * Returns `unrecognized` rather than guessing when the output matches neither
 * shape. That case is treated as a hard failure by the caller on purpose: a
 * future wrangler that reworded its table would otherwise silently read as
 * "nothing pending" and wave an unmigrated database straight through.
 *
 * @returns {{ status: 'pending'|'up-to-date'|'unrecognized', migrations: string[] }}
 */
export function interpretMigrationsList(output) {
  // Strip ANSI SGR codes first. A colorized filename (`\x1b[32m0022_x.sql`)
  // defeats the leading `\b` — an SGR sequence ends in a letter, and letter→
  // digit is not a word boundary — so the regex finds nothing and genuinely
  // pending migrations read as "unrecognized". That fails safe (the caller
  // aborts) but would be a spurious deploy outage if anything ever sets
  // FORCE_COLOR on captured, non-TTY output.
  const text = String(output ?? "").replace(/\x1b\[[0-9;]*m/g, "");
  const migrations = [...new Set(text.match(MIGRATION_FILENAME) ?? [])];

  if (migrations.length > 0) return { status: "pending", migrations };
  if (UP_TO_DATE.test(text)) return { status: "up-to-date", migrations: [] };
  return { status: "unrecognized", migrations: [] };
}

/** Stable slug identifying one physical database (dev and dev preview differ). */
export function targetSlug(target) {
  return `${target.database}${target.preview ? "-preview" : ""}`;
}

/**
 * Backup filename + R2 object key for a target.
 * `timestamp` is an ISO-8601 string; `:` and `.` are not safe in object keys
 * on every tool that touches them, so they are flattened to `-`.
 */
export function backupNames(target, timestamp) {
  const stamp = String(timestamp).replace(/[:.]/g, "-");
  const slug = targetSlug(target);
  const fileName = `${slug}-${stamp}.sql`;
  return { fileName, objectKey: `d1/${slug}/${fileName}` };
}

export function migrationsListArgs(target) {
  return [
    "d1", "migrations", "list", target.database,
    "--remote", "--env", target.wranglerEnv,
    ...(target.preview ? ["--preview"] : []),
  ];
}

export function migrationsApplyArgs(target) {
  return [
    "d1", "migrations", "apply", target.database,
    "--remote", "--env", target.wranglerEnv,
    ...(target.preview ? ["--preview"] : []),
  ];
}

/**
 * `wrangler d1 export` rejects --preview ("Unknown argument: preview"), so a
 * preview database is addressed by ID instead. Passing --preview here silently
 * broke the dev-preview backup until a real run caught it.
 */
export function exportArgs(target, outputPath) {
  return [
    "d1", "export", target.exportDatabaseId ?? target.database,
    "--remote", "--env", target.wranglerEnv,
    // Non-interactive: the export must never block an unattended deploy.
    "--skip-confirmation",
    "--output", outputPath,
  ];
}

export function r2PutArgs(bucket, objectKey, filePath) {
  return [
    "r2", "object", "put", `${bucket}/${objectKey}`,
    "--file", filePath,
    "--content-type", "application/sql",
    "--remote",
  ];
}
