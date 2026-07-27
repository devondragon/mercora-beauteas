#!/usr/bin/env node
/**
 * === Build with the correct NEXT_PUBLIC_* values for a wrangler environment ===
 *
 * WHY THIS EXISTS
 *
 * `wrangler.jsonc` `vars` populate the *Worker's runtime env*. But Next.js
 * inlines `NEXT_PUBLIC_*` into the *client bundle at build time* — see
 * `lib/stripe.ts`, which captures the publishable key in a module-scope const.
 *
 * `next build` loads env files in this order (from @next/env):
 *
 *     .env.production.local → .env.local → .env.production → .env
 *
 * ...so `.env.local` (which holds our *test* keys for `next dev`) outranks
 * `.env.production` and gets baked into production bundles. Before this script,
 * `npm run deploy:production` shipped a client bundle containing `pk_test_…`
 * while the Worker held live secret keys — the server would create a live
 * PaymentIntent and the browser would confirm it with a test-mode key, so
 * checkout failed on key/mode mismatch.
 *
 * HOW THIS FIXES IT
 *
 * @next/env only assigns a variable if it is NOT already present in
 * `process.env` (it snapshots process.env before loading any .env file, then
 * skips any key found there). So a value exported by the *parent process* wins
 * over every .env file. This script reads the target environment's `vars` out
 * of `wrangler.jsonc` and spawns the build with them already set — making
 * `wrangler.jsonc` the single source of truth for both build and runtime, with
 * no second copy to drift.
 *
 * It then scans the built assets and FAILS the build if a key from the wrong
 * Stripe/Clerk mode was inlined, so this class of bug cannot reach a deploy.
 *
 * Usage:  node scripts/build-with-env.mjs <dev|production> <command...>
 *   e.g.  node scripts/build-with-env.mjs production opennextjs-cloudflare build
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const [, , target, ...commandParts] = process.argv;

if (!target || commandParts.length === 0) {
  console.error('Usage: node scripts/build-with-env.mjs <dev|production> <command...>');
  process.exit(1);
}

/**
 * Strip `//` and block comments from JSONC without corrupting string contents.
 * A naive regex would mangle values like "https://img.beauteas.com", so this
 * tracks string state (and escapes) as it scans.
 */
function stripJsonComments(text) {
  let out = '';
  let inString = false;
  let inLine = false;
  let inBlock = false;
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const n = text[i + 1];

    if (inLine) {
      if (c === '\n') {
        inLine = false;
        out += c;
      }
      continue;
    }
    if (inBlock) {
      if (c === '*' && n === '/') {
        inBlock = false;
        i++;
      }
      continue;
    }
    if (inString) {
      out += c;
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      out += c;
      continue;
    }
    if (c === '/' && n === '/') {
      inLine = true;
      i++;
      continue;
    }
    if (c === '/' && n === '*') {
      inBlock = true;
      i++;
      continue;
    }
    out += c;
  }
  // JSONC permits trailing commas; JSON does not.
  return out.replace(/,(\s*[}\]])/g, '$1');
}

// ─── Read the target env's vars out of wrangler.jsonc ──────────────────────

const configPath = new URL('../wrangler.jsonc', import.meta.url);
let config;
try {
  config = JSON.parse(stripJsonComments(readFileSync(configPath, 'utf8')));
} catch (err) {
  console.error(`[build-with-env] Could not parse wrangler.jsonc: ${err.message}`);
  process.exit(1);
}

const envConfig = config?.env?.[target];
if (!envConfig) {
  console.error(
    `[build-with-env] No "env.${target}" block in wrangler.jsonc. ` +
      `Available: ${Object.keys(config?.env ?? {}).join(', ') || '(none)'}`
  );
  process.exit(1);
}

const vars = envConfig.vars ?? {};

// Only NEXT_PUBLIC_* need build-time injection — everything else is read from
// the Worker's runtime env (vars) or from secrets, neither of which is inlined.
const publicVars = Object.fromEntries(
  Object.entries(vars).filter(([k]) => k.startsWith('NEXT_PUBLIC_'))
);

if (Object.keys(publicVars).length === 0) {
  console.error(`[build-with-env] "env.${target}.vars" contains no NEXT_PUBLIC_* keys. Refusing to build.`);
  process.exit(1);
}

const placeholders = Object.entries(publicVars).filter(([, v]) => String(v).includes('REPLACE_WITH'));
if (placeholders.length > 0) {
  console.error(
    `[build-with-env] Unfilled placeholder(s) in env.${target}.vars: ${placeholders
      .map(([k]) => k)
      .join(', ')}`
  );
  process.exit(1);
}

console.log(`[build-with-env] Building for "${target}" with:`);
for (const [k, v] of Object.entries(publicVars)) {
  // Publishable keys are safe to display, but truncate so logs stay tidy.
  const shown = String(v).length > 24 ? `${String(v).slice(0, 24)}…` : String(v);
  console.log(`  ${k} = ${shown}`);
}

// ─── Run the build with those vars already in process.env ──────────────────

const result = spawnSync(commandParts.join(' '), {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, ...publicVars },
});

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

// ─── Post-build guard: assert no wrong-mode key was inlined ────────────────

const assetsDir = new URL('../.open-next/assets', import.meta.url).pathname;

if (!existsSync(assetsDir)) {
  console.warn('[build-with-env] .open-next/assets not found; skipping bundle key check.');
  process.exit(0);
}

/** Recursively collect text-ish files worth scanning. */
function collectFiles(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) collectFiles(full, acc);
    else if (/\.(js|mjs|cjs|json|html|txt)$/.test(entry)) acc.push(full);
  }
  return acc;
}

// A production bundle must never contain a test key, and vice versa.
//
// Match the prefix PLUS at least 16 chars of key material. A bare-prefix search
// produces false positives: both the Clerk and Stripe SDKs ship string
// constants like `let i="pk_live_"` to detect which mode a key is in, so
// `contents.includes('pk_live_')` flags every bundle containing those SDKs.
// Real publishable keys always carry a long random suffix.
const forbiddenPrefix = target === 'production' ? 'pk_test_' : 'pk_live_';
const forbiddenPattern = new RegExp(`${forbiddenPrefix}[A-Za-z0-9]{16,}`);
const offenders = [];

for (const file of collectFiles(assetsDir)) {
  const contents = readFileSync(file, 'utf8');
  const match = contents.match(forbiddenPattern);
  if (match) {
    offenders.push(`${file.replace(assetsDir, '.open-next/assets')}  (${match[0].slice(0, 24)}…)`);
  }
}

if (offenders.length > 0) {
  console.error(
    `\n[build-with-env] ✗ FAILED: a "${forbiddenPrefix}" key was inlined into the "${target}" bundle.\n` +
      `  This means the build picked up keys from a .env file instead of wrangler.jsonc.\n` +
      `  Offending files:\n${offenders.map((f) => `    ${f}`).join('\n')}\n`
  );
  process.exit(1);
}

console.log(`[build-with-env] ✓ Bundle check passed — no "${forbiddenPrefix}" key in the ${target} build.`);
