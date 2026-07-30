# BMC-216 Shared Interface Contract

> **Purpose:** This document pins every name, type, signature, path, and wire
> shape that crosses ticket boundaries in BMC-216 (A–G). Every implementation
> plan MUST use these exact names. If an implementer believes a contract entry
> is wrong, they stop and escalate — they do not rename unilaterally.
>
> Spec: `docs/superpowers/plans/2026-07-30-bmc-216-basic-oms.md`

## Migrations

- `migrations/0022_add_shipping_carrier.sql` — adds `orders.shipping_carrier
  TEXT` (nullable) + backfill (precedence: `json_extract(extensions,
  '$.carrier')`, fallback to `shipping_method` only when it matches a known
  carrier token; normalize per `normalizeLegacyCarrier` rules below).
- `migrations/0023_add_order_events.sql` — creates `order_events` + indexes
  `(order_id, created_at)` and `(event_type)`.

## New files and owners

| Path | Ticket | Responsibility |
|---|---|---|
| `lib/fulfillment/types.ts` | A | Carrier/event/actor types and constants |
| `lib/fulfillment/tracking.ts` | A | Pure carrier normalization + URL building |
| `lib/fulfillment/transitions.ts` | A | Pure input parsing + ship/tracking decisions |
| `lib/orders/customer-email.ts` | A | `getOrderCustomerEmail` shared resolver |
| `lib/order-status/token.ts` | A | Guest HMAC token (mirrors `lib/email/unsubscribe-token.ts`) |
| `lib/db/schema/order-events.ts` | A | Drizzle table for `order_events` (re-export from `lib/db/schema/index.ts`) |
| `lib/fulfillment/service.ts` | B | Server-only D1 shipment/tracking/event writes |
| `lib/fulfillment/queries.ts` | D | SQL-backed admin queue queries |
| `app/api/admin/orders/[id]/ship/route.ts` | B | POST create shipment |
| `app/api/admin/orders/[id]/tracking/route.ts` | B | PATCH tracking correction |
| `app/api/admin/orders/[id]/events/route.ts` | B | GET audit history |
| `lib/fulfillment/shipping-email.ts` | C | Orchestrates send + audit events for shipping email |
| `app/api/admin/orders/[id]/shipping-email/route.ts` | C | POST retry/resend |
| `app/api/admin/orders/route.ts` | D | GET SQL-backed admin order list |
| `app/order-status/[id]/page.tsx` | E | Guest status page |

Modified (not new): `lib/utils/email.ts` (C adds shipping email; F escapes the
legacy template), `app/api/orders/route.ts` (F allowlist), `app/admin/orders/`
(D), `app/account/orders/[id]/page.tsx` (E),
`lib/services/order-confirmation.ts` (A refactors email resolution; C fixes
the merchant deep-link).

## `lib/fulfillment/types.ts`

```ts
export const CARRIERS = ["ups", "fedex", "other"] as const;
export type Carrier = (typeof CARRIERS)[number];

export const ORDER_EVENT_TYPES = [
  "shipment_created",
  "tracking_updated",
  "shipping_email_sent",
  "shipping_email_failed",
  "shipping_email_resent",
] as const;
export type OrderEventType = (typeof ORDER_EVENT_TYPES)[number];

export type ActorType = "admin" | "service" | "system";

export interface Actor {
  type: ActorType;
  id: string | null; // Clerk user ID, "api-token" for ADMIN_VECTORIZE_TOKEN, null for system
}

export interface ShipmentInput {
  carrier: Carrier | null;
  trackingNumber: string | null; // sanitized; null means untracked
}
```

## `lib/fulfillment/tracking.ts` (pure — no D1/Next/Clerk/Resend imports)

```ts
export const MAX_TRACKING_LENGTH = 100;

/** Strict API-input normalization: "ups"/"fedex"/"other" case-insensitive, else null. */
export function normalizeCarrier(raw: unknown): Carrier | null;

/** Lenient legacy normalization (migration backfill + legacy display):
 *  UPS/FedEx variants (case-insensitive, whitespace-trimmed) -> "ups"/"fedex";
 *  any other non-empty string -> "other"; empty/null/non-string -> null. */
export function normalizeLegacyCarrier(raw: unknown): Carrier | null;

/** Trim, strip C0/C1 control chars (/[\u0000-\u001F\u007F-\u009F]/g), enforce
 *  MAX_TRACKING_LENGTH. Returns null for empty/non-string input.
 *  Over-length input returns null (callers treat as invalid, not truncated). */
export function sanitizeTrackingNumber(raw: unknown): string | null;

/** ups   -> https://www.ups.com/track?loc=en_US&tracknum=<encodeURIComponent>
 *  fedex -> https://www.fedex.com/fedextrack/?trknbr=<encodeURIComponent>
 *  other/null carrier or null tracking -> null. Never a search-engine URL. */
export function buildTrackingUrl(
  carrier: Carrier | null,
  trackingNumber: string | null,
): string | null;
```

