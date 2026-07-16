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
  | "giftcard";

/**
 * Record a critical money-path failure: log an alertable line and (best effort)
 * a metric. Never throws.
 *
 * @param area   which money path failed (drives alerting + metric grouping)
 * @param event  short stable event name, e.g. "order_create_failed"
 * @param detail small, non-PII context (ids, statuses) — serialized into the log
 * @param error  the caught error, if any (name + message are extracted)
 */
export function logCritical(
  area: CriticalArea,
  event: string,
  detail: Record<string, unknown> = {},
  error?: unknown
): void {
  const payload: Record<string, unknown> = { area, event, ...detail };
  if (error !== undefined) payload.error = errorMessage(error);

  // Single line, stable prefix, JSON body → reliably parsed by the Tail Worker.
  console.error(`${CRITICAL_MARKER} ${area}.${event}`, JSON.stringify(payload));

  writeMetric(area, event);
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

function errorMessage(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}
