/**
 * Copies the CMS page images still hosted on the old Shopify CDN into R2.
 *
 * These images do not currently render: the sanitizer only permits image
 * sources under https://img.beauteas.com/ or relative paths, so a
 * cdn.shopify.com `src` is stripped at render time. Once uploaded they are
 * served through the existing /media/[...key] R2 proxy route.
 *
 * Usage:  npx tsx scripts/migrate-page-images.ts --env dev|production
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
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const IMAGES = [
  {
    source:
      "https://cdn.shopify.com/s/files/1/0554/7288/1831/files/85A6329_e90889c6-2175-4c97-ab75-96eac46c1115_1024x1024.jpg?v=1626361061",
    key: "pages/about-us-vanity-ritual.jpg",
  },
  {
    source:
      "https://cdn.shopify.com/s/files/1/0554/7288/1831/files/85A6494_1024x1024.jpg?v=1625358797",
    key: "pages/brewing-iced-tea-pour.jpg",
  },
  {
    source:
      "https://cdn.shopify.com/s/files/1/0554/7288/1831/files/85A6547_1024x1024.jpg?v=1625358249",
    key: "pages/subscriptions-vanity-flatlay.jpg",
  },
] as const;

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

/** Resolve the Cloudflare account id — env var first, else `wrangler whoami --json`. */
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
  const accountId = (JSON.parse(out) as { accounts?: { id: string }[] }).accounts?.[0]?.id;
  if (!accountId) {
    throw new Error(
      "Could not resolve a Cloudflare account id from `wrangler whoami --json`. Set CLOUDFLARE_ACCOUNT_ID explicitly."
    );
  }
  cachedAccountId = accountId;
  return accountId;
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

  const workDir = mkdtempSync(join(tmpdir(), "page-images-"));
  try {
    for (const image of IMAGES) {
      if (await objectExists(bucket, image.key)) {
        console.log(`skip   ${image.key} (already in ${bucket})`);
        continue;
      }

      const response = await fetch(image.source);
      if (!response.ok) {
        throw new Error(`Failed to download ${image.source}: HTTP ${response.status}`);
      }
      const localPath = join(workDir, image.key.replace(/\//g, "-"));
      writeFileSync(localPath, Buffer.from(await response.arrayBuffer()));

      wrangler([
        "r2",
        "object",
        "put",
        `${bucket}/${image.key}`,
        "--file",
        localPath,
        "--content-type",
        "image/jpeg",
        "--remote",
      ]);
      console.log(`upload ${image.key} -> ${bucket}`);
    }
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
