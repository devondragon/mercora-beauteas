# Codebase Structure

**Analysis Date:** 2026-03-04

## Directory Layout

```
mercora-beauteas/
├── app/                        # Next.js App Router (pages + API routes)
│   ├── layout.tsx              # Root layout (ClerkProvider, BrandProvider, Header/Footer)
│   ├── page.tsx                # Home page (hero + featured products)
│   ├── loading.tsx             # Global loading state
│   ├── globals.css             # Global styles (Tailwind)
│   ├── [slug]/                 # Dynamic CMS pages
│   ├── category/[slug]/        # Category listing pages
│   ├── product/[slug]/         # Product detail pages
│   ├── checkout/               # Checkout flow
│   ├── orders/                 # Order history page
│   ├── admin/                  # Admin dashboard (separate layout)
│   │   ├── layout.tsx          # Admin layout (sidebar, dark theme, AdminGuard)
│   │   ├── page.tsx            # Admin dashboard with AI analytics
│   │   ├── categories/         # Category management
│   │   ├── knowledge/          # Knowledge base management
│   │   ├── orders/             # Order management
│   │   ├── pages/              # CMS page management
│   │   ├── products/           # Product management
│   │   ├── promotions/         # Promotion management
│   │   ├── reviews/            # Review moderation
│   │   └── settings/           # Store settings
│   └── api/                    # API route handlers
│       ├── admin/              # Admin-only API endpoints
│       │   ├── analytics/      # AI-powered business analytics
│       │   ├── auth-check/     # Admin auth verification
│       │   ├── categories/     # Category CRUD + refresh counts
│       │   ├── generate-article/       # AI article generation
│       │   ├── generate-product-description/  # AI product descriptions
│       │   ├── knowledge/      # Knowledge base CRUD + vectorize status
│       │   ├── page-templates/ # CMS page templates
│       │   ├── pages/          # CMS pages CRUD
│       │   ├── reviews/        # Review management + reminders
│       │   ├── settings/       # Store settings CRUD
│       │   ├── upload-image/   # R2 image upload
│       │   ├── users/          # Admin user management
│       │   └── vectorize/      # Vectorize index management
│       ├── agent-chat/         # AI chat assistant endpoint
│       ├── analytics/          # Public analytics + web vitals
│       ├── categories/         # Public category API
│       ├── mcp/                # MCP Server (AI agent commerce)
│       │   ├── route.ts        # Main MCP discovery + tool execution
│       │   ├── schema/         # MCP schema endpoint
│       │   ├── sessions/       # Agent session management
│       │   └── tools/          # Individual tool REST endpoints
│       │       ├── agents/     # Agent CRUD
│       │       ├── assess/     # Fulfillment assessment
│       │       ├── cart/       # Cart operations (add/remove/update/bulk/clear/estimate)
│       │       ├── order/      # Order operations (place/status/track)
│       │       ├── payment/    # Payment validation
│       │       ├── recommend/  # Product recommendations
│       │       ├── search/     # Product search
│       │       └── shipping/   # Shipping options
│       ├── orders/             # Order CRUD + refunds
│       ├── pages/              # Public CMS pages API
│       ├── payment-intent/     # Stripe PaymentIntent creation
│       ├── products/           # Public product API
│       ├── promotions/         # Promotions API
│       ├── shipping-options/   # Shipping rate calculator
│       ├── tax/                # Tax calculation (Stripe Tax)
│       ├── validate-discount/  # Discount code validation
│       └── webhooks/
│           └── stripe/         # Stripe webhook handler
├── components/                 # Reusable React components
│   ├── Breadcrumbs.tsx         # Navigation breadcrumbs
│   ├── ClientOnly.tsx          # Client-only render wrapper
│   ├── Footer.tsx              # Site footer
│   ├── Header.tsx              # Site header (server)
│   ├── HeaderClient.tsx        # Site header (client interactions)
│   ├── OrderCard.tsx           # Order display card
│   ├── ProductCard.tsx         # Product listing card
│   ├── ProductRecommendations.tsx  # Related products section
│   ├── PromotionalBanner.tsx   # Promo banner above header
│   ├── admin/                  # Admin-specific components
│   │   ├── AdminGuard.tsx      # Auth gate for admin routes
│   │   ├── AdminHeader.tsx     # Admin top bar
│   │   ├── AdminLayoutProvider.tsx  # Admin layout state
│   │   ├── AdminSidebar.tsx    # Admin navigation sidebar
│   │   ├── CategoryPicker.tsx  # Category selection widget
│   │   ├── ProductEditor.tsx   # Product edit form
│   │   └── reviews/
│   │       └── ReviewModerationDashboard.tsx
│   ├── agent/                  # AI chat assistant components
│   │   ├── AgentDrawer.tsx     # Chat drawer (main interface)
│   │   └── ProductCard.tsx     # Product card for chat context
│   ├── analytics/
│   │   └── WebVitals.tsx       # Core Web Vitals reporter
│   ├── cart/                   # Shopping cart components
│   │   ├── CartDrawer.tsx      # Slide-out cart panel
│   │   ├── CartHydrationGuard.tsx  # Prevents SSR/client mismatch
│   │   └── CartItemCard.tsx    # Individual cart item display
│   ├── checkout/               # Checkout flow components
│   │   ├── CheckoutClient.tsx  # Main checkout orchestrator
│   │   ├── DiscountCodeInput.tsx
│   │   ├── OrderConfirmationModal.tsx
│   │   ├── OrderItemCard.tsx
│   │   ├── OrderSummary.tsx
│   │   ├── PaymentForm.tsx     # Stripe Elements payment
│   │   ├── ProgressBar.tsx     # Checkout step indicator
│   │   ├── ShippingForm.tsx    # Address collection
│   │   ├── ShippingOptions.tsx # Shipping method selection
│   │   └── StripeProvider.tsx  # Stripe Elements wrapper
│   ├── login/
│   │   └── ClerkLogin.tsx      # Clerk sign-in component
│   ├── reviews/                # Product review components
│   │   ├── ProductReviewsSection.tsx
│   │   ├── ReviewForm.tsx
│   │   └── StarRating.tsx
│   └── ui/                     # shadcn/ui primitives (Radix-based)
│       ├── alert-dialog.tsx
│       ├── badge.tsx
│       ├── button.tsx
│       ├── card.tsx
│       ├── checkbox.tsx
│       ├── dialog.tsx
│       ├── dropdown-menu.tsx
│       ├── input.tsx
│       ├── label.tsx
│       ├── loading.tsx
│       ├── navigation-menu.tsx
│       ├── select.tsx
│       ├── separator.tsx
│       ├── sheet.tsx
│       ├── switch.tsx
│       ├── table.tsx
│       ├── textarea.tsx
│       ├── toggle-group.tsx
│       └── toggle.tsx
├── lib/                        # Shared libraries, models, and utilities
│   ├── db.ts                   # Database connection (D1 + Drizzle + React cache)
│   ├── db/schema/              # Drizzle ORM schema definitions
│   │   ├── index.ts            # Schema barrel export
│   │   ├── products.ts         # Products + variants tables
│   │   ├── category.ts         # Categories table
│   │   ├── order.ts            # Orders table
│   │   ├── settings.ts         # Admin settings table
│   │   ├── reviews.ts          # Reviews + ratings tables
│   │   ├── pages.ts            # CMS pages table
│   │   ├── mcp.ts              # MCP sessions/agents table
│   │   ├── admin_users.ts      # Admin users table
│   │   ├── address.ts          # Address schema
│   │   ├── couponInstance.ts   # Coupon instances
│   │   ├── customer.ts         # Customer entity
│   │   ├── inventory.ts        # Inventory entity
│   │   ├── language.ts         # Localization support
│   │   ├── media.ts            # Media entity
│   │   ├── pricing.ts          # Pricing entity
│   │   ├── product_types.ts    # Product type definitions
│   │   └── promotions.ts       # Promotion entity
│   ├── models/                 # Business logic / data access
│   │   ├── index.ts            # Models barrel export
│   │   ├── admin.ts            # Admin user operations
│   │   ├── auth.ts             # API token operations
│   │   ├── cart.ts             # Cart helper functions
│   │   ├── order.ts            # Order operations (app-specific)
│   │   ├── pages.ts            # CMS page operations
│   │   ├── reviews.ts          # Review CRUD + moderation
│   │   └── mach/               # MACH Alliance model implementations
│   │       ├── index.ts        # MACH models barrel export
│   │       ├── products.ts     # Product CRUD (32KB - largest model)
│   │       ├── category.ts     # Category CRUD
│   │       ├── orders.ts       # Order CRUD (MACH-compliant)
│   │       ├── customer.ts     # Customer CRUD
│   │       ├── inventory.ts    # Inventory management
│   │       ├── address.ts      # Address operations
│   │       ├── couponInstance.ts # Coupon management
│   │       ├── language.ts     # Localization operations
│   │       ├── media.ts        # Media operations
│   │       ├── pricing.ts      # Pricing operations
│   │       ├── product_types.ts # Product type operations
│   │       └── promotions.ts   # Promotion operations
│   ├── types/                  # TypeScript type definitions
│   │   ├── index.ts            # Types barrel export
│   │   ├── order.ts            # Order types
│   │   ├── cart.ts             # Cart type
│   │   ├── cartitem.ts         # CartItem type
│   │   ├── money.ts            # Money type
│   │   ├── shipping.ts         # Shipping types
│   │   ├── billing.ts          # Billing types
│   │   ├── review.ts           # Review types
│   │   ├── agent.ts            # Agent types
│   │   ├── userProfile.ts      # User profile type
│   │   ├── productAvailability.ts
│   │   ├── apiPermissions.ts   # API permission types
│   │   └── mach/               # MACH Alliance types
│   │       ├── index.ts        # MACH types barrel export
│   │       ├── Product.ts      # Product interface
│   │       ├── Category.ts     # Category interface
│   │       ├── Customer.ts     # Customer interface
│   │       ├── Pricing.ts      # Pricing interface
│   │       ├── Inventory.ts    # Inventory interface
│   │       ├── Promotion.ts    # Promotion interface
│   │       ├── ProductType.ts  # ProductType interface
│   │       ├── Media.ts        # Media interface
│   │       ├── Language.ts     # Language/localization interface
│   │       ├── Address.ts      # Address interface
│   │       ├── CouponInstance.ts # Coupon interface
│   │       └── APIResponse.ts  # API response wrapper
│   ├── stores/                 # Zustand state stores
│   │   ├── cart-store.ts       # Cart + checkout state (persisted)
│   │   ├── chat-store.ts       # Chat conversation state
│   │   └── server-chat-store.ts # Server-side chat context
│   ├── mcp/                    # MCP Server implementation
│   │   ├── auth.ts             # Agent authentication
│   │   ├── context.ts          # Agent context parsing
│   │   ├── error-handler.ts    # MCP error response formatting
│   │   ├── session.ts          # Session management
│   │   ├── types.ts            # MCP-specific types
│   │   └── tools/              # Tool implementations
│   │       ├── agent.ts        # Agent management tool
│   │       ├── assess.ts       # Fulfillment assessment tool
│   │       ├── cart.ts         # Cart operations tool
│   │       ├── order.ts        # Order operations tool
│   │       ├── payment.ts      # Payment validation tool
│   │       ├── recommend.ts    # Recommendation engine tool
│   │       ├── search.ts       # Product search tool
│   │       └── shipping.ts     # Shipping options tool
│   ├── ai/                     # AI model configuration
│   │   ├── config.ts           # Centralized AI model configs + runner
│   │   └── moderation.ts       # Content moderation logic
│   ├── auth/                   # Authentication modules
│   │   ├── index.ts            # Auth barrel export
│   │   ├── admin-middleware.ts  # Admin permission checking
│   │   └── unified-auth.ts     # API token auth (currently disabled)
│   ├── brand/                  # Brand configuration module
│   │   ├── index.ts            # Brand barrel export
│   │   └── BrandProvider.tsx   # React context provider + hook
│   ├── brand.config.ts         # Brand identity configuration
│   ├── hooks/                  # Custom React hooks
│   │   ├── useEnhancedUserContext.ts  # Enhanced user context for AI
│   │   └── useWebVitals.ts     # Web Vitals reporting hook
│   ├── stripe.ts               # Stripe client (Node + Cloudflare Workers)
│   ├── utils.ts                # General utilities (cn, etc.)
│   └── utils/                  # Domain-specific utilities
│       ├── email.ts            # Resend email sending
│       ├── r2.ts               # Cloudflare R2 bucket operations
│       ├── settings.ts         # DB settings access
│       ├── ratings.ts          # Rating calculation helpers
│       ├── review-notifications.ts  # Review notification logic
│       ├── personalized-recommendations.ts  # Recommendation engine
│       ├── image-placeholders.ts    # Placeholder image generation
│       └── performance-tracer.ts    # Performance measurement
├── hooks/                      # Top-level hooks (legacy location)
│   └── useCartPersistence.ts   # Cart hydration hook
├── emails/                     # React Email templates
│   └── OrderConfirmation.tsx   # Order confirmation email template
├── data/                       # Seed data and static assets
│   ├── d1/                     # Database seed files
│   │   ├── seed.sql            # Main product/category seed (134KB)
│   │   └── seed-reviews.sql    # Review seed data
│   └── r2/                     # R2 bucket seed data
│       ├── categories/         # Category images
│       ├── products/           # Product images
│       ├── products_md/        # Product markdown descriptions
│       └── knowledge_md/       # Knowledge base articles
├── migrations/                 # D1 database migrations (Drizzle)
│   ├── 0001_initial_schema.sql
│   ├── 0002_add_admin_users.sql
│   ├── 0003_add_cms_pages.sql
│   ├── 0004_add_mcp_tables.sql
│   ├── 0005_add_reviews_tables.sql
│   └── 0006_add_review_reminders.sql
├── docs/                       # Project documentation
├── public/                     # Static assets
│   ├── _headers                # Cloudflare custom headers
│   ├── robots.txt              # SEO robots file
│   ├── sitemap.xml             # SEO sitemap
│   └── generate-token.html     # Admin token generation page
├── middleware.ts                # Next.js middleware (auth + maintenance)
├── next.config.ts              # Next.js configuration
├── wrangler.jsonc              # Cloudflare Wrangler config (dev + production)
├── open-next.config.ts         # OpenNext Cloudflare adapter config
├── image-loader.ts             # Custom Next.js image loader (R2 integration)
├── cloudflare-env.d.ts         # Cloudflare env type definitions
├── worker-configuration.d.ts   # Worker configuration types
├── tailwind.config.ts          # Tailwind CSS configuration
├── tsconfig.json               # TypeScript configuration
├── components.json             # shadcn/ui configuration
├── postcss.config.js           # PostCSS configuration
├── package.json                # Package manifest
├── mercora-db-dump.sql         # Database dump (reference)
└── MIGRATION-PLAN.md           # Migration planning document
```