## `lib/fulfillment/transitions.ts` (pure)

```ts
import type { Carrier, ShipmentInput } from "./types";

export interface OrderFulfillmentSnapshot {
  status: string;
  payment_status: string | null;
  shipping_carrier: string | null;
  tracking_number: string | null;
}

/** Parse + validate a request body into ShipmentInput.
 *  Rules: both absent -> valid untracked. trackingNumber without carrier ->
 *  invalid. carrier without trackingNumber -> invalid. Unknown carrier ->
 *  invalid. Tracking sanitized via sanitizeTrackingNumber (null after
 *  sanitize = invalid if key was present and non-empty). */
export function parseShipmentInput(
  body: unknown,
): { ok: true; input: ShipmentInput } | { ok: false; error: string };

/** Case-insensitive tracking-number compare (toUpperCase), carrier exact. */
export function shipmentDataEqual(a: ShipmentInput, b: ShipmentInput): boolean;

export type ShipDecision =
  | { kind: "ship" }
  | { kind: "idempotent" }                    // shipped, identical data -> 200
  | { kind: "conflict" }                      // shipped, different data -> 409 shipment_conflict
  | { kind: "not_fulfillable"; status: string; paymentStatus: string | null }; // -> 409 not_fulfillable

/** Encodes the matrix: processing+paid -> ship; shipped -> idempotent or
 *  conflict via shipmentDataEqual; everything else -> not_fulfillable. */
export function decideShipment(
  order: OrderFulfillmentSnapshot,
  input: ShipmentInput,
): ShipDecision;

/** Tracking correction allowed only when status === "shipped". */
export function canEditTracking(order: OrderFulfillmentSnapshot): boolean;
```

## `lib/orders/customer-email.ts` (pure)

```ts
/** extensions.email || shipping_address.email, trimmed + lowercased.
 *  Returns null when neither resolves to a non-empty string.
 *  lib/services/order-confirmation.ts line ~107 must be refactored to call
 *  this (single source of truth). */
export function getOrderCustomerEmail(order: {
  extensions?: Record<string, unknown> | null;
  shipping_address?: unknown;
}): string | null;
```

## `lib/order-status/token.ts` (pure, Web Crypto — mirror `lib/email/unsubscribe-token.ts`)

```ts
export const MAX_ORDER_STATUS_TOKEN_LENGTH = 256;
// Scope string signed: `order-status:v1:<orderId>:<normalizedEmail>`
// Token = base64url(HMAC-SHA256(scope, ORDER_STATUS_SECRET)) — signature only,
// no email/address payload inside the token.

export function isOrderStatusTokenConfigured(): boolean; // false when secret unset/empty

/** null when secret missing (fail closed) or email empty. */
export function createOrderStatusToken(
  orderId: string,
  email: string,
): Promise<string | null>;

/** false when secret missing, token over MAX length, malformed, or signature
 *  mismatch. Constant-time compare over fixed 32-byte signatures. */
export function verifyOrderStatusToken(
  token: string,
  orderId: string,
  email: string,
): Promise<boolean>;
```

Secret env var: `ORDER_STATUS_SECRET` (read the same way
`unsubscribe-token.ts` reads `EMAIL_UNSUBSCRIBE_SECRET`).

## `lib/db/schema/order-events.ts`

```ts
export const orderEvents = sqliteTable(
  "order_events",
  {
    id: text("id").primaryKey(),                 // crypto.randomUUID()
    order_id: text("order_id").notNull(),
    event_type: text("event_type").notNull(),    // OrderEventType
    actor_type: text("actor_type").notNull(),    // ActorType
    actor_id: text("actor_id"),
    from_status: text("from_status"),
    to_status: text("to_status"),
    details: text("details", { mode: "json" }),  // pass raw objects, never pre-stringified
    created_at: text("created_at").notNull(),    // ISO 8601 with ms
  },
  /* indexes: (order_id, created_at) and (event_type) */
);
```

`details` shapes per event type:

- `shipment_created`: `{ carrier, trackingNumber, trackingUrl }`
- `tracking_updated`: `{ previous: { carrier, trackingNumber }, next: { carrier, trackingNumber } }`
- `shipping_email_sent` / `shipping_email_failed` / `shipping_email_resent`:
  `{ idempotencyKey, error?, resendOfEventId? }`

