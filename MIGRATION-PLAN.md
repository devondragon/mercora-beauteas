# BeauTeas: Shopify to Mercora Migration Plan

## Context

BeauTeas.com currently runs on Shopify selling organic skincare teas (~30 products). The goal is to migrate to the existing Mercora e-commerce platform (Next.js 15 / Cloudflare Workers / D1 / Stripe) while maintaining full feature parity and adding subscription support. The Mercora codebase already has a strong foundation: product catalog, cart, checkout, orders, reviews, admin dashboard, AI search, and Stripe payments are all implemented.

**Key gaps to close:** Subscriptions (must-have), data migration from Shopify, blog system, Klaviyo email marketing, customer account pages, SEO improvements, and several UX features.

---

## Phase 1: SEO Foundation (Launch Blocker)

Without these, migrating off Shopify would destroy search rankings.

### 1.1 Dynamic Sitemap
- Create `app/sitemap.ts` using Next.js built-in sitemap generation
- Include: products, categories, CMS pages, blog posts (when added)
- Delete static `public/sitemap.xml`

### 1.2 Product/Category Page Metadata
- Add `generateMetadata()` to `app/product/[slug]/page.tsx` — currently missing OG tags, canonical URL
- Add `generateMetadata()` to `app/category/[slug]/page.tsx`
- Add canonical tags, Open Graph (og:title, og:description, og:image), Twitter cards

### 1.3 JSON-LD Structured Data
- Create `components/seo/JsonLd.tsx` with reusable components:
  - `ProductJsonLd` — Product schema with pricing, availability, aggregate ratings
  - `OrganizationJsonLd` — BeauTeas organization schema in root layout
  - `BreadcrumbJsonLd` — Breadcrumb schema on product/category pages
  - `ArticleJsonLd` — For blog posts (Phase 3)
- Add to product pages, layout, category pages

### 1.4 Shopify URL Redirects
- Add `redirects()` to `next.config.ts` for 301 redirects:
  - `/products/:slug` → `/product/:slug`
  - `/collections/:slug` → `/category/:slug`
  - `/blogs/news/:slug` → `/blog/:slug`
  - `/pages/:slug` → `/:slug`
- Generate full redirect map during data migration (Phase 5)

### 1.5 Dynamic robots.txt
- Create `app/robots.ts` replacing static `public/robots.txt`
- Disallow: `/checkout`, `/orders`, `/api/`, `/admin/`, `/_next/`
- Reference sitemap URL

**Files to modify:** `app/product/[slug]/page.tsx`, `app/category/[slug]/page.tsx`, `app/layout.tsx`, `next.config.ts`
**Files to create:** `app/sitemap.ts`, `app/robots.ts`, `components/seo/JsonLd.tsx`

---

## Phase 2: Subscription System (Must-Have)

Stripe Subscriptions as billing authority; local D1 database as sync layer via webhooks.

### 2.1 Database Schema
- Create `lib/db/schema/subscription.ts` with three tables:
  - `subscription_plans` — Maps products to Stripe recurring Prices (interval, discount %)
  - `customer_subscriptions` — Tracks active subscriptions synced from Stripe
  - `subscription_events` — Audit log of lifecycle events
- Create `migrations/0007_add_subscriptions.sql`
- Export from `lib/db/schema/index.ts`

### 2.2 Stripe Configuration
- Create recurring Stripe Prices for subscribable products (every 2 weeks, monthly, every 2 months)
- Create a Stripe Coupon for subscription discount (e.g., 10% off)
- Use SetupIntents for payment method collection (Stripe manages billing cycle)

### 2.3 Model Layer & Types
- Create `lib/types/subscription.ts` — SubscriptionPlan, CustomerSubscription, SubscriptionEvent types
- Create `lib/models/mach/subscriptions.ts` — CRUD operations, stats queries
- Add Stripe subscription helpers to `lib/stripe.ts`:
  - `getOrCreateStripeCustomer()`, `createStripeSubscription()`, `pauseStripeSubscription()`, `resumeStripeSubscription()`, `cancelStripeSubscription()`, `createSetupIntent()`
  - Must use the fetch-based `CloudflareStripe` pattern (not Node.js SDK)

### 2.4 API Routes
- `app/api/subscriptions/route.ts` — Customer: list own subs (GET), create new sub (POST)
- `app/api/subscriptions/[id]/route.ts` — Customer: actions (pause/resume/skip/cancel)
- `app/api/products/[id]/subscription-plans/route.ts` — Public: get plans for a product
- `app/api/admin/subscription-plans/route.ts` — Admin: manage plans
- `app/api/admin/subscriptions/route.ts` — Admin: list/filter all subscriptions

