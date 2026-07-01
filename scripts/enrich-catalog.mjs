#!/usr/bin/env node
/**
 * Apply the committed catalog enrichment layer on top of the ETL'd base catalog.
 *
 * The Shopify ETL loads an accurate but flat catalog: product `extensions` carry
 * only {vendor, product_type}, and descriptions cram benefits/ingredients inline.
 * This step layers the curated data we own — structured `extensions` (benefits,
 * brewing, caffeine, servings, certifications, ingredients) plus clean, single
 * source-of-truth descriptions — onto the matching products.
 *
 * Source of truth: data/enrichment/products.json, keyed by product SLUG (stable
 * across ETL runs; numeric Shopify IDs are not). Each entry may provide:
 *   - description: string  → written as {"en": …}, replacing the inline-heavy ETL copy
 *   - extensions:  object  → MERGED into the product's existing extensions
 *                            (preserves ETL-provided vendor/product_type)
 *
 * Idempotent: it UPDATEs by slug and always writes the same merged result, so
 * re-running is a no-op. This is the reproducible, version-controlled replacement
 * for hand-editing a remote D1. Run it as the `enrich` stage of the pipeline:
 *   ETL → enrich → image-sync, identical for dev and prod.
 *
 * Usage:
 *   node scripts/enrich-catalog.mjs --env dev                 # remote dev D1
 *   node scripts/enrich-catalog.mjs --env production          # remote prod D1
 *   node scripts/enrich-catalog.mjs --env dev --local         # local sim
 *   node scripts/enrich-catalog.mjs --env dev --dry-run       # print SQL, don't apply
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DB = "beauteas-db-dev"; // wrangler binding name; --env selects the actual DB
const PRODUCTS_FILE = join(ROOT, "data/enrichment/products.json");
const CATEGORIES_FILE = join(ROOT, "data/enrichment/categories.json");
const tag = "[enrich]";

function parseArgs() {
  const args = process.argv.slice(2);
  const env = (args[args.indexOf("--env") + 1] || "").trim();
  return {
    env,
    local: args.includes("--local"),
    dryRun: args.includes("--dry-run"),
  };
}

const { env, local, dryRun } = parseArgs();
if (env !== "dev" && env !== "production") {
  console.error(`${tag} ERROR: pass --env dev|production`);
  process.exit(1);
}
const scope = local ? "--local" : "--remote";

// No shell: args pass directly to wrangler.
function wrangler(args, { capture = false } = {}) {
  return execFileSync("npx", ["wrangler", ...args], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
}

function d1Json(command) {
  const out = wrangler(
    ["d1", "execute", DB, scope, "--env", env, "--json", "--command", command],
    { capture: true }
  );
  return JSON.parse(out.slice(out.indexOf("[")));
}

const sqlStr = (s) => `'${String(s).replace(/'/g, "''")}'`;
const localized = (s) => JSON.stringify({ en: s });

// slug is stored either as a plain string or a localized JSON object ({"en": …})
// — normalize in JS (avoids json_extract erroring on the plain-string rows).
const normalizeSlug = (raw) => {
  if (typeof raw !== "string") return raw;
  if (raw.startsWith("{")) {
    try {
      const o = JSON.parse(raw);
      return o.en ?? Object.values(o)[0] ?? raw;
    } catch {
      return raw;
    }
  }
  return raw;
};

const readJsonIfExists = (p) => {
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
};

// UPDATE the target row's extensions by MERGING (preserves ETL-provided keys).
function mergeExtensions(entry, row) {
  if (!entry.extensions || !Object.keys(entry.extensions).length) return null;
  let base = {};
  try {
    base = row.extensions ? JSON.parse(row.extensions) : {};
  } catch {
    base = {};
  }
  return `extensions=${sqlStr(JSON.stringify({ ...base, ...entry.extensions }))}`;
}

// Per-table SET builders. Products: extensions (merged) + clean description.
// Categories: status, clean description, hero image.
const BUILDERS = {
  products: (entry, row) =>
    [
      typeof entry.status === "string" ? `status=${sqlStr(entry.status)}` : null,
      mergeExtensions(entry, row),
      typeof entry.description === "string" && entry.description.trim()
        ? `description=${sqlStr(localized(entry.description))}`
        : null,
    ].filter(Boolean),
  categories: (entry) =>
    [
      typeof entry.status === "string" ? `status=${sqlStr(entry.status)}` : null,
      typeof entry.description === "string" && entry.description.trim()
        ? `description=${sqlStr(localized(entry.description))}`
        : null,
      // Present + object → set; present + null → clear to SQL NULL; absent → leave.
      "primary_image" in entry
        ? `primary_image=${entry.primary_image === null ? "NULL" : sqlStr(JSON.stringify(entry.primary_image))}`
        : null,
    ].filter(Boolean),
};

function prepare(table, file) {
  const data = readJsonIfExists(file);
  if (!data) return { statements: [], missing: [] };
  const rows = d1Json(`SELECT id, slug, extensions FROM ${table}`)[0].results;
  const bySlug = new Map(rows.map((r) => [normalizeSlug(r.slug), r]));
  const statements = [];
  const missing = [];
  for (const slug of Object.keys(data)) {
    const row = bySlug.get(slug);
    if (!row) {
      missing.push(slug);
      continue;
    }
    const sets = BUILDERS[table](data[slug], row);
    if (!sets.length) continue;
    sets.push("updated_at=datetime('now')");
    statements.push(`UPDATE ${table} SET ${sets.join(", ")} WHERE id=${sqlStr(row.id)};`);
  }
  return { statements, missing };
}

const jobs = [
  { table: "products", file: PRODUCTS_FILE },
  { table: "categories", file: CATEGORIES_FILE },
];

const allStatements = [];
for (const { table, file } of jobs) {
  const { statements, missing } = prepare(table, file);
  if (missing.length) {
    console.warn(`${tag} WARN: ${missing.length} ${table} slug(s) not in target catalog — skipped: ${missing.join(", ")}`);
  }
  if (statements.length) console.log(`${tag} ${statements.length} ${table} enrichment(s) prepared for ${env} (${scope}).`);
  allStatements.push(...statements);
}

if (!allStatements.length) {
  console.log(`${tag} Nothing to apply.`);
  process.exit(0);
}

if (dryRun) {
  console.log(`\n${allStatements.join("\n\n")}\n`);
  console.log(`${tag} --dry-run: ${allStatements.length} statement(s) NOT applied.`);
  process.exit(0);
}

for (const stmt of allStatements) {
  wrangler(["d1", "execute", DB, scope, "--env", env, "--command", stmt], { capture: true });
}
console.log(`${tag} Applied ${allStatements.length} enrichment statement(s) to ${env}.`);
