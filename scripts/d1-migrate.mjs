#!/usr/bin/env node
/**
 * Apply pending D1 migrations to every remote database backing a deploy target,
 * BEFORE the Worker for that target is built and deployed (BMC-239).
 *
 * Wired into npm's `predeploy:dev` / `predeploy:production` lifecycle hooks, so
 * it covers both entry points from one place:
 *   - manual  — `npm run deploy:dev`, `npm run deploy:production`
 *   - CI/CD   — .github/workflows/production-deploy-guard.yml, which invokes
 *               `npm run deploy:production`
 * A non-zero exit from a `pre*` hook aborts the run, so a failed migration
 * blocks the deploy for free: the Worker is never deployed against a
 * half-migrated database.
 *
 * ORDERING: this runs before the build, so a build failure can leave the DB
 * migrated with the old code still live. That is the safe direction (DB ahead
 * of code) and is why additive/expand-first migrations are the house rule —
 * see docs/database-migrations.md § Auto-apply on deploy.
 *
 * BACKUPS: a pre-flight `d1 export` is taken of any database with pending
 * migrations, written to ./.backups (gitignored) and uploaded to a private R2
 * bucket. Production REQUIRES the R2 upload to succeed — on a CI runner the
 * local file evaporates with the job, and that backup is the only safety net
 * standing between an auto-applied destructive migration and lost data.
 * A prod export is full customer PII: it must never go to a public bucket or a
 * GitHub Actions artifact.
 *
 * Usage:
 *   node scripts/d1-migrate.mjs --env dev
 *   node scripts/d1-migrate.mjs --env production
 *   node scripts/d1-migrate.mjs --env production --dry-run   # list only, no writes
 *   node scripts/d1-migrate.mjs --env dev --skip-backup       # dev only
 *
 * Env:
 *   D1_BACKUP_R2_BUCKET  private R2 bucket for backups
 *                        (default beauteas-db-backups; `none` disables — dev only)
 *   CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID  consumed by wrangler.
 *                        The token needs D1:Edit and R2:Edit.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  DEPLOY_TARGET_NAMES,
  backupNames,
  exportArgs,
  interpretMigrationsList,
  migrationsApplyArgs,
  migrationsListArgs,
  r2PutArgs,
  requiresDurableBackup,
  resolveTargets,
  targetSlug,
} from "./lib/d1-migrate-plan.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BACKUP_DIR = join(ROOT, ".backups");
const DEFAULT_BACKUP_BUCKET = "beauteas-db-backups";
const tag = "[d1-migrate]";

const log = (msg) => console.log(`${tag} ${msg}`);
const warn = (msg) => console.warn(`${tag} ⚠️  ${msg}`);

function fail(msg) {
  console.error(`${tag} ABORT: ${msg}`);
  console.error(`${tag} Deploy stopped — the Worker was NOT deployed.`);
  process.exit(1);
}

// --- args -------------------------------------------------------------------

const argv = process.argv.slice(2);
const envIndex = argv.indexOf("--env");
const envName = envIndex >= 0 ? argv[envIndex + 1] : undefined;
const dryRun = argv.includes("--dry-run");
const skipBackup = argv.includes("--skip-backup");

if (!envName) {
  console.error(`${tag} usage: node scripts/d1-migrate.mjs --env <${DEPLOY_TARGET_NAMES.join("|")}> [--dry-run] [--skip-backup]`);
  process.exit(1);
}

let targets;
try {
  targets = resolveTargets(envName);
} catch (err) {
  fail(err.message);
}

if (skipBackup && requiresDurableBackup(envName)) {
  fail("--skip-backup is not allowed for production. The pre-flight export is the only safety net for an auto-applied migration.");
}

const backupBucket = process.env.D1_BACKUP_R2_BUCKET ?? DEFAULT_BACKUP_BUCKET;
const backupsDisabled = backupBucket === "" || backupBucket === "none";

if (backupsDisabled && requiresDurableBackup(envName) && !dryRun) {
  fail(
    `D1_BACKUP_R2_BUCKET is disabled ("${backupBucket}") but production requires a durable off-machine backup. ` +
    "Point it at a PRIVATE R2 bucket (never beauteas-images — that one is public).",
  );
}

// --- wrangler ---------------------------------------------------------------

/** Run wrangler, streaming to the console. Returns true on exit code 0. */
function wrangler(args) {
  const res = spawnSync("npx", ["wrangler", ...args], {
    cwd: ROOT,
    stdio: ["inherit", "inherit", "inherit"],
    encoding: "utf8",
  });
  return res.status === 0;
}

/** Run wrangler capturing stdout+stderr together (wrangler splits across both). */
function wranglerCapture(args) {
  const res = spawnSync("npx", ["wrangler", ...args], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
  });
  return { ok: res.status === 0, output: `${res.stdout ?? ""}\n${res.stderr ?? ""}` };
}