## `lib/fulfillment/service.ts` (server-only)

```ts
import type { Actor, ShipmentInput } from "./types";

export type ShipOrderResult =
  | { outcome: "shipped"; order: Order; eventId: string }        // fresh CAS win -> HTTP 201
  | { outcome: "already_shipped"; order: Order }                 // idempotent    -> HTTP 200
  | { outcome: "not_found" }                                     // -> 404
  | { outcome: "conflict"; order: Order }                        // -> 409 shipment_conflict
  | { outcome: "not_fulfillable"; status: string; paymentStatus: string | null }; // -> 409 not_fulfillable

/** Guarded UPDATE (WHERE status='processing' AND payment_status='paid')
 *  RETURNING, batched via db.batch() with a conditional event INSERT…SELECT
 *  keyed on this request's exact shipped_at timestamp (the operation marker).
 *  Zero-row CAS -> re-read and branch per ShipDecision. */
export function shipOrder(
  orderId: string,
  input: ShipmentInput,
  actor: Actor,
): Promise<ShipOrderResult>;

export type UpdateTrackingResult =
  | { outcome: "updated"; order: Order; eventId: string }
  | { outcome: "not_found" }
  | { outcome: "not_shipped"; status: string };                  // -> 409

/** Requires a full valid pair (carrier + trackingNumber). Guarded on
 *  status='shipped'. Appends tracking_updated with previous/next. */
export function updateTracking(
  orderId: string,
  input: ShipmentInput,
  actor: Actor,
): Promise<UpdateTrackingResult>;

/** Oldest-first fulfillment events for one order. */
export function listOrderEvents(orderId: string): Promise<OrderEventRow[]>;

/** Append-only email audit event writer (used by ticket C). */
export function recordEmailEvent(
  orderId: string,
  type: "shipping_email_sent" | "shipping_email_failed" | "shipping_email_resent",
  actor: Actor,
  details: Record<string, unknown>,
): Promise<string>; // returns event id
```

`Order` = the existing row type from `lib/db/schema/order.ts` /
`lib/types/order.ts`. Timestamps: `new Date().toISOString()`.
DB access: `getDbAsync()` from `lib/db.ts`. Atomicity: `db.batch()` only —
D1 has no `db.transaction()`.

## Shipping email (`lib/utils/email.ts`, ticket C)

```ts
export interface ShippingConfirmationData {
  orderNumber: string;
  customerName: string | null;
  customerEmail: string;
  items: Array<{ name: string; quantity: number }>; // short preview, max 5
  carrier: Carrier | null;
  trackingNumber: string | null;
  trackingUrl: string | null;   // derived via buildTrackingUrl, never stored
  orderStatusUrl: string | null; // account link or guest token link; null omits the button
}

export interface ShippingEmailResult {
  success: boolean;
  error?: string;
}

export function sendShippingConfirmationEmail(
  data: ShippingConfirmationData,
  opts: { idempotencyKey: string },
): Promise<ShippingEmailResult>;
```

- Every interpolation escaped with the existing `escapeHtml`.
- Idempotency keys: initial `shipping-confirmation/<order-id>/initial`;
  resend `shipping-confirmation/<order-id>/resend/<event-id>`.
- Pass the key as Resend's second arg: `resend.emails.send(payload, { idempotencyKey })`.

### B↔C seam: `lib/fulfillment/shipping-email.ts` (ticket C)

Ticket B's ship route returns `email: { attempted: false, success: false }`
via a clearly-marked call to a seam function that ticket C replaces:

```ts
export interface InitialShippingEmailResult {
  attempted: boolean;
  success: boolean;
  error?: string;
  eventId?: string; // shipping_email_sent / shipping_email_failed event
}

/** Builds ShippingConfirmationData from the order (customer email via
 *  getOrderCustomerEmail; tracking link via buildTrackingUrl; status URL =
 *  account link for registered customers, guest token link otherwise, null
 *  when no email resolves -> returns { attempted: false, success: false }),
 *  sends with the `initial` idempotency key, records the
 *  shipping_email_sent/failed event via recordEmailEvent. Never throws. */
export function sendInitialShippingEmail(
  order: Order,
  actor: Actor,
): Promise<InitialShippingEmailResult>;
```

Ticket B creates this file with the stub implementation returning
`{ attempted: false, success: false }` (so B is shippable alone); ticket C
replaces the stub body.

## HTTP wire shapes