### 2.5 Webhook Extensions
- Extend `app/api/webhooks/stripe/route.ts` to handle:
  - `customer.subscription.created/updated/deleted/paused/resumed`
  - `invoice.payment_succeeded` (create renewal order), `invoice.payment_failed`
  - `invoice.upcoming` (handle skip-next-renewal logic)
- Each handler: update local DB state, create audit event, trigger email

### 2.6 Email Notifications
- Add to `lib/utils/email.ts`: subscription created, renewed, payment failed, paused, resumed, canceled, upcoming renewal emails
- Follow existing `generateOrderConfirmationHTML` pattern

### 2.7 Customer UI
- `components/product/SubscriptionSelector.tsx` — "One-time" vs "Subscribe & Save" toggle on product pages, with frequency dropdown
- Modify `app/product/[slug]/ProductDisplay.tsx` to integrate selector
- `app/checkout/subscription/page.tsx` — Dedicated subscription checkout (shipping → SetupIntent → create sub)
- `components/checkout/SubscriptionCheckout.tsx` — Checkout flow component

### 2.8 Admin UI
- `app/admin/subscriptions/page.tsx` — Dashboard: active count, MRR, churn, filterable table
- `app/admin/subscriptions/[id]/page.tsx` — Detail view with event timeline
- `app/admin/subscription-plans/page.tsx` — Manage which products have subscription options
- Add "Subscriptions" to `components/admin/AdminSidebar.tsx`

---

## Phase 3: Blog System

BeauTeas has educational content (blog posts, "How Our Teas Work", "Learn" section) that needs a proper blog system beyond the existing CMS pages.

### 3.1 Database Schema
- Create `lib/db/schema/blog.ts`:
  - `blog_posts` — title, slug, content (HTML), excerpt, featured_image, author, tags (JSON), category, SEO fields, status (draft/published/scheduled), published_at, reading_time
  - `blog_categories` — name, slug, description, sort_order
- Create `migrations/0008_add_blog_tables.sql` with seed data for categories: "How Our Teas Work", "Learn", "Recipes & Tips", "News"

### 3.2 Model Layer
- Create `lib/models/blog.ts` following `lib/models/pages.ts` pattern
- Functions: `getBlogPosts(filters)`, `getBlogPostBySlug()`, `createBlogPost()`, `updateBlogPost()`, `publishBlogPost()`, `getRelatedPosts()`, `getBlogStats()`

### 3.3 Frontend Pages
- `app/blog/page.tsx` — Blog listing with pagination, category filtering
- `app/blog/[slug]/page.tsx` — Post detail with `generateMetadata()`, JSON-LD ArticleJsonLd, related posts
- `app/blog/feed.xml/route.ts` — RSS feed

### 3.4 Admin UI
- `app/admin/blog/page.tsx` + `BlogManagement.tsx` — Following `app/admin/pages/` pattern
- `app/api/admin/blog/route.ts` + `[id]/route.ts` — CRUD API
- Add "Blog" to `components/admin/AdminSidebar.tsx`
- Leverage existing `app/api/admin/upload-image/` for featured images (add `blog` to R2 folders in `lib/utils/r2.ts`)

---

## Phase 4: Klaviyo Integration

Keep Resend for transactional emails. Use Klaviyo for marketing automation, abandoned cart flows, and newsletter.

### 4.1 Klaviyo Client
- Create `lib/klaviyo/client.ts` — Fetch-based API wrapper (same pattern as `CloudflareStripe` in `lib/stripe.ts`)
- Create `lib/klaviyo/types.ts` — Profile, Event, CatalogItem types
- Create `lib/klaviyo/events.ts` — Domain-specific event functions:
  - `trackViewedProduct()`, `trackAddedToCart()`, `trackStartedCheckout()`, `trackPlacedOrder()`, `trackSubscriptionCreated/Paused/Cancelled/Renewed()`

### 4.2 Integration Points
- `app/product/[slug]/ProductDisplay.tsx` — Track product views in useEffect
- `lib/stores/cart-store.ts` — Track add-to-cart events
- `app/api/webhooks/stripe/route.ts` — Track placed order, subscription events
- `components/checkout/CheckoutClient.tsx` — Track started checkout

