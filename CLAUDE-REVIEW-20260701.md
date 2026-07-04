# BeauTeas — Security Review (2026-07-01)

**Scope:** Full source-tree security audit of the BeauTeas storefront (Next.js 15 / Cloudflare Workers via OpenNext, Stripe payments, Clerk auth, Cloudflare D1 + Vectorize, MCP agent-commerce server).

**Method:** Six parallel specialist review agents, each covering a slice of the codebase:
1. Payments & webhooks
2. Data-access layer, migrations, secrets/config
3. MCP server
4. Auth / authorization / credential handling
5. Public API surface + Chai AI assistant
6. Admin API surface (`app/api/admin/*`)

A seventh cross-check (OpenAI Codex `gpt-5.5`, `xhigh`, read-only full-tree audit) originally hung mid-run; a **subsequent Codex pass completed** and its unique findings have now been merged in (see `CODEX-REVIEW-202650701.md` for the raw output). Codex independently confirmed the core unauthenticated-mutation, checkout-price, order-IDOR, MCP, and AI-abuse clusters, and surfaced **five new issues not caught by the six agents** — now tracked below as **C10, H6, M5, M6, M7** (all verified against the code before inclusion).

> ⚠️ **Bottom line:** This app is **not safe to expose live** in its current state. There are multiple unauthenticated mutation endpoints (catalog, categories, promotions) and several ways to obtain goods without paying (client-controlled prices, MCP order placement, 100%-off coupons). The prior orders/refund P0 is confirmed fixed, but a new class of the same problem exists elsewhere. On top of that, **real customer PII is sitting in the git repo** (C10). **All CRITICAL items must be closed before DNS cutover / go-live** — and the committed PII dump should be purged from history immediately, independent of the launch timeline.

---

## Severity summary

| # | Severity | Issue | Location |
|---|----------|-------|----------|
| C1 | **Critical** | Unauthenticated product CRUD | `app/api/products/route.ts`, `app/api/products/[id]/route.ts` |
| C2 | **Critical** | Unauthenticated category CRUD | `app/api/categories/route.ts`, `app/api/categories/[id]/route.ts` |
| C3 | **Critical** | Unauthenticated promotion/coupon CRUD (fraud) | `app/api/promotions/route.ts` |
| C4 | **Critical** | Client-controlled checkout total / Stripe charge amount | `app/api/payment-intent/route.ts`, `app/api/orders/route.ts`, `components/checkout/CheckoutClient.tsx` |
| C5 | **Critical** | MCP `place_order` creates "confirmed" orders with zero payment verification | `lib/mcp/tools/order.ts` |
| C6 | **Critical** | MCP session/cart/order hijack — no session-ownership check | `lib/mcp/tools/cart.ts`, `lib/mcp/tools/order.ts`, `app/api/mcp/tools/cart/*` |
| C7 | **Critical** | MCP `get_agent_details` leaks other agents' live session IDs | `lib/mcp/tools/agent.ts` |
| C8 | **Critical** | MCP agent-management has no authorization tier (any key = admin) | `lib/mcp/tools/agent.ts`, `app/api/mcp/tools/agents/*` |
| C9 | **Critical** | Hardcoded prod MCP credential `test-key-123` seeded via migration | `migrations/0004_add_mcp_tables.sql` |
| C10 | **Critical** | Production customer PII (address, order, PaymentIntent) committed to git | `mercora-db-dump.sql` |
| H1 | **High** | IDOR — anonymous read of any order's PII | `app/api/orders/[id]/route.ts` |
| H2 | **High** | `/api/agent-chat` unauth (billed AI abuse) + prompt injection + unguarded content-gen mode | `app/api/agent-chat/route.ts` |
| H3 | **High** | `PUT /api/orders` can set `payment_status: paid` with no Stripe check | `app/api/orders/route.ts` |
| H4 | **High** | MCP API keys stored/compared in plaintext (vs. SHA-256 elsewhere) | `lib/db/schema/mcp.ts`, `lib/mcp/auth.ts` |
| H5 | **High** | MCP hourly rate limit (order bound) checked but never incremented | `lib/mcp/auth.ts` |
| H6 | **High** | Stored XSS — CMS page HTML / AI markdown / maintenance banner rendered via `dangerouslySetInnerHTML` without sanitization (no CSP) | `app/[slug]/PageRenderer.tsx`, `lib/models/pages.ts`, `middleware.ts`, `app/admin/page.tsx` |
| M1 | **Medium** | `ADMIN_VECTORIZE_TOKEN` placed in URL query string on internal fetch (log leak) | `app/api/admin/knowledge/route.ts` |
| M2 | **Medium** | Service token can self-promote arbitrary Clerk user to DB admin | `app/api/admin/users/route.ts`, `lib/auth/admin-middleware.ts` |
| M3 | **Medium** | `upload-image` MIME/extension mismatch, no magic-byte check, no `nosniff` | `app/api/admin/upload-image/route.ts`, `app/media/[...key]/route.ts` |
| M4 | **Medium** | MCP keys/session IDs generated with `Date.now()`+`Math.random()` (not CSPRNG) | `lib/mcp/auth.ts`, `lib/mcp/context.ts` |
| M5 | **Medium** | Subscription creation doesn't verify the SetupIntent/Stripe customer belongs to the current Clerk user | `app/api/subscriptions/route.ts` |
| M6 | **Medium** | Public products API discloses draft/inactive products + `cost`/`barcode`/inventory fields | `app/api/products/route.ts`, `lib/models/mach/products.ts` |
| M7 | **Medium** | No security headers (CSP/HSTS/`nosniff`/`X-Frame-Options`) + stale Workers compat date | `next.config.ts`, `wrangler.jsonc` |
| L1 | **Low** | Non-constant-time comparison of `ADMIN_VECTORIZE_TOKEN` in admin-middleware | `lib/auth/admin-middleware.ts` |
| L2 | **Low** | Partial-refund amount not validated against cumulative prior refunds | `app/api/orders/refund/route.ts` |
| L3 | **Low** | Webhook dedup read-then-write TOCTOU race | `app/api/webhooks/stripe/route.ts` |
| L4 | **Low** | Verbose internal error messages returned unconditionally (admin routes) | `app/api/admin/pages/[id]`, `.../knowledge`, `.../vectorize` |
| L5 | **Low** | MCP API key lookup not timing-safe | `lib/mcp/auth.ts` |
| L6 | **Low** | Unsanitized client `filename` used to build R2 keys (defense-in-depth) | `app/api/admin/knowledge/route.ts` |
| L7 | **Low** | Admin/ETL CLI tools build raw SQL via manual quote-escaping | `scripts/manage-tokens.ts`, `scripts/enrich-catalog.mjs` |

