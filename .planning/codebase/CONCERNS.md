# Codebase Concerns

**Analysis Date:** 2026-03-04

## Tech Debt

**Authentication Completely Disabled:**
- Issue: The unified auth system in `lib/auth/unified-auth.ts` has `authenticateRequest()` hardcoded to always return `success: true` with full admin permissions (`admin:*`). The function body is a bypass stub that grants universal access to every caller.
- Files: `lib/auth/unified-auth.ts`
- Impact: Every API route that relies on `authenticateRequest()` (orders PUT, refunds, admin vectorize operations) is completely unprotected. Any unauthenticated request gets full admin permissions.
- Fix approach: Re-implement the token-based authentication logic. The function signature and permission constants are already defined -- the actual verification against stored tokens needs to be restored.

**Admin Auth Grants Access to All Authenticated Users in Development:**
- Issue: `checkAdminPermissions()` in `lib/auth/admin-middleware.ts` grants admin access to ANY authenticated Clerk user when `NODE_ENV === "development"` (line 46). The client-side `AdminGuard` component (`components/admin/AdminGuard.tsx`, line 70) does the same. This is not gated behind a feature flag -- it is the default for all dev environments.
- Files: `lib/auth/admin-middleware.ts`, `components/admin/AdminGuard.tsx`
- Impact: In development, any signed-in user has full admin access. If `NODE_ENV` is misconfigured in staging or preview deployments, admin access is wide open.
- Fix approach: Replace `NODE_ENV` checks with an explicit `ENABLE_DEV_ADMIN_BYPASS` environment variable that must be explicitly set, or use a whitelist of developer Clerk user IDs.

**Hardcoded Admin Token in Frontend:**
- Issue: `app/admin/knowledge/KnowledgeManagement.tsx` passes a hardcoded token `"beauteas-admin"` as a query parameter in API calls (lines 323, 368). This is a plaintext credential in committed source code.
- Files: `app/admin/knowledge/KnowledgeManagement.tsx`
- Impact: The token is visible in the git history and client-side JavaScript. Anyone with access to the source or browser devtools can use this token.
- Fix approach: Remove the hardcoded token. Use Clerk session-based authentication for admin API calls from the frontend, matching the pattern used in other admin components.

**Hardcoded Dev Bypass Token:**
- Issue: `lib/auth/admin-middleware.ts` checks for a hardcoded dev bypass token `"mercora-dev-bypass"` (line 18) that can be passed via headers or query params. While gated by `NODE_ENV === "development"`, the token value is in source code.
- Files: `lib/auth/admin-middleware.ts`
- Impact: Low risk in production (gated by NODE_ENV), but the pattern normalizes hardcoded credentials. If NODE_ENV is ever misconfigured, anyone knowing the token string has admin access.
- Fix approach: Move bypass token to environment variable. Add logging/alerting if the bypass is used.

**Duplicate Order Models (Legacy + MACH):**
- Issue: Two parallel order model files exist: `lib/models/order.ts` (legacy, with deprecated functions) and `lib/models/mach/orders.ts` (MACH-compliant). The legacy file defines its own schema AND functions marked as "deprecated - use MACH orders module." Both are imported by `app/api/orders/route.ts` (lines 18-24).
- Files: `lib/models/order.ts`, `lib/models/mach/orders.ts`, `app/api/orders/route.ts`
- Impact: Confusion about which module to use. The legacy functions (`getOrderByIdLegacy`, `updateOrderStatusLegacy`, etc.) are dead code. The orders route imports from both but primarily uses direct Drizzle queries and `lib/models/mach/orders.ts` functions.
- Fix approach: Remove the deprecated functions from `lib/models/order.ts`. Keep only the schema definition and the actively-used exports (`insertOrder`, `getOrdersByCustomerId`). Update all imports to use `lib/models/mach/orders.ts`.