### `POST /api/admin/orders/[id]/ship`

Request: `{ "carrier"?: "ups"|"fedex"|"other", "trackingNumber"?: string }`
(both absent = untracked shipment).

`201` (fresh) / `200` (idempotent retry):

```json
{
  "order": { /* updated order row (API projection) */ },
  "tracking": { "carrier": "ups", "trackingNumber": "1Z...", "trackingUrl": "https://..." },
  "email": { "attempted": true, "success": false, "error": "..." },
  "eventId": "uuid"
}
```

Errors: `400 { "error": "..." }`, `404`, `409 { "code": "shipment_conflict" | "not_fulfillable", "status": "...", "paymentStatus": "..." }`.

### `PATCH /api/admin/orders/[id]/tracking`

Request: `{ "carrier": "ups"|"fedex"|"other", "trackingNumber": string }` (both
required). `200 { order, tracking, eventId }`; `409 { "code": "not_shipped", "status": "..." }`.
Never sends email.

### `POST /api/admin/orders/[id]/shipping-email`

Request: `{ "mode": "retry" | "resend" }`.

- `retry`: valid only when no `shipping_email_sent` event exists for the
  order; reuses the `initial` idempotency key.
- `resend`: valid only when a `shipping_email_sent` event exists; mints a new
  event id and `resend/<event-id>` key, records `shipping_email_resent`.
- Mode/history mismatch -> `409 { "code": "wrong_mode" }`. Non-shipped order -> `409 { "code": "not_shipped" }`.
- `200 { "email": { "success": true }, "eventId": "..." }` (email failure is
  `200` with `success: false` + a `shipping_email_failed` event — the HTTP
  call succeeded; the send did not).

### `GET /api/admin/orders/[id]/events`

`200 { "events": [{ "id", "type", "actorType", "actorId", "fromStatus", "toStatus", "details", "createdAt" }] }` — oldest first. Fulfillment events only.

### `GET /api/admin/orders` (ticket D — replaces `GET /api/orders?admin=true` for the queue UI)

Query params: `view=awaiting|shipped|cancelled|all` (default `awaiting`),
`q` (search), `limit` (default 20, max 100), `offset` (default 0).

View predicates (SQL, before pagination):

- `awaiting`: `status='processing' AND payment_status='paid'` — sort `created_at ASC`
- `shipped`: `status IN ('shipped','delivered')` — sort `created_at DESC`
- `cancelled`: `status IN ('cancelled','refunded')` — sort `created_at DESC`
- `all`: everything except unpaid drafts (`NOT (status='pending' AND payment_status!='paid')`) — sort `created_at DESC`

Search `q`: `OR` across order `id` (LIKE), `json_extract(shipping_address,
'$.email')`, `json_extract(extensions, '$.email')`, and the recipient-name
key(s) actually present in the stored `shipping_address` JSON (inspect
`lib/types` for the Address shape before writing the SQL).

`200 { "orders": [...], "total": n, "counts": { "awaiting": n, "shipped": n, "cancelled": n, "all": n } }`

Backing query lives in `lib/fulfillment/queries.ts`:

```ts
export interface AdminOrderQuery {
  view: "awaiting" | "shipped" | "cancelled" | "all";
  q?: string;
  limit: number;
  offset: number;
}
export function queryAdminOrders(
  params: AdminOrderQuery,
): Promise<{ orders: Order[]; total: number; counts: Record<"awaiting"|"shipped"|"cancelled"|"all", number> }>;
```

### Guest status page (ticket E)

URL: `${BASE_URL}/order-status/<orderId>?token=<token>` (`BASE_URL` from
`lib/seo/metadata.ts`). Server component flow: rate-limit by IP via
`enforceRateLimit` + `PUBLIC_RATE_LIMITER` -> load order ->
`getOrderCustomerEmail` -> `verifyOrderStatusToken(token, orderId, email)` ->
render minimal projection. Any failure (rate limit, missing order, no email,
bad token) -> `notFound()`. `noindex` metadata + `referrer: "no-referrer"`.

## Auth

All `/api/admin/orders/*` routes authenticate via the existing
`lib/auth/admin-middleware.ts` helper (same as other `/api/admin/*` routes —
read that file for the exact export). Actor for audit rows: Clerk `userId`
with `type: "admin"`; `ADMIN_VECTORIZE_TOKEN` callers use
`{ type: "service", id: "api-token" }`.

## Ticket F contract (changes to existing code)

