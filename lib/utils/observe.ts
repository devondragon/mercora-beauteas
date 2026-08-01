/**
 * Critical-path observability helper (BMC-168).
 *
 * Two jobs, both best-effort and non-throwing so telemetry can NEVER break a
 * money path:
 *
 *  1. Emit a single, stable, machine-parseable log line for the failure. The
 *     line is prefixed with {@link CRITICAL_MARKER} and drained to Cloudflare
 *     Workers Logs (`observability.enabled` in wrangler.jsonc). The
 *     observability Tail Worker (`workers/observability-tail/`) keys on that
 *     marker and turns any matching line into an alert email — so the marker
 *     string MUST stay in sync with the copy in that Worker.
 *  2. Write a best-effort Workers Analytics Engine data point (the `ANALYTICS`
 *     binding) so money-path failures are queryable/graphable over time.
 *
 * Call this at the outer catch of the critical money paths (order creation,
 * payment-intent, webhook processing, refund, gift-card fulfillment) IN ADDITION
 * to any existing local `console.error` — it does not replace domain logging,
 * it adds the alertable signal on top.
 */

import { getCloudflareContext } from "@opennextjs/cloudflare";

/**
 * Prefix the Tail Worker matches on. Keep in sync with `CRITICAL_MARKER` in
 * `workers/observability-tail/src/index.ts`.
 */
export const CRITICAL_MARKER = "[critical]";

/** The money paths we alert on. Also used as the Analytics Engine index. */
export type CriticalArea =
  | "order_create"
  | "payment_intent"
  | "webhook"
  | "refund"
  | "giftcard"
  | "inventory"
  // Coupon redemption at finalization (BMC-197): a failure here means single_use /
  // usage_limit enforcement silently didn't record, so a one-shot code could be
  // reused — a promotions-integrity gap worth alerting on.
  | "promotion"
  // Transactional email on the money path. Sends are deliberately swallowed so a
  // mail failure can't break order finalization — which means without alerting, a
  // broken Resend config (bad key, unverified domain, suspended account) silently
  // eats every order confirmation with nobody paged.
  | "email"
  // Guarded-CAS shipment/tracking writes (BMC-226). These are concurrency-
  // critical and D1-batch-backed; an unhandled failure here means the admin
  // fulfillment UI silently 500s with nothing paged.
  | "fulfillment";

/**
 * Record a critical money-path failure: log an alertable line and (best effort)
 * a metric. Never throws.
 *
 * SECURITY (BMC-168 review): the `[critical]` line this emits is forwarded to a
 * THIRD-PARTY email relay (Resend) by the Tail Worker, so it must not carry raw
 * error text — a Stripe error can echo customer PII (name/address) and gift-card
 * error strings embed redeemable codes. Therefore only the error *class* (via
 * {@link errorLabel}) is included here; the full message stays in the caller's
 * sibling `console.error`, which drains to access-controlled Workers Logs only.
 * Keep `detail` limited to non-PII identifiers/counts for the same reason.
 *
 * @param area   which money path failed (drives alerting + metric grouping)
 * @param event  short stable event name, e.g. "order_create_failed"
 * @param detail small, non-PII context (ids, statuses) — serialized into the log
 * @param error  the caught error, if any (only its class/type is emitted)
 */
export function logCritical(
  area: CriticalArea,
  event: string,
  detail: Record<string, unknown> = {},
  error?: unknown
): void {
  // Fully guarded: this is telemetry on a money path and MUST NOT throw — a
  // circular `detail` (JSON.stringify) or a patched console must never turn a
  // handled failure into an unhandled one.
  try {
    // area/event are spread LAST so a caller's `detail` key can never clobber the
    // real classification the Tail Worker/metrics rely on.
    const payload: Record<string, unknown> = { ...detail, area, event };
    if (error !== undefined) payload.errorType = errorLabel(error);
    // Single line, stable prefix, JSON body → reliably parsed by the Tail Worker.
    console.error(`${CRITICAL_MARKER} ${area}.${event}`, safeStringify(payload));
  } catch {
    // Last resort: still emit the marker so the failure is at least alertable.
    try {
      console.error(`${CRITICAL_MARKER} ${area}.${event}`);
    } catch {
      /* nothing more we can safely do */
    }
  }

  writeMetric(area, event);
}

/**
 * Non-alerting sibling of {@link logCritical}: same stable `<area>.<event>` +
 * JSON-payload line shape (and the same PII rule — error class only, never the
 * message), but emitted via console.warn WITHOUT {@link CRITICAL_MARKER}, so
 * the observability Tail Worker never turns it into an alert. For failure
 * classes that are diagnosable-but-expected — e.g. Resend's
 * `concurrent_idempotent_requests` 409 when a shipping-email retry races the
 * still-in-flight original send (BMC-246). Still writes the best-effort
 * metric. Never throws.
 */
export function logWarn(
  area: CriticalArea,
  event: string,
  detail: Record<string, unknown> = {},
  error?: unknown
): void {
  try {
    const payload: Record<string, unknown> = { ...detail, area, event };
    if (error !== undefined) payload.errorType = errorLabel(error);
    console.warn(`${area}.${event}`, safeStringify(payload));
  } catch {
    try {
      console.warn(`${area}.${event}`);
    } catch {
      /* nothing more we can safely do */
    }
  }

  writeMetric(area, event);
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return '"[unserializable detail]"';
  }
}

/**
 * Best-effort Analytics Engine data point. Swallows everything — a missing
 * binding (`next dev`, unit tests) or a write failure must not surface.
 */
function writeMetric(area: CriticalArea, event: string): void {
  try {
    const { env } = getCloudflareContext();
    const analytics = (env as unknown as { ANALYTICS?: AnalyticsEngineDataset }).ANALYTICS;
    analytics?.writeDataPoint({
      // Text labels: the money path + the specific event name.
      blobs: [area, event],
      // Counter: one failure.
      doubles: [1],
      // Group/sample by money path.
      indexes: [area],
    });
  } catch {
    // No Workers runtime or ANALYTICS binding unset — telemetry is optional.
  }
}

/**
 * The error's CLASS/type only — never its message. This is what may be forwarded
 * to the alert email, so it must not contain error content (which can carry PII
 * or secrets). Full detail remains in the caller's sibling `console.error`.
 */
function errorLabel(error: unknown): string {
  if (error instanceof Error) return error.name || "Error";
  return typeof error;
}
