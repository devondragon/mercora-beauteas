#!/usr/bin/env node
/**
 * Promote the curated catalog/content from the DEV env to PRODUCTION.
 *
 * Cutover strategy (see PRODUCTION-CUTOVER-RUNBOOK.md Phase 8): prod starts
 * fresh — NO customers/orders are migrated. The Shopify ETL already ran into
 * dev and the catalog was hand-curated there, so DEV is the golden source. This
 * copies the curated catalog/content from dev → prod rather than re-running the
 * ETL against prod (which would discard the curation and orphan dev-Clerk-bound
 * customers).
 *
 * Three parts:
 *   1. D1  — export the whitelisted tables from beauteas-db-dev (--no-schema),
 *            rewrite INSERT → INSERT OR REPLACE, load into beauteas-db.
 *   2. R2  — copy catalog images dev → prod by delegating to sync-images.mjs
 *            (pull --env dev, then push --env production).
 *   3. Vectorize — NOT copyable; printed as a final manual curl (needs prod
 *            deployed + reachable first).
 *
 * SAFETY: dry-run by default. It only writes to production when you pass
 * --execute. The dry run still reads dev + prod (read-only) so you get a real
 * preview (row counts, migration-parity check) before committing.
 *
 * PREREQ: migrations 0013–0018 must already be applied to prod (BMC-208), or
 * dev/prod schemas won't match. The script preflights this and aborts if not.
 *
 * Usage:
 *   node scripts/promote-dev-to-prod.mjs                 # dry run (safe preview)
 *   node scripts/promote-dev-to-prod.mjs --execute       # actually write to prod
 *   node scripts/promote-dev-to-prod.mjs --execute --skip-r2
 *   node scripts/promote-dev-to-prod.mjs --execute --skip-d1
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEV_DB = "beauteas-db-dev"; // binding; --env dev selects the real DB
const PROD_DB = "beauteas-db"; //    binding; --env production selects the real DB
const tag = "[promote]";

// Catalog/content tables to copy, parents before children (FKs are deferred, so
// this ordering is belt-and-suspenders). Keep in sync with the runbook copy set.
const COPY_TABLES = [
  "admin_settings",
  "categories",
  "product_types",
  "media",
  "products",
  "product_variants",
  "inventory",
  "pricing",
  "page_templates",
  "pages",
  "page_versions",
  "redirect_map",
  "product_reviews",
  "review_media",
  "blog_categories",
  "blog_posts",
  "subscription_plans",
];

// Explicitly NEVER copied — documented so each exclusion is a decision, not an
// omission. Credentials, admin, customer/order, transactional, and dev-noise.
const NEVER_COPY = [
  "admin_users", "api_tokens", "mcp_agents", "mcp_sessions", "mcp_usage", "mcp_rate_limits",
  "customers", "addresses", "orders", "order_webhooks",
  "customer_subscriptions", "subscription_events", "processed_webhook_events",
  "chat_sessions", "chat_messages", "gift_cards", "gift_card_transactions",
  "review_reminders", "review_flags", "email_unsubscribes",
  "promotions", "coupon_instances", // discounts carry redemption state — re-create in prod if you configured any in dev
  "product_recommendations", //         rebuilt from Vectorize, not copied
  "languages", //                       migration-seeded reference data; prod already has it
];

// Tables whose presence in prod proves migrations 0013 + 0018 are applied.
const PARITY_TABLES = ["product_recommendations", "email_unsubscribes"];

const args = process.argv.slice(2);
const execute = args.includes("--execute");
const skipD1 = args.includes("--skip-d1");
const skipR2 = args.includes("--skip-r2");

function wrangler(wargs, { capture = false } = {}) {
  return execFileSync("npx", ["wrangler", ...wargs], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "pipe"] : ["ignore", "inherit", "inherit"],
  });
}

function runNode(nargs) {
  execFileSync("node", nargs, { cwd: ROOT, stdio: "inherit" });
}

// Parse a `wrangler d1 execute --json` payload (skips any npm/notice preamble).
function d1Query(db, env, sql) {
  const out = wrangler(
    ["d1", "execute", db, "--remote", "--env", env, "--json", "--command", sql],
    { capture: true },
  );
  return JSON.parse(out.slice(out.indexOf("[")))[0].results;
}

function prodHasTable(name) {
  return d1Query(PROD_DB, "production",
    `SELECT name FROM sqlite_master WHERE type='table' AND name='${name}';`).length > 0;
}

function devRowCount(table) {
  try {
    return d1Query(DEV_DB, "dev", `SELECT COUNT(*) AS n FROM ${table};`)[0].n;
  } catch {
    return "?";
  }
}

// ---------------------------------------------------------------------------

console.log(`${tag} mode: ${execute ? "EXECUTE (writes to PRODUCTION)" : "DRY RUN (no writes)"}`);
if (execute) {
  console.log(`${tag} ⚠️  This will write catalog/content into the PRODUCTION D1 + R2.`);
}

// --- Preflight: migration parity (dev tables must exist in prod) ---
console.log(`${tag} preflight: checking prod schema parity (migrations 0013–0018)...`);
const missing = PARITY_TABLES.filter((t) => !prodHasTable(t));
if (missing.length) {
  console.error(
    `${tag} ABORT: prod is missing table(s) [${missing.join(", ")}]. ` +
    `Apply migrations 0013–0018 to prod first (BMC-208):\n` +
    `  npx wrangler d1 migrations apply ${PROD_DB} --env production --remote`,
  );
  process.exit(1);
}
console.log(`${tag} ✓ prod schema parity OK.`);

// --- Step 1: D1 catalog/content copy ---
if (skipD1) {
  console.log(`${tag} D1: skipped (--skip-d1).`);
} else {
  console.log(`${tag} D1: copy set (${COPY_TABLES.length} tables), dev row counts:`);
  for (const t of COPY_TABLES) console.log(`       ${String(devRowCount(t)).padStart(6)}  ${t}`);
  console.log(`${tag} D1: NEVER copied (${NEVER_COPY.length}): ${NEVER_COPY.join(", ")}`);

  mkdirSync(join(ROOT, ".wrangler"), { recursive: true });
  const tmpRaw = join(ROOT, ".wrangler", "_promote-dev-export.sql");
  const loadFile = join(ROOT, ".wrangler", "_promote-prod-load.sql");
  const tableArgs = COPY_TABLES.flatMap((t) => ["--table", t]);

  console.log(`${tag} D1: exporting whitelisted tables from ${DEV_DB} (dev, --remote)...`);
  wrangler(["d1", "export", DEV_DB, "--remote", "--env", "dev", "--no-schema", ...tableArgs, "--output", tmpRaw]);

  // Data-only INSERTs → INSERT OR REPLACE so they coexist with prod's
  // migration-seeded rows (CMS/legal pages, gift-card product) by primary key.
  const inserts = readFileSync(tmpRaw, "utf8")
    .split("\n")
    .filter((l) => l.trim().startsWith("INSERT INTO"))
    .map((l) => l.replace(/^INSERT INTO/, "INSERT OR REPLACE INTO"))
    .join("\n");
  rmSync(tmpRaw, { force: true });
  const rowN = inserts.split("\n").filter(Boolean).length;
  writeFileSync(loadFile, `PRAGMA defer_foreign_keys=TRUE;\n\n${inserts}\n`);
  console.log(`${tag} D1: prepared ${rowN} INSERT OR REPLACE row(s) → ${loadFile}`);

  if (execute) {
    console.log(`${tag} D1: loading into ${PROD_DB} (production, --remote)...`);
    wrangler(["d1", "execute", PROD_DB, "--remote", "--env", "production", "--file", loadFile]);
    rmSync(loadFile, { force: true });
    console.log(`${tag} D1: ✓ loaded ${rowN} row(s) into production.`);
  } else {
    console.log(`${tag} D1: dry run — not loaded. Inspect ${loadFile} to preview the exact SQL.`);
  }
}

// --- Step 2: R2 image copy (delegates to the existing env-aware sync tool) ---
if (skipR2) {
  console.log(`${tag} R2: skipped (--skip-r2).`);
} else if (execute) {
  console.log(`${tag} R2: pulling dev catalog images → data/r2/ ...`);
  runNode(["scripts/sync-images.mjs", "pull", "--env", "dev"]);
  console.log(`${tag} R2: pushing data/r2/ → prod bucket (beauteas-images) ...`);
  runNode(["scripts/sync-images.mjs", "push", "--env", "production"]);
  console.log(`${tag} R2: ✓ images copied. Confirm img.beauteas.com is a custom domain on the prod bucket.`);
} else {
  console.log(`${tag} R2: dry run — would 'sync-images pull --env dev' then 'push --env production'.`);
  runNode(["scripts/sync-images.mjs", "pull", "--env", "dev", "--dry-run"]);
}

// --- Step 3: Vectorize (manual, needs prod deployed) ---
console.log(`${tag} Vectorize: not copyable — rebuild from prod once it is deployed + reachable:`);
console.log(`       curl -X POST "https://beauteas.com/api/admin/vectorize" -H "Authorization: Bearer <ADMIN_VECTORIZE_TOKEN>"`);

console.log(`${tag} done (${execute ? "EXECUTED" : "dry run"}).`);
if (!execute) console.log(`${tag} re-run with --execute to write to production.`);
