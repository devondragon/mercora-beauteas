#!/usr/bin/env node
/**
 * Env-aware image sync between the repo (data/r2/) and a Cloudflare R2 bucket.
 * The `image-sync` stage of the catalog pipeline (ETL → enrich → image-sync).
 *
 *   push  repo → R2   Upload committed images (products + curated categories)
 *                     to a target bucket. Use to seed a fresh env's R2 or to
 *                     publish curated/marketing imagery.
 *
 *   pull  R2 → repo   Fetch exactly the images the target catalog references
 *                     (products.primary_image + media, categories.primary_image)
 *                     into data/r2/, skipping any already present. Use to make a
 *                     local checkout mirror what dev/prod actually serves.
 *
 * Bucket is resolved from --env + scope (local dev binds the preview bucket):
 *   dev        remote → beauteas-images-dev          local → beauteas-images-dev-preview
 *   production remote → beauteas-images              local → beauteas-images
 *
 * Usage:
 *   node scripts/sync-images.mjs pull --env dev              # dev R2 → data/r2/
 *   node scripts/sync-images.mjs push --env production       # data/r2/ → prod R2
 *   node scripts/sync-images.mjs push --env dev --local      # → local miniflare R2
 *   node scripts/sync-images.mjs pull --env dev --dry-run
 *
 * Product images come from the ETL; curated category/marketing images live in
 * the repo. This keeps a single mechanism for both, per environment.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DB = "beauteas-db-dev"; // binding name; --env selects the real DB
const R2_ROOT = join(ROOT, "data/r2");
const SOURCE_DIRS = ["products", "categories"];
const BUCKETS = {
  dev: { remote: "beauteas-images-dev", local: "beauteas-images-dev-preview" },
  production: { remote: "beauteas-images", local: "beauteas-images" },
};
const tag = "[img-sync]";

function parseArgs() {
  const a = process.argv.slice(2);
  const mode = a[0];
  const env = (a[a.indexOf("--env") + 1] || "").trim();
  return { mode, env, local: a.includes("--local"), dryRun: a.includes("--dry-run") };
}
const { mode, env, local, dryRun } = parseArgs();
if (mode !== "push" && mode !== "pull") {
  console.error(`${tag} ERROR: first arg must be 'push' or 'pull'`);
  process.exit(1);
}
if (!BUCKETS[env]) {
  console.error(`${tag} ERROR: pass --env dev|production`);
  process.exit(1);
}
const scope = local ? "--local" : "--remote";
const bucket = BUCKETS[env][local ? "local" : "remote"];

function wrangler(args, { capture = false } = {}) {
  return execFileSync("npx", ["wrangler", ...args], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "pipe"] : ["ignore", "ignore", "inherit"],
  });
}

function push() {
  const files = [];
  for (const dir of SOURCE_DIRS) {
    const abs = join(R2_ROOT, dir);
    if (!existsSync(abs)) continue;
    for (const name of readdirSync(abs)) {
      const fp = join(abs, name);
      if (statSync(fp).isFile()) files.push({ key: `${dir}/${name}`, fp });
    }
  }
  console.log(`${tag} push: ${files.length} file(s) → ${bucket} (${scope})`);
  if (dryRun) {
    files.forEach((f) => console.log(`  would put ${f.key}`));
    return;
  }
  let n = 0;
  for (const { key, fp } of files) {
    wrangler(["r2", "object", "put", `${bucket}/${key}`, scope, "--file", fp], { capture: true });
    process.stdout.write(`\r${tag} ${++n}/${files.length}`);
  }
  process.stdout.write("\n");
  console.log(`${tag} pushed ${n} image(s).`);
}

// Collect every R2 key the catalog points at (products + categories).
function catalogImageKeys() {
  const out = wrangler(
    ["d1", "execute", DB, scope, "--env", env, "--json", "--command",
      "SELECT primary_image, media, NULL AS cat FROM products UNION ALL SELECT primary_image, NULL, 1 FROM categories"],
    { capture: true }
  );
  const rows = JSON.parse(out.slice(out.indexOf("[")))[0].results;
  const keys = new Set();
  const addUrl = (u) => { if (typeof u === "string" && u && !/^https?:\/\//.test(u)) keys.add(u.replace(/^\/+/, "")); };
  const pick = (raw) => {
    if (!raw) return;
    if (typeof raw === "string" && !raw.startsWith("{") && !raw.startsWith("[")) return addUrl(raw);
    try {
      const v = JSON.parse(raw);
      if (Array.isArray(v)) v.forEach((m) => addUrl(m?.url || m?.file?.url));
      else addUrl(v?.url || v?.file?.url);
    } catch { /* not JSON */ }
  };
  for (const r of rows) { pick(r.primary_image); pick(r.media); }
  return [...keys];
}

function pull() {
  const keys = catalogImageKeys().filter((k) => SOURCE_DIRS.includes(k.split("/")[0]));
  const have = [], need = [];
  for (const key of keys) (existsSync(join(R2_ROOT, key)) ? have : need).push(key);
  console.log(`${tag} pull from ${bucket} (${scope}): ${keys.length} referenced, ${have.length} already local, ${need.length} to fetch`);
  if (dryRun) {
    need.forEach((k) => console.log(`  would fetch ${k}`));
    return;
  }
  let fetched = 0, missingInR2 = [];
  for (const key of need) {
    const dest = join(R2_ROOT, key);
    mkdirSync(dirname(dest), { recursive: true });
    try {
      wrangler(["r2", "object", "get", `${bucket}/${key}`, scope, "--file", dest], { capture: true });
      fetched++;
      console.log(`  ↓ ${key}`);
    } catch {
      missingInR2.push(key);
      console.warn(`  ✗ not in R2: ${key}`);
    }
  }
  console.log(`${tag} fetched ${fetched}; ${missingInR2.length} referenced key(s) absent from R2.`);
}

mode === "push" ? push() : pull();
