# External Integrations

**Analysis Date:** 2026-03-04

## APIs & External Services

**Stripe (Payment Processing):**
- Purpose: Checkout payments, tax calculation, refunds, webhook event handling
- SDK/Client (server): `stripe` v18.4.0 - standard Node.js SDK + custom `CloudflareStripe` fetch-based client for Workers compatibility
- SDK/Client (client): `@stripe/stripe-js` v7.8.0 + `@stripe/react-stripe-js` v3.9.0
- Configuration: `lib/stripe.ts`
- Auth env vars: `STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`
- API version: `2025-08-27.basil` (standard SDK), `2020-08-27` (CloudflareStripe fallback)
- Runtime detection: `getStripeClient()` in `lib/stripe.ts` auto-selects between Node SDK and CloudflareStripe based on runtime environment
- Currency: USD only, amounts in cents
- Features used: Payment Intents, Tax Calculations, Webhook Events, Refunds

**Clerk (Authentication):**
- Purpose: User authentication, session management, admin role checking
- SDK: `@clerk/nextjs` v6.25.5, `@clerk/themes` v2.4.0
- Configuration: ClerkProvider in `app/layout.tsx`, middleware in `middleware.ts`
- Auth env vars: `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`
- Middleware: `clerkMiddleware()` wraps all routes (see `middleware.ts`)
- Server auth: `auth()` from `@clerk/nextjs/server` used in `lib/auth/admin-middleware.ts`
- Admin check: Clerk userId checked against `admin_users` DB table via `isUserAdmin()` in `lib/models/admin.ts`
- Session claims: Admin role also checked via `sessionClaims.metadata.role`

**Resend (Transactional Email):**
- Purpose: Order confirmation emails, order status update emails, review reminder emails
- SDK: `resend` v4.8.0
- Configuration: `lib/utils/email.ts`
- Auth env var: `RESEND_API_KEY`
- From address: `BeauTeas<hello@beauteas.com>`
- Email types: Order confirmation, order status updates (processing, shipped, delivered, cancelled, refunded)
- HTML templates: Inline HTML generation in `lib/utils/email.ts` (primary), React Email template in `emails/OrderConfirmation.tsx` (secondary)
- Review reminders: `lib/utils/review-notifications.ts`

**Cloudflare AI (Text Generation & Embeddings):**
- Purpose: AI chat assistant ("Volt"), content generation, product description generation, content moderation, analytics insights
- Access: Cloudflare Workers AI binding (`env.AI`)
- Configuration: `lib/ai/config.ts` (centralized model config)
- Text model: `@cf/openai/gpt-oss-20b` (primary text generation)
- Embedding model: `@cf/baai/bge-base-en-v1.5` (semantic search embeddings)
- Use cases with custom configs:
  - `CHAT`: temperature 0.1, maxTokens 400 - AI assistant responses
  - `ANALYTICS`: temperature 0.2, maxTokens 800 - business analytics
  - `CONTENT_GENERATION`: temperature 0.3, maxTokens 2000 - article generation
  - `MARKETING`: temperature 0.8, maxTokens 800 - product descriptions
  - `MODERATION`: temperature 0, maxTokens 300 - review moderation
  - `GREETING`: temperature 0.1, maxTokens 100 - greeting responses
  - `EMBEDDINGS`: BGE embeddings for vector search
- API endpoints using AI:
  - `app/api/agent-chat/route.ts` - AI chat assistant
  - `app/api/admin/generate-article/route.ts` - Knowledge base article generation
  - `app/api/admin/generate-product-description/route.ts` - Product description generation
  - `app/api/admin/analytics/route.ts` - AI-powered analytics insights
- Moderation: `lib/ai/moderation.ts` - AI + Vectorize combined content moderation for reviews
- Helper: `runAI()` in `lib/ai/config.ts` handles different model response formats (OpenAI vs Llama)
- Response extraction: `extractAIResponse()` handles GPT-OSS-20B structured output and legacy formats

**Cloudflare Vectorize (Vector Search):**
- Purpose: Semantic product search, knowledge base search, content moderation pattern matching
- Access: Cloudflare Workers binding (`env.VECTORIZE`)
- Index names: `beauteas-index-dev` (dev), `beauteas-index` (production)
- Wrangler binding: `VECTORIZE`
- Vectorization endpoint: `app/api/admin/vectorize/route.ts` - bulk vectorizes products and knowledge articles
- Moderation namespace: `moderation` namespace in `lib/ai/moderation.ts` for content safety patterns
- Status check: `app/api/admin/knowledge/vectorize-status/route.ts`

**Cloudflare Image Resizing:**
- Purpose: On-the-fly image optimization, format conversion (WebP/AVIF), responsive sizing
- Configuration: `image-loader.ts` (custom Next.js image loader)
- CDN URL pattern: `https://beauteas-images.beauteas.com/cdn-cgi/image/{params}/{path}`
- Parameters: `width`, `format=auto`, `quality`
- Skipped in development mode (returns raw `src`)
- Used in email templates for optimized image delivery (100px width, quality 80)

## Data Storage