## Directory Purposes

**`app/`:**
- Purpose: Next.js App Router - all pages and API routes
- Contains: `page.tsx` (pages), `layout.tsx` (layouts), `route.ts` (API handlers)
- Key files: `app/layout.tsx` (root layout), `app/page.tsx` (home), `app/admin/layout.tsx` (admin shell)

**`app/api/`:**
- Purpose: REST API endpoints organized by resource
- Contains: Route handlers with HTTP method exports
- Key files: `app/api/mcp/route.ts` (MCP server), `app/api/orders/route.ts` (order management), `app/api/agent-chat/route.ts` (AI chat)

**`components/`:**
- Purpose: Reusable React components organized by feature domain
- Contains: Both Server Components and Client Components
- Key files: `components/checkout/CheckoutClient.tsx` (checkout orchestrator), `components/agent/AgentDrawer.tsx` (AI chat UI), `components/admin/AdminGuard.tsx` (auth gate)

**`components/ui/`:**
- Purpose: shadcn/ui primitive components built on Radix UI
- Contains: Low-level UI primitives (buttons, dialogs, inputs, etc.)
- Key files: All follow shadcn/ui conventions - do not modify directly, regenerate via CLI if needed

**`lib/db/schema/`:**
- Purpose: Drizzle ORM table definitions for Cloudflare D1
- Contains: `sqliteTable()` definitions + helper functions
- Key files: `lib/db/schema/index.ts` (barrel), `lib/db/schema/products.ts` (product + variant tables)

