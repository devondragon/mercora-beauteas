# BeauTeas Security Findings — Upstream Provenance (Mercora)

**Question answered:** Which of the 30 findings in [`CLAUDE-REVIEW-20260701.md`](CLAUDE-REVIEW-20260701.md) are inherited from the original **Mercora** project (`https://github.com/russellkmoore/mercora`) vs. introduced by **BeauTeas**?

**Method:** Cloned upstream `russellkmoore/mercora` (HEAD `66f765b`, 2026-03-26) and compared every finding-file against the current BeauTeas working tree — byte-level `diff` of shared files plus targeted checks of each specific vulnerability marker (auth guards, price recompute, session-ownership checks, `dangerouslySetInnerHTML`, header config, etc.).

> **Bottom line:** **25 of 30 findings are inherited from upstream Mercora — including all 10 Criticals.** Only **3** are genuinely BeauTeas-introduced (M5, L3, L7). **2** more are inherited-at-the-core with a BeauTeas-added surface (M3, H6).

---

## Summary

| Classification | Count | Findings |
|---|---|---|
| **Inherited from Mercora** (present & still vulnerable upstream) | 25 | C1–C10, H1–H6, M1, M2, M4, M6, M7, L1, L2, L4, L5, L6 |
| **BeauTeas-introduced** (absent upstream) | 3 | M5, L3, L7 |
| **Mixed** (inherited core + BeauTeas-added surface) | 2 | M3, H6 |

**Every launch-blocking Critical (C1–C10) is inherited from upstream Mercora**, unchanged in substance. BeauTeas added *partial* mitigations around a few (gift-card payment verification and PaymentIntent binding near C4; the "mark orders paid after server-verified payment" fix on order *creation*, though the PUT path in H3 remained unguarded) but did not introduce any of the Critical classes.

---

## Inherited from upstream Mercora

Present in `russellkmoore/mercora` and still vulnerable there. "Byte-identical" means the file matches the current BeauTeas copy exactly.

| # | Finding | Evidence in upstream |
|---|---------|----------------------|
| **C1** | Unauthenticated product CRUD | `app/api/products/route.ts` + `app/api/products/[id]/route.ts` **byte-identical** |
| **C2** | Unauthenticated category CRUD | `app/api/categories/route.ts` + `[id]/route.ts` **byte-identical** |
| **C3** | Unauthenticated promotion/coupon CRUD | `app/api/promotions/route.ts` **byte-identical** |
| **C4** | Client-controlled checkout total | upstream `payment-intent/route.ts` takes `amount` from `req.json()`, validates only `amount > 0`, passes straight to `createPaymentIntent` — no catalog recompute. *(BeauTeas later added a $0.50 floor + gift-card/PI-binding checks — partial guards; the core "trust client price" flaw is inherited.)* |
| **C5** | MCP `place_order` — zero payment verification | upstream `lib/mcp/tools/order.ts` builds `status: 'confirmed'`, `payment_method: request.paymentMethod \|\| 'agent-processed'`, calls `createOrder` — no retrieve/`markOrderPaid` |
| **C6** | MCP session/cart/order hijack | upstream `lib/mcp/tools/cart.ts` calls `getSessionCart(sessionId)` directly with no `session.agentId === auth.agentId` check |
| **C7** | `get_agent_details` leaks session IDs | `lib/mcp/tools/agent.ts` **byte-identical** |
| **C8** | MCP agent-management no authz tier | `lib/mcp/tools/agent.ts` **byte-identical** |
| **C9** | Hardcoded `test-key-123` credential | `migrations/0004_add_mcp_tables.sql` **byte-identical** (contains `test-key-123`) |
| **C10** | Customer PII DB dump in git | `mercora-db-dump.sql` **exists upstream, same ~95 KB** — it is literally the Mercora dump; the filename is the giveaway |
| **H1** | Order IDOR (anonymous PII read) | `app/api/orders/[id]/route.ts` **byte-identical** |
| **H2** | agent-chat unauth + injection + content-gen | upstream has the unused `const { userId } = await auth()`, `isContentGeneration`, and the `Generate ONLY the inner HTML` magic string. Only Volt→Chai rebranding differs |
| **H3** | PUT `/api/orders` sets `payment_status` unchecked | upstream `orders/route.ts` PUT destructures `payment_status` from body and writes it (`...(payment_status && { payment_status })`) with no Stripe re-verification |
| **H4** | MCP API keys stored/compared in plaintext | `lib/mcp/auth.ts` + `lib/db/schema/mcp.ts` **byte-identical** |
| **H5** | Hourly rate limit never incremented | `lib/mcp/auth.ts` **byte-identical** |
| **H6** | Stored XSS (CMS page + admin AI) | `app/[slug]/PageRenderer.tsx:135` `dangerouslySetInnerHTML={{__html: page.content}}` and `app/admin/page.tsx:455` present; `lib/models/pages.ts` **byte-identical** (no sanitization). *(Maintenance-banner sub-vector is BeauTeas-expanded — see Mixed.)* |
| **M1** | `ADMIN_VECTORIZE_TOKEN` in URL query | `app/api/admin/knowledge/route.ts` **byte-identical** |
| **M2** | Service token self-promote to DB admin | `app/api/admin/users/route.ts` **byte-identical**; upstream `admin-middleware.ts` grants the blanket service-token pass |
| **M4** | MCP IDs via `Date.now()`+`Math.random()` | `lib/mcp/auth.ts` + `lib/mcp/context.ts` **byte-identical** |
| **M6** | Public products leak draft/inactive + cost | `app/api/products/route.ts` GET + `lib/models/mach/products.ts` **byte-identical** |
| **M7** | No security headers + stale compat date | upstream `next.config.ts` has perf-only `headers()`; `wrangler.jsonc` `compatibility_date: 2024-12-01` |
| **L1** | Non-constant-time admin token compare | upstream `lib/auth/admin-middleware.ts:31` `if (adminToken && authToken === adminToken)` |
| **L2** | Partial-refund not summed vs prior | upstream `orders/refund/route.ts` checks `refundAmount` only against order total; writes `extensions.refunds[]` without summing |
| **L4** | Verbose admin error messages | admin routes are inherited upstream (`knowledge/route.ts` byte-identical); same unconditional `error.message` pattern |
| **L5** | MCP key lookup not timing-safe | `lib/mcp/auth.ts` **byte-identical** |
| **L6** | Unsanitized filename → R2 key | `app/api/admin/knowledge/route.ts` **byte-identical** |