**Outdated AI Persona and Branding Mismatch:**
- Issue: The AI chatbot ("Volt") is characterized as an "outdoor gear expert" with camping/hiking personality across multiple files, but the store is "BeauTeas" -- an organic skincare tea brand. The system prompt in `app/api/agent-chat/route.ts` (line 183) correctly references BeauTeas/skincare, but fallback responses (lines 330-361) reference "outdoor gear," "trail," "camping," and "hiking." The MCP capabilities endpoint (`app/api/mcp/route.ts`, lines 17-24) returns hardcoded outdoor gear categories like "Tents and Shelters" and "Sleeping Systems."
- Files: `app/api/agent-chat/route.ts`, `app/api/mcp/route.ts`, `components/agent/AgentDrawer.tsx`, `app/admin/pages/PageManagement.tsx`
- Impact: Users of the MCP API and the fallback chat responses get outdoor gear terminology for what is a skincare tea store. This is confusing and unprofessional.
- Fix approach: Update all fallback responses, the MCP capabilities response, and the AgentDrawer UI copy to reference skincare tea products and BeauTeas branding.

**Pervasive Use of `any` Type:**
- Issue: Over 100 uses of `any` across application code (excluding generated type definition files). Concentrated in API routes, admin components, and the Stripe integration layer.
- Files: `app/api/orders/route.ts` (lines 192, 304, 341), `app/api/agent-chat/route.ts` (lines 76-77, 102, 107-108), `lib/stripe.ts` (lines 102, 115, 152, 164, 244, 260), `app/admin/page.tsx` (15+ occurrences), `app/api/orders/refund/route.ts` (lines 131-132, 145-146, 158, 167), `lib/ai/config.ts` (lines 106, 109, 118)
- Impact: Loss of type safety, potential runtime errors from unchecked data shapes, harder refactoring. Particularly concerning in payment and order processing code.
- Fix approach: Prioritize typing in payment (`lib/stripe.ts`) and order (`app/api/orders/route.ts`) code first. Create proper interfaces for Cloudflare AI response shapes, Stripe response types, and admin data transfer objects.

**nanoid Imported But Not in Dependencies:**
- Issue: `lib/models/order.ts` (line 4) and `lib/db/schema/reviews.ts` (line 3) import `nanoid`, but it is not listed in `package.json` dependencies or devDependencies.
- Files: `lib/models/order.ts`, `lib/db/schema/reviews.ts`, `package.json`
- Impact: Relies on nanoid being available as a transitive dependency. If the upstream package that provides it changes, builds will break.
- Fix approach: Add `nanoid` to `package.json` dependencies explicitly.

**Empty `response.json` File:**
- Issue: An empty `response.json` file exists at the project root with no content.
- Files: `response.json`
- Impact: Appears to be a debugging artifact. No code references it.
- Fix approach: Delete `response.json` from the repository.

## Known Bugs

**Orders GET Fetches All Orders Then Filters in Memory:**
- Issue: `app/api/orders/route.ts` (lines 72-88) executes `db.select().from(orders)` to fetch ALL orders, then applies filters (customer_id, status, orderId) using JavaScript `.filter()` in memory. Pagination is also done via `.slice()` on the full result set.
- Files: `app/api/orders/route.ts`
- Trigger: Any GET request to `/api/orders`
- Workaround: None -- this is the current implementation.
- Impact: Performance degrades linearly with order count. For a store with thousands of orders, this will cause slow responses and high memory usage on the edge worker.
- Fix: Use Drizzle `.where()` clauses to push filters to the D1 database. Apply `.limit()` and `.offset()` in the query, not in JavaScript.

**Analytics Endpoint Fetches Entire Tables:**
- Issue: `app/api/admin/analytics/route.ts` (lines 128, 158-159) fetches ALL orders, ALL products, and ALL product variants into memory for analysis.
- Files: `app/api/admin/analytics/route.ts`
- Trigger: Any POST or GET request to `/api/admin/analytics`
- Impact: Will hit Cloudflare Workers memory limits or cause timeouts as data grows.
- Fix: Use SQL aggregation queries (`COUNT`, `SUM`, `GROUP BY`) instead of loading entire tables into JavaScript.

**Stripe Webhook Handler Calls Own API via HTTP:**
- Issue: `app/api/webhooks/stripe/route.ts` (lines 119-131) updates order status by making an HTTP `fetch()` call to its own `/api/orders` endpoint, using the webhook secret as an API key. This is a self-referential HTTP call within the same worker.
- Files: `app/api/webhooks/stripe/route.ts`
- Trigger: `payment_intent.succeeded` webhook event
- Impact: Unnecessary latency, potential for infinite loops or edge runtime issues with self-calls, and the auth bypass (using webhook secret as API key) is fragile since unified auth is disabled anyway. The `handlePaymentFailed` function (lines 155-178) has a TODO and does NOT actually update the order status.
- Fix: Import and call `updateOrderStatus()` from `lib/models/mach/orders.ts` directly instead of making an HTTP self-call. Implement the `handlePaymentFailed` logic.

