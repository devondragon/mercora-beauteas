---
phase: 01-seo-foundations
verified: 2026-03-05T23:30:00Z
status: passed
score: 5/5 must-haves verified
re_verification: false
human_verification:
  - test: "Visit /sitemap.xml on the dev server and confirm valid XML with product, category, and CMS page URLs"
    expected: "Well-formed XML with <url> entries for homepage, all active products (/product/slug), active categories (/category/slug), and published CMS pages (/slug)"
    why_human: "Dynamic sitemap requires a running database connection to generate URLs from live data"
  - test: "Visit /products/any-slug and confirm browser redirects to /product/any-slug"
    expected: "Browser URL bar shows /product/any-slug after redirect; HTTP response has 308 status (not 404)"
    why_human: "Redirect behavior requires a running Next.js server to verify HTTP status codes"
  - test: "View page source of a product page and confirm og:title, og:description, og:image, twitter:card, and canonical link tags are present with correct values"
    expected: "Meta tags in HTML head match product name/description/image; canonical URL is https://beauteas.com/product/slug"
    why_human: "Metadata rendering depends on server-side execution and actual product data"
  - test: "View page source of a product page and confirm script type=application/ld+json tags contain Product schema with price in dollars (e.g. 19.99 not 1999)"
    expected: "JSON-LD with @type Product, offers.price as decimal dollars, availability URL, and @type BreadcrumbList"
    why_human: "JSON-LD content depends on live product data with actual pricing"
  - test: "Paste a deployed product page URL into Google Rich Results Test"
    expected: "Product structured data detected with no errors; breadcrumb detected with no errors"
    why_human: "Google Rich Results Test is an external service that must be run manually against a live URL"
---

# Phase 1: SEO Foundations Verification Report

**Phase Goal:** Search engines index the Mercora storefront correctly, preserving all Shopify ranking equity through proper metadata, structured data, and redirect stubs
**Verified:** 2026-03-05T23:30:00Z
**Status:** passed
**Re-verification:** No -- initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Visiting /sitemap.xml returns a valid XML sitemap listing all products, categories, and CMS pages with correct URLs | VERIFIED | `app/sitemap.ts` (58 lines) fetches products, categories, and pages via `Promise.all` from DB models, maps to MetadataRoute.Sitemap with absolute `https://beauteas.com/` URLs. Static `public/sitemap.xml` confirmed deleted. `robots.txt` references `/sitemap.xml`. |
| 2 | Product and category pages render complete OG tags, Twitter cards, and canonical URLs visible in page source | VERIFIED | `app/product/[slug]/page.tsx` exports `generateMetadata` with og:title, og:description, og:image, og:url, og:siteName, twitter:card (summary_large_image), twitter:title, twitter:description, twitter:images, and `alternates.canonical`. `app/category/[slug]/page.tsx` exports `generateMetadata` with OG tags and canonical. Root layout has `metadataBase: new URL(BASE_URL)` for relative canonical resolution. |
| 3 | Product pages include JSON-LD Product schema with pricing and availability; all pages include Organization schema; product and category pages include Breadcrumb schema | VERIFIED | `lib/seo/json-ld.tsx` (281 lines) exports `buildProductJsonLd` (with price cents-to-dollars conversion, availability mapping, aggregateRating), `buildOrganizationJsonLd`, `buildBreadcrumbJsonLd`, and `JsonLdScript` component with XSS-safe serialization. Product page renders `<JsonLdScript>` for Product + Breadcrumb. Category page renders `<JsonLdScript>` for Breadcrumb. Root layout renders `<JsonLdScript>` for Organization (module-level static). |
| 4 | Requesting any known Shopify URL pattern (/products/slug, /collections/slug, /pages/slug) returns a permanent redirect to the corresponding Mercora URL | VERIFIED | `next.config.ts` contains `async redirects()` with three rules: `/products/:slug` -> `/product/:slug`, `/collections/:slug` -> `/category/:slug`, `/pages/:slug` -> `/:slug`, all with `permanent: true`. Note: Next.js `permanent: true` sends 308 (not 301). Google treats 308 identically to 301 for SEO purposes. See Human Verification note. |
| 5 | Google Rich Results Test validates structured data on product pages without errors | VERIFIED (code-level) | Product JSON-LD includes all required schema.org fields: @type Product, name, brand, description, image, offers (with price, priceCurrency, availability), aggregateRating (conditional). XSS prevention via `\\u003c` escaping. Requires human verification against Google Rich Results Test on deployed URL. |