---

## BeauTeas-introduced (NOT in upstream Mercora)

These files/features do not exist in `russellkmoore/mercora`, so the flaws were added by BeauTeas.

| # | Finding | Why it's new |
|---|---------|--------------|
| **M5** | Subscription SetupIntent ownership not verified | `app/api/subscriptions/` **does not exist upstream** — Stripe subscriptions are a BeauTeas addition |
| **L3** | Webhook dedup read-then-write TOCTOU | the dedup logic (`isWebhookEventProcessed`/`recordWebhookEvent`, backed by `processed_webhook_events` from migration `0007`) is **absent upstream**; the whole Stripe webhook route was heavily rewritten in BeauTeas |
| **L7** | Admin/ETL CLI raw-SQL escaping | `scripts/manage-tokens.ts` + `scripts/enrich-catalog.mjs` are **absent upstream** |

---

## Mixed (inherited core + BeauTeas-added surface)

| # | Finding | Split |
|---|---------|-------|
| **M3** | upload MIME/extension mismatch + no `nosniff` | **Storage-side flaw inherited** — `app/api/admin/upload-image/route.ts` is **byte-identical** upstream. **Serving-side is BeauTeas-added** — `app/media/[...key]/route.ts` (where the missing `X-Content-Type-Options: nosniff` lives) **does not exist upstream**, and neither does the "correct" reference route `app/api/admin/upload/route.ts`. |
| **H6** | Stored XSS — maintenance-banner sub-vector | CMS-page and admin-AI XSS vectors are inherited (see above). The maintenance-mode rendering path was **expanded in BeauTeas's `middleware.ts`** (+45 lines vs upstream), so that particular sub-vector is partly BeauTeas-shaped. |

---

## ⚠️ Upstream exposure worth acting on

`russellkmoore/mercora` is a **public** GitHub repository, and it currently contains:

- **`mercora-db-dump.sql` with real customer PII** (C10) — name, full shipping/billing address, order contents, and a Stripe PaymentIntent identifier.
- The **`test-key-123` MCP credential** (C9) in `migrations/0004_add_mcp_tables.sql`.

Purging these from BeauTeas alone does **not** remove them from the upstream public repo or its git history. If the dump holds real people's data, the **upstream repo owner** should purge the file from history (BFG/`git filter-repo`) and rotate, and treat it as a potential disclosure — it may already be cloned/forked/scraped.

---

## Fix-triage implication

Because ~83% of these findings live in upstream Mercora, most fixes are candidates to be made **upstream and pulled down**, rather than patched only in the BeauTeas fork — otherwise they'll re-appear on the next merge. The clean exceptions (fix only in BeauTeas) are **M5, L3, L7** and the serving-route half of **M3**.

_Generated 2026-07-01 from a diff of `russellkmoore/mercora` @ `66f765b` against the BeauTeas working tree. See [`CLAUDE-REVIEW-20260701.md`](CLAUDE-REVIEW-20260701.md) for the full finding detail and Linear issues BMC-128 – BMC-157._
