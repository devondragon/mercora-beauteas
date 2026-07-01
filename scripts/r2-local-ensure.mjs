#!/usr/bin/env node
/**
 * Ensure the LOCAL R2 bucket has product/category images for `npm run preview:dev`.
 *
 * The Workers preview serves images through the same-origin `/media/[...key]`
 * route, which streams objects from the MEDIA R2 bucket. In local dev that
 * bucket (`beauteas-images-dev-preview`) starts empty, so every product/category
 * image renders as a blank box until it is populated. This uploads the images
 * committed under `data/r2/` into the local R2 store that `wrangler dev` reads.
 *
 * Idempotent: guarded by a marker file under `.wrangler/state`. Image content is
 * static, so once seeded there is nothing to re-check. `npm run clean` wipes
 * `.wrangler/state` (marker included), so the next preview reseeds automatically.
 * Delete the marker to force a re-upload without a full clean.
 *
 * Mirrors scripts/db-local-ensure.mjs (D1). Only the Workers preview needs this;
 * `next dev` has no R2 binding, so it is not part of the `predev` hook.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

const ENV = "dev";
// What the MEDIA binding resolves to in local dev (preview_bucket_name).
const BUCKET = "beauteas-images-dev-preview";
// Folders under data/r2 whose files map to R2 keys "<folder>/<filename>".
const SOURCE_DIRS = ["data/r2/products", "data/r2/categories"];
const MARKER = ".wrangler/state/.r2-images-seeded";

const tag = "[r2:local]";

// No shell: args pass directly to wrangler, nothing is interpolated.
function wrangler(args) {
  execFileSync("npx", ["wrangler", ...args], { stdio: ["ignore", "ignore", "inherit"] });
}

if (existsSync(MARKER)) {
  console.log(`${tag} Images already seeded — skipping (delete ${MARKER} or run 'npm run clean' to reseed).`);
  process.exit(0);
}

const files = [];
for (const dir of SOURCE_DIRS) {
  if (!existsSync(dir)) continue;
  const folder = dir.split("/").pop(); // "products" | "categories"
  for (const name of readdirSync(dir)) {
    const filePath = join(dir, name);
    if (!statSync(filePath).isFile()) continue;
    files.push({ key: `${folder}/${name}`, filePath });
  }
}

if (files.length === 0) {
  console.log(`${tag} No image files found under ${SOURCE_DIRS.join(", ")} — nothing to seed.`);
  process.exit(0);
}

console.log(`${tag} Uploading ${files.length} image(s) to local R2 (${BUCKET})...`);
let done = 0;
for (const { key, filePath } of files) {
  wrangler(["r2", "object", "put", `${BUCKET}/${key}`, "--local", "--env", ENV, "--file", filePath]);
  done += 1;
  process.stdout.write(`\r${tag} ${done}/${files.length}`);
}
process.stdout.write("\n");

mkdirSync(dirname(MARKER), { recursive: true });
execFileSync("touch", [MARKER]);
console.log(`${tag} Image seed complete.`);