## Security Considerations

**Arbitrary Code Execution via CMS Pages:**
- Risk: `app/[slug]/PageRenderer.tsx` (line 43) evaluates CMS page custom JavaScript dynamically at runtime using unsafe code evaluation patterns. Any admin who can create pages can inject and execute arbitrary code in all visitors' browsers.
- Files: `app/[slug]/PageRenderer.tsx`
- Current mitigation: Only admins can create pages. But admin auth is weakly enforced (see unified auth bypass above).
- Recommendations: Remove dynamic code evaluation entirely. If custom JS is required, use a Content Security Policy (CSP) with a strict nonce, or sandbox the execution in an iframe. At minimum, validate the JS before execution.

**Unsanitized HTML Rendering via CMS Content and AI Output:**
- Risk: `app/[slug]/PageRenderer.tsx` (line 135) renders CMS page content using React's unsafe HTML injection. `app/admin/page.tsx` (line 455) renders AI-generated analytics insights through `marked()` and then injects the resulting HTML unsafely. Neither uses an HTML sanitization library.
- Files: `app/[slug]/PageRenderer.tsx`, `app/admin/page.tsx`
- Current mitigation: CMS content is created by admins. AI output is generated server-side.
- Recommendations: Add DOMPurify or a similar HTML sanitizer before any unsafe HTML rendering. Install and configure a sanitization library for all user-facing HTML injection points.

**XSS via Maintenance Mode Message:**
- Risk: `middleware.ts` (line 148) interpolates `maintenanceMessage` directly into an HTML template string without escaping. The message comes from database settings. If an admin stores HTML/JS in the maintenance message, it will execute in all visitors' browsers.
- Files: `middleware.ts`
- Current mitigation: Only admins can set the maintenance message.
- Recommendations: HTML-escape the `maintenanceMessage` before interpolation. Use a simple escape function for `<`, `>`, `&`, `"`, and `'`.

**Cloudflare Stripe Webhook Verification is a No-Op:**
- Risk: The `CloudflareStripe` class in `lib/stripe.ts` (lines 192-202) has a `webhooks.constructEvent` method that does NOT verify the signature -- it simply parses the JSON payload. The comment says "Basic webhook verification - in production, you'd want more robust verification."
- Files: `lib/stripe.ts`
- Current mitigation: The main webhook handler (`app/api/webhooks/stripe/route.ts`) uses `getStripe()` which returns the regular Stripe SDK with proper verification. However, if `getStripeClient()` returns a `CloudflareStripe` instance (which it does in production per line 229), webhook verification would be bypassed.
- Recommendations: Implement proper HMAC-SHA256 webhook signature verification in the `CloudflareStripe.webhooks.constructEvent` method, or ensure the webhook handler always uses the official Stripe SDK's verification.

**MCP API Key Generation is Weak:**
- Risk: `lib/mcp/auth.ts` (line 189) generates API keys using `Date.now()` and `Math.random()`, which are predictable and not cryptographically secure.
- Files: `lib/mcp/auth.ts`
- Current mitigation: Rate limiting is in place for MCP agents.
- Recommendations: Use `crypto.randomUUID()` or `crypto.getRandomValues()` for API key generation.

**API Keys Accepted via Query Parameters:**
- Risk: Multiple auth functions accept API keys via query parameters (`lib/mcp/auth.ts` line 17, `lib/auth/admin-middleware.ts` line 16). Query parameters appear in server logs, browser history, and referrer headers.
- Files: `lib/mcp/auth.ts`, `lib/auth/admin-middleware.ts`
- Current mitigation: None.
- Recommendations: Remove query parameter authentication. Require API keys only in headers (`Authorization` or `X-Agent-API-Key`).

**Publishable Keys Committed in wrangler.jsonc:**
- Risk: `wrangler.jsonc` contains Clerk and Stripe publishable (test) keys in plaintext (lines 66-67). While publishable keys are designed to be public, committing them alongside database IDs and infrastructure config normalizes credential exposure.
- Files: `wrangler.jsonc`
- Current mitigation: Only test/publishable keys. Secret keys are properly managed via `wrangler secret put`.
- Recommendations: Consider using environment variable references for all keys, even publishable ones, to maintain consistent security practices.

## Performance Bottlenecks

**Full-Table Scans for Filtered Queries:**
- Problem: Multiple API endpoints fetch entire tables and filter in JavaScript rather than using SQL WHERE clauses.
- Files: `app/api/orders/route.ts` (line 72-88), `app/api/admin/analytics/route.ts` (lines 128-159), `app/admin/page.tsx` (lines 156-200)
- Cause: Drizzle queries use `.select().from(table)` without `.where()`, then apply JavaScript `.filter()`.
- Improvement path: Add proper WHERE clauses and SQL aggregation. For the admin dashboard (`app/admin/page.tsx`), the client component fetches the admin API which then loads full tables -- use server-side aggregation queries.

**Agent Chat Makes Two Cloudflare Context Calls:**
- Problem: `app/api/agent-chat/route.ts` calls `getCloudflareContext({ async: true })` twice (lines 106, 262) within a single request.
- Files: `app/api/agent-chat/route.ts`
- Cause: The first call is for vectorize search, the second for AI generation. They were likely written independently.
- Improvement path: Call `getCloudflareContext()` once at the top of the handler and reuse the `env` binding.

**Oversized Admin Components:**
- Problem: Several admin components are extremely large single-file components with mixed concerns (data fetching, state management, rendering, form handling).
- Files: `components/admin/ProductEditor.tsx` (1645 lines), `app/admin/settings/page.tsx` (1135 lines), `app/admin/categories/CategoryManagement.tsx` (1066 lines), `app/admin/pages/PageManagement.tsx` (975 lines), `app/admin/orders/[id]/page.tsx` (952 lines), `app/admin/orders/page.tsx` (842 lines)
- Cause: Monolithic component design without extraction of sub-components or custom hooks.
- Improvement path: Extract reusable sub-components, move data fetching to custom hooks, separate form logic from display logic.

**130+ JSON.parse Calls Across the Codebase:**
- Problem: JSON fields stored as TEXT in D1 require constant JSON.parse() calls throughout the application (130 total occurrences). Many include try/catch for malformed data, adding error-handling overhead.
- Files: Concentrated in `lib/models/mach/products.ts` (28), `lib/db/schema/customer.ts` (12), `lib/db/schema/category.ts` (9), `app/api/orders/route.ts` (9)
- Cause: D1 SQLite stores JSON as TEXT. Drizzle's `{ mode: 'json' }` should handle serialization, but the code often re-parses manually.
- Improvement path: Trust Drizzle's JSON mode handling and remove manual parse/stringify calls. Create a utility function for safe JSON hydration where manual parsing is truly needed.

## Fragile Areas

**Stripe Client Runtime Detection:**
- Files: `lib/stripe.ts` (lines 218-234)
- Why fragile: `getStripeClient()` tries to detect Cloudflare Workers runtime by checking `navigator.userAgent` and the existence of globals (`caches`, `Request`, `Response`). In production (`NODE_ENV === 'production'`), it always returns `CloudflareStripe` regardless of runtime detection. The `CloudflareStripe` class is a partial reimplementation of the Stripe SDK with incomplete webhook verification.
- Safe modification: If changing Stripe integration, test in both local dev (Node.js runtime) and Cloudflare Workers. The refund endpoint (`app/api/orders/refund/route.ts`) uses duck-typing (`'refunds' in stripe`) to determine which client it received.
- Test coverage: No tests exist.

**Order Data Hydration:**
- Files: `app/api/orders/route.ts` (function `hydrateOrder`, lines 402-424), `lib/models/mach/orders.ts` (function `hydrateOrder`, lines 190-220)
- Why fragile: Two separate `hydrateOrder` functions exist with slightly different implementations. Both manually parse JSON fields with `typeof` checks and `JSON.parse`. If the database schema changes or a field format changes, both must be updated independently.
- Safe modification: Consolidate to a single hydration function in `lib/models/mach/orders.ts` and import it everywhere.
- Test coverage: No tests exist.

