/**
 * Pure guards for the metadata-only PUT /api/orders handler (BMC-216F,
 * hardening BMC-158 / BMC-140).
 *
 * The PUT handler is gated by ORDERS_UPDATE — a scoped webhook/automation
 * permission, NOT full admin. Two classes of order data it could otherwise
 * write freely are integrity-sensitive and belong to other, verified paths:
 *
 *  1. Every fulfillment/lifecycle field (`status`, `tracking_number`,
 *     `shipped_at`, `delivered_at`, `shipping_method`, tracking URLs). Each
 *     now has a dedicated owner — the Stripe webhook (pending → processing),
 *     POST /api/admin/orders/{id}/ship and PATCH .../tracking (shipment state,
 *     CAS-guarded with audit events), and POST /api/orders/refund (cancelled /
 *     refunded, only after a verified Stripe refund). Writing them here would
 *     bypass the fulfillment state machine and produce inconsistent state
 *     (e.g. status='refunded' while payment_status stays 'paid'). So this
 *     handler rejects them outright — see `validatePutOrderBody`.
 *
 *  2. `extensions` as a whole. The PUT handler writes the `extensions` JSON
 *     column, but that column holds several server-owned keys the client must
 *     not be able to clobber:
 *       - `payment_intent_id` — the binding the refund route trusts to locate
 *         the PaymentIntent it refunds. A holder of ORDERS_UPDATE could rebind
 *         it (or drop it via a wholesale overwrite) before a refund — a
 *         refund-fraud / integrity concern.
 *       - `refunds[]` — the refund ledger `computeRefundedTotal()` sums to
 *         enforce the over-refund guard. A wholesale `extensions` overwrite
 *         (e.g. `PUT { extensions: { carrier: 'X' } }`) would drop it, resetting
 *         the cumulative refunded total to 0 and enabling a second refund beyond
 *         the original amount.
 *       - other stored keys (`restockedLineKeys`, `email`, …) the client did
 *         not send.
 *     So this handler MERGES the client's `extensions` over the stored ones
 *     (rather than wholesale-replacing) and re-pins `payment_intent_id` to the
 *     stored value. See `mergeExtensions`.
 *
 * Kept dependency-free (no DB / Cloudflare bindings) so they can be unit
 * tested directly. Consumed by app/api/orders/route.ts.
 */

/**
 * BMC-216F: PUT /api/orders allowlist.
 *
 * After BMC-216 every lifecycle transition has a dedicated owner — the Stripe
 * webhook (pending → processing), POST /api/admin/orders/{id}/ship
 * (processing → shipped), and POST /api/orders/refund (→ cancelled/refunded).
 * Nothing legitimate is left for a generic status/fulfillment write, so this
 * route accepts ONLY order metadata: `notes`, `external_references`, and the
 * (further restricted, merged) `extensions`. Every fulfillment field is
 * rejected with a 400 whose message names the correct endpoint.
 *
 * `payment_status` is deliberately NOT in the rejected map: the route keeps
 * the BMC-140 behavior of logging + silently dropping it (changing that to a
 * 400 would break existing webhook/automation callers that harmlessly echo it).
 */
export const PUT_UPDATABLE_FIELDS = ['notes', 'external_references', 'extensions'] as const;

const SHIP_ENDPOINT = 'POST /api/admin/orders/{id}/ship';
const TRACKING_ENDPOINT = 'PATCH /api/admin/orders/{id}/tracking';
const REFUND_ENDPOINT = 'POST /api/orders/refund';

const PUT_REJECTED_FIELD_MESSAGES: Record<string, string> = {
  status:
    `"status" cannot be set via PUT /api/orders. Shipments are created via ` +
    `${SHIP_ENDPOINT}; cancellations and refunds go through ${REFUND_ENDPOINT}, ` +
    `which issues the Stripe refund and updates payment_status atomically.`,
  tracking_number:
    `"tracking_number" cannot be set via PUT /api/orders. Use ${SHIP_ENDPOINT} ` +
    `to create a shipment, or ${TRACKING_ENDPOINT} to correct tracking on a ` +
    `shipped order.`,
  shipped_at:
    `"shipped_at" cannot be set via PUT /api/orders — shipment timestamps are ` +
    `server-owned. Use ${SHIP_ENDPOINT}.`,
  delivered_at:
    `"delivered_at" cannot be set via PUT /api/orders — delivery timestamps are ` +
    `server-owned.`,
  shipping_method:
    `"shipping_method" cannot be changed via PUT /api/orders. Carrier changes ` +
    `go through ${SHIP_ENDPOINT} or ${TRACKING_ENDPOINT}.`,
  trackingUrl:
    `Tracking URL fields cannot be set via PUT /api/orders — tracking URLs are ` +
    `derived server-side from carrier + tracking number. Use ${SHIP_ENDPOINT} ` +
    `or ${TRACKING_ENDPOINT}.`,
  tracking_url:
    `Tracking URL fields cannot be set via PUT /api/orders — tracking URLs are ` +
    `derived server-side from carrier + tracking number. Use ${SHIP_ENDPOINT} ` +
    `or ${TRACKING_ENDPOINT}.`,
};

/**
 * Validates a PUT /api/orders body against the allowlist. Key PRESENCE (not
 * truthiness) is what rejects — `{ status: null }` is still an attempt to
 * touch a rejected field. Returns a discriminated result (never throws).
 */