---

## CRITICAL

### C1 — Unauthenticated product CRUD
**Files:** `app/api/products/route.ts` (POST, ~76-111), `app/api/products/[id]/route.ts` (PUT/DELETE, ~28-96)
**Confidence:** 95%

`POST /api/products`, `PUT /api/products/[id]`, and `DELETE /api/products/[id]` have **no authentication or authorization** — no Clerk check, no `ADMIN_VECTORIZE_TOKEN`, no auth helper imported. Any anonymous client can create products, overwrite `name`/`description`/`status`/price on any existing product by ID, or delete products outright. The admin dashboard drives its CRUD through this same public route (`app/admin/page.tsx:148`, `app/admin/categories/[id]/CategoryDetail.tsx:48`), so it is the live write path, not dead code.

```
curl -X DELETE https://beauteas.com/api/products/<id>
curl -X POST https://beauteas.com/api/products -d '{"name":"x","variants":[{"price":{"amount":1}}]}'
```

**Fix:** Gate POST/PUT/DELETE behind `isUserAdmin()` / the same admin-middleware pattern as `/api/admin/*`.

### C2 — Unauthenticated category CRUD
**Files:** `app/api/categories/route.ts` (POST, ~73-104), `app/api/categories/[id]/route.ts` (PUT/DELETE, ~38-119)
**Confidence:** 95%

Same pattern as C1 — no auth on mutating verbs. Admin UI (`app/admin/categories/CategoryManagement.tsx:670`, `components/admin/CategoryPicker.tsx:151`) uses this public route. Anonymous attacker can rename/hide/delete categories or create bogus ones (defacement, SEO/catalog sabotage).

**Fix:** Require admin auth on POST/PUT/DELETE.

### C3 — Unauthenticated promotion/coupon CRUD (fraud)
**File:** `app/api/promotions/route.ts` (GET/POST/PUT/DELETE, ~199-433)
**Confidence:** 95%

No auth anywhere in the file.
- `GET` returns every promotion, including inactive ones and their raw codes (business-sensitive enumeration).
- `POST` lets anyone create an attacker-chosen code, e.g. `{"name":"x","code":"FREEALL","type":"percentage","value":100}` → a 100%-off, unlimited-use code, then redeem it at checkout for free orders.
- `PUT`/`DELETE` let an attacker disable competitor promotions or modify existing ones by ID.

`app/admin/promotions/PromotionManagement.tsx` uses this exact public route, confirming it's the intended-admin path.

**Fix:** Require admin auth on all four verbs; consider moving under `/api/admin/promotions`.

### C4 — Client-controlled checkout total / Stripe charge amount
**Files:** `app/api/payment-intent/route.ts` (~53-166), `app/api/orders/route.ts` (~141-146, 247-267), `components/checkout/CheckoutClient.tsx` (~184-268)
**Confidence:** 90%

The charged amount is entirely client-supplied with **no server-side recomputation from D1 catalog prices**.
- `POST /api/payment-intent` takes `amount` straight from the request body (validated only `>0` and `>=0.5`) and passes it to Stripe.
- `POST /api/orders` takes `body.total_amount` and `body.items[].unit_price` verbatim and stores them. It verifies that a *given* PaymentIntent succeeded and is bound to the order ID (`retrievePaymentIntent`) — but **never** that the PaymentIntent amount matches the real catalog price × quantity.
- `CheckoutClient.tsx` computes subtotal, tax basis, shipping basis, final `amount`, and `unit_price` purely from client-held `item.price`.

**Exploit:** (1) POST `/api/payment-intent` with `amount: 0.50`; (2) pay the $0.50 PI; (3) POST `/api/orders` with the real (expensive) items and `extensions.payment_intent_id` pointing at that PI. Order is marked `paid`/`processing` — arbitrary goods for $0.50.

The gift-card path (`lib/services/gift-card-fulfillment.ts`) already guards exactly this with `verifyPaymentSufficient` and fixed denominations — but that protection is scoped to gift-card line items only; ordinary product lines have no equivalent check anywhere (verified: no `getProductById`/`products` lookup exists in the order or payment-intent routes).