**`lib/models/mach/`:**
- Purpose: MACH Alliance-compliant data access layer
- Contains: CRUD functions per commerce entity
- Key files: `lib/models/mach/products.ts` (product ops), `lib/models/mach/orders.ts` (order ops), `lib/models/mach/category.ts` (category ops)

**`lib/types/mach/`:**
- Purpose: TypeScript interfaces for MACH Alliance data model
- Contains: Interface definitions per entity (PascalCase filenames)
- Key files: `lib/types/mach/Product.ts`, `lib/types/mach/Category.ts`, `lib/types/mach/index.ts` (barrel)

**`lib/mcp/`:**
- Purpose: Model Context Protocol server implementation for AI agent commerce
- Contains: Auth, session, context, error handling, and tool implementations
- Key files: `lib/mcp/tools/cart.ts` (15KB), `lib/mcp/tools/recommend.ts` (11KB), `lib/mcp/auth.ts`

**`lib/stores/`:**
- Purpose: Client-side state management with Zustand
- Contains: Stores for cart (persistent), chat, and server-side chat
- Key files: `lib/stores/cart-store.ts` (12KB - main cart + checkout state)

**`data/`:**
- Purpose: Seed data for initial database and R2 bucket population
- Contains: SQL seed files and R2 image/markdown content
- Key files: `data/d1/seed.sql` (134KB main seed), `data/d1/seed-reviews.sql`

