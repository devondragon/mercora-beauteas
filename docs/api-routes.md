# API Routes (by area)

Current route map. ([`api-architecture.md`](api-architecture.md) is an older, broader design doc.)
Authorization rules live in [`auth-model.md`](auth-model.md).

---

## Public

`/api/categories` · `/api/products` · `/api/products/[id]` · `/api/products/[id]/subscription-plans` · `/api/pages/[slug]` · `/api/validate-discount` · `/api/tax` · `/api/shipping-options` · `/api/email/unsubscribe` (CAN-SPAM opt-out — GET renders a confirm page, POST opts out; BMC-184)

## Orders & payments

- `GET`/`POST /api/orders`
- `GET /api/orders/[id]`
- `POST /api/orders/refund` — authenticated (`ORDERS_UPDATE`). The ledger entry mirrors Stripe's refund status: a delayed payment method (Klarna / Cash App Pay / Amazon Pay) returns `pending`, and the order is **not** cancelled or restocked until `refund.updated` confirms it settled (BMC-224). The response carries `refund.status` so an operator can tell the two apart. A refund Stripe rejects synchronously releases its reservation and returns 502.

  ⚠️ **Because the order stays `processing` + `paid` while a refund is unsettled, `POST /api/admin/orders/[id]/ship` refuses to ship it** — otherwise the goods go out and the refund then succeeds, leaving the customer with both. The guard is a SQL predicate inside the ship CAS (not just a pre-read), so a refund reserving its entry mid-request can't be raced past. The 409 carries `refundPending: true` and an operator-readable `error`.
- `POST /api/payment-intent`

## Subscriptions

- `GET`/`POST /api/subscriptions`
- `POST /api/subscriptions/[id]` — pause / resume / cancel, Clerk user

## Webhooks

`POST /api/webhooks/stripe` — handles `payment_intent`, subscription, invoice, and the refund events below; deduplicated via `processed_webhook_events`.

`charge.refunded` reconciles refunds issued **outside** the app (Stripe Dashboard) into the `orders.extensions.refunds[]` ledger so the over-refund guard can see them (BMC-213). It must also be **subscribed on the Stripe endpoint**, or the handler never runs.

`refund.updated` / `refund.failed` apply a refund's later **transition** (BMC-224). `charge.refunded` fires when a refund is *created* and never re-fires, so BMC-213 records a `pending` ledger entry and withholds cancellation + restock until Stripe confirms the money left — and nothing resumed that. These events do:

- **succeeded** → settle the entry, then apply the held `status: 'cancelled'` / `payment_status: 'refunded'` and the two-phase restock claim. Also sends the customer's "you have been refunded" email if the entry was **app-initiated** — `POST /api/orders/refund` defers that message on an unsettled refund, and this is where it becomes true. Externally-reconciled (Dashboard) refunds have never sent it and still don't.
- **failed / canceled** → release the entry to `failed` so it stops counting toward the over-refund guard, and lower `extensions.stripe_amount_refunded` to the charge's cumulative `amount_refunded` **read back from Stripe**. This is the only place that high-water mark may fall, and it is never inferred — an unreadable charge throws so Stripe redelivers.

`charge.refund.updated` (the legacy name) routes to the same handler, but per Stripe's SDK docs it fires only "on selected payment methods" — **it is not a substitute for subscribing `refund.updated` and `refund.failed`.** Without those two, a delayed refund (Klarna / Cash App Pay / Amazon Pay) stays stuck forever.

A lifecycle event whose refund matches no ledger entry is a deliberate **no-op, never an append**: `charge.refunded` is the authoritative recorder and its entry may legitimately carry no Stripe refund id, so appending would double-count the money.

## Agent

`POST /api/agent-chat` — Chai. See [`ai-chai.md`](ai-chai.md).

## Fulfillment (admin, BMC-226)

| Route | Behaviour |
|---|---|
| `POST /api/admin/orders/[id]/ship` | processing + paid → shipped. 201 fresh · 200 idempotent · 409 `shipment_conflict` \| `not_fulfillable` |
| `PATCH /api/admin/orders/[id]/tracking` | correction on an already-shipped order. 409 `not_shipped` \| `tracking_conflict` |
| `GET /api/admin/orders/[id]/events` | audit log from `order_events` |

Timestamps and tracking URLs are **server-owned** — the request body can never supply a status or a timestamp.

> ✅ **These are the only writer of `shipped`** as of **BMC-230**. The legacy `PUT /api/orders` was reduced to a metadata allowlist (`notes`, `external_references`, merged `extensions`) and now rejects `status` / `tracking_number` / `shipped_at` / `delivered_at` / `shipping_method` / any tracking-URL key with a **400 naming the endpoint above**. It also strips the server-owned keys (`carrier`, `trackingUrl`, `email`, `refunds`, `refunds_version`, `restockedLineKeys`) from the `extensions` merge, merges `external_references` instead of replacing it, re-pins `payment_intent_id` in **both** JSON columns, and sends no email.

Requires migrations `0022` + `0023` on the target environment — see [`database-migrations.md`](database-migrations.md).

## Admin (`/api/admin/*`)

`vectorize` · `analytics/*` · `categories` · `products` · `pages` · `reviews` · `subscriptions` · `knowledge` · `upload-image` · and others.

## MCP server

`GET /api/mcp` (capabilities) · `POST /api/mcp` (tool execution) · `GET /api/mcp/schema` · plus `/api/mcp/tools/*` REST endpoints.

Per-agent API keys + rate limits; persistent sessions carry cart state. Full spec: [`mcp-server-specification.md`](mcp-server-specification.md).

## Rate limiting

`tax`, `validate-discount`, `gift-cards/validate`, `payment-intent` and `shipping-options` sit behind `PUBLIC_RATE_LIMITER`; `agent-chat` behind `AI_RATE_LIMITER`. Enforcement **fails open** when the binding is absent — see [`cloudflare-environments.md`](cloudflare-environments.md).