**Fix:** Before creating the PaymentIntent (and again before marking paid), recompute the expected total server-side from `products`/`product_variants` × quantity + server-computed tax/shipping, and reject/clamp if client values don't match within a small tolerance — mirroring the gift-card pattern.

### C5 — MCP `place_order` creates "confirmed" orders with zero payment verification
**File:** `lib/mcp/tools/order.ts` (~78-103)
**Confidence:** 95%

`placeOrder()` builds `orderData` with `status: 'confirmed'` and calls `createOrder(orderData)` directly. No PaymentIntent verification, no `markOrderPaid()`. `request.paymentMethod` defaults to `'agent-processed'` and is accepted as-is. Any agent with a valid API key (including a self-registered one — see C8) can `POST /api/mcp/tools/order/place` and receive a real, DB-persisted "confirmed" order for free.

**Fix:** Require a verified Stripe PaymentIntent (`payments.retrieve` + status check) before `createOrder`, and set status via the same `markOrderPaid` path as storefront checkout — not a hardcoded `'confirmed'`.

### C6 — MCP session/cart/order hijack (no ownership check)
**Files:** `lib/mcp/tools/cart.ts` (addToCart 7-99, updateCart 258-325, getCartEstimate 334-383), `lib/mcp/tools/order.ts` (placeOrder 8-16), `app/api/mcp/tools/cart/*`, `app/api/mcp/route.ts` (71-97)
**Confidence:** 90%

