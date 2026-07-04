
• ## Security review result

  The application is not safe for production in its current state. I found 2 critical, 6 high, and 4 medium-risk issues. No files were changed.

  ### Critical

  1. Unauthenticated catalog and promotion administration

  clerkMiddleware() runs but never invokes auth.protect(). Middleware alone does not protect routes (Clerk documentation (https://clerk.com/docs/reference/nextjs/clerk-middleware)).

  Anyone can create, modify, or delete products, categories, and promotions—including coupon codes:

  - middleware.ts:66
  - app/api/products/route.ts:76
  - app/api/products/[id]/route.ts:28
  - app/api/categories/route.ts:73
  - app/api/categories/[id]/route.ts:38
  - app/api/promotions/route.ts:223

  Remediation: enforce admin authorization independently inside every mutating handler, then add centralized route protection as defense in depth.

  2. Checkout price manipulation

  POST /api/payment-intent trusts the client’s amount, while order creation trusts client-supplied items and totals. Payment verification checks only that Stripe succeeded and the PaymentIntent’s orderId matches—
  it never checks the captured amount against server-calculated catalog prices.

  An attacker can pay the $0.50 minimum while submitting an expensive physical-goods order that becomes processing/paid.

  - app/api/payment-intent/route.ts:51
  - app/api/payment-intent/route.ts:136
  - app/api/orders/route.ts:215
  - app/api/orders/route.ts:243

  Remediation: accept only product/variant IDs and quantities; load prices, promotions, shipping, tax, and gift-card balances server-side; bind a server-generated checkout record to the PaymentIntent; verify
  currency and amount_received.

  ### High

  3. Unauthenticated order disclosure

  The order-detail authorization condition only rejects a mismatched authenticated user. An unauthenticated request bypasses the condition and receives shipping/billing addresses, items, notes, and payment
  metadata.

  - app/api/orders/[id]/route.ts:32

  Require authentication and enforce order.customer_id === userId, with a separate explicit admin path. Guest orders need a high-entropy capability token rather than order ID alone.

  4. MCP authorization is effectively absent

  MCP keys are stored in plaintext, generated with Math.random(), and accepted through query parameters. Stored permissions are never enforced. Any valid agent can create agents with arbitrary permissions,
  enumerate agents, or disable another agent.

  - lib/mcp/auth.ts:14
  - lib/mcp/auth.ts:163
  - lib/db/schema/mcp.ts:16
  - app/api/mcp/tools/agents/create/route.ts:6
  - app/api/mcp/tools/agents/[agentId]/route.ts:38

  A git-history scan also found a real-shaped MCP credential in an old commit. Rotate all MCP credentials.

  5. MCP session IDOR and broken rate limiting

  Cart/order tools accept arbitrary session_id values without confirming the session belongs to the authenticated agent. Session IDs also use predictable timestamp plus Math.random().

  Rate limiting stops updating after a window changes, and the hourly counter is checked but never incremented.

  - lib/mcp/context.ts:76
  - app/api/mcp/tools/cart/add/route.ts:26
  - lib/mcp/auth.ts:78
  - lib/mcp/auth.ts:142

  6. Public, unbounded AI endpoint

  /api/agent-chat claims Clerk protection and rate limiting, but it rejects neither anonymous users nor oversized prompts/history. Anonymous callers can repeatedly invoke Workers AI and Vectorize, creating cost
  and availability exposure.

  - app/api/agent-chat/route.ts:69

  7. Production customer data committed to git

  mercora-db-dump.sql:63 contains an identifiable customer record, full shipping/billing address, order contents, and PaymentIntent identifier. It exists in git history.

  Remove it from the repository and history, assess repository visibility and access logs, notify the affected person as appropriate, and rotate/revoke associated identifiers where possible.

  8. Stored XSS paths

  CMS page HTML is stored without authoritative sanitization and rendered with dangerouslySetInnerHTML. The maintenance message and AI-generated Markdown are also rendered unsafely. Missing CSP increases impact.

  - app/[slug]/PageRenderer.tsx:135
  - lib/models/pages.ts:151
  - middleware.ts:88
  - app/admin/page.tsx:453

  ### Medium

  - Public product APIs disclose draft/inactive products, cost, barcode, and inventory fields: lib/models/mach/products.ts:386.
  - Subscription creation does not verify that the retrieved SetupIntent/Stripe customer belongs to the current Clerk user: app/api/subscriptions/route.ts:96.
  - Image uploads trust browser-provided MIME types without inspecting file signatures; the same-origin media route lacks nosniff: app/api/admin/upload/route.ts:43, app/media/[...key]/route.ts:40.
  - Security headers are absent, and the Workers compatibility date is from 2024: next.config.ts:46, wrangler.jsonc:19. Add CSP, HSTS, X-Content-Type-Options, Referrer-Policy, Permissions-Policy, and clickjacking
	protection. Cloudflare also recommends periodically updating the compatibility date (Workers best practices (https://developers.cloudflare.com/workers/best-practices/workers-best-practices/)).

  ### Verification

  - TypeScript: passed.
  - Vitest: 32 tests passed across 2 files.
  - Git-history secret scan: completed with redaction; historical MCP credential requires rotation.
  - Production dependency audit: inconclusive because npm’s advisory endpoint stalled twice.
  - Existing tests do not cover product/category/promotion authorization, checkout price integrity, order-detail authorization, MCP permissions, or AI abuse controls.

  Immediate priority: close the unauthenticated mutation routes, fix server-side pricing, block order disclosure, disable or isolate MCP, and purge the database dump before another deployment.