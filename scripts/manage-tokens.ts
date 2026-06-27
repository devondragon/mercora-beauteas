/**
 * API Token Management CLI
 *
 * Mints, lists, and revokes rows in the `api_tokens` table that backs
 * `authenticateRequest()` in `lib/auth/unified-auth.ts`. Use this for
 * server-to-server / non-browser callers (carrier webhooks, automation,
 * external scripts) — the browser admin UI uses a Clerk session and does
 * not need a token.
 *
 * The raw token is shown exactly ONCE at creation. Only its SHA-256 hash is
 * stored, so a database leak never exposes a usable token — but a lost token
 * cannot be recovered, only revoked and reissued.
 *
 * Runs in plain Node via `tsx` (no Cloudflare bindings), so it talks to D1
 * through `wrangler d1 execute` — the same approach as the migration tooling.
 *
 * Usage:
 *   npm run token:generate -- --name=carrier_webhook --permissions=webhooks:receive,orders:update_tracking
 *   npm run token:generate -- --name=ops_orders --preset=ORDERS_UPDATE --expires=90d --env=production
 *   npm run token:list -- --env=production
 *   npm run token:revoke -- --name=carrier_webhook --env=production
 *
 * Targets REMOTE D1 by default (that's what the deployed Worker reads).
 * Pass --local to operate on the local dev database instead.
 */

import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";

/** Named permission presets, mirroring PERMISSIONS in lib/auth/unified-auth.ts. */
const PRESETS: Record<string, string[]> = {
  VECTORIZE_READ: ["vectorize:read"],
  VECTORIZE_WRITE: ["vectorize:read", "vectorize:write"],
  ORDERS_READ: ["orders:read"],
  ORDERS_WRITE: ["orders:read", "orders:write"],
  ORDERS_UPDATE: ["orders:read", "orders:write", "orders:update_status"],
  WEBHOOKS_RECEIVE: ["webhooks:receive"],
  WEBHOOKS_CARRIER: ["webhooks:receive", "orders:update_tracking"],
  ADMIN_FULL: ["admin:*"],
};

interface Flags {
  _: string[]; // positional args
  [key: string]: string | boolean | string[];
}

/** Parse `--key=value`, `--flag`, and positional args. */
function parseFlags(argv: string[]): Flags {
  const flags: Flags = { _: [] };
  for (const arg of argv) {
    if (arg.startsWith("--")) {
      const [key, ...rest] = arg.slice(2).split("=");
      const raw = rest.length > 0 ? rest.join("=") : true;
      // Coerce literal "true"/"false" strings so --local=false doesn't become truthy.
      flags[key] = raw === "true" ? true : raw === "false" ? false : raw;
    } else {
      (flags._ as string[]).push(arg);
    }
  }
  return flags;
}

/** Resolve the D1 database name from --db or --env (dev|production). */
function resolveDb(flags: Flags): { dbName: string; remoteArgs: string[]; env: string } {
  const env = typeof flags.env === "string" ? flags.env : "dev";
  const dbName =
    typeof flags.db === "string"
      ? flags.db
      : env === "production"
        ? "beauteas-db"
        : "beauteas-db-dev";
  // Token rows must live where the deployed Worker reads them: remote D1.
  const remoteArgs = flags.local ? [] : ["--remote"];
  return { dbName, remoteArgs, env };
}