`addToCart`, `updateCart`, `removeFromCart`, `bulkAddToCart`, and `placeOrder` take a client-supplied `session_id` and call `getSessionCart(sessionId)` / `updateSessionCart(...)` directly, with **no check that `session.agentId === auth.agentId`**. (`app/api/mcp/sessions/[sessionId]/route.ts` *does* verify ownership — the tools don't.) `get_cart`/`clear_cart` receive `auth.agentId` but only use it for a cosmetic response field.

**Exploit chain (with C7):** enumerate agents → fetch victim's `sessionId` via `get_agent_details` → call `place_order` with that `session_id` and the attacker's own shipping address → victim's cart ships to the attacker as a "confirmed" (unpaid) order.

**Fix:** In every cart/order tool, resolve `getSession(sessionId)` first and reject with 403 if `session.agentId !== callingAgentId`, exactly as `/sessions/[sessionId]` already does.

### C7 — MCP `get_agent_details` leaks other agents' live session IDs
**File:** `lib/mcp/tools/agent.ts` (getAgentDetails ~253-355, recent_sessions ~290-306)
**Confidence:** 90%

`getAgentDetails(agentId, …)` is callable by any authenticated agent for any `agentId` (no ownership/admin check — see C8) and returns `recent_sessions: [{ sessionId, createdAt, expiresAt, itemsInCart }]` straight from `mcp_sessions`. This directly hands an attacker the `sessionId` values needed for C6 — no brute forcing required.

**Fix:** Require the caller to be the agent itself or hold an explicit admin permission; return counts/aggregates only, never raw session IDs.

### C8 — MCP agent-management has no authorization tier
**Files:** `lib/mcp/tools/agent.ts` (createAgent 60-169, listAgents 171-251, getAgentDetails 253-355, updateAgentStatus 357-440), `app/api/mcp/tools/agents/*`
**Confidence:** 85%

All four agent-management routes only call `authenticateAgent(request)` — the same check any storefront-search/cart call uses — then pass `auth.agentId!` through as `adminAgentId` with no role/permission check. The `permissions` array on `mcpAgents` is written on creation but **never read/enforced anywhere** (`grep permissions` → only serialized/deserialized). Net effect: any agent — including one that just self-registered via `create_agent` (which requires no prior privilege) — can list all agents, fetch any agent's details/sessions (C7), disable any competitor agent (DoS), and mint new agents with arbitrary rate limits.

**Fix:** Introduce and enforce a real permission check (e.g. `admin:agents`) in `authenticateAgent` or a middleware wrapper; gate all four `agents/*` tools behind it.

### C9 — Hardcoded prod MCP credential seeded via migration
**File:** `migrations/0004_add_mcp_tables.sql` (~50-69)
**Confidence:** 90%

The migration does:
```sql
INSERT OR REPLACE INTO mcp_agents (... api_key ...) VALUES
  ('test-agent', ..., 'test-key-123', '["read:products","write:cart","place:orders"]', 1000, 100, 1)
```
`lib/mcp/auth.ts::authenticateAgent()` (29-37) authenticates any request presenting this exact string (plaintext, un-hashed compare) with `isActive=1`. Per CLAUDE.md, all 11 migrations were applied to production `beauteas-db` on 2026-06-29 — so this literal committed credential is **live in prod right now** with `place:orders`/`write:cart` and 1000 rpm / 100 oph limits. Anyone with repo (or migration-history) read access has a working prod key.

**Fix:** Immediately deactivate/delete the row in prod D1 (`UPDATE mcp_agents SET is_active=0 WHERE agent_id='test-agent'`), rotate dependent tooling to a freshly generated key, and stop seeding test credentials from migrations that run against prod — move to a dev-only seed script (e.g. `data/d1/seed.sql`).

> **Codex cross-check (C9 addendum):** A git-history secret scan also flagged a **real-shaped MCP credential in an older commit**, not just the seeded `test-key-123`. Rotate *all* MCP credentials, not only the seed row, and treat the git history as compromised for MCP keys.

### C10 — Production customer PII committed to git *(new, from Codex)*
**File:** `mercora-db-dump.sql` (git-tracked; ~623 lines, ~95 KB)
**Confidence:** 95% (verified)

A full D1 database dump is **committed to the repo and present in git history** (added in commit `d6a0e2e`, still tracked at HEAD). It contains real customer records — identifiable name, full **shipping + billing address**, order contents/totals, and at least one **Stripe PaymentIntent identifier** (grep confirms 42 `customer`/`address`/`payment_intent`/`email`/`phone` hits). This is production/real personal data living in source control; anyone with repo or git-history read access (or a fork/clone made before removal) has it. Deleting the file at HEAD is **not sufficient** — it remains recoverable from history.

**Fix:** Remove `mercora-db-dump.sql` from the working tree **and purge it from history** (`git filter-repo`/BFG), then force-push and rotate. Assess repo visibility + access logs to gauge exposure, notify the affected individual(s) if disclosure obligations apply, and revoke/rotate any identifiers referenced in the dump (e.g. invalidate the leaked PaymentIntent's context). Add `*.sql` dumps (or at least `mercora-db-dump.sql` and `scripts/db-dump.mjs` output) to `.gitignore` so re-commits can't happen. **Treat as a data-breach candidate, not just a code smell.**

---

## HIGH

### H1 — IDOR: anonymous read of any order's PII
**File:** `app/api/orders/[id]/route.ts` (~32-49)
**Confidence:** 75%

Ownership check is `if (order.customer_id && userId && order.customer_id !== userId) return 403`. This only blocks the case where the order has an owner *and* the requester is a *different authenticated* user. An unauthenticated request (`userId` is `null`) short-circuits the check to `false` and receives the full order — shipping/billing address, items, totals, `payment_status`, tracking. Order IDs are `WEB-<USER>-<timestamp_ms>` / `WEB-GUEST-<timestamp_ms>` (`app/api/orders/route.ts:154-180`), so they're guessable/enumerable by timestamp — no random token protects them.

**Fix:** Require authenticated owner (`userId === order.customer_id`) or admin for all non-null-customer orders; reject anonymous requests unless the order is a guest order proven via a signed order-access token issued at checkout (not the raw sequential ID).

### H2 — `/api/agent-chat`: unauth + prompt injection + unguarded content-gen mode
**File:** `app/api/agent-chat/route.ts` (~69-80, 198-206, 254-256, 297-305)
**Confidence:** 70-75%

- **No auth gate:** `const { userId } = await auth();` is called but never checked — no `if (!userId) return 401`. The JSDoc/CLAUDE.md call this "Clerk-authenticated," but any anonymous visitor can invoke it, triggering billed Workers AI + Vectorize calls (cost-abuse / resource exhaustion, no identity accountability).
- **Prompt injection:** `orders` and `userContext` come straight from the request body and are spliced verbatim into the system prompt ("Customer Profile: ${userContext}", "Purchase History: ..."). An attacker can inject overriding instructions (false health/medical claims about products, off-brand output) — a liability risk for a skincare storefront.
- **Privileged mode via magic string:** `isContentGeneration = userContext === 'content-generation' || question.includes('Generate ONLY the inner HTML') || ...` switches to an unrestricted "professional content writer" prompt meant only for the admin CMS tool. With no auth and selection by request-body string, any anonymous caller can invoke free-form HTML generation off the site's AI account.

**Fix:** Decide whether the route is public (update docs) or add `if (!userId) return 401`; add per-IP/session rate limiting. Never interpolate raw client strings into the system prompt — pass them as clearly-delimited, escaped untrusted-data blocks, or drop client-supplied `orders`/`userContext` and fetch order history server-side by `userId`. Gate `content-generation` behind admin auth, ideally under `/api/admin/*`.

> **Codex cross-check (H2 addendum):** Codex also flagged that the endpoint enforces **no input-size bounds** on the prompt or chat history — even authenticated, an oversized `question`/history payload drives unbounded Workers AI + Vectorize token spend. Add a max-length cap on `question` and a cap on the number/size of history messages alongside the auth + rate-limit fix.

### H3 — `PUT /api/orders` can set `payment_status: paid` with no Stripe check
**File:** `app/api/orders/route.ts` (~380-447, updateData 430-441)
**Confidence:** 60%

Unlike order creation (which now verifies via `retrievePaymentIntent` before marking paid), this endpoint takes `payment_status`/`status` straight from the request body and writes them unconditionally. Any credential scoped only to `orders:update` (intended per CLAUDE.md for "webhooks/automation," not full admin) can flip an unpaid order to `paid`/`delivered`, or mark someone else's order `refunded`/`cancelled`, with zero linkage to a Stripe event. This reintroduces the class of bug the recent "mark orders paid after server-verified payment" fix addressed, via the admin PUT path.

**Fix:** For `payment_status → paid`, require server-side re-verification against Stripe (same `retrievePaymentIntent` pattern), or restrict this field to webhook/order-creation code paths only.

### H4 — MCP API keys stored/compared in plaintext
**Files:** `lib/db/schema/mcp.ts` (~20), `lib/mcp/auth.ts` (29-37, 163-186)
**Confidence:** 80%

`mcpAgents.apiKey` is a plain `text` column; `createAgent()` writes the raw generated key directly, and `authenticateAgent()` does a plaintext equality match. This is inconsistent with `apiTokens.tokenHash` (SHA-256) used everywhere else (`lib/models/auth.ts`, `scripts/manage-tokens.ts`). Any D1 read (backup export, `wrangler d1 export`, admin-panel data leak) exposes usable, unexpired agent credentials directly.

**Fix:** Store only a SHA-256 hash of the key (mirroring `unified-auth.ts`), compare hashes on auth, and generate with `crypto.getRandomValues`/`randomBytes` (see M4).

### H5 — MCP hourly rate limit checked but never incremented
**File:** `lib/mcp/auth.ts` (checkRateLimit 78-140, updateRateLimit 142-161)
**Confidence:** 80%

`checkRateLimit` reads `window: 'hour'` rows and rejects if `count >= ophLimit`, but the only write path, `updateRateLimit(...)`, is called solely with `window: 'minute'`. No code ever writes a `window: 'hour'` row, so `hourUsage` is always empty and `ophLimit` (default 10 ops/hour, meant to bound order placement) never trips. Combined with C5/C8, an agent can place unlimited free orders per hour.

**Fix:** Also call `updateRateLimit(agentId, 'hour', hourStart.toISOString())`; consider scoping the hourly counter to order-placement calls specifically.

### H6 — Stored XSS via unsanitized HTML rendered with `dangerouslySetInnerHTML` *(new, from Codex)*
**Files:** `app/[slug]/PageRenderer.tsx` (~138), `lib/models/pages.ts` (~151), `middleware.ts` (~88, maintenance banner), `app/admin/page.tsx` (~455)
**Confidence:** 75% (paths verified; exploitability depends on who can write content)

CMS page HTML is stored without authoritative server-side sanitization (`lib/models/pages.ts`) and rendered raw: `PageRenderer.tsx:138` does `dangerouslySetInnerHTML={{ __html: page.content }}`. The maintenance-mode message (`middleware.ts`) and AI-generated markdown/HTML in the admin dashboard (`app/admin/page.tsx:455`) are likewise rendered unescaped. With **no Content-Security-Policy** (see M7) to blunt impact, any HTML that reaches these fields — via a compromised/over-privileged admin, the unauthenticated content-gen path (H2), or the unauthenticated CMS write surface — executes in visitors' browsers under the `beauteas.com` origin (session theft, admin-action forgery). *(Note: the blog JSON-LD `dangerouslySetInnerHTML` in `app/blog/[slug]/page.tsx:85` escapes `<` and is not affected; `components/blog/BlogPostContent.tsx:26` renders `html` and should be checked for its source.)*

**Fix:** Sanitize on the write path (server-side allowlist sanitizer, e.g. DOMPurify/`sanitize-html`, before persisting page/blog content) and/or on render; add a restrictive CSP (M7) as defense-in-depth; ensure the maintenance message is plain-text-escaped, not raw HTML.

---

## MEDIUM

### M1 — `ADMIN_VECTORIZE_TOKEN` in URL query string (log leak)
**File:** `app/api/admin/knowledge/route.ts` (~138-149, 201-212)
**Confidence:** 70%

POST and DELETE handlers do `vectorizeUrl.searchParams.set('token', adminToken); await fetch(vectorizeUrl.toString())`. This contradicts the explicit `extractToken()` design comment ("Deliberately does NOT accept `?token=`… tokens in URLs leak into logs, history, Referer"). Workers observability is enabled, so the outgoing fetch URL — containing the full `admin:*` secret in plaintext — is a candidate for capture in `wrangler tail`/Workers Logs. Anyone with log read access recovers the token and can use it (via header) against every admin endpoint and orders refund/update. (Bonus: `checkAdminPermissions()` never reads `?token=`, so the call also silently 401s — the secret leaks for no functional benefit.)

**Fix:** Send via `Authorization: Bearer <adminToken>` header (or call the vectorize logic in-process).

### M2 — Service token can self-promote an arbitrary Clerk user to DB admin
**Files:** `app/api/admin/users/route.ts` (POST ~29-77), `lib/auth/admin-middleware.ts` (~28-35)
**Confidence:** 70%

`checkAdminPermissions` treats the `ADMIN_VECTORIZE_TOKEN` credential (`userId: "admin-service"`) as a fully-verified human admin — a blanket pass, not scoped to `admin:vectorize`. `users/route.ts` POST does no additional check before `addAdminUser({ userId, role: 'admin' })`. So anyone who obtains this one token (see M1 for how it can leak) plus a known Clerk user ID (trivially their own) can insert a persistent `admin_users` row, gaining browser-session admin access that outlives and exceeds the token's intended scope.

**Fix:** Give the service token a narrow scope (e.g. `admin:vectorize`); reject `admin_users` mutations unless the caller authenticated via a Clerk session with a DB-verified admin role.

### M3 — `upload-image` MIME/extension mismatch, no magic-byte check, no `nosniff`
**Files:** `app/api/admin/upload-image/route.ts` (validation ~50-70, upload ~84-95), `app/media/[...key]/route.ts` (~40-46)
**Confidence:** 55%

Validation checks `file.type` (attacker-supplied multipart header) against an image allowlist, but the stored extension comes from `file.name.split('.').pop()` (a separate attacker-controlled field), with no magic-byte verification. A caller holding any admin credential (including the M2 service token) can submit `file.type="image/png"` with `file.name="payload.svg"` and arbitrary bytes; it's stored as `products/xxx.svg` with `Content-Type: image/png`. `app/media/[...key]/route.ts` serves it back via `object.writeHttpMetadata(headers)` with no `X-Content-Type-Options: nosniff`. Script-execution risk in modern browsers is limited, but it lets a privileged caller host arbitrary bytes under the trusted `beauteas.com`/`img.beauteas.com` origin. (`app/api/admin/upload/route.ts` does this correctly — extension derived from validated MIME via `EXT_BY_MIME[file.type]`.)

**Fix:** Derive the stored extension/content-type from validated `file.type` (like `upload/route.ts`); add a magic-byte check; add `X-Content-Type-Options: nosniff` in `app/media/[...key]/route.ts`.

> **Codex cross-check (M3 note):** Codex flagged the same class but pointed at `app/api/admin/upload/route.ts:43`; this review found *that* route derives the extension from validated MIME (correct) and identifies `upload-image/route.ts` as the actually-vulnerable one. Either way both agree the shared media route (`app/media/[...key]/route.ts`) lacks `nosniff` — fix that regardless.

### M4 — MCP keys/session IDs generated with `Date.now()` + `Math.random()`
**Files:** `lib/mcp/auth.ts` (generateApiKey ~188-190), `lib/mcp/context.ts` (createAgentSessionId ~76-78)
**Confidence:** 65%

`generateApiKey()` → `mcp_${Date.now()}_${Math.random().toString(36).substring(2,15)}`; `createAgentSessionId()` → `${agentId}_${Date.now()}_${Math.random().toString(36).substring(2,8)}` (~31 bits of entropy on the suffix). `Math.random()` is not a CSPRNG. Combined with `createdAt` timestamps exposed via `list_agents`/`get_agent_details`, the timestamp search space for predicting a key/session ID is narrowed considerably.

**Fix:** Use `crypto.getRandomValues`/`crypto.randomUUID()` (available in the Workers runtime) for both.

### M5 — Subscription creation doesn't verify SetupIntent/customer ownership *(new, from Codex)*
**File:** `app/api/subscriptions/route.ts` (~55-140)
**Confidence:** 75% (verified)

`POST /api/subscriptions` authenticates the Clerk `userId`, but the `setupIntentId` is taken **verbatim from the request body**. The route does `stripe.setupIntents.retrieve(setupIntentId)` and then `stripe.subscriptions.create({ customer: stripeCustomerId, default_payment_method: paymentMethodId, ... })` using the customer/payment-method pulled *from that SetupIntent* — with **no check that the SetupIntent's customer belongs to the calling `userId`** (the D1 `customer_id`/Clerk↔Stripe mapping is only written into `metadata` afterward, never validated against the retrieved intent). An attacker who learns or guesses another user's `seti_…` ID can create a subscription billed to that victim's payment method / Stripe customer.

**Fix:** Before creating the subscription, resolve the caller's own Stripe customer ID from your Clerk↔Stripe mapping and assert `setupIntent.customer === <caller's stripe customer>` (and/or verify `setupIntent.metadata.customer_id === userId`); reject on mismatch. Don't trust the customer embedded in a client-supplied SetupIntent.

### M6 — Public products API discloses draft/inactive products and internal fields *(new, from Codex)*
**Files:** `app/api/products/route.ts` (GET ~17-40), `lib/models/mach/products.ts` (`listProducts` ~385+)
**Confidence:** 80% (verified)

`GET /api/products` is unauthenticated and passes a client-controlled `?status=` straight into `listProducts({ status })`, so `?status=draft` (or `inactive`/`archived`) returns not-yet-published products to anyone. Worse, `listProducts` does `db.select().from(products)` and returns full deserialized rows — including internal-only fields such as **cost, barcode, and inventory** — with no field projection. Competitors/scrapers can enumerate unreleased SKUs, margins, and stock levels.

**Fix:** For unauthenticated callers, force `status: ['active']` (ignore/deny client-supplied non-active statuses unless an admin), and project the public response to storefront-safe fields only — strip `cost`, `barcode`, and raw inventory from the public payload.

### M7 — Missing security headers + stale Workers compatibility date *(new, from Codex)*
**Files:** `next.config.ts` (`headers()` ~47-90), `wrangler.jsonc` (`compatibility_date` ~19)
**Confidence:** 70% (verified)

`next.config.ts` defines a `headers()` block but sets only performance hints (`X-DNS-Prefetch-Control`, `X-Resource-Hint-Control`, static-asset caching). There is **no `Content-Security-Policy`, `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `X-Frame-Options`/frame-ancestors, `Referrer-Policy`, or `Permissions-Policy`.** Absent CSP directly amplifies H6 (stored XSS) and M3 (content-type sniffing); no `X-Frame-Options` leaves the admin UI clickjackable. Separately, the Workers `compatibility_date` is `2024-12-01` — Cloudflare recommends advancing it periodically to pick up runtime fixes.

**Fix:** Add the full security-header set (CSP tuned to the app's script/style origins, HSTS, `nosniff`, frame-ancestors/`X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`) via `headers()` or middleware; bump `compatibility_date` after a preview smoke test.

---

## LOW

### L1 — Non-constant-time comparison of `ADMIN_VECTORIZE_TOKEN` (admin-middleware)
**File:** `lib/auth/admin-middleware.ts` (~32) — Confidence 75%

`if (adminToken && authToken === adminToken)` uses plain JS string equality, unlike the timing-safe hash-and-XOR compare in `unified-auth.ts` for the same secret. All 24 `/api/admin/*` routes gate through this. Practical remote exploitability is low (TLS jitter dominates), but the impact of full compromise (`admin:*` everywhere) and the inconsistency with CLAUDE.md's "timing-safe" claim make it worth fixing.
**Fix:** Reuse `timingSafeEqual()` from `unified-auth.ts`.

### L2 — Partial-refund amount not validated against cumulative prior refunds
**File:** `app/api/orders/refund/route.ts` (~111-123) — Confidence 55%

For `type === 'partial'`, `refundAmount = amount!` is checked only against the order total, not against amounts already refunded. The `extensions.refunds[]` audit array is written but never summed. Stripe's own `refunds.create` will reject over-refunds, so this isn't independently exploitable, but the app has no defense-in-depth check and surfaces a raw Stripe error instead of a clean 400.
**Fix:** Sum `extensions.refunds[].amount` and validate `sum(existing) + refundAmount <= total` before calling Stripe.

### L3 — Webhook dedup read-then-write TOCTOU
**File:** `app/api/webhooks/stripe/route.ts` (~81-91, 139-140) — Confidence 55%

`isWebhookEventProcessed(event.id)` is checked (step 4) but `recordWebhookEvent(...)` only runs after the handler completes (step 7). Two concurrent deliveries of the same event could both pass the duplicate check before either inserts. Not currently exploitable for double-crediting — `processed_webhook_events.event_id` is a PK (second insert fails) and the side effects (`markOrderPaid`, gift-card fulfillment) are independently idempotent — but it's a latent race relying on downstream idempotency.
**Fix:** Make the PK insert the dedup gate — attempt `recordWebhookEvent` first and catch the unique-constraint violation as "duplicate, skip."

### L4 — Verbose internal errors returned unconditionally (admin routes)
**Files:** `app/api/admin/pages/[id]/route.ts` (~177-186), `.../knowledge/route.ts` (~77-87), `.../knowledge/vectorize-status/route.ts` (~59-68), `.../vectorize/route.ts` (~346-349) — Confidence 55%

Several handlers return `error.message`/`String(error)` directly regardless of `NODE_ENV`. Admin-gated, so impact is info disclosure to an already-privileged caller (including the lower-trust service token), but can surface DB/driver internals. Inconsistent with the dev-only gating in `generate-product-description`/`generate-article`.
**Fix:** Gate `details`/raw error fields behind `NODE_ENV === 'development'` consistently.

### L5 — MCP API key lookup not timing-safe
**File:** `lib/mcp/auth.ts` (~30-37) — Confidence 55%

`authenticateAgent` does `eq(mcpAgents.apiKey, apiKey)` — a plain DB equality query, no constant-time compare, unlike `ADMIN_VECTORIZE_TOKEN`. Practically a D1 indexed lookup where network jitter dominates, but inconsistent with the codebase's timing-safe pattern.
**Fix:** Compare a SHA-256 hash (as `api_tokens` does) with a constant-time compare (folds into H4).

### L6 — Unsanitized client `filename` used to build R2 keys
**Files:** `app/api/admin/knowledge/route.ts` (~113-115, 187-194), `.../vectorize-status/route.ts` (~22-29) — Confidence 45%

`const key = \`knowledge_md/${mdFilename}\`` uses the raw client-supplied `filename` with no rejection of `/` or `..`. R2 keys are a flat opaque namespace (no path resolution), so `../../products_md/x.md` produces a literal harmless key still prefixed `knowledge_md/` — not a practical traversal today. Worth constraining as defense-in-depth.
**Fix:** Reject filenames containing `/`, `\`, or `..` before building the key.

### L7 — Admin/ETL CLI tools build raw SQL via manual quote-escaping
**Files:** `scripts/manage-tokens.ts` (~82-85, 196-289), `scripts/enrich-catalog.mjs` (~73, 108-151) — Confidence 60%

Both build SQL text with a hand-rolled escaper (`` `'${value.replace(/'/g, "''")}'` ``) passed to `wrangler d1 execute --command` (which doesn't support parameter binding, so this is a reasonable workaround). All current interpolation sites were reviewed — `name` is regex-validated (`^[a-z0-9_]+$`) and every other value passes through the escaper — so **no injection path exists today**. These are operator-only tools (no user input). Flagged only because a future edit forgetting to wrap a new field would silently reintroduce injection.
**Fix:** No urgent action; consider centralizing the escaper or switching to `--file` with parameter-safe templates if these grow.