**`migrations/`:**
- Purpose: Incremental D1 database schema migrations
- Contains: Sequential SQL migration files (0001-0006)
- Key files: `migrations/0001_initial_schema.sql` (20KB initial schema)

## Key File Locations

**Entry Points:**
- `app/layout.tsx`: Root layout - global providers, navigation, metadata
- `app/page.tsx`: Home page - hero section, featured products
- `middleware.ts`: Request middleware - auth, maintenance mode
- `app/admin/layout.tsx`: Admin entry - auth guard, sidebar, dark theme

**Configuration:**
- `lib/brand.config.ts`: Brand identity (name, colors, fonts, social, MCP metadata)
- `lib/ai/config.ts`: AI model configuration (GPT-OSS-20B, BGE embeddings)
- `lib/stripe.ts`: Stripe payment configuration (client + server + Cloudflare adapter)
- `next.config.ts`: Next.js build config (custom image loader, webpack optimization)
- `wrangler.jsonc`: Cloudflare Workers config (D1, R2, Vectorize, AI bindings, envs)
- `tailwind.config.ts`: Tailwind CSS theme configuration
- `tsconfig.json`: TypeScript config with `@/` path alias

**Core Logic:**
- `lib/db.ts`: Database connection factory (`getDb()`, `getDbAsync()`)
- `lib/models/mach/products.ts`: Product CRUD (32KB - largest model file)
- `lib/models/mach/orders.ts`: MACH-compliant order operations
- `lib/models/order.ts`: App-specific order table + functions
- `lib/models/reviews.ts`: Review CRUD + moderation (35KB)
- `lib/stores/cart-store.ts`: Cart + checkout state management
- `lib/mcp/tools/cart.ts`: MCP cart operations for AI agents