/** SHA-256 hex — must match sha256Hex() in lib/auth/unified-auth.ts. */
function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/** Escape a SQL string literal by doubling single quotes. */
function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** Run `wrangler d1 execute` with a single SQL command. Returns parsed --json result. */
function execD1(sql: string, dbName: string, remoteArgs: string[]): unknown {
  const args = [
    "wrangler",
    "d1",
    "execute",
    dbName,
    ...remoteArgs,
    `--command=${sql}`,
    "--json",
  ];

  try {
    const out = execFileSync("npx", args, {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    // wrangler --json prints `[{ results, success, meta }]` (sometimes a bare object).
    const parsed = JSON.parse(out);
    return Array.isArray(parsed) ? parsed[0] : parsed;
  } catch (error) {
    const stderr =
      error && typeof error === "object" && "stderr" in error
        ? String((error as { stderr: unknown }).stderr)
        : "";
    throw new Error(`wrangler d1 execute failed: ${stderr || (error as Error).message}`);
  }
}

/** Extract the `results` rows from a parsed wrangler --json payload. */
function resultRows(payload: unknown): Record<string, unknown>[] {
  if (payload && typeof payload === "object" && "results" in payload) {
    const results = (payload as { results: unknown }).results;
    if (Array.isArray(results)) return results as Record<string, unknown>[];
  }
  return [];
}

function resolvePermissions(flags: Flags): string[] {
  const perms: string[] = [];
  if (typeof flags.preset === "string") {
    const preset = PRESETS[flags.preset.toUpperCase()];
    if (!preset) {
      throw new Error(
        `Unknown preset "${flags.preset}". Available: ${Object.keys(PRESETS).join(", ")}`
      );
    }
    perms.push(...preset);
  }
  if (typeof flags.permissions === "string") {
    perms.push(
      ...flags.permissions
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean)
    );
  }
  // De-duplicate while preserving order.
  return [...new Set(perms)];
}

/** Compute an ISO expiry from `--expires=30d` or an ISO date string. */
function resolveExpiry(flags: Flags): string | null {
  if (flags.expires === undefined) return null;
  if (typeof flags.expires !== "string") {
    // `--expires` with no value parses to boolean true; reject it rather than
    // silently minting a never-expiring token.
    throw new Error("--expires needs a value, e.g. --expires=90d or an ISO date.");
  }
  const daysMatch = /^(\d+)d$/.exec(flags.expires.trim());
  if (daysMatch) {
    const ms = Date.now() + Number(daysMatch[1]) * 24 * 60 * 60 * 1000;
    return new Date(ms).toISOString();
  }
  const parsed = new Date(flags.expires);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid --expires value "${flags.expires}". Use e.g. 90d or an ISO date.`);
  }
  return parsed.toISOString();
}

function requireName(flags: Flags): string {
  const name =
    typeof flags.name === "string" ? flags.name : (flags._ as string[])[1];
  if (!name) {
    throw new Error("Missing --name=<token_name>");
  }
  if (!/^[a-z0-9_]+$/i.test(name)) {
    throw new Error("--name may only contain letters, numbers, and underscores");
  }
  return name;
}

function cmdGenerate(flags: Flags): void {
  const { dbName, remoteArgs, env } = resolveDb(flags);
  const name = requireName(flags);
  const permissions = resolvePermissions(flags);
  const expiresAt = resolveExpiry(flags);

  if (permissions.length === 0) {
    throw new Error(
      "No permissions specified. Use --permissions=a,b or --preset=NAME.\n" +
        `Presets: ${Object.keys(PRESETS).join(", ")}`
    );
  }

  // Refuse to silently clobber an existing token name (token_name is UNIQUE).
  const existing = resultRows(
    execD1(
      `SELECT id FROM api_tokens WHERE token_name = ${sqlString(name)};`,
      dbName,
      remoteArgs
    )
  );
  if (existing.length > 0) {
    throw new Error(
      `A token named "${name}" already exists. Revoke it first or choose another name.`
    );
  }

  const rawToken = `bt_${randomBytes(32).toString("base64url")}`;
  const tokenHash = sha256Hex(rawToken);
  const permissionsJson = JSON.stringify(permissions);
  const expiresSql = expiresAt ? sqlString(expiresAt) : "NULL";

  const insert =
    `INSERT INTO api_tokens (token_name, token_hash, permissions, active, expires_at, created_at, updated_at) ` +
    `VALUES (${sqlString(name)}, ${sqlString(tokenHash)}, ${sqlString(permissionsJson)}, 1, ${expiresSql}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);`;

  execD1(insert, dbName, remoteArgs);

  console.log("\n✅ API token created.");
  console.log(`   Target:      ${dbName} (${flags.local ? "local" : "remote"}, env=${env})`);
  console.log(`   Name:        ${name}`);
  console.log(`   Permissions: ${permissions.join(", ")}`);
  console.log(`   Expires:     ${expiresAt ?? "never"}`);
  console.log("\n   Send it as:  Authorization: Bearer <token>   (or  X-API-Key: <token>)");
  console.log("\n────────────────────────────────────────────────────────────");
  console.log("  ⚠️  COPY THIS TOKEN NOW — it is shown only once:\n");
  console.log(`     ${rawToken}`);
  console.log("\n────────────────────────────────────────────────────────────\n");
}

function cmdList(flags: Flags): void {
  const { dbName, remoteArgs, env } = resolveDb(flags);
  const rows = resultRows(
    execD1(
      `SELECT id, token_name, substr(token_hash, 1, 8) AS hash_prefix, permissions, active, expires_at, last_used_at, created_at ` +
        `FROM api_tokens ORDER BY created_at DESC;`,
      dbName,
      remoteArgs
    )
  );

  console.log(`\nAPI tokens in ${dbName} (${flags.local ? "local" : "remote"}, env=${env}):\n`);
  if (rows.length === 0) {
    console.log("  (none)\n");
    return;
  }
  for (const row of rows) {
    const active = row.active === 1 || row.active === true ? "active" : "REVOKED";
    console.log(`  • ${String(row.token_name)}  [${active}]`);
    console.log(`      id=${String(row.id)}  hash=${String(row.hash_prefix)}…`);
    console.log(`      permissions: ${String(row.permissions)}`);
    console.log(
      `      expires=${row.expires_at ?? "never"}  last_used=${row.last_used_at ?? "never"}  created=${String(row.created_at)}`
    );
  }
  console.log("");
}

function cmdRevoke(flags: Flags): void {
  const { dbName, remoteArgs, env } = resolveDb(flags);
  const name = requireName(flags);

  const existing = resultRows(
    execD1(
      `SELECT active FROM api_tokens WHERE token_name = ${sqlString(name)};`,
      dbName,
      remoteArgs
    )
  );
  if (existing.length === 0) {
    throw new Error(`No token named "${name}" found in ${dbName}.`);
  }
  if (existing[0].active === 0 || existing[0].active === false) {
    console.warn(`\n⚠️  Token "${name}" is already revoked in ${dbName}.\n`);
    return;
  }

  // Soft-revoke (active=0) rather than delete, to preserve the audit trail.
  const result = execD1(
    `UPDATE api_tokens SET active = 0, updated_at = CURRENT_TIMESTAMP WHERE token_name = ${sqlString(name)};`,
    dbName,
    remoteArgs
  );
  if (
    result &&
    typeof result === "object" &&
    "success" in result &&
    !(result as { success: boolean }).success
  ) {
    throw new Error(`wrangler reported success=false for the UPDATE — token may still be active.`);
  }

  console.log(`\n✅ Revoked token "${name}" in ${dbName} (${flags.local ? "local" : "remote"}, env=${env}).\n`);
}

function printHelp(): void {
  console.log(`
API Token Management

Commands:
  generate   Create a new token and print it once
  list       List tokens (names, permissions, status — never the secret)
  revoke     Deactivate a token by name

Common flags:
  --env=dev|production   Selects DB (beauteas-db-dev | beauteas-db). Default: dev
  --db=<name>            Override the D1 database name
  --local                Operate on the local D1 database (default is remote)

generate flags:
  --name=<token_name>           Required. Unique identifier (letters/digits/_)
  --permissions=a:b,c:d         Comma-separated permission strings
  --preset=NAME                 One of: ${Object.keys(PRESETS).join(", ")}
  --expires=90d | <ISO date>    Optional expiry. Default: never

Examples:
  npm run token:generate -- --name=carrier_webhook --preset=WEBHOOKS_CARRIER --env=production
  npm run token:generate -- --name=ops --permissions=orders:read,orders:write --expires=30d
  npm run token:list -- --env=production
  npm run token:revoke -- --name=carrier_webhook --env=production
`);
}

function main(): void {
  const flags = parseFlags(process.argv.slice(2));
  const command = (flags._ as string[])[0];

  if (!command || flags.help || command === "help") {
    printHelp();
    return;
  }

  switch (command) {
    case "generate":
      cmdGenerate(flags);
      break;
    case "list":
      cmdList(flags);
      break;
    case "revoke":
      cmdRevoke(flags);
      break;
    default:
      console.error(`Unknown command: ${command}\n`);
      printHelp();
      process.exit(1);
  }
}

try {
  main();
} catch (error) {
  console.error(`\n❌ ${(error as Error).message}\n`);
  process.exit(1);
}