**Databases:**
- Cloudflare D1 (edge-native SQLite)
  - Binding: `DB`
  - Dev database: `beauteas-db-dev`
  - Production database: `beauteas-db`
  - Client: Drizzle ORM via `lib/db.ts`
  - Access patterns:
    - `getDb()` - Synchronous, React `cache()` wrapped, for Server Components
    - `getDbAsync()` - Async, React `cache()` wrapped, for API routes
  - Schema: `lib/db/schema/` (18 schema files)
  - Migrations: `migrations/` (6 migration files, `0001_initial_schema.sql` through `0006_add_review_reminders.sql`)
  - SQL dump: `mercora-db-dump.sql` (reference/seed data)

**Schema entities:**
- `products` + `product_variants` - Product catalog (`lib/db/schema/products.ts`)
- `product_types` - Product type definitions with attributes (`lib/db/schema/product_types.ts`)
- `categories` - Product categories (`lib/db/schema/category.ts`)
- `orders` - Order records (`lib/db/schema/order.ts`)
- `customers` - Customer data (`lib/db/schema/customer.ts`)
- `pricing` - Price management (`lib/db/schema/pricing.ts`)
- `promotions` - Discount/promotion rules (`lib/db/schema/promotions.ts`)
- `inventory` - Stock tracking (`lib/db/schema/inventory.ts`)
- `media` - Media asset metadata (`lib/db/schema/media.ts`)
- `addresses` - Address data (`lib/db/schema/address.ts`)
- `languages` - Localization support (`lib/db/schema/language.ts`)
- `coupon_instances` - Coupon tracking (`lib/db/schema/couponInstance.ts`)
- `pages` - CMS pages (`lib/db/schema/pages.ts`)
- `admin_settings` - Key-value app configuration (`lib/db/schema/settings.ts`)
- `admin_users` - Admin user records (`lib/db/schema/admin_users.ts`)
- `mcpAgents` + `mcpRateLimits` - MCP agent management (`lib/db/schema/mcp.ts`)
- `reviews` - Product reviews and ratings (`lib/db/schema/reviews.ts`)

**File Storage:**
- Cloudflare R2 (S3-compatible object storage)
  - Dev bucket: `beauteas-images-dev`
  - Production bucket: `beauteas-images`
  - Bindings: `MEDIA` (application use), `NEXT_INC_CACHE_R2_BUCKET` (Next.js incremental cache)
  - Utilities: `lib/utils/r2.ts`
  - Folder structure:
    - `products/` - Product images
    - `categories/` - Category images
    - `products_md/` - Product markdown content for vectorization
    - `knowledge_md/` - Knowledge base markdown articles
  - Operations: `uploadToR2()`, `getFromR2()`, `listR2Files()`, `deleteFromR2()`, `uploadMarkdownToR2()`, `uploadImageToR2()`
  - Image upload endpoint: `app/api/admin/upload-image/route.ts`
  - Local seed data: `data/r2/` (local copies of R2 content)

**Caching:**
- R2 incremental cache (configured in `open-next.config.ts` via `r2IncrementalCache`)
- React `cache()` for request-level DB connection memoization (`lib/db.ts`)
- Cloudflare CDN caching for static assets (1-year immutable, `next.config.ts` headers)
- localStorage for cart persistence (Zustand persist middleware in `lib/stores/cart-store.ts`)

## Authentication & Identity

**Primary Auth Provider: Clerk**
- Implementation: `@clerk/nextjs` middleware + provider pattern
- Middleware: `middleware.ts` - `clerkMiddleware()` on all non-static routes
- Provider: `ClerkProvider` wraps app in `app/layout.tsx`
- Server auth: `auth()` from `@clerk/nextjs/server`
- Admin check: `lib/auth/admin-middleware.ts` - `checkAdminPermissions()`
  - Checks Clerk session for userId
  - Verifies against `admin_users` DB table
  - Falls back to `sessionClaims.metadata.role === "admin"`
  - Dev mode bypass: `x-dev-admin: mercora-dev-bypass` header or `?dev=mercora-dev-bypass`
  - Service token: `ADMIN_VECTORIZE_TOKEN` env var for server-to-server calls

**API Token Auth (MCP / Internal):**
- Implementation: `lib/auth/unified-auth.ts` - currently DISABLED for development (returns success always)
- MCP Agent auth: `lib/mcp/auth.ts` - API key-based auth with rate limiting
  - Auth header: `X-Agent-API-Key` or `Authorization: Bearer <key>` or `?api_key=<key>`
  - Agents stored in `mcpAgents` D1 table
  - Rate limiting: per-minute and per-hour limits tracked in `mcpRateLimits` table
  - Agent creation: `createAgent()` generates `mcp_<timestamp>_<random>` keys
- Token management scripts: `npm run token:generate`, `npm run token:list`, `npm run token:revoke`

**Permission System:**
- Defined in `lib/auth/unified-auth.ts` (`PERMISSIONS` object):
  - `vectorize:read`, `vectorize:write`
  - `orders:read`, `orders:write`, `orders:update_status`, `orders:update_tracking`
  - `webhooks:receive`
  - `admin:*` (full admin)
