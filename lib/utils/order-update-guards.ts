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
 *  2. The two JSON columns the handler writes — `extensions` and
 *     `external_references`. Both hold server-owned keys the client must not be
 *     able to clobber:
 *       - `payment_intent_id` — the binding the refund route trusts to locate
 *         the PaymentIntent it refunds. It is dual-written at order creation to
 *         BOTH columns, and `getOrderByPaymentIntentId` matches either with an
 *         OR + `LIMIT 1`. A holder of ORDERS_UPDATE could rebind it (or drop it
 *         via a wholesale overwrite) before a refund — a refund-fraud /
 *         integrity concern — or point a second order at someone else's PI so
 *         the `charge.refunded` reconciler writes onto the wrong row.
 *       - `refunds[]` — the refund ledger `computeRefundedTotal()` sums to
 *         enforce the over-refund guard. A wholesale `extensions` overwrite
 *         (e.g. `PUT { extensions: { carrier: 'X' } }`) would drop it, resetting
 *         the cumulative refunded total to 0 and enabling a second refund beyond
 *         the original amount.
 *       - `refunds_version`, `restockedLineKeys`, `restockInflightLineKeys`,
 *         `email`, `carrier`, `trackingUrl`, `stripe_amount_refunded`,
 *         `agent_id`, `expected_shipping_cents`, `expected_tax_cents` — every
 *         `extensions` key a server-side money, authorization or idempotency
 *         decision reads. See `SERVER_OWNED_EXTENSION_KEYS`.
 *     So this handler MERGES the client's object over the stored one (rather
 *     than wholesale-replacing), drops the server-owned keys from the client's
 *     overlay, and re-pins `payment_intent_id` to the stored value. See
 *     `mergeExtensions` / `mergeExternalReferences`.
 *
 * Note the deliberate asymmetry between those two mechanisms: a TOP-LEVEL
 * `{ trackingUrl: … }` on the PUT body 400s the whole request (it is in
 * `PUT_REJECTED_FIELD_MESSAGES`), while the same value NESTED as
 * `{ extensions: { trackingUrl: … } }` is silently stripped and the request
 * succeeds with a 200. Both are safe — the value is never stored either way —
 * but only the first tells the caller. The rejected map exists to point a
 * caller at the right endpoint for a field they clearly meant to set; the
 * nested strip is a blanket integrity guard over a free-form JSON column where
 * a 400 on any server-owned key would break automation callers that echo back
 * an order they just read. If you are debugging "why didn't my
 * `extensions.<key>` persist", the answer is `SERVER_OWNED_EXTENSION_KEYS`.
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
    `"shipped_at" cannot be set via PUT /api/orders. Shipment timestamps are ` +
    `server-owned. Use ${SHIP_ENDPOINT}.`,
  delivered_at:
    `"delivered_at" cannot be set via PUT /api/orders. Delivery timestamps are ` +
    `server-owned.`,
  shipping_method:
    `"shipping_method" cannot be changed via PUT /api/orders. Carrier changes ` +
    `go through ${SHIP_ENDPOINT} or ${TRACKING_ENDPOINT}.`,
  trackingUrl:
    `Tracking URL fields cannot be set via PUT /api/orders. Tracking URLs are ` +
    `derived server-side from carrier + tracking number. Use ${SHIP_ENDPOINT} ` +
    `or ${TRACKING_ENDPOINT}.`,
  tracking_url:
    `Tracking URL fields cannot be set via PUT /api/orders. Tracking URLs are ` +
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
  // `null` does NOT count as an updatable field. The two JSON columns treat a
  // null overlay as "no keys to apply", so `{ external_references: null }`
  // alone would otherwise 200 on a write that changed nothing — and would
  // silently re-serialize a stored raw JSON string into an object as a side
  // effect. Reject it as the no-op it is. (`notes: null` IS a real clear, but
  // it needs a non-null field alongside it to be worth a write.)
  const hasUpdatable = PUT_UPDATABLE_FIELDS.some((f) => body[f] !== undefined && body[f] !== null);
  if (!hasUpdatable) {
    return {
      ok: false,
      error:
        'No updatable fields provided. PUT /api/orders accepts only: ' +
        'notes, external_references, extensions (a null value is not an update).',
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
 * Keys inside `extensions` that ONLY server code may write, dropped from the
 * client's overlay before the merge. Merging alone is not enough: it protects
 * keys the client OMITS, but a key the client SENDS still wins. Each of these
 * has a verified server-side writer and a concrete abuse if a PUT can set it:
 *
 *  - `carrier`, `trackingUrl` (BMC-216F) — written only by the shipment service
 *    / legacy backfill; `trackingUrl` is always DERIVED from carrier + tracking
 *    number, never stored from a client. Writable here, a PUT could plant a
 *    phishing tracking link or rewrite the shipped carrier.
 *  - `email` (BMC-230) — the guest-order email of record. `getOrderCustomerEmail`
 *    prefers it over `shipping_address.email`, so it decides where the shipping /
 *    refund / confirmation emails go AND is the value the guest order-status
 *    token is signed over (`createOrderStatusToken`). Writable here, a PUT could
 *    redirect a customer's emails to an attacker AND hand them a token that
 *    verifies at `/order-status/[id]` — full guest-order takeover.
 *  - `refunds`, `refunds_version` — the refund ledger and the monotonic counter
 *    the refund route's CAS is guarded on. Writable here, a PUT could reset the
 *    over-refund guard or stall/replay the CAS.
 *  - `restockedLineKeys`, `restockInflightLineKeys` — the restock idempotency
 *    pair. `readUnavailableRestockKeys` unions them, so BOTH must be protected:
 *    clearing either causes double-restock, planting keys in either silently
 *    suppresses a legitimate one.
 *  - `stripe_amount_refunded` (BMC-230 review) — the high-water mark of
 *    cumulative `charge.amount_refunded` observed from Stripe. The over-refund
 *    check is `Math.max(ledgerRefunded, stripeRefundedFloor)`, and per its own
 *    contract the floor "is the only thing that keeps the guard honest" when a
 *    `pending` → `failed` reservation makes the ledger under-report. Writable
 *    here, a PUT could zero the floor and wave through a second real refund.
 *  - `agent_id` (BMC-230 review) — the MCP ownership predicate. `getOwnedOrder`
 *    returns not-found unless `extensions.agent_id === agentId`. Writable here,
 *    a PUT could hand an order to an arbitrary agent or strip the legitimate
 *    agent's access.
 *  - `expected_shipping_cents`, `expected_tax_cents` (BMC-230 review) — computed
 *    server-side at PaymentIntent creation and re-enforced by
 *    `order-finalization` as the BMC-201 undercharge guard. Zeroed on a still-
 *    pending order, `verifyOrderChargeSufficient` falls back to the goods-only
 *    floor and accepts a capture that omitted tax + shipping.
 *  - `tracking_url` — the snake_case spelling. Nothing reads it today, but the
 *    top-level rejected map treats both spellings as equivalent, so the nested
 *    strip does too rather than leaving a spelling-dependent hole.
 *
 * `payment_intent_id` is NOT in this list because it is not merely dropped —
 * it is re-pinned to the stored value. See `mergeGuardedJsonColumn`.
 *
 * When adding a server-owned key anywhere, add it here too — the
 * "every server-read key is protected" block in
 * tests/unit/lib/utils/order-update-guards.test.ts pins this set.
 */
export const SERVER_OWNED_EXTENSION_KEYS = [
  'carrier',
  'trackingUrl',
  'tracking_url',
  'email',
  'refunds',
  'refunds_version',
  'restockedLineKeys',
  'restockInflightLineKeys',
  'stripe_amount_refunded',
  'agent_id',
  'expected_shipping_cents',
  'expected_tax_cents',
] as const;

/**
 * Merges a client-supplied JSON-column object over the order's stored one,
 * drops `serverOwnedKeys` from the client's overlay, and re-pins
 * `payment_intent_id` to the stored value.
 *
 * Merging (rather than wholesale-replacing) is what keeps a PUT that sends only
 * `{ erp: 'X-1' }` from wiping keys it omitted — most critically `refunds[]`
 * (summed by `computeRefundedTotal` for the over-refund guard). Dropping
 * `serverOwnedKeys` is what keeps a PUT that DOES send them from winning the
 * overlay. Both are needed.
 *
 * `payment_intent_id` is always forced back to the stored value (restored
 * whether the client rebound it, dropped it, or introduced one), or stripped
 * entirely if the order never had one — that binding is set only at verified
 * order creation, the refund route trusts it, and `getOrderByPaymentIntentId`
 * matches it across BOTH JSON columns, so a client-planted value in either one
 * can misdirect refund reconciliation onto the wrong order.
 *
 * Fails SAFE: if the STORED `current` is a corrupt/unparseable string (or a
 * non-object), we return an error instead of persisting a stripped object that
 * would silently drop the refund ledger. A corrupt CLIENT `incoming` value is
 * treated leniently (as an empty overlay) — it can only fail to add keys, never
 * drop stored ones.
 */
function mergeGuardedJsonColumn(
  incoming: unknown,
  current: unknown,
  serverOwnedKeys: readonly string[],
  corruptStoredError: string
):
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; error: string; status: number } {
  const parsedCurrent = parseExtensionsInput(current);
  if (!parsedCurrent.ok) {
    return { ok: false, error: corruptStoredError, status: 422 };
  }

  const parsedIncoming = parseExtensionsInput(incoming);
  const incomingObj = parsedIncoming.ok ? parsedIncoming.value : {};
  const stored = parsedCurrent.value;

  // Drop server-owned keys from the client's overlay. The STORED values survive
  // untouched — this only removes the client's ability to change them.
  const clientKeys: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(incomingObj)) {
    if (!serverOwnedKeys.includes(key)) clientKeys[key] = value;
  }

  const merged: Record<string, unknown> = { ...stored, ...clientKeys };

  // Re-pin the immutable PI binding to the stored value.
  const storedPi = stored.payment_intent_id;
  if (typeof storedPi === 'string' && storedPi.length > 0) {
    merged.payment_intent_id = storedPi;
  } else {
    // No stored PI — PUT may not introduce one. Strip any client-supplied value.
    delete merged.payment_intent_id;
  }

  return { ok: true, value: merged };
}