// --- run --------------------------------------------------------------------

log(`target: ${envName} (${targets.length} database${targets.length === 1 ? "" : "s"})${dryRun ? " — DRY RUN, no writes" : ""}`);

let appliedAny = false;

for (const target of targets) {
  const slug = targetSlug(target);
  const listed = wranglerCapture(migrationsListArgs(target));

  if (!listed.ok) {
    console.error(listed.output.trim());
    fail(
      `could not list migrations for ${target.label} (${slug}). ` +
      "If this is a permissions error, the CLOUDFLARE_API_TOKEN needs D1:Edit.",
    );
  }

  const { status, migrations } = interpretMigrationsList(listed.output);

  if (status === "unrecognized") {
    console.error(listed.output.trim());
    fail(
      `could not understand \`wrangler d1 migrations list\` output for ${target.label}. ` +
      "Refusing to assume nothing is pending — a reworded wrangler table must not read as 'up to date'.",
    );
  }

  if (status === "up-to-date") {
    log(`✓ ${target.label} (${slug}) is up to date.`);
    continue;
  }

  log(`${target.label} (${slug}) — ${migrations.length} pending: ${migrations.join(", ")}`);

  if (dryRun) continue;

  if (!skipBackup) {
    const { fileName, objectKey } = backupNames(target, new Date().toISOString());
    const localPath = join(BACKUP_DIR, fileName);
    try {
      mkdirSync(BACKUP_DIR, { recursive: true });
    } catch (err) {
      fail(`could not create ${BACKUP_DIR} for the pre-flight backup: ${err.message}`);
    }

    log(`${target.label}: pre-flight export → .backups/${fileName}`);
    if (!wrangler(exportArgs(target, localPath))) {
      fail(`pre-flight backup of ${target.label} failed. Not applying migrations without a backup.`);
    }

    // An exit-0 export that produced nothing is not a backup. Cheap to check,
    // and the alternative is discovering it when someone needs to restore.
    let exportedBytes = 0;
    try {
      exportedBytes = statSync(localPath).size;
    } catch (err) {
      fail(`pre-flight export of ${target.label} left no readable file at ${localPath}: ${err.message}`);
    }
    if (exportedBytes === 0) {
      fail(`pre-flight export of ${target.label} produced an empty file. Refusing to apply against an empty backup.`);
    }

    if (backupsDisabled) {
      warn(`${target.label}: R2 upload disabled — backup exists only at .backups/${fileName}.`);
    } else {
      log(`${target.label}: uploading backup → r2://${backupBucket}/${objectKey}`);
      if (!wrangler(r2PutArgs(backupBucket, objectKey, localPath))) {
        const hint =
          `could not upload the ${target.label} backup to r2://${backupBucket}. ` +
          "Check the bucket exists and CLOUDFLARE_API_TOKEN has R2:Edit.";
        if (requiresDurableBackup(envName)) {
          fail(`${hint} Refusing to auto-apply production migrations without a durable backup.`);
        }
        warn(`${hint} Continuing — backup is local-only at .backups/${fileName}.`);
      }
    }
  } else {
    warn(`${target.label}: --skip-backup set, applying with NO backup.`);
  }

  log(`${target.label}: applying ${migrations.length} migration(s)...`);
  if (!wrangler(migrationsApplyArgs(target))) {
    fail(
      `migration apply failed for ${target.label} (${slug}). ` +
      "The failed migration was rolled back; earlier ones remain applied.",
    );
  }

  // A zero exit is NOT proof the migrations landed. `wrangler d1 migrations
  // apply` prompts for confirmation on a real TTY (a deliberate human beat on
  // a manual prod deploy), and answering "no" makes its handler `return`
  // normally — the process exits 0 having applied nothing. Trusting the exit
  // code there would log "✓ applied", let the deploy proceed, and reproduce
  // the exact unmigrated-DB outage this script exists to prevent. So verify
  // the post-condition instead: nothing may still be pending.
  const after = wranglerCapture(migrationsListArgs(target));
  const verified = interpretMigrationsList(after.output);
  if (!after.ok || verified.status !== "up-to-date") {
    const stillPending = verified.migrations.length
      ? ` Still pending: ${verified.migrations.join(", ")}.`
      : "";
    fail(
      `${target.label} (${slug}) still reports unapplied migrations after the apply step.${stillPending} ` +
      "If you answered 'no' to wrangler's confirmation prompt, that is why — re-run and confirm, " +
      "or apply by hand before deploying.",
    );
  }

  appliedAny = true;
  log(`✓ ${target.label}: applied ${migrations.join(", ")}`);
}

if (dryRun) {
  log("dry run complete — nothing was written.");
} else if (appliedAny) {
  log("✓ all target databases migrated. Proceeding with the deploy.");
} else {
  log("✓ nothing to apply. Proceeding with the deploy.");
}