**Testing:**
- No test files detected in the codebase

## Naming Conventions

**Files:**
- Pages: `page.tsx` (Next.js convention)
- Layouts: `layout.tsx` (Next.js convention)
- API routes: `route.ts` (Next.js convention)
- Components: PascalCase (e.g., `ProductCard.tsx`, `AdminGuard.tsx`)
- Admin page components: PascalCase inline (e.g., `CategoryManagement.tsx`, `ProductManagement.tsx`)
- Models: camelCase/snake_case (e.g., `products.ts`, `product_types.ts`)
- Types (MACH): PascalCase (e.g., `Product.ts`, `Category.ts`)
- Types (app): camelCase (e.g., `order.ts`, `cartitem.ts`)
- Schema: snake_case (e.g., `admin_users.ts`, `couponInstance.ts`)
- Stores: kebab-case (e.g., `cart-store.ts`, `chat-store.ts`)
- Utils: kebab-case (e.g., `image-placeholders.ts`, `performance-tracer.ts`)

**Directories:**
- App routes: kebab-case (e.g., `agent-chat/`, `payment-intent/`, `shipping-options/`)
- Dynamic routes: `[param]` Next.js convention (e.g., `[slug]/`, `[id]/`)
- Component domains: camelCase or kebab-case (e.g., `checkout/`, `cart/`, `agent/`)
- Lib modules: camelCase or kebab-case (e.g., `mcp/`, `ai/`, `auth/`)

