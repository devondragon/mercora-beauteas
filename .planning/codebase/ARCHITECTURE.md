# Architecture

**Analysis Date:** 2026-03-04

## Pattern Overview

**Overall:** Next.js App Router full-stack e-commerce application deployed on Cloudflare Workers via OpenNext. Follows a layered architecture with MACH Alliance-inspired data models, Cloudflare-native services (D1, R2, Vectorize, Workers AI), and a client-side Zustand store for cart state.

**Key Characteristics:**
- Server-first rendering with `force-dynamic` root layout and selective client components (`"use client"`)
- MACH Alliance Open Data Model for product catalog (products, categories, inventory, pricing, promotions)
- Cloudflare edge-native: D1 (SQLite), R2 (object storage), Vectorize (semantic search), Workers AI (LLM + embeddings)
- MCP (Model Context Protocol) server built into the application for AI agent commerce
- Brand-configurable storefront: all brand identity driven by `lib/brand.config.ts`
- Clerk for authentication, Stripe for payments, Resend for transactional email

## Layers

**Presentation Layer (App Router Pages + Components):**
- Purpose: Render storefront UI, admin dashboard, and checkout flow
- Location: `app/` (pages/routes), `components/` (reusable UI)
- Contains: Server Components (pages), Client Components (`"use client"` for interactivity), layouts
- Depends on: Models layer (data fetching), Stores (client state), Brand config
- Used by: End users (storefront), admins (dashboard)

**API Layer (Route Handlers):**
- Purpose: REST API endpoints for CRUD operations, webhooks, AI chat, and MCP tools
- Location: `app/api/`
- Contains: Next.js route handlers (`route.ts` files) with HTTP method exports (GET, POST, PUT, DELETE)
- Depends on: Models layer, Auth layer, Stripe/Resend integrations, AI config
- Used by: Frontend components (fetch calls), MCP agents, Stripe webhooks, external systems

**Models Layer (Business Logic + Data Access):**
- Purpose: Encapsulate all database queries and business logic for domain entities
- Location: `lib/models/` and `lib/models/mach/`
- Contains: CRUD functions per entity (products, orders, categories, etc.), serialization/deserialization
- Depends on: Database layer (`lib/db.ts`), Schema definitions (`lib/db/schema/`)
- Used by: API routes, Server Components, MCP tool implementations

**Schema Layer (Database Schema Definitions):**
- Purpose: Define database table structures with Drizzle ORM
- Location: `lib/db/schema/`
- Contains: Drizzle table definitions, validation helpers, utility functions per entity
- Depends on: Drizzle ORM, TypeScript types
- Used by: Models layer, Database connection module

**Type System:**
- Purpose: Single source of truth for all TypeScript interfaces
- Location: `lib/types/` and `lib/types/mach/`
- Contains: MACH-compliant types (`Product`, `Category`, `Inventory`, etc.) and app-specific types (`Order`, `Cart`, `Review`)
- Depends on: Nothing (leaf dependency)
- Used by: All layers

**State Management (Client-side):**
- Purpose: Manage cart, chat, and UI state on the client
- Location: `lib/stores/`
- Contains: Zustand stores with localStorage persistence
- Depends on: Types
- Used by: Client Components (checkout, cart drawer, agent chat)

**MCP Server Layer:**
- Purpose: Expose commerce tools to AI agents via Model Context Protocol
- Location: `lib/mcp/` (core), `app/api/mcp/` (HTTP endpoints)
- Contains: Tool implementations (search, cart, order, payment, shipping, agent), session management, auth, error handling
- Depends on: Models layer, Auth, Types
- Used by: External AI agents via REST API

**AI/ML Layer:**
- Purpose: Provide AI-powered features (chat assistant, analytics, content generation, moderation)
- Location: `lib/ai/`
- Contains: Model configuration, moderation logic, centralized AI runner
- Depends on: Cloudflare Workers AI bindings
- Used by: Agent chat API, admin analytics, product description generation, review moderation

**Auth Layer:**
- Purpose: Handle authentication for users (Clerk), admins (Clerk + DB), API tokens, and MCP agents
- Location: `lib/auth/`, `middleware.ts`
- Contains: Admin permission checking, unified auth (API tokens), MCP agent auth
- Depends on: Clerk SDK, Database (admin_users table)
- Used by: Middleware, API routes, Admin layout

**Infrastructure/Utilities:**
- Purpose: Shared helpers, integrations, and cross-cutting concerns
- Location: `lib/utils/`, `lib/stripe.ts`, `lib/db.ts`, `lib/brand.config.ts`
- Contains: R2 utilities, email sending, settings access, image placeholders, performance tracing, Stripe client
- Depends on: Cloudflare bindings, external SDKs
- Used by: All layers