- `PUT /api/orders` allowlist: accepts only `notes`, `external_references`,
  `extensions` (merged). Rejects with `400` (message naming the correct
  endpoint): `status`, `tracking_number`, `shipped_at`, `delivered_at`,
  `shipping_method`, any tracking URL. Email-on-status-change block deleted.
- `mergeExtensions` (`lib/utils/order-update-guards.ts`) additionally strips
  client-supplied `carrier` and `trackingUrl` keys (server-owned).
- Legacy `generateOrderStatusUpdateHTML`: every interpolation wrapped in
  `escapeHtml`; the stored-`trackingUrl` link block removed.

## Global constraints (inherited by every plan)

- Tests live under `tests/unit/**` only (CI runs nothing else). Mock the
  model layer with `vi.mock("@/lib/models/…")` — unit tests must not touch
  Cloudflare bindings.
- `npm run lint` and `npx tsc --noEmit` must pass before every commit claim.
- Money: all monetary display/serialization through `lib/money` — never raw
  `*100`/`/100`.
- D1: `db.batch()` for atomic writes; no `db.transaction()`.
- Files kebab-case; components PascalCase; `@/*` path alias.
- Pure modules (`lib/fulfillment/tracking.ts`, `transitions.ts`,
  `lib/order-status/token.ts`, `lib/orders/customer-email.ts`) must import
  nothing from D1/Next/Clerk/Resend.
- Migration files: next free numbers `0022`, `0023`. Never renumber existing
  migrations. D1 LIKE patterns are capped at 50 chars — use `json_extract`,
  not long LIKE guards.
- `ORDER_STATUS_SECRET` typing is hand-added to `cloudflare-env.d.ts` — never
  regenerate that file wholesale.

## Addenda — reconciled decisions from plan review

These were flagged as deviations/clarifications by the per-ticket plans and
are now part of the contract:

- `OrderEventRow` lives in `lib/db/schema/order-events.ts` as
  `typeof orderEvents.$inferSelect` (ticket A exports it; B and C import it).
- `hydrateOrder` in `lib/models/mach/orders.ts` is exported by **ticket B
  Task 1**. A patches its `shipping_carrier` handling; E only verifies.
- `normalizeLegacyCarrier` variant matching: compact-token prefix match
  (`ups`/`unitedparcel` → `ups`; `fedex`/`federalexpress` → `fedex`),
  mirrored exactly in the 0022 SQL with sub-20-char LIKE patterns.
- `CARRIER_LABELS` (display names, incl. `other` → "Carrier") lives in the
  A-owned `lib/fulfillment/types.ts`; ticket E appends it (D also consumes).
- Ticket C additive exports: `buildShippingConfirmationData` and
  `initialShippingEmailKey` in `lib/fulfillment/shipping-email.ts`.
- Resend-mode idempotency: the route mints a UUID **before** sending and uses
  it in the `resend/<uuid>` key; the event's `details` carry
  `{ idempotencyKey, resendOfEventId }`.
- Idempotent `200` ship responses carry `"eventId": null` (the
  `already_shipped` variant has no event).
- `sendInitialShippingEmail` guards internally against non-shipped orders
  (returns `{ attempted: false, success: false }`).
- No-resolvable-email on retry/resend → `200` with `success: false` plus a
  `shipping_email_failed` event (same as a failed send).
- Ticket E additive: `getClientIpFromHeaders` in `lib/rate-limit.ts`
  (server components have headers, not a Request; `getClientIp(req)`
  delegates to it) and `lib/order-status/guest-projection.ts` with
  `buildGuestOrderProjection(order): GuestOrderProjection` (the allowlist as
  a pure, testable function).
- Ticket D additive files: `lib/fulfillment/queue-view.ts` (pure view-models)
  and `components/admin/{MarkShippedModal,EditTrackingModal,QueueOrderRow,OrdersQueueClient,FulfillmentTimeline}.tsx`.
- Ticket D query details: `all`-view predicate NULL-safe via
  `COALESCE(payment_status,'pending')`; `id` tiebreak on both sort orders;
  `counts` scoped by `q` but not by `view`; search input sanitized and capped
  at 40 chars (D1 LIKE limit); recipient search covers `$.recipient` and
  `$.company` (the real MACHAddress keys).
- Ticket F interpretations: refund-owned statuses on PUT move from 422 → 400
  (message still names the refund endpoint); "any tracking URL" =
  `trackingUrl` and `tracking_url` keys; `payment_status` keeps its BMC-140
  logged silent-drop behavior (not a 400).
- `getOrderCustomerEmail` lowercases (needed for stable token signing) — a
  deliberate behavior change vs. the old inline expression in
  `order-confirmation.ts`.
