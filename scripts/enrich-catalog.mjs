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
const ENRICHMENT = join(ROOT, "data/enrichment/products.json");
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

const enrichment = JSON.parse(readFileSync(ENRICHMENT, "utf8"));
const slugs = Object.keys(enrichment);
console.log(`${tag} ${slugs.length} enrichment entries → ${env} D1 (${scope})`);

// Pull current products so we merge rather than clobber. slug is stored either
// as a plain string or a localized JSON object ({"en": …}) — normalize in JS
// (avoids json_extract erroring on the plain-string rows).
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
const rows = d1Json("SELECT id, slug, extensions FROM products")[0].results;
const bySlug = new Map(rows.map((r) => [normalizeSlug(r.slug), r]));

const statements = [];
const missing = [];
for (const slug of slugs) {
  const row = bySlug.get(slug);
  if (!row) {
    missing.push(slug);
    continue;
  }
  const entry = enrichment[slug];
  const sets = [];

  if (entry.extensions && Object.keys(entry.extensions).length) {
    let base = {};
    try {
      base = row.extensions ? JSON.parse(row.extensions) : {};
    } catch {
      base = {};
    }
    const merged = { ...base, ...entry.extensions };
    sets.push(`extensions=${sqlStr(JSON.stringify(merged))}`);
  }
  if (typeof entry.description === "string" && entry.description.trim()) {
    sets.push(`description=${sqlStr(JSON.stringify({ en: entry.description }))}`);
  }
  if (!sets.length) continue;

  sets.push("updated_at=datetime('now')");
  statements.push(`UPDATE products SET ${sets.join(", ")} WHERE id=${sqlStr(row.id)};`);
}

if (missing.length) {
  console.warn(`${tag} WARN: ${missing.length} slug(s) not in target catalog — skipped: ${missing.join(", ")}`);
}
if (!statements.length) {
  console.log(`${tag} Nothing to apply.`);
  process.exit(0);
}

if (dryRun) {
  console.log(`\n${statements.join("\n\n")}\n`);
  console.log(`${tag} --dry-run: ${statements.length} statement(s) NOT applied.`);
  process.exit(0);
}

// Apply as one batched file via stdin-less temp: pass through --command per statement
// keeps it simple and transactional enough for a handful of rows.
for (const stmt of statements) {
  wrangler(["d1", "execute", DB, scope, "--env", env, "--command", stmt], { capture: true });
}
console.log(`${tag} Applied ${statements.length} product enrichment(s) to ${env}.`);