---

## Confirmed safe / ruled out

- **Prior P0 (unauthenticated orders/refund) is fixed.** `POST /api/orders/refund` and `GET /api/orders?admin=...` both call `authenticateRequest()` and return `authResult.response!` on failure. All 25 admin-adjacent routes check `.success` and return before proceeding.
- **`timingSafeEqual` in `unified-auth.ts` (58-65) is genuinely constant-time** (both sides SHA-256 hashed, accumulating XOR, no early return).
- **Dev bypasses cannot reach prod.** `NODE_ENV` is never set in `wrangler.jsonc`/`.dev.vars`/`.env.local`, and `next build` (via `opennextjs-cloudflare build`, used for both `deploy:dev` and `deploy:production`) forces `NODE_ENV=production` at build time. So the `x-dev-admin` header bypass and the "any signed-in Clerk user is admin" dev-parity branch are dead code in every deployed Worker.
- **All admin routes (`app/api/admin/*`, 22 files) call `checkAdminPermissions()` first** on every verb — no method-specific gaps.
- **No SQL injection** in `lib/models/*`, `lib/models/mach/*`, MCP tools, or admin routes — all use Drizzle's query builder or `sql` tagged-template with bound values. `like()` patterns pass composed strings as single bound parameters (at most benign wildcard-widening).
- **No secrets committed *in config/migrations*.** Prod `vars` hold literal placeholders (`REPLACE_WITH_LIVE_*`); dev `vars` hold publishable (`pk_test_…`) keys, which are designed to be public. Real secrets are `wrangler secret put` only. `.dev.vars` is git-ignored and untracked (only `.env.example` is tracked). No seeded credentials/PII in migrations besides C9. **⚠️ However, customer PII *is* committed outside migrations** — see **C10** (`mercora-db-dump.sql`) — and a real-shaped MCP credential exists in git history (C9 addendum).
- **`scripts/manage-tokens.ts`** stores only SHA-256 hashes; raw token printed once to stdout on `generate` (expected), never logged; `list`/`revoke` show only an 8-char hash prefix. `expires_at` is enforced by default (`allowExpired` never passed true).
- **Webhook signature verification** (`lib/stripe.ts:135-148`) uses the raw `req.text()` body + `constructEventAsync` with the Workers SubtleCrypto provider — no parse-before-verify. The deprecated no-op parser (`lib/stripe.ts:259-270`) is unused by the webhook route.
- **`app/api/account/**`** scopes every read/write by Clerk `userId` (verified down to `updateCustomerAddress`/`removeCustomerAddress`, which check address ownership) — no IDOR.
- **`app/api/gift-cards/validate`** — 12-char, 32-symbol crypto-random codes (~32^12 keyspace), generic error (no enumeration), read-only balance, atomic CAS-guarded redemption in `lib/models/mach/giftCard.ts`.
- **Refund endpoint** derives `payment_intent_id` from the order's own `extensions`, not client input — cannot be pointed at an arbitrary PaymentIntent.
- **MCP capabilities endpoint** (`GET /api/mcp`) requires auth and returns only catalog-derived data; `payment/validate` exposes no Stripe secrets or card data.
- **No card numbers, secret keys, or full PII found in logs** — error logs use PaymentIntent/order IDs and generic messages.
- **`lib/db.ts`** `getDb`/`getDbAsync` wrap `drizzle(env.DB,{schema})` in React `cache()` (per-request scope) — no cross-request leakage.

