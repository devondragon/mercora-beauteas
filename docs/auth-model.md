# Authentication Model

Current source of truth for how requests are authorized. (The older [`admin-authentication.md`](admin-authentication.md) is a pre-BeauTeas deep-dive and predates this model.)

Two layers; both **fail closed** (default deny). The prior P0 — unauthenticated order/refund APIs — is **fixed**.

---

## `lib/auth/unified-auth.ts` — order/refund + service auth

**Protects:**
- `POST /api/orders/refund` → `ORDERS_UPDATE`
- the admin path of `GET /api/orders` (`?admin=true`) → `ORDERS_READ`

**Credentials:**

- **API token** via `Authorization: Bearer` or `X-API-Key` — **header-only**, no `?token=` query params. `ADMIN_VECTORIZE_TOKEN` (compared timing-safe) grants `admin:*`; `api_tokens` rows store SHA-256 hashes with per-token permissions + expiry.
- **Clerk session** for the browser admin UI → `isUserAdmin()`, which checks the `admin_users` table or Clerk metadata `role=admin`.

**Dev parity:** any signed-in Clerk user is admin when `NODE_ENV=development`. This is never true in the production Worker.

## `lib/auth/admin-middleware.ts` — `/api/admin/*`

Clerk session (admin check) **or** an `ADMIN_VECTORIZE_TOKEN` header. Dev-only bypass header: `x-dev-admin: mercora-dev-bypass`.

## Token management

`scripts/manage-tokens.ts` — `npm run token:generate | token:list | token:revoke` — mints and revokes scoped `api_tokens` rows for webhooks and automation. Its SHA-256 hashing matches the `unified-auth.ts` verifier.

Never pass a secret as a CLI argument. Store per-environment secrets with `wrangler secret put … --env <env>`; see [`cloudflare-environments.md`](cloudflare-environments.md).

## Guest order status

`lib/order-status/token.ts` mints HMAC tokens signed with `ORDER_STATUS_SECRET` (BMC-216A) so guests can view a shipment without an account. If the secret is unset on an environment, the feature **fails closed** — no token is minted or verified — rather than erroring loudly.