## Data Flow

**Storefront Product Browse:**
1. User navigates to `/category/[slug]` or `/product/[slug]`
2. Server Component calls model functions (e.g., `getProductsByCategory()` in `lib/models/mach/products.ts`)
3. Model queries D1 via Drizzle ORM (`lib/db.ts` -> `getDb()`)
4. Product data deserialized from DB JSON columns, images resolved from R2 paths
5. Server-rendered HTML returned with product cards and details

**Checkout Flow:**
1. Client-side cart managed by Zustand store (`lib/stores/cart-store.ts`) persisted in localStorage
2. Checkout page (`app/checkout/page.tsx`) dynamically imports `CheckoutClient` (no SSR)
3. Shipping form -> `POST /api/shipping-options` -> shipping rates returned
4. Tax calculation -> `POST /api/tax` -> Stripe Tax API
5. Payment -> `POST /api/payment-intent` -> Stripe PaymentIntent created
6. Order submission -> `POST /api/orders` -> order stored in D1, confirmation email via Resend
7. Stripe webhook (`/api/webhooks/stripe`) confirms payment status

**AI Agent Chat:**
1. User opens AgentDrawer (client component using `useChatStore`)
2. Message sent to `POST /api/agent-chat`
3. User question vectorized via Cloudflare Vectorize (BGE embeddings) for semantic product search
4. Matching product IDs fetched from D1
5. System prompt + conversation history + product context sent to Workers AI (GPT-OSS-20B)
6. AI response + product recommendations returned to client
7. ProductCard components rendered inline in chat

**MCP Agent Commerce:**
1. External AI agent authenticates via API key/header to `/api/mcp`
2. Agent discovers capabilities via `GET /api/mcp` or `/api/mcp/schema`
3. Agent calls tools via `POST /api/mcp` with `{tool, params, session_id}`
4. MCP route dispatches to tool handler in `lib/mcp/tools/`
5. Tool executes against models layer, returns structured `MCPToolResponse`
6. Individual tool REST endpoints also available at `/api/mcp/tools/[tool]/`

**Admin Dashboard:**
1. Admin navigates to `/admin` -> `AdminGuard` checks auth via `checkAdminPermissions`
2. Dashboard fetches stats from `/api/products` and `/api/orders`
3. AI analytics fetched from `POST /api/admin/analytics` -> Workers AI generates business insights
4. Admin CRUD operations use `/api/admin/*` endpoints with Clerk session auth

**State Management:**
- **Server state:** React `cache()` wraps DB connections for request-level memoization
- **Client cart state:** Zustand with `persist` middleware -> localStorage key `cart-storage`, `skipHydration: true`
- **Client chat state:** Zustand store (`lib/stores/chat-store.ts`) for conversation history
- **Server chat state:** Separate store (`lib/stores/server-chat-store.ts`) for server-side context

## Key Abstractions

**MACH Models (`lib/models/mach/`):**
- Purpose: Implement MACH Alliance Open Data Model for commerce entities
- Examples: `lib/models/mach/products.ts`, `lib/models/mach/category.ts`, `lib/models/mach/orders.ts`, `lib/models/mach/inventory.ts`, `lib/models/mach/promotions.ts`
- Pattern: Each file exports async CRUD functions (e.g., `listProducts`, `getProductBySlug`, `createProduct`, `updateProduct`). Functions use `getDb()` / `getDbAsync()` internally. JSON columns are deserialized into typed objects.

**MACH Types (`lib/types/mach/`):**
- Purpose: TypeScript interfaces matching MACH Alliance specification
- Examples: `lib/types/mach/Product.ts`, `lib/types/mach/Category.ts`, `lib/types/mach/Pricing.ts`, `lib/types/mach/Inventory.ts`
- Pattern: PascalCase files with exported interfaces. Complex nested types for Money, Media, Localized strings.

**Database Schema (`lib/db/schema/`):**
- Purpose: Drizzle ORM table definitions with SQLite column types
- Examples: `lib/db/schema/products.ts`, `lib/db/schema/order.ts`, `lib/db/schema/settings.ts`, `lib/db/schema/reviews.ts`
- Pattern: Export `sqliteTable()` definitions + helper functions (validation, transformation, localization). JSON columns store complex objects as text.

**Brand Config (`lib/brand.config.ts`, `lib/brand/`):**
- Purpose: Centralize all brand identity for easy rebranding of the Mercora platform
- Examples: `lib/brand.config.ts` (config), `lib/brand/BrandProvider.tsx` (React context), `lib/brand/index.ts` (exports)
- Pattern: Single config object exported as `brand`. Client components use `useBrand()` hook. Server components import `brand` directly.