**Score:** 5/5 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `app/sitemap.ts` | Dynamic sitemap generation from DB | VERIFIED | 58 lines, default export async function, MetadataRoute.Sitemap return type, fetches all 3 data sources |
| `next.config.ts` | Shopify URL redirect rules | VERIFIED | 117 lines, `async redirects()` added with 3 redirect patterns alongside existing headers/webpack config |
| `lib/seo/metadata.ts` | Shared SEO constants and helpers | VERIFIED | 88 lines, exports BASE_URL, SITE_NAME, resolveLocalizedField, resolveImageUrl |
| `lib/seo/json-ld.tsx` | JSON-LD builder functions and JsonLdScript component | VERIFIED | 281 lines (exceeds 80-line min), exports JsonLdScript, buildProductJsonLd, buildOrganizationJsonLd, buildBreadcrumbJsonLd |
| `app/product/[slug]/page.tsx` | generateMetadata + Product/Breadcrumb JSON-LD | VERIFIED | 149 lines, exports generateMetadata with OG/Twitter/canonical, renders JsonLdScript for Product + Breadcrumb |
| `app/category/[slug]/page.tsx` | generateMetadata + Breadcrumb JSON-LD | VERIFIED | 230 lines, exports generateMetadata with OG/canonical, renders JsonLdScript for Breadcrumb |
| `app/layout.tsx` | metadataBase, title template, Organization JSON-LD | VERIFIED | 194 lines, metadataBase set, title.template configured, JsonLdScript for Organization rendered in body |
| `public/sitemap.xml` | Must NOT exist (deleted) | VERIFIED | Confirmed file does not exist on disk |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `app/sitemap.ts` | `lib/models/mach/products.ts` | `listProducts()` call | WIRED | Imported from `@/lib/models` barrel, called with `{ status: ["active"] }` in Promise.all |
| `app/sitemap.ts` | `lib/models/mach/category.ts` | `listCategories()` call | WIRED | Imported from `@/lib/models` barrel, called with `{ status: "active" }` in Promise.all |
| `app/sitemap.ts` | `lib/models/pages.ts` | `getPublishedPages()` call | WIRED | Imported from `@/lib/models` barrel, called in Promise.all |
| `app/product/[slug]/page.tsx` | `lib/models/mach/products.ts` | `getProductBySlug()` in generateMetadata | WIRED | Imported from `@/lib/models`, called in both generateMetadata and ProductPage |
| `app/category/[slug]/page.tsx` | `lib/models/mach/category.ts` | `getCategoryBySlug()` in generateMetadata | WIRED | Imported from `@/lib/models`, called in both generateMetadata and CategoryPage |
| `app/product/[slug]/page.tsx` | `lib/seo/metadata.ts` | imports resolveLocalizedField, resolveImageUrl, BASE_URL, SITE_NAME | WIRED | All 4 exports imported and used in generateMetadata and JSON-LD construction |
| `app/category/[slug]/page.tsx` | `lib/seo/metadata.ts` | imports resolveLocalizedField, resolveImageUrl, BASE_URL, SITE_NAME | WIRED | All 4 exports imported and used in generateMetadata and JSON-LD construction |
| `app/product/[slug]/page.tsx` | `lib/seo/json-ld.tsx` | imports JsonLdScript, buildProductJsonLd, buildBreadcrumbJsonLd | WIRED | All 3 imports used: buildProductJsonLd and buildBreadcrumbJsonLd called, JsonLdScript rendered twice |
| `app/category/[slug]/page.tsx` | `lib/seo/json-ld.tsx` | imports JsonLdScript, buildBreadcrumbJsonLd | WIRED | Both imports used: buildBreadcrumbJsonLd called, JsonLdScript rendered |
| `app/layout.tsx` | `lib/seo/json-ld.tsx` | imports JsonLdScript, buildOrganizationJsonLd | WIRED | buildOrganizationJsonLd called at module level, JsonLdScript rendered in body |
| `lib/seo/json-ld.tsx` | `lib/brand.config.ts` | brand import for Organization schema | WIRED | `import { brand } from "@/lib/brand"` resolves via barrel, brand.name/description/social used in buildOrganizationJsonLd |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| SEO-01 | 01-01 | Dynamic sitemap at /sitemap.xml includes all products, categories, and CMS pages | SATISFIED | `app/sitemap.ts` fetches all three entity types from DB, maps to sitemap entries with absolute URLs |
| SEO-02 | 01-02 | Product pages have generateMetadata() with title, description, canonical URL, OG tags, and Twitter cards | SATISFIED | `app/product/[slug]/page.tsx` exports generateMetadata with all required tags including twitter:card summary_large_image |
| SEO-03 | 01-02 | Category pages have generateMetadata() with title, description, canonical URL, and OG tags | SATISFIED | `app/category/[slug]/page.tsx` exports generateMetadata with title, description, canonical, OG tags |
| SEO-04 | 01-03 | Product pages include JSON-LD Product schema with pricing, availability, and aggregate ratings | SATISFIED | `buildProductJsonLd` produces schema.org Product with offers (price in dollars, priceCurrency, availability), aggregateRating conditional on reviews |
| SEO-05 | 01-03 | Root layout includes JSON-LD Organization schema for BeauTeas | SATISFIED | `app/layout.tsx` renders `<JsonLdScript data={organizationJsonLd} />` built from brand config with name, description, url, logo, sameAs |
| SEO-06 | 01-03 | Product and category pages include JSON-LD Breadcrumb schema | SATISFIED | Product page: Home > Product Name breadcrumb. Category page: Home > Categories > Category Name breadcrumb. Both render via JsonLdScript. |
| SEO-07 | 01-01 | Shopify URLs redirect via permanent redirect to Mercora equivalents (/products/ -> /product/, /collections/ -> /category/, /pages/ -> /) | SATISFIED | `next.config.ts` redirects() with three patterns, all `permanent: true` (308). Note: 308 vs 301 is equivalent for SEO; Phase 4 MIGR-08 will add slug-level mapping. |

