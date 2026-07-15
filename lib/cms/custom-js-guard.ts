/**
 * CMS custom_js guardrails (BMC-163)
 *
 * `page.custom_js` is admin-authored JavaScript executed client-side by
 * `app/[slug]/PageRenderer.tsx` via `new Function(...)()`. That is arbitrary
 * code execution, so it is fenced by three guardrails:
 *
 *  1. Per-env kill switch — execution only happens when the
 *     `cms.custom_js_enabled` admin setting is explicitly `true`. Absent /
 *     malformed / errored reads all resolve to `false` (secure by default).
 *  2. Super-admin write gate — only a super-admin may set or change a page's
 *     `custom_js` (enforced in the admin pages API using {@link customJsChanged}).
 *  3. Audit log — every attempt to set/change `custom_js` is logged via
 *     {@link logCustomJsAudit}.
 *
 * This module holds the pure, unit-testable pieces plus a thin async reader.
 */

import { getSettings } from "@/lib/utils/settings";

/** admin_settings key for the custom_js execution kill switch. */
export const CUSTOM_JS_ENABLED_SETTING = "cms.custom_js_enabled";

/**
 * Pure: is client-side `custom_js` execution enabled?
 *
 * Default OFF — only an explicit boolean `true` enables it. A missing key, a
 * stringified value, or any other type resolves to `false` so the feature is
 * disabled unless an admin has deliberately turned it on.
 */
export function isCustomJsEnabled(raw: Record<string, unknown>): boolean {
  return raw[CUSTOM_JS_ENABLED_SETTING] === true;
}

/**
 * Read the kill switch from admin_settings. Fails closed (returns `false`) on
 * any error so a DB hiccup can never accidentally enable code execution.
 */
export async function getCustomJsEnabled(): Promise<boolean> {
  try {
    const settings = await getSettings();
    return isCustomJsEnabled(settings);
  } catch (error) {
    console.error("[cms.custom_js] failed reading kill switch; defaulting OFF", error);
    return false;
  }
}

/** Treat null / undefined / whitespace-only as "no script" so no-op writes don't trip the gate. */
function normalizeScript(value: string | null | undefined): string | null {
  return value === null || value === undefined || value.trim() === "" ? null : value;
}

/**
 * Pure: does this value carry actual script content (i.e. non-empty after
 * whitespace normalization)? Used by the write routes to distinguish
 * *setting/changing* `custom_js` to a non-empty value (super-admin only) from
 * *removing* it (empty/whitespace — an ordinary admin may clear it).
 */
export function isNonEmptyScript(value: string | null | undefined): boolean {
  return normalizeScript(value) !== null;
}

/**
 * Pure: does this page write set or change `custom_js` relative to the current
 * row? Returns `false` when the payload doesn't include `custom_js` at all, or
 * when the (whitespace-normalized) value is unchanged — so ordinary edits that
 * leave `custom_js` alone never require elevated privileges.
 *
 * @param incoming the update/create payload
 * @param current  the existing page row (pass `null`/`undefined` for creates)
 */
export function customJsChanged(
  incoming: { custom_js?: string | null },
  current?: { custom_js?: string | null } | null
): boolean {
  if (!("custom_js" in incoming)) return false;
  return normalizeScript(incoming.custom_js) !== normalizeScript(current?.custom_js);
}

/**
 * Emit a structured audit record for a `custom_js` write.
 * Uses `console.warn` (surfaced in Workers observability / `wrangler tail`)
 * since the repo has no dedicated audit table. Records who, what, when, and
 * the outcome.
 *
 * Callers log with `allowed: false` when *rejecting* an attempt (before any
 * write), and with `allowed: true` only *after* the write has actually
 * persisted — so an `allowed: true` record always corresponds to a real,
 * committed change (see BMC-163 review).
 */
export function logCustomJsAudit(entry: {
  actorUserId?: string;
  pageId?: number | string;
  pageSlug?: string;
  action: "create" | "update";
  allowed: boolean;
}): void {
  console.warn(
    "[audit][cms.custom_js]",
    JSON.stringify({
      event: "cms.custom_js.write",
      action: entry.action,
      allowed: entry.allowed,
      actorUserId: entry.actorUserId ?? "unknown",
      pageId: entry.pageId ?? null,
      pageSlug: entry.pageSlug ?? null,
      at: new Date().toISOString(),
    })
  );
}