**MCP Tools (`lib/mcp/tools/`):**
- Purpose: Implement individual AI agent commerce capabilities
- Examples: `lib/mcp/tools/search.ts`, `lib/mcp/tools/cart.ts`, `lib/mcp/tools/order.ts`, `lib/mcp/tools/recommend.ts`, `lib/mcp/tools/agent.ts`
- Pattern: Each file exports async tool functions. Functions accept typed request params + session_id, return `MCPToolResponse<T>`. Agent context parsed from headers.

**Cloudflare Stripe Adapter (`lib/stripe.ts`):**
- Purpose: Provide Stripe payment integration compatible with both Node.js and Cloudflare Workers runtime
- Examples: `lib/stripe.ts`
- Pattern: Dual implementation - standard Stripe SDK for Node.js dev, custom `CloudflareStripe` fetch-based client for Workers. `getStripeClient()` auto-selects based on runtime environment.

## Entry Points

**Root Layout (`app/layout.tsx`):**
- Location: `app/layout.tsx`
- Triggers: Every page load
- Responsibilities: Wraps app in ClerkProvider + BrandProvider, renders Header/Footer/PromotionalBanner/Toaster, sets fonts and metadata, MCP server discovery meta tags

**Middleware (`middleware.ts`):**
- Location: `middleware.ts`
- Triggers: Every non-static request (configured via matcher regex)
- Responsibilities: Clerk authentication, maintenance mode check (reads from D1 settings), admin/MCP route bypass

**Home Page (`app/page.tsx`):**
- Location: `app/page.tsx`
- Triggers: Navigation to `/`
- Responsibilities: Hero section, featured products (fetched server-side from `getProductsByCategory("cat_1")`)

**Admin Layout (`app/admin/layout.tsx`):**
- Location: `app/admin/layout.tsx`
- Triggers: Any `/admin/*` route
- Responsibilities: AdminGuard auth check, sidebar navigation, admin header, dark theme

**MCP Discovery (`app/api/mcp/route.ts`):**
- Location: `app/api/mcp/route.ts`
- Triggers: GET (capabilities discovery), POST (tool execution)
- Responsibilities: Agent authentication, tool routing via switch statement, capabilities response

**Stripe Webhook (`app/api/webhooks/stripe/route.ts`):**
- Location: `app/api/webhooks/stripe/route.ts`
- Triggers: Stripe webhook events (payment_intent.succeeded, payment_failed, etc.)
- Responsibilities: Webhook signature verification, payment event processing

## Error Handling

**Strategy:** Try/catch at API route level with console.error logging and JSON error responses. No centralized error boundary or error reporting service.

**Patterns:**
- API routes wrap handler logic in try/catch, return `NextResponse.json({ error: message }, { status: code })`
- MCP tools use dedicated error handler (`lib/mcp/error-handler.ts`) with `createHttpErrorResponse()`
- Models layer throws errors that bubble up to API routes
- Middleware silently catches errors to avoid breaking the site (maintenance mode check)
- Client components use `useState` for error state, display inline error messages
- No global error boundary component detected
- Stripe webhook verifies signatures and returns appropriate HTTP status codes

## Cross-Cutting Concerns

**Logging:** `console.log` / `console.error` throughout. No structured logging framework. Admin auth uses emoji prefixes for dev-mode logs. Performance tracing available via `lib/utils/performance-tracer.ts`.

**Validation:** Minimal validation at API route level (basic null checks). Schema-level validation helpers in `lib/db/schema/` files (e.g., `validateProductType`, `validateAttributeValue`). No request body validation library (no Zod/Yup detected).

**Authentication:** Three systems:
- **User auth:** Clerk middleware (`middleware.ts`) + `@clerk/nextjs` for session management
- **Admin auth:** `lib/auth/admin-middleware.ts` checks Clerk session + `admin_users` DB table (dev mode bypasses with `x-dev-admin` header)
- **API token auth:** `lib/auth/unified-auth.ts` (currently disabled for development - always returns success)
- **MCP agent auth:** `lib/mcp/auth.ts` for AI agent API key validation

**Image Handling:** Custom Next.js image loader (`image-loader.ts`) resolves R2 bucket paths. R2 utilities in `lib/utils/r2.ts` for upload/download operations.

**Email:** Resend SDK (`lib/utils/email.ts`) with React Email templates (`emails/OrderConfirmation.tsx`). Sends order confirmation and status update emails.

**Settings:** Database-stored application settings (`lib/db/schema/settings.ts`) accessed via `lib/utils/settings.ts`. Categories: store, refund, ai, system, social. Used for maintenance mode, refund policies, AI personality, etc.

---

*Architecture analysis: 2026-03-04*
