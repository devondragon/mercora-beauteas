# Technology Stack

**Analysis Date:** 2026-03-04

## Languages

**Primary:**
- TypeScript 5.x - All application code (`.ts`, `.tsx`)

**Secondary:**
- SQL (SQLite dialect) - Database migrations in `migrations/`
- CSS - Tailwind CSS utility classes with PostCSS

## Runtime

**Environment:**
- Node.js (development via Next.js dev server with Turbopack)
- Cloudflare Workers (production runtime, edge-native)

**Package Manager:**
- npm
- Lockfile: `package-lock.json` (present)

## Frameworks

**Core:**
- Next.js 15.3.5 - Full-stack React framework (App Router)
- React 19.0.0 - UI library
- React DOM 19.0.0 - DOM rendering

**Database/ORM:**
- Drizzle ORM 0.35.2 - Type-safe SQL ORM for D1
- Drizzle Kit 0.31.4 (dev) - Migration tooling

**UI/Styling:**
- Tailwind CSS 3.4.1 - Utility-first CSS framework
- shadcn/ui (new-york style, RSC-enabled) - Component library (`components.json`)
- Radix UI - Headless primitive components (dialog, select, dropdown-menu, checkbox, switch, etc.)
- Lucide React 0.525.0 - Icon library
- React Icons 5.5.0 - Additional icons
- class-variance-authority 0.7.1 - Component variant management
- clsx 2.1.1 + tailwind-merge 3.3.1 - Conditional class utilities
- tw-animate-css 1.3.5 (dev) - Animation utilities
- @tailwindcss/typography 0.5.16 - Prose styling plugin

**State Management:**
- Zustand 5.0.6 - Client-side state (cart store at `lib/stores/cart-store.ts`, chat store at `lib/stores/chat-store.ts`)

**Authentication:**
- @clerk/nextjs 6.25.5 - Authentication provider
- @clerk/themes 2.4.0 - Clerk UI theming

**Payments:**
- stripe 18.4.0 - Server-side Stripe SDK
- @stripe/stripe-js 7.8.0 - Client-side Stripe loader
- @stripe/react-stripe-js 3.9.0 - React Stripe components

**Email:**
- resend 4.8.0 - Transactional email API
- @react-email/components 0.4.0 - Email template components
- @react-email/render 1.1.4 - Email rendering

**Content:**
- marked 16.3.0 - Markdown parsing/rendering

**Monitoring:**
- web-vitals 5.1.0 - Core Web Vitals tracking
- sonner 2.0.6 - Toast notification system

**Build/Dev:**
- @opennextjs/cloudflare 1.5.1 - Next.js to Cloudflare Workers adapter
- wrangler 4.40.2 (dev) - Cloudflare Workers CLI
- PostCSS 8.5.6 + Autoprefixer 10.4.21 (dev) - CSS processing
- ESLint 9.36.0 + eslint-config-next 15.5.4 (dev) - Linting
- tsx 4.20.3 (dev) - TypeScript script runner (used for token management scripts)
- critters 0.0.23 - Critical CSS inlining

**Cloudflare Types:**
- @cloudflare/workers-types 4.20250726.0 - Workers type definitions
- `cloudflare-env.d.ts` and `worker-configuration.d.ts` - Generated environment types

## Key Dependencies

**Critical:**
- `next` 15.3.5 - Application framework; App Router with RSC
- `drizzle-orm` 0.35.2 - All database access goes through Drizzle
- `@clerk/nextjs` 6.25.5 - Authentication across all routes
- `stripe` 18.4.0 - Payment processing (checkout, webhooks, refunds, tax)
- `@opennextjs/cloudflare` 1.5.1 - Bridges Next.js to Cloudflare Workers runtime
- `zustand` 5.0.6 - Cart persistence (localStorage-backed)

**Infrastructure:**
- `resend` 4.8.0 - Order confirmation and status update emails
- `marked` 16.3.0 - Rendering knowledge base and product markdown content
- `server-only` 0.0.1 - Enforces server-side-only module boundaries

## Configuration

**TypeScript:**
- Config: `tsconfig.json`
- Target: ES2017
- Module: ESNext with bundler resolution
- Strict mode enabled
- Path alias: `@/*` maps to project root (`./`)
- Types include: `./cloudflare-env.d.ts`, `node`

**Tailwind:**
- Config: `tailwind.config.ts`
- Content scanned: `./app/**/*.{ts,tsx}`, `./components/**/*.{ts,tsx}`
- Custom brand colors imported from `lib/brand.config`
- Typography plugin enabled
- PostCSS config: `postcss.config.js`

**Next.js:**
- Config: `next.config.ts`
- Custom image loader: `image-loader.ts` (Cloudflare Image Resizing)
- Turbopack enabled for dev (`next dev --turbopack`)
- Webpack chunk splitting configured (vendor max 150KB, common max 100KB)
- Static asset caching headers configured
- OpenNext Cloudflare integration initialized for dev

**OpenNext/Cloudflare:**
- Config: `open-next.config.ts`
- Uses R2 incremental cache (`r2IncrementalCache`)

**Wrangler (Cloudflare Workers):**
- Config: `wrangler.jsonc`
- Compatibility date: 2024-12-01
- Flags: `nodejs_compat`, `global_fetch_strictly_public`
- Observability enabled
- Multi-environment: `dev` and `production`

**shadcn/ui:**
- Config: `components.json`
- Style: new-york
- RSC: true
- Base color: neutral
- CSS variables enabled
- Icon library: lucide

**Brand/Theme:**
- Config: `lib/brand.config.ts`
- Fonts: Lora (heading), Alegreya (body), Geist Mono (monospace)
- Theme: light mode with warm cream/blush color palette
- All brand values centralized for easy rebranding

**Environment:**
- `.env.example` present - documents required env vars
- `.env*.local` gitignored
- `.dev.vars*` gitignored (Wrangler local secrets)
- Production secrets managed via `wrangler secret put` per environment

**Required environment variables:**
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` - Clerk auth (public)
- `CLERK_SECRET_KEY` - Clerk auth (secret)
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` - Stripe payments (public)
- `STRIPE_SECRET_KEY` - Stripe payments (secret)
- `STRIPE_WEBHOOK_SECRET` - Stripe webhook verification
- `RESEND_API_KEY` - Email sending

**Build Commands:**
```bash
npm run dev                  # Local dev with Turbopack
npm run build                # Next.js production build
npm run deploy:dev           # Build + deploy to Cloudflare dev environment
npm run deploy:production    # Build + deploy to Cloudflare production
npm run preview              # Build + local Cloudflare preview
npm run preview:dev          # Build + wrangler dev mode
npm run lint                 # ESLint
npm run clean                # Remove .open-next, .next, .wrangler/state
npm run token:generate       # Generate API tokens (tsx scripts/manage-tokens.ts)
npm run token:list           # List API tokens
npm run token:revoke         # Revoke API tokens
```

## Platform Requirements

**Development:**
- Node.js (version not pinned; no `.nvmrc`)
- npm for package management
- Wrangler CLI (installed as devDependency)
- Cloudflare account for D1/R2/AI/Vectorize bindings

**Production:**
- Cloudflare Workers (edge runtime)
- Cloudflare D1 (SQLite database)
- Cloudflare R2 (object storage for images and content)
- Cloudflare AI (text generation and embeddings)
- Cloudflare Vectorize (vector search index)
- Cloudflare Image Resizing (CDN image optimization)
- Clerk (authentication service)
- Stripe (payment processing)
- Resend (transactional email)

---

*Stack analysis: 2026-03-04*