/**
 * Merges a client-supplied `extensions` object over the order's currently
 * stored `extensions`, dropping `SERVER_OWNED_EXTENSION_KEYS` from the client's
 * overlay and re-pinning `payment_intent_id`.
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
  const result = mergeGuardedJsonColumn(
    incoming,
    current,
    SERVER_OWNED_EXTENSION_KEYS,
    'Cannot update order: stored extensions are corrupt and cannot be safely ' +
      'merged. Refusing to overwrite to avoid dropping server-owned data ' +
      '(e.g. the refunds ledger).'
  );
  return result.ok ? { ok: true, extensions: result.value } : result;
}

/**
 * Merges a client-supplied `external_references` object over the order's stored
 * one and re-pins `payment_intent_id` (BMC-230).
 *
 * `external_references` is genuine cross-system metadata (`erp`, `shopify_id`,
 * …) that an ORDERS_UPDATE caller is meant to write, so unlike `extensions`
 * there is no server-owned key list here — the ONE protected key is
 * `payment_intent_id`, which order creation dual-writes into this column
 * alongside `extensions`. `getOrderByPaymentIntentId` OR-matches both columns
 * with `LIMIT 1` and no `ORDER BY`, so a client-planted value here makes a
 * second row match a victim's PaymentIntent and lets `charge.refunded`
 * reconciliation write `cancelled` / `refunded` and the refund-ledger entry
 * onto the wrong order. Merging also stops a partial overwrite from dropping
 * the stored binding.
 *
 * @param incoming  the client-supplied `external_references` from the PUT body
 * @param current   the order's currently persisted `external_references`
 */
export function mergeExternalReferences(
  incoming: unknown,
  current: unknown
):
  | { ok: true; externalReferences: Record<string, unknown> }
  | { ok: false; error: string; status: number } {
  const result = mergeGuardedJsonColumn(
    incoming,
    current,
    [],
    'Cannot update order: stored external_references are corrupt and cannot be ' +
      'safely merged. Refusing to overwrite to avoid dropping the stored ' +
      'payment_intent_id binding.'
  );
  return result.ok ? { ok: true, externalReferences: result.value } : result;
}
