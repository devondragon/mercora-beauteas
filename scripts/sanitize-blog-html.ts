/**
 * One-time blog HTML re-sanitization backfill.
 *
 * Before BMC-122, blog post HTML was sanitized at READ time (DOMPurify inside a
 * client-side BlogPostContent). BMC-122 moves sanitization to WRITE time and
 * renders stored HTML directly in a server component — so any rows written
 * before BMC-122 deployed still contain un-sanitized HTML.
 *
 * This script re-runs every blog_posts.html row through sanitizeBlogHtmlServer
 * (the same Workers-compatible sanitizer the model layer now uses on write) and
 * updates rows whose HTML changed. Run it once per database before/at deploy.
 *
 * Runs in plain Node via `tsx` (no Cloudflare bindings), talking to D1 through
 * `wrangler d1 execute` — the same approach as scripts/manage-tokens.ts.
 *
 * Usage:
 *   npx tsx scripts/sanitize-blog-html.ts --env=dev            # remote dev D1
 *   npx tsx scripts/sanitize-blog-html.ts --env=dev --local    # local dev D1
 *   npx tsx scripts/sanitize-blog-html.ts --env=production     # remote prod D1
 *   npx tsx scripts/sanitize-blog-html.ts --env=dev --dry-run  # report only, no writes
 */

import { execFileSync } from "node:child_process";
import { sanitizeBlogHtmlServer } from "../lib/utils/sanitize-html-core";

interface Flags {
  [key: string]: string | boolean;
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = {};
  for (const arg of argv) {
    if (!arg.startsWith("--")) continue;
    const [key, ...rest] = arg.slice(2).split("=");
    const raw = rest.length > 0 ? rest.join("=") : true;
    flags[key] = raw === "true" ? true : raw === "false" ? false : raw;
  }
  return flags;
}

function resolveDb(flags: Flags): { dbName: string; remoteArgs: string[] } {
  const env = typeof flags.env === "string" ? flags.env : "dev";
  const dbName =
    typeof flags.db === "string"
      ? flags.db
      : env === "production"
        ? "beauteas-db"
        : "beauteas-db-dev";
  const remoteArgs = flags.local ? [] : ["--remote"];
  return { dbName, remoteArgs };
}

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function execD1(sql: string, dbName: string, remoteArgs: string[]): unknown {
  const args = ["wrangler", "d1", "execute", dbName, ...remoteArgs, `--command=${sql}`, "--json"];
  try {
    const out = execFileSync("npx", args, { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });
    const parsed = JSON.parse(out);
    return Array.isArray(parsed) ? parsed[0] : parsed;
  } catch (error) {
    // wrangler writes its JSON error payload to stdout (not stderr) before
    // exiting non-zero, so surface both to make failures diagnosable.
    const read = (key: "stdout" | "stderr") =>
      error && typeof error === "object" && key in error
        ? String((error as Record<string, unknown>[typeof key]) ?? "").trim()
        : "";
    const detail = [...new Set([read("stderr"), read("stdout")])].filter(Boolean).join("\n") || (error as Error).message;
    throw new Error(`wrangler d1 execute failed:\n${detail}`);
  }
}

function resultRows(payload: unknown): Record<string, unknown>[] {
  if (payload && typeof payload === "object" && "results" in payload) {
    const results = (payload as { results: unknown }).results;
    if (Array.isArray(results)) return results as Record<string, unknown>[];
  }
  return [];
}

// Mirror of calculateReadingTime in lib/models/blog.ts (duplicated to avoid
// importing the Drizzle/db module graph into this plain-Node script).
function calculateReadingTime(html: string): number {
  const text = html.replace(/<[^>]*>/g, "");
  const words = text.split(/\s+/).filter((w) => w.length > 0).length;
  return Math.max(1, Math.ceil(words / 250));
}

function main() {
  const flags = parseFlags(process.argv.slice(2));
  const dryRun = !!flags["dry-run"];
  const { dbName, remoteArgs } = resolveDb(flags);

  console.log(`Scanning blog_posts in ${dbName}${remoteArgs.length ? " (remote)" : " (local)"}…`);
  const rows = resultRows(execD1("SELECT id, html FROM blog_posts", dbName, remoteArgs));
  console.log(`Found ${rows.length} post(s).`);

  let changed = 0;
  for (const row of rows) {
    const id = Number(row.id);
    const original = typeof row.html === "string" ? row.html : "";
    const clean = sanitizeBlogHtmlServer(original);
    if (clean === original) continue;

    changed++;
    console.log(`  post #${id}: sanitized (${original.length} → ${clean.length} chars)`);
    if (dryRun) continue;

    const reading_time = calculateReadingTime(clean);
    execD1(
      `UPDATE blog_posts SET html = ${sqlString(clean)}, reading_time = ${reading_time} WHERE id = ${id}`,
      dbName,
      remoteArgs
    );
  }

  if (changed === 0) {
    console.log("All posts already clean — nothing to update.");
  } else {
    console.log(dryRun ? `${changed} post(s) would change (dry run).` : `Updated ${changed} post(s).`);
  }
}

main();