### 4.3 Newsletter Signup
- Create `components/newsletter/NewsletterSignup.tsx`
- Create `app/api/klaviyo/subscribe/route.ts`
- Add to `components/Footer.tsx`

### 4.4 Admin Sync
- Create `app/api/klaviyo/sync/route.ts` — Bulk sync customers + catalog to Klaviyo (one-time + periodic)

### 4.5 Environment
- Add `KLAVIYO_API_KEY` and `KLAVIYO_NEWSLETTER_LIST_ID` secrets via wrangler

---

## Phase 5: Shopify Data Migration

One-time migration scripts to move all data from Shopify to Mercora.

### 5.1 Migration Tool Structure
```
scripts/shopify-migration/
  index.ts              — Main orchestrator (run via tsx)
  config.ts             — Shopify API credentials
  api/
    shopify-client.ts   — GraphQL client with cursor pagination
    judgeme-client.ts   — Judge.me REST API client
  extractors/           — Fetch data from Shopify/Judge.me
  transformers/         — Convert to Mercora schema format
  loaders/
    d1-loader.ts        — Insert into D1
    r2-loader.ts        — Upload images to R2
  utils/
    id-mapping.ts       — Shopify ID → Mercora ID mapping
    url-mapping.ts      — Generate redirect CSV
    validation.ts       — Record count verification
```

### 5.2 Data to Migrate
| Data | Source | Target | Notes |
|------|--------|--------|-------|
| Products + Variants | Shopify Admin API | `products`, `product_variants` | Map to MACH schema, store Shopify ID in `external_references` |
| Product Images | Shopify CDN | R2 `products/` | Download and re-upload |
| Categories/Collections | Shopify Admin API | `categories` | Map collections → categories |
| Customers | Shopify Admin API | `customers` | Passwords can't migrate — use Clerk password reset flow |
| Orders | Shopify Admin API | `orders` | Read-only historical data, preserve dates and status |
| Reviews | Judge.me API | `product_reviews` | Recalculate product ratings after import |
| Blog Posts | Shopify Admin API | `blog_posts` | Include images → R2 `blog/` |
| Pages | Shopify Admin API | `pages` | FAQ, About Us, etc. |

### 5.3 Customer Password Strategy
- Import customer emails into Clerk via Backend API with `skip_password_requirement: true`
- Send migration email to all customers with password reset link
- Store `{ "migrated_from": "shopify", "password_reset_required": true }` in customer `authentication` field

### 5.4 Execution Order
1. Categories → 2. Products + Variants + Images → 3. Customers → 4. Orders → 5. Reviews (then recalc ratings) → 6. Blog posts → 7. Pages → 8. Generate redirect map → 9. Validate counts

### 5.5 Validation & Rollback
- Pre-migration: D1 backup via `wrangler d1 export`
- Post-migration: Count verification per table, spot-check orders/reviews, test image loading
- Keep Shopify store in read-only mode during migration window as fallback

---

## Phase 6: Customer Account Pages

Currently there's no dedicated account area — just `/orders`.

### 6.1 Account Layout
- Create `app/account/layout.tsx` — Auth-protected layout with sidebar navigation
- Create `components/account/AccountSidebar.tsx` — Nav: Orders, Addresses, Subscriptions, Settings

### 6.2 Pages
- `app/account/page.tsx` — Account dashboard overview
- `app/account/orders/page.tsx` — Enhanced order history (migrate from `/app/orders/`)
- `app/account/orders/[id]/page.tsx` — Detailed order view with timeline
- `app/account/addresses/page.tsx` — Saved addresses CRUD (uses existing `addCustomerAddress`/`updateCustomerAddress`/`removeCustomerAddress` in `lib/models/mach/customer.ts`)
- `app/account/subscriptions/page.tsx` — Subscription management (pause/skip/cancel)
- `app/account/settings/page.tsx` — Name, email, communication preferences (uses existing `updateCommunicationPreferences` in customer model)

### 6.3 API Routes
- `app/api/account/addresses/route.ts` — GET/POST
- `app/api/account/addresses/[id]/route.ts` — PUT/DELETE
- `app/api/account/settings/route.ts` — GET/PUT

---

## Phase 7: UX Parity Features

Smaller features to match Shopify experience.

### 7.1 Apple Pay / Google Pay
- Already configured in `PaymentForm.tsx` (wallets: auto)
- Remaining: Add Apple Pay domain verification file at `public/.well-known/apple-developer-merchantid-domain-association`
- Register domain in Stripe dashboard