---

## Recommended remediation order

**Block go-live until these are done (Critical):**
1. Add admin auth to `/api/products`, `/api/categories`, `/api/promotions` mutating verbs (C1, C2, C3). Cheapest, highest impact.
2. Server-side price recomputation for checkout + MCP order placement (C4, C5).
3. Fix MCP authorization: session-ownership checks, agent-management permission tier, stop leaking session IDs (C6, C7, C8).
4. Deactivate/rotate the `test-key-123` prod credential and remove it from the migration (C9); rotate **all** MCP keys (git-history leak per Codex).
5. Purge `mercora-db-dump.sql` from the working tree and git history; treat as a possible PII breach; rotate referenced identifiers; `.gitignore` DB dumps (C10).

**Before or immediately after launch (High):**
5. IDOR fix on `GET /api/orders/[id]` (H1).
6. `/api/agent-chat` auth + prompt-injection hardening + gate content-gen mode + input-size caps (H2).
7. Stripe re-verification on `PUT /api/orders` payment_status (H3).
8. Hash MCP keys + fix hourly rate limit (H4, H5).
9. Sanitize CMS/AI HTML + add CSP to kill stored XSS (H6).

**Hardening pass (Medium/Low):** M1–M7, L1–L7 — includes subscription SetupIntent ownership (M5), public-product field/status leakage (M6), and the full security-header set (M7).

