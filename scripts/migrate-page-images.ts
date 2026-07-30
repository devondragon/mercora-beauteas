/**
 * Uploads the CMS page images into R2.
 *
 * These images do not render while they point at Shopify: the sanitizer only
 * permits image sources under https://img.beauteas.com/ or relative paths, so a
 * cdn.shopify.com `src` is stripped at render time. Migration 0019 repoints the
 * page HTML at https://img.beauteas.com/pages/<file>, which this populates.
 *
 * The bytes come from `data/r2/pages/`, committed alongside this script —
 * deliberately NOT re-downloaded from cdn.shopify.com. This runs during a
 * Shopify cutover; once that store is torn down those URLs 404 and a
 * download-based script would be unrunnable exactly when it is needed, with the
 * correct bytes sitting in the working tree the whole time.
 *
 * Usage:  npm run images:pages -- --env dev|production
 * Requires CLOUDFLARE_API_TOKEN (same token wrangler authenticates with).
 * Re-runnable: existing keys are skipped, never overwritten.
 *
 * Existence check: this deliberately does NOT use `wrangler r2 object get` to
 * probe for a key. In testing against this project's buckets, that command
 * repeatedly reported "does not exist" for objects that the R2 "list objects"
 * API confirmed (with correct size/etag) were already present — a transient
 * false negative on the CLI's read path that would make this script re-upload
 * on every run instead of skipping. Querying the R2 objects-list API directly
 * (same CLOUDFLARE_API_TOKEN wrangler itself authenticates with) gave
 * consistent, immediate, correct answers in every trial, including
 * immediately after an upload, so that's what's used here.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

/** R2 keys, resolved against data/r2/<key> in the repo. */
const IMAGE_KEYS = [
  "pages/about-us-vanity-ritual.jpg",
  "pages/brewing-iced-tea-pour.jpg",
  "pages/subscriptions-vanity-flatlay.jpg",
] as const;

const SOURCE_ROOT = join(process.cwd(), "data", "r2");

const BUCKETS = {
  dev: "beauteas-images-dev",
  production: "beauteas-images",
} as const;

/** Run `npx wrangler <args>`, throwing (with stderr attached) on a non-zero exit. */
function wrangler(args: string[]): void {
  try {
    execFileSync("npx", ["wrangler", ...args], {
      stdio: ["ignore", "ignore", "pipe"],
    });
  } catch (error) {
    const stderr =
      error && typeof error === "object" && "stderr" in error
        ? String((error as { stderr: unknown }).stderr)
        : "";
    throw new Error(`wrangler ${args.join(" ")} failed: ${stderr || (error as Error).message}`);
  }
}

let cachedAccountId: string | undefined;

/**
 * Resolve the Cloudflare account id used for the existence check — explicit
 * env var first, else `wrangler whoami --json`.
 *
 * This resolution is independent of whatever account `wrangler r2 object
 * put` itself targets (there's no `account_id` in wrangler.jsonc, so
 * wrangler does its own resolution for the actual upload). On a token
 * scoped to more than one account, guessing here could silently point the
 * existence check at a *different* account than the upload — so on
 * ambiguity we fail fast rather than picking one. When resolution succeeds
 * via `wrangler whoami`, we log the account id used, so an operator can
 * always see which account the existence check ran against.
 */
function resolveAccountId(): string {
  if (cachedAccountId) return cachedAccountId;
  if (process.env.CLOUDFLARE_ACCOUNT_ID) {
    cachedAccountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    return cachedAccountId;
  }
  let out: string;
  try {
    out = execFileSync("npx", ["wrangler", "whoami", "--json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    throw new Error(
      `Could not resolve a Cloudflare account id: \`wrangler whoami\` failed (${(error as Error).message}). Set CLOUDFLARE_ACCOUNT_ID or run \`wrangler login\`.`
    );
  }
  const accounts = (JSON.parse(out) as { accounts?: { id: string; name?: string }[] }).accounts ?? [];
  if (accounts.length === 0) {
    throw new Error(
      "Could not resolve a Cloudflare account id: `wrangler whoami --json` returned no accounts. Set CLOUDFLARE_ACCOUNT_ID explicitly."
    );
  }
  if (accounts.length > 1) {
    throw new Error(
      `\`wrangler whoami --json\` returned ${accounts.length} accounts (${accounts
        .map((a) => `${a.name ?? "?"} [${a.id}]`)
        .join(
          ", "
        )}) — refusing to guess which one the existence check should use, since it could silently diverge from whatever account \`wrangler r2 object put\` resolves to. Set CLOUDFLARE_ACCOUNT_ID explicitly to the account that owns these buckets.`
    );
  }
  cachedAccountId = accounts[0].id;
  console.log(`(resolved Cloudflare account for existence check: ${accounts[0].name ?? "?"} [${cachedAccountId}])`);
  return cachedAccountId;
}

/** True if `key` already exists in `bucket`, via the R2 objects-list API (see header). */
async function objectExists(bucket: string, key: string): Promise<boolean> {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!token) {
    throw new Error(
      "CLOUDFLARE_API_TOKEN is not set — required to check R2 object existence via the Cloudflare API."
    );
  }
  const accountId = resolveAccountId();
  const url = new URL(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${bucket}/objects`
  );
  url.searchParams.set("prefix", key);

  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) {
    throw new Error(
      `R2 object-list check for ${bucket}/${key} failed: HTTP ${response.status}`
    );
  }
  const body = (await response.json()) as {
    success: boolean;
    errors?: unknown;
    result?: { key: string }[];
  };
  if (!body.success) {
    throw new Error(
      `R2 object-list check for ${bucket}/${key} returned success=false: ${JSON.stringify(body.errors)}`
    );
  }
  return (body.result ?? []).some((object) => object.key === key);
}

function resolveEnv(): keyof typeof BUCKETS {
  const envArg = process.argv.indexOf("--env");
  const env = envArg > -1 ? process.argv[envArg + 1] : "dev";
  if (env !== "dev" && env !== "production") {
    throw new Error(`Unknown env "${env}" — expected --env dev or --env production`);
  }
  return env;
}

async function main() {
  const env = resolveEnv();
  const bucket = BUCKETS[env];
  const accountId = resolveAccountId();

  // Fail before touching R2 if the repo copy is missing, rather than uploading
  // a partial set and reporting success.
  const sources = IMAGE_KEYS.map((key) => ({ key, path: join(SOURCE_ROOT, key) }));
  const missing = sources.filter(({ path }) => !existsSync(path));
  if (missing.length > 0) {
    throw new Error(
      `Missing source image(s) in the repo:\n${missing.map(({ path }) => `  ${path}`).join("\n")}`,
    );
  }

  for (const { key, path } of sources) {
    if (await objectExists(bucket, key)) {
      console.log(`skip   ${key} (already in ${bucket}, account ${accountId})`);
      continue;
    }

    wrangler([
      "r2",
      "object",
      "put",
      `${bucket}/${key}`,
      "--file",
      path,
      "--content-type",
      "image/jpeg",
      "--remote",
    ]);
    console.log(`upload ${key} -> ${bucket} (existence check ran against account ${accountId})`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