### 7.2 Search Improvements
- Create `components/search/SearchBar.tsx` — Debounced autocomplete with product suggestions
- Create `app/search/page.tsx` — Full search results with category/price facets
- Create `hooks/useSearch.ts` — Debounced search hook
- Integrate into `components/HeaderClient.tsx`

### 7.3 Breadcrumbs Everywhere
- Breadcrumbs component already exists at `components/Breadcrumbs.tsx`
- Add to: product pages, checkout, orders, CMS pages, blog pages

### 7.4 Social Sharing
- Create `components/social/ShareButtons.tsx` — Copy link, Facebook, Twitter/X, Pinterest
- Uses Web Share API with fallbacks, no external dependencies
- Add to product pages below Add to Cart

### 7.5 Recently Viewed
- Create `hooks/useRecentlyViewed.ts` — localStorage-based, last 10 products
- Create `components/RecentlyViewed.tsx` — Horizontal product card scroll
- Add to product pages below recommendations

### 7.6 Wishlist
- Create `lib/db/schema/wishlist.ts` + `migrations/0009_add_wishlist.sql`
- Create `lib/models/wishlist.ts`, `app/api/wishlist/route.ts`
- Create `components/wishlist/WishlistButton.tsx` — Heart icon toggle
- Add to product pages and product cards
- Create `app/account/wishlist/page.tsx`

---

## Phase 8: Gift Cards (Nice to Have)

### 8.1 Schema & Model
- Create `lib/db/schema/gift_cards.ts` — `gift_cards` + `gift_card_transactions` tables
- Create `migrations/0010_add_gift_cards.sql`
- Create `lib/models/gift-cards.ts` — generate code, create, redeem, check balance

### 8.2 Purchase & Redemption
- Gift card as a product type in the catalog
- `app/api/gift-cards/route.ts` — Purchase and balance check
- `app/api/gift-cards/redeem/route.ts` — Apply to checkout
- Add gift card input to `components/checkout/CheckoutClient.tsx` (similar to existing `DiscountCodeInput.tsx`)

### 8.3 Email Delivery
- Create gift card email template following `lib/utils/email.ts` pattern
- Send to recipient on purchase

---

## Verification Plan

### Per-Phase Testing
- **Phase 1 (SEO):** Google Rich Results Test on product pages, validate sitemap.xml loads, check redirects with curl
- **Phase 2 (Subscriptions):** Create test subscription end-to-end, verify webhook handling with Stripe CLI (`stripe listen --forward-to`), test pause/resume/cancel flows
- **Phase 3 (Blog):** Create post via admin, verify listing/detail/RSS, check JSON-LD with structured data validator
- **Phase 4 (Klaviyo):** Verify events appear in Klaviyo dashboard, test newsletter signup, check abandoned cart flow trigger
- **Phase 5 (Migration):** Record count comparison Shopify vs D1, spot-check 5 orders + 5 reviews, verify all images load from R2, test customer login via Clerk
- **Phase 6 (Account):** Test address CRUD, verify order history shows migrated orders, test subscription management actions
- **Phase 7-8:** Manual QA of each feature

### Pre-Launch Checklist
- [ ] All Shopify data migrated and validated
- [ ] URL redirects working (301s)
- [ ] Sitemap submitted to Google Search Console
- [ ] Apple Pay domain verified
- [ ] Klaviyo flows configured in dashboard
- [ ] Stripe webhooks registered for subscription events
- [ ] Customer migration emails sent with password reset links
- [ ] DNS cutover plan ready
- [ ] Shopify store in read-only mode as fallback

---

## New Database Migrations Summary
| Migration | Tables |
|-----------|--------|
| `0007_add_subscriptions.sql` | `subscription_plans`, `customer_subscriptions`, `subscription_events` |
| `0008_add_blog_tables.sql` | `blog_posts`, `blog_categories` |
| `0009_add_wishlist.sql` | `wishlists` |
| `0010_add_gift_cards.sql` | `gift_cards`, `gift_card_transactions` |

## New Secrets Required
```
KLAVIYO_API_KEY
KLAVIYO_NEWSLETTER_LIST_ID
STRIPE_SUBSCRIPTION_COUPON_ID
```

## No New npm Dependencies
All features use existing packages (Stripe, Clerk, Drizzle, Zustand, Resend) or fetch-based API clients.