---

## Note on the Codex cross-check

The initial OpenAI Codex (`gpt-5.5`, `xhigh` reasoning, read-only) run hung after ~2 hours, but a **subsequent Codex pass completed** (raw output in `CODEX-REVIEW-202650701.md`). It **independently corroborated** the review's core clusters — unauthenticated product/category/promotion CRUD (C1–C3), client-controlled checkout pricing (C4), order-detail IDOR (H1), the MCP authorization/plaintext-key/rate-limit failures (C6–C8, H4, H5, M4), and the unauthenticated/unbounded AI endpoint (H2) — raising confidence in those findings.

Codex additionally surfaced **five issues the six-agent panel missed**, all verified and now merged above:
- **C10** — production customer PII in a git-committed DB dump (`mercora-db-dump.sql`).
- **H6** — stored XSS via unsanitized CMS/AI HTML rendered with `dangerouslySetInnerHTML`.
- **M5** — subscription creation trusts a client-supplied SetupIntent without ownership verification.
- **M6** — public products API leaks draft/inactive products and cost/barcode/inventory fields.
- **M7** — missing security headers (CSP/HSTS/nosniff/X-Frame-Options) + stale Workers compat date.

It also added detail to existing items: a real-shaped MCP credential in **git history** (C9 addendum — rotate all MCP keys), missing **input-size limits** on `/api/agent-chat` (H2 addendum), and a file-path reconciliation on the upload/MIME issue (M3 note).

Codex verification also reported: TypeScript passed; Vitest 32 tests / 2 files passed; existing tests do **not** cover product/category/promotion authorization, checkout price integrity, order-detail authorization, MCP permissions, or AI-abuse controls (dependency audit was inconclusive — npm advisory endpoint stalled). Between the two independent reviews, cross-check coverage is now considered solid; no further pre-launch audit is required beyond closing the items above.
