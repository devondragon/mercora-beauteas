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

**Dev parity:** any signed-in Clerk user is admin when `NODE_ENV=development` (`components/admin/AdminGuard.tsx`). This is never true in the production Worker — **and never true under `npm run preview:dev` either**, see below.

## `lib/auth/admin-middleware.ts` — `/api/admin/*`

Clerk session (admin check) **or** an `ADMIN_VECTORIZE_TOKEN` header. Dev-only bypass header: `x-dev-admin: mercora-dev-bypass`.

## ⚠️ Neither dev shortcut works under `preview:dev`

There are **two separate** dev shortcuts, and they are easy to conflate:

| Shortcut | Covers | Where |
|---|---|---|
| `x-dev-admin: mercora-dev-bypass` header | `/api/admin/*` routes only | `lib/auth/admin-middleware.ts` |
| Any signed-in Clerk user is admin | the admin **pages** — ignores the header entirely | `components/admin/AdminGuard.tsx` |

Both are gated on `process.env.NODE_ENV === "development"`. `npm run preview:dev` builds through `opennextjs-cloudflare`, which runs `next build` — and that **inlines `NODE_ENV` as `"production"`** into the Worker bundle. So both shortcuts are dead in every local Workers run, including the one you actually test against.

**Practical consequence:** browser QA of `/admin/*` under `preview:dev` needs a real Clerk sign-in plus a real `admin_users` row — the header alone will not get you in, and neither will merely being signed in. On the Clerk dev instance you can sign up with a `…+clerk_test@example.com` address and the fixed verification code `424242`, then insert the matching `admin_users` row into local D1.

## Token management

`scripts/manage-tokens.ts` — `npm run token:generate | token:list | token:revoke` — mints and revokes scoped `api_tokens` rows for webhooks and automation. Its SHA-256 hashing matches the `unified-auth.ts` verifier.

Never pass a secret as a CLI argument. Store per-environment secrets with `wrangler secret put … --env <env>`; see [`cloudflare-environments.md`](cloudflare-environments.md).

## Guest order status

`lib/order-status/token.ts` mints HMAC tokens signed with `ORDER_STATUS_SECRET` (BMC-216A) so guests can view a shipment without an account. If the secret is unset on an environment, the feature **fails closed** — no token is minted or verified — rather than erroring loudly.