export function validatePutOrderBody(
  body: Record<string, unknown>
): { ok: true } | { ok: false; error: string; status: number } {
  for (const [field, message] of Object.entries(PUT_REJECTED_FIELD_MESSAGES)) {
    if (field in body) {
      return { ok: false, error: message, status: 400 };
    }
  }
  const hasUpdatable = PUT_UPDATABLE_FIELDS.some((f) => body[f] !== undefined);
  if (!hasUpdatable) {
    return {
      ok: false,
      error:
        'No updatable fields provided. PUT /api/orders accepts only: ' +
        'notes, external_references, extensions.',
      status: 400,
    };
  }
  return { ok: true };
}

/**
 * Parses a `mode:"json"` extensions value that may be an object or a raw JSON
 * string. Distinguishes three cases the merge below cares about:
 *   - absent (`null`/`undefined`/empty string) → `{ ok: true, value: {} }`
 *   - a valid object (or JSON string that parses to a plain object) → `{ ok: true, value }`
 *   - a corrupt string / non-plain-object → `{ ok: false }`
 *
 * The `ok: false` case is what lets the stored side fail SAFE instead of
 * silently coercing corrupt data to `{}` and dropping server-owned keys.
 */
function parseExtensionsInput(
  value: unknown
): { ok: true; value: Record<string, unknown> } | { ok: false } {
  if (value === null || value === undefined) return { ok: true, value: {} };
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return { ok: true, value: {} };
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return { ok: true, value: parsed as Record<string, unknown> };
      }
      return { ok: false };
    } catch {
      return { ok: false };
    }
  }
  if (typeof value === 'object' && !Array.isArray(value)) {
    return { ok: true, value: value as Record<string, unknown> };
  }
  return { ok: false };
}

/**
 * Merges a client-supplied `extensions` object over the order's currently
 * stored `extensions`, then re-pins `payment_intent_id` to the stored value.
 *
 * This replaces the previous wholesale-replace behavior: a PUT that sends only
 * `{ carrier: 'X' }` must NOT wipe server-owned keys it omitted — most
 * critically `refunds[]` (summed by `computeRefundedTotal` for the over-refund
 * guard), plus `restockedLineKeys`, `email`, and any other stored keys. Those
 * survive because we start from the stored object and overlay the client keys.
 *
 * `payment_intent_id` is always forced back to the stored value (restored
 * whether the client rebound it, dropped it, or introduced one), or stripped
 * entirely if the order never had one — that binding is set only at verified
 * order creation and the refund route trusts it.
 *
 * Fails SAFE: if the STORED `current` is a corrupt/unparseable string (or a
 * non-object), we return an error instead of persisting a stripped object that
 * would silently drop the refund ledger. A corrupt CLIENT `incoming` value is
 * treated leniently (as an empty overlay) — it can only fail to add keys, never
 * drop stored ones.
 *
 * Returns a discriminated result (never throws) so the route can turn a
 * failure straight into a clean error response.
 *
 * @param incoming  the client-supplied `extensions` from the PUT body (object or JSON string)
 * @param current   the order's currently persisted `extensions` (object or JSON string)
 */
export function mergeExtensions(
  incoming: unknown,
  current: unknown
):
  | { ok: true; extensions: Record<string, unknown> }
  | { ok: false; error: string; status: number } {
  const parsedCurrent = parseExtensionsInput(current);
  if (!parsedCurrent.ok) {
    // Corrupt stored extensions — refuse rather than overwrite. Persisting the
    // client's object here would drop the refunds ledger and reset the
    // over-refund guard, so fail closed.
    return {
      ok: false,
      error:
        'Cannot update order: stored extensions are corrupt and cannot be safely ' +
        'merged. Refusing to overwrite to avoid dropping server-owned data ' +
        '(e.g. the refunds ledger).',
      status: 422,
    };
  }

  const parsedIncoming = parseExtensionsInput(incoming);
  const incomingObj = parsedIncoming.ok ? parsedIncoming.value : {};
  const stored = parsedCurrent.value;

  // BMC-216F: `carrier` and `trackingUrl` are server-owned fulfillment keys
  // (written only by the shipment service / legacy backfill; trackingUrl is
  // always DERIVED from carrier + tracking number, never stored from a
  // client). Strip them from the client overlay before merging so a PUT can
  // neither plant a phishing trackingUrl nor rewrite the shipped carrier —
  // the STORED values survive untouched for legacy orders.
  const {
    carrier: _clientCarrier,
    trackingUrl: _clientTrackingUrl,
    ...clientKeys
  } = incomingObj;

  // Start from the stored keys, overlay the client's remaining keys.
  // Server-owned keys the client did NOT send (refunds, restockedLineKeys,
  // email, carrier, trackingUrl, …) survive.
  const merged: Record<string, unknown> = { ...stored, ...clientKeys };

  // Re-pin the immutable PI binding to the stored value.
  const storedPi = stored.payment_intent_id;
  if (typeof storedPi === 'string' && storedPi.length > 0) {
    merged.payment_intent_id = storedPi;
  } else {
    // No stored PI — PUT may not introduce one. Strip any client-supplied value.
    delete merged.payment_intent_id;
  }

  return { ok: true, extensions: merged };
}