**Exports:**
- Components: default export (e.g., `export default function ProductCard`)
- Models: named exports (e.g., `export async function listProducts`)
- Types: named exports (e.g., `export interface Product`)
- Barrel files: re-exports via `export * from`

## Where to Add New Code

**New Storefront Page:**
- Create `app/[page-name]/page.tsx` for the page component
- Add any page-specific components as sibling files (e.g., `app/[page-name]/SomeDisplay.tsx`)
- If data fetching needed, use existing model functions from `lib/models/`

**New API Endpoint:**
- Create `app/api/[resource-name]/route.ts` with exported HTTP method handlers
- For admin endpoints: `app/api/admin/[resource-name]/route.ts` with `checkAdminPermissions` guard
- Use `getDbAsync()` for database access, return `NextResponse.json()`

**New Admin Page:**
- Create `app/admin/[section]/page.tsx` - automatically inherits admin layout + auth
- Create management component alongside: `app/admin/[section]/[Name]Management.tsx`
- Mark as `"use client"` for interactive admin UIs

**New Component:**
- Feature component: `components/[domain]/[ComponentName].tsx`
- Shared UI primitive: `components/ui/[component-name].tsx` (prefer shadcn/ui CLI)
- Admin component: `components/admin/[ComponentName].tsx`

**New MACH Model:**
- Schema: `lib/db/schema/[entity].ts` - define Drizzle table
- Types: `lib/types/mach/[Entity].ts` - define TypeScript interface
- Model: `lib/models/mach/[entity].ts` - implement CRUD functions
- Add exports to respective `index.ts` barrel files
- Create migration in `migrations/` for the new table

**New MCP Tool:**
- Implementation: `lib/mcp/tools/[tool-name].ts`
- Add case to switch in `app/api/mcp/route.ts`
- Optionally add REST endpoint at `app/api/mcp/tools/[tool-name]/route.ts`
- Add types to `lib/mcp/types.ts`

**New Utility:**
- Shared helper: `lib/utils/[name].ts`
- Custom hook: `lib/hooks/[useName].ts`
- Store: `lib/stores/[name]-store.ts`

**New Email Template:**
- Template: `emails/[TemplateName].tsx` (React Email format)
- Sending logic: Add function to `lib/utils/email.ts`

## Special Directories

**`data/`:**
- Purpose: Seed data for database and R2 object storage initialization
- Generated: No (manually maintained)
- Committed: Yes

**`migrations/`:**
- Purpose: D1 database schema migrations (sequential SQL files)
- Generated: Partially (Drizzle Kit can generate, but files are manually maintained)
- Committed: Yes

**`public/`:**
- Purpose: Static assets served directly by Next.js/Cloudflare
- Generated: No
- Committed: Yes

**`.open-next/`:**
- Purpose: OpenNext build output for Cloudflare Workers deployment
- Generated: Yes (by `opennextjs-cloudflare build`)
- Committed: No (in `.gitignore`)

**`.next/`:**
- Purpose: Next.js build cache
- Generated: Yes
- Committed: No (in `.gitignore`)

**`docs/`:**
- Purpose: Project documentation (architecture, specs, deployment guides)
- Generated: No
- Committed: Yes
- Key files: `docs/CLAUDE.md` (AI coding assistant context), `docs/architecture.md`, `docs/mcp-server-specification.md`

**`components/ui/`:**
- Purpose: shadcn/ui component library (Radix UI-based primitives)
- Generated: Yes (via shadcn/ui CLI: `npx shadcn@latest add [component]`)
- Committed: Yes
- Note: These are owned copies, not node_modules. Can be customized but prefer regenerating.

---

*Structure analysis: 2026-03-04*
