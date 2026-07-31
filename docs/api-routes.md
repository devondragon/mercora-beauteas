# API Routes (by area)

Current route map. ([`api-architecture.md`](api-architecture.md) is an older, broader design doc.)
Authorization rules live in [`auth-model.md`](auth-model.md).

---

## Public

`/api/categories` · `/api/products` · `/api/products/[id]` · `/api/products/[id]/subscription-plans` · `/api/pages/[slug]` · `/api/validate-discount` · `/api/tax` · `/api/shipping-options` · `/api/email/unsubscribe` (CAN-SPAM opt-out — GET renders a confirm page, POST opts out; BMC-184)

## Orders & payments

- `GET`/`POST /api/orders`
- `GET /api/orders/[id]`
- `POST /api/orders/refund` — authenticated (`ORDERS_UPDATE`)
- `POST /api/payment-intent`

## Subscriptions

- `GET`/`POST /api/subscriptions`
- `POST /api/subscriptions/[id]` — pause / resume / cancel, Clerk user

## Webhooks

`POST /api/webhooks/stripe` — handles `payment_intent`, subscription, invoice, and `charge.refunded`; deduplicated via `processed_webhook_events`.

`charge.refunded` reconciles refunds issued **outside** the app (Stripe Dashboard) into the `orders.extensions.refunds[]` ledger so the over-refund guard can see them (BMC-213). It must also be **subscribed on the Stripe endpoint**, or the handler never runs.

## Agent

`POST /api/agent-chat` — Chai. See [`ai-chai.md`](ai-chai.md).

## Fulfillment (admin, BMC-226)

| Route | Behaviour |
|---|---|
| `POST /api/admin/orders/[id]/ship` | processing + paid → shipped. 201 fresh · 200 idempotent · 409 `shipment_conflict` \| `not_fulfillable` |
| `PATCH /api/admin/orders/[id]/tracking` | correction on an already-shipped order. 409 `not_shipped` \| `tracking_conflict` |
| `GET /api/admin/orders/[id]/events` | audit log from `order_events` |

Timestamps and tracking URLs are **server-owned** — the request body can never supply a status or a timestamp.

> ⚠️ **These are not yet the only writer of `shipped`.** The legacy `PUT /api/orders` still accepts client-supplied `status` / `shipped_at` / `tracking_number`, can ship an unpaid order, and writes no `order_events` row. Closing it is **BMC-230** — until then these routes are the *correct* path, not the *enforced* one.

Requires migrations `0022` + `0023` on the target environment — see [`database-migrations.md`](database-migrations.md).

## Admin (`/api/admin/*`)

`vectorize` · `analytics/*` · `categories` · `products` · `pages` · `reviews` · `subscriptions` · `knowledge` · `upload-image` · and others.

## MCP server

`GET /api/mcp` (capabilities) · `POST /api/mcp` (tool execution) · `GET /api/mcp/schema` · plus `/api/mcp/tools/*` REST endpoints.

Per-agent API keys + rate limits; persistent sessions carry cart state. Full spec: [`mcp-server-specification.md`](mcp-server-specification.md).

## Rate limiting

`tax`, `validate-discount`, `gift-cards/validate`, `payment-intent` and `shipping-options` sit behind `PUBLIC_RATE_LIMITER`; `agent-chat` behind `AI_RATE_LIMITER`. Enforcement **fails open** when the binding is absent — see [`cloudflare-environments.md`](cloudflare-environments.md).