No orphaned requirements. All 7 SEO requirements mapped to Phase 1 in REQUIREMENTS.md are claimed by plans and have implementation evidence.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| (none) | - | - | - | No TODO, FIXME, placeholder, or stub patterns found in any modified file |

All 7 key files scanned. ESLint passes with zero warnings or errors.

### Human Verification Required

### 1. Dynamic Sitemap Content Validation

**Test:** Start the dev server and visit `http://localhost:3000/sitemap.xml`
**Expected:** Valid XML document with `<url>` entries for the homepage, all active products (under `/product/`), all active categories (under `/category/`), and all published CMS pages. Each entry should have `<loc>`, `<lastmod>`, `<changefreq>`, and `<priority>` tags.
**Why human:** Requires a running database connection to generate URLs from live product/category/page data.

### 2. Shopify Redirect Status Code

**Test:** Run `curl -sI http://localhost:3000/products/any-slug` and check the HTTP status code
**Expected:** `HTTP/1.1 308 Permanent Redirect` with `Location: /product/any-slug`. Repeat for `/collections/any-slug` (expect `/category/any-slug`) and `/pages/any-slug` (expect `/any-slug`).
**Why human:** HTTP redirect behavior requires a running Next.js server. Note: Implementation uses 308 (not 301) per Next.js `permanent: true` convention. If the business strictly requires 301 status codes, change to `statusCode: 301` in next.config.ts. For SEO purposes, 308 and 301 are equivalent.

### 3. Product Page Meta Tags in Source

**Test:** Visit a product page in the browser, view page source, search for `og:title`, `twitter:card`, and `rel="canonical"`
**Expected:** Complete OG tags with product-specific title/description/image, Twitter summary_large_image card, and canonical URL matching `https://beauteas.com/product/{slug}`
**Why human:** Metadata rendering depends on server-side execution with actual product data from the database.

### 4. JSON-LD Structured Data in Source

**Test:** View page source of a product page and find `<script type="application/ld+json">` tags
**Expected:** Two JSON-LD blocks: (1) Product schema with name, price in decimal dollars (e.g., "19.99" not "1999"), priceCurrency, availability URL, and brand; (2) BreadcrumbList with Home > Product Name. Also check the homepage source for Organization JSON-LD with BeauTeas name and social links.
**Why human:** JSON-LD content depends on live product data; price conversion correctness (cents to dollars) can only be fully validated with real data.

### 5. Google Rich Results Test

**Test:** Deploy to a publicly accessible URL, then paste a product page URL into https://search.google.com/test/rich-results
**Expected:** "Product" and "Breadcrumb" detected with no errors or warnings. Product shows price, availability, and (if reviews exist) aggregate rating.
**Why human:** Requires a deployed site and Google's external validation service.

### Gaps Summary

No gaps found. All 5 observable truths are verified at the code level. All 7 required artifacts exist, are substantive (non-trivial implementations), and are properly wired into the application. All 11 key links verified as WIRED (imported and used). All 7 requirement IDs (SEO-01 through SEO-07) are satisfied with implementation evidence. No anti-patterns detected. ESLint passes clean.

The one notable implementation choice is the use of 308 status codes instead of 301 for Shopify redirects. This is functionally equivalent for SEO and is the standard Next.js approach, but if the business requirement strictly mandates 301 status codes, the `permanent: true` flag should be changed to `statusCode: 301` in `next.config.ts`.

Five items require human verification on a running server with live data, particularly the Google Rich Results Test which requires a deployed URL.

---

_Verified: 2026-03-05T23:30:00Z_
_Verifier: Claude (gsd-verifier)_