**Agent Chat Variant Parsing:**
- Files: `app/api/agent-chat/route.ts` (lines 459-541)
- Why fragile: 80+ lines of manual field parsing for product variants with individual try/catch blocks for each field. Uses helper functions defined inline (`parseMoneyField`, `parseInventoryField`) that duplicate logic from the schema layer.
- Safe modification: Use the existing `deserializeProduct` function which already handles variant deserialization. The current inline parsing is a duplication of schema-level logic.
- Test coverage: No tests exist.

## Scaling Limits

**Cloudflare D1 SQLite:**
- Current capacity: D1 has a 10GB database size limit per database. Row size limit of 2MB. Single-region primary with read replicas.
- Limit: Write throughput is limited by single-region primary. Complex queries with JOINs across large tables will be slow.
- Scaling path: For read-heavy workloads, D1's read replicas help. For write-heavy workloads, consider sharding by tenant or moving high-write tables (orders, analytics) to a separate database.

**In-Memory Data Processing:**
- Current capacity: Cloudflare Workers have 128MB memory limit.
- Limit: Full-table fetches (orders, products, variants) will hit memory limits as data grows beyond a few thousand records.
- Scaling path: Push all filtering and aggregation to SQL. Implement cursor-based pagination instead of offset pagination.

## Dependencies at Risk

**@opennextjs/cloudflare (v1.5.1):**
- Risk: Relatively young project bridging Next.js to Cloudflare Workers. API surface may change across versions. The `getCloudflareContext()` function is used throughout the codebase (25+ callsites) -- any breaking change cascades widely.
- Impact: Build and deployment pipeline depends on this adapter. If it breaks or is abandoned, migrating to a different hosting strategy is significant work.
- Migration plan: Keep version pinned. Monitor the OpenNext project for stability. Evaluate native Cloudflare Pages support for Next.js as an alternative.

**nanoid (unlisted transitive dependency):**
- Risk: Used by `lib/models/order.ts` and `lib/db/schema/reviews.ts` but not in `package.json`. Could disappear from transitive dependency tree on any `npm install`.
- Impact: Build failure.
- Migration plan: Add `nanoid` to `package.json` or replace with `crypto.randomUUID()`.

## Missing Critical Features

**No Test Suite:**
- Problem: Zero test files exist in the entire codebase. No unit tests, integration tests, or e2e tests. No test framework is configured (no jest.config, vitest.config, playwright.config, or similar).
- Blocks: Safe refactoring, confident deployments, regression detection, CI/CD quality gates.

**No Rate Limiting on Public API Routes:**
- Problem: Rate limiting exists only for MCP agents (`lib/mcp/auth.ts`). Public-facing endpoints like `/api/agent-chat`, `/api/payment-intent`, `/api/orders` (POST), and `/api/tax` have no rate limiting.
- Blocks: Protection against abuse, DDoS mitigation, cost control for AI inference calls (Cloudflare AI is metered).

**No Input Sanitization Library:**
- Problem: No HTML sanitization library (DOMPurify, sanitize-html) is installed despite multiple instances of unsafe HTML rendering and dynamic code evaluation of CMS content. User-supplied and AI-generated content is rendered without sanitization.
- Blocks: Safe CMS content rendering, protection against stored XSS.

**Webhook Audit Trail Not Implemented:**
- Problem: `app/api/orders/route.ts` (line 372) has a TODO for re-implementing webhook audit trail. Order status changes are logged to console but not persisted. The `order_webhooks` table exists in the schema but is not used by the main order update flow.
- Blocks: Order lifecycle auditing, debugging payment issues, compliance requirements.

## Test Coverage Gaps

**Entire Codebase is Untested:**
- What's not tested: Everything -- API routes, model functions, schema validation, auth middleware, Stripe integration, AI chat, MCP tools, checkout flow, admin operations.
- Files: All files in `app/api/`, `lib/models/`, `lib/auth/`, `lib/stripe.ts`, `lib/mcp/`, `components/`
- Risk: Any change can break existing functionality with no automated detection. The disabled auth system, for example, has no test that would fail when auth is bypassed.
- Priority: High -- this is the single largest risk multiplier in the codebase. Every other concern is harder to fix safely without tests.

---

*Concerns audit: 2026-03-04*