- Admin permissions in `lib/auth/admin-middleware.ts` (`ADMIN_PERMISSIONS`):
  - `admin:products`, `admin:orders`, `admin:customers`, `admin:promotions`, `admin:knowledge`, `admin:analytics`, `admin:settings`

## Monitoring & Observability

**Performance Monitoring:**
- Core Web Vitals: `web-vitals` v5.1.0 via `components/analytics/WebVitals.tsx` and `lib/hooks/useWebVitals.ts`
- Vitals endpoint: `app/api/analytics/vitals/route.ts`
- Analytics endpoint: `app/api/analytics/route.ts` (console logging, no external analytics service)
- Performance tracer: `lib/utils/performance-tracer.ts` (custom timing utility for Workers)

**Error Tracking:**
- Console-based logging only (no external error tracking service like Sentry)
- MCP error handler: `lib/mcp/error-handler.ts` (structured error classes)

**Cloudflare Observability:**
- Enabled in `wrangler.jsonc`: `"observability": { "enabled": true }`

**Logs:**
- `console.log` / `console.error` throughout
- Cloudflare Workers logs via wrangler dashboard

## CI/CD & Deployment

**Hosting:**
- Cloudflare Workers (via OpenNext adapter)
- Multi-environment: `dev` and `production` (configured in `wrangler.jsonc`)

**CI Pipeline:**
- GitHub Actions workflows in `.github/workflows/`:
  - `claude-code-review.yml` - Automated code review
  - `claude.yml` - Claude PR assistant

**Deployment:**
- `npm run deploy:dev` - Clean build + deploy to `beauteas-dev` worker
- `npm run deploy:production` - Clean build + deploy to `beauteas` worker
- Uses `opennextjs-cloudflare build && opennextjs-cloudflare deploy --env <env>`

## Environment Configuration

**Required env vars (secrets, set via `wrangler secret put`):**
- `CLERK_SECRET_KEY` - Clerk authentication secret
- `STRIPE_SECRET_KEY` - Stripe payment processing
- `STRIPE_WEBHOOK_SECRET` - Stripe webhook signature verification
- `RESEND_API_KEY` - Resend email service

**Required env vars (public, set in `wrangler.jsonc` vars):**
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` - Clerk client-side auth key
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` - Stripe client-side payment key

**Cloudflare bindings (configured in `wrangler.jsonc`):**
- `DB` - D1 database binding
- `MEDIA` - R2 bucket binding (images/content)
- `NEXT_INC_CACHE_R2_BUCKET` - R2 bucket for Next.js incremental cache
- `VECTORIZE` - Vectorize index binding
- `AI` - Cloudflare AI binding
- `ASSETS` - Static assets binding

**Secrets location:**
- Development: `.env.local` or `.dev.vars` (gitignored)
- Production: Cloudflare Workers secrets (managed via `wrangler secret put`)
- Reference: `.env.example` documents all required variables

## Webhooks & Callbacks

**Incoming:**
- Stripe webhooks: `app/api/webhooks/stripe/route.ts` (POST)
  - `payment_intent.succeeded` - Updates order to "processing" status
  - `payment_intent.payment_failed` - Logs payment failure (TODO: order status update)
  - `checkout.session.completed` - Logs checkout completion (TODO: processing)
  - `invoice.payment_succeeded` - Logs subscription payments (TODO: processing)
  - Signature verification via `stripe.webhooks.constructEvent()`

**Outgoing:**
- None detected

## MCP Server (Model Context Protocol)

**Purpose:** Enables AI agents to interact with the BeauTeas storefront programmatically

**Endpoints:**
- `app/api/mcp/` - MCP server root
- `app/api/mcp/schema/` - Schema discovery
- `app/api/mcp/sessions/` - Session management
- `app/api/mcp/sessions/[sessionId]/` - Session operations
- `app/api/mcp/tools/` - Tool discovery

**Tools (in `app/api/mcp/tools/`):**
- `search/` - Product search
- `recommend/` - Product recommendations
- `assess/` - Requirements assessment
- `cart/` - Cart operations (add, remove, update, clear, bulk-add, estimate)
- `order/` - Order operations (place, status, track)
- `payment/` - Payment validation
- `shipping/` - Shipping options
- `agents/` - Agent management (create, list, get by ID)

**Implementation:**
- Tool logic: `lib/mcp/tools/` (agent.ts, assess.ts, cart.ts, order.ts, payment.ts, recommend.ts, search.ts, shipping.ts)
- Auth: `lib/mcp/auth.ts` - API key auth with rate limiting
- Session: `lib/mcp/session.ts` - Session management
- Context: `lib/mcp/context.ts` - Agent context parsing
- Types: `lib/mcp/types.ts` - Request/response type definitions
- Error handling: `lib/mcp/error-handler.ts` - Structured error classes

**Discovery:**
- HTML meta tags in `app/layout.tsx` for MCP server discovery
- `<link rel="mcp-server" href="/api/mcp" />`
- `<meta name="mcp-capabilities" content="commerce,tea,skincare,organic,e-commerce" />`

---

*Integration audit: 2026-03-04*
