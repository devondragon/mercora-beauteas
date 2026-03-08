# Phase 1: SEO Foundations - Research

**Researched:** 2026-03-05
**Domain:** Next.js 15 App Router SEO -- sitemaps, metadata, JSON-LD structured data, 301 redirects
**Confidence:** HIGH

## Summary

Phase 1 implements SEO foundations for the BeauTeas Shopify-to-Mercora migration. The work covers seven requirements (SEO-01 through SEO-07): dynamic sitemap generation, `generateMetadata()` for product and category pages, JSON-LD structured data (Product, Organization, Breadcrumb), and 301 redirects from Shopify URL patterns.

The existing codebase has a static `public/sitemap.xml` (hardcoded categories, no products) and a static `public/robots.txt`. Neither product pages nor category pages have `generateMetadata()` -- the root layout has only a basic static `metadata` export with brand name and description. The CMS `[slug]` pages already have `generateMetadata()` with OG tags and canonical URLs, which serves as a working reference pattern.

**Primary recommendation:** Use Next.js 15 built-in file conventions (`app/sitemap.ts`, `generateMetadata()`) and inline `<script type="application/ld+json">` tags for all SEO work. No new npm packages needed. The constraint "no new npm dependencies" means `schema-dts` cannot be used; define JSON-LD types manually with TypeScript interfaces.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SEO-01 | Dynamic sitemap at `/sitemap.xml` includes all products, categories, and CMS pages | Next.js `app/sitemap.ts` convention generates XML from async function; replaces static `public/sitemap.xml` |
| SEO-02 | Product pages have `generateMetadata()` with title, description, canonical URL, OG tags, Twitter cards | Next.js `generateMetadata()` with `openGraph`, `twitter`, and `alternates.canonical` fields; product data already available via `getProductBySlug()` |
| SEO-03 | Category pages have `generateMetadata()` with title, description, canonical URL, OG tags | Same pattern as SEO-02; category data available via `getCategoryBySlug()` with SEO fields on the category model |
| SEO-04 | Product pages include JSON-LD Product schema with pricing, availability, aggregate ratings | Inline `<script>` tag in product page.tsx; product model has `rating`, `variants[].price`, `variants[].inventory` |
| SEO-05 | Root layout includes JSON-LD Organization schema for BeauTeas | Inline `<script>` tag in `app/layout.tsx`; brand config has name, description, social links |
| SEO-06 | Product and category pages include JSON-LD Breadcrumb schema | Inline `<script>` tag alongside Product/Category JSON-LD; path data derivable from slug and category hierarchy |
| SEO-07 | Shopify URLs redirect via 301 to Mercora equivalents | `next.config.ts` `redirects()` with path pattern matching; stub redirects now, Phase 4 populates full redirect map |
</phase_requirements>

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Next.js | 15.3.5 | App Router sitemap.ts, generateMetadata(), JSON-LD rendering | Built-in SEO file conventions -- no external library needed |
| TypeScript | 5.x | Type-safe JSON-LD interfaces, Metadata types | Already in project; `import type { Metadata } from "next"` |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Drizzle ORM | 0.35.2 | Query products, categories, pages for sitemap and metadata | Data fetching in `sitemap.ts` and `generateMetadata()` |
| brand.config | n/a | Organization schema data (name, description, social links) | JSON-LD Organization schema in root layout |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Manual JSON-LD types | `schema-dts` (Google) | Provides typed schema.org -- but project has "no new dependencies" constraint |
| `app/sitemap.ts` | `next-sitemap` package | External package, unnecessary -- built-in convention is sufficient for ~30 products |
| `next.config.ts` redirects | Middleware redirects | Middleware runs on every request; `next.config.ts` redirects are handled by the router and more performant for static patterns |

**Installation:**
```bash
# No new packages needed -- all capabilities exist in current stack
```

## Architecture Patterns

### Recommended File Structure

```
app/
  sitemap.ts                    # SEO-01: Dynamic sitemap (replaces public/sitemap.xml)
  layout.tsx                    # SEO-05: Add Organization JSON-LD
  product/
    [slug]/
      page.tsx                  # SEO-02, SEO-04, SEO-06: Add generateMetadata + Product JSON-LD + Breadcrumb JSON-LD
  category/
    [slug]/
      page.tsx                  # SEO-03, SEO-06: Add generateMetadata + Breadcrumb JSON-LD
lib/
  seo/
    json-ld.ts                  # Shared JSON-LD builder functions (Product, Organization, Breadcrumb)
    metadata.ts                 # Shared metadata helper (site URL, OG image defaults)
next.config.ts                  # SEO-07: Shopify redirect rules
```

### Pattern 1: Dynamic Sitemap via File Convention

**What:** Replace static `public/sitemap.xml` with `app/sitemap.ts` that queries DB for products, categories, and pages.
**When to use:** Always -- this is the Next.js 15 standard approach.
**Key detail:** In Next.js 15, `app/sitemap.ts` generates XML dynamically on every request (not build-time static like Next.js 14). The function must be the default export and return `MetadataRoute.Sitemap`.

```typescript
// Source: https://nextjs.org/docs/app/api-reference/file-conventions/metadata/sitemap
import type { MetadataRoute } from "next";

const BASE_URL = "https://beauteas.com";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [products, categories, pages] = await Promise.all([
    listProducts({ status: ["active"] }),
    listCategories({ status: "active" }),
    getPublishedPages(),
  ]);

  const productUrls = products.map((p) => ({
    url: `${BASE_URL}/product/${typeof p.slug === "string" ? p.slug : Object.values(p.slug)[0]}`,
    lastModified: p.updated_at ? new Date(p.updated_at) : new Date(),
    changeFrequency: "weekly" as const,
    priority: 0.8,
  }));

  // ... categories, pages, static pages
  return [homepage, ...categoryUrls, ...productUrls, ...pageUrls];
}
```

**CRITICAL:** Delete `public/sitemap.xml` after creating `app/sitemap.ts`. If both exist, the static file takes precedence (it is served by the asset handler before the route handler runs).

### Pattern 2: generateMetadata with Product Data

**What:** Export async `generateMetadata()` from product and category page.tsx files.
**When to use:** Every page that needs unique title, description, OG tags.
**Key detail:** In Next.js 15, `params` is a Promise that must be awaited.

```typescript
// Source: https://nextjs.org/docs/app/api-reference/functions/generate-metadata
import type { Metadata } from "next";

const BASE_URL = "https://beauteas.com";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const product = await getProductBySlug(slug);
  if (!product) return { title: "Product Not Found" };

  const name = typeof product.name === "string" ? product.name : product.name?.en || "";
  const description = typeof product.description === "string"
    ? product.description
    : product.description?.en || "";
  const imageUrl = product.primary_image?.file?.url || product.primary_image?.url || "";

  return {
    title: product.seo?.meta_title || name,
    description: product.seo?.meta_description || description,
    alternates: {
      canonical: `${BASE_URL}/product/${slug}`,
    },
    openGraph: {
      title: product.seo?.meta_title || name,
      description: product.seo?.meta_description || description,
      url: `${BASE_URL}/product/${slug}`,
      siteName: "BeauTeas",
      images: imageUrl ? [{ url: imageUrl, alt: name }] : [],
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: product.seo?.meta_title || name,
      description: product.seo?.meta_description || description,
      images: imageUrl ? [imageUrl] : [],
    },
  };
}
```

### Pattern 3: JSON-LD via Inline Script Tag

**What:** Render JSON-LD as `<script type="application/ld+json">` in page component return.
**When to use:** Product pages (Product + Breadcrumb), category pages (Breadcrumb), root layout (Organization).
**Key detail:** Use `JSON.stringify(jsonLd).replace(/</g, '\\u003c')` for XSS prevention per Next.js official docs. This is the officially recommended sanitization approach.

```typescript
// Source: https://nextjs.org/docs/app/guides/json-ld
// The replace() call prevents XSS by escaping HTML angle brackets in JSON output
function JsonLdScript({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      // eslint-disable-next-line -- official Next.js pattern for JSON-LD injection
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(data).replace(/</g, "\\u003c"),
      }}
    />
  );
}
```

Usage in a page component:

```typescript
export default async function ProductPage({ params }: any) {
  const { slug } = await params;
  const product = await getProductBySlug(slug);
  if (!product) return notFound();

  const productLd = buildProductJsonLd(product, `https://beauteas.com/product/${slug}`);
  const breadcrumbLd = buildBreadcrumbJsonLd([
    { name: "Home", url: "https://beauteas.com" },
    { name: categoryName, url: `https://beauteas.com/category/${categorySlug}` },
    { name: productName },
  ]);

  return (
    <main>
      <JsonLdScript data={productLd} />
      <JsonLdScript data={breadcrumbLd} />
      {/* ... page content */}
    </main>
  );
}
```

### Pattern 4: Config-Based Redirects for Shopify URLs

**What:** Add `redirects()` to `next.config.ts` for Shopify URL patterns.
**When to use:** Static URL pattern redirects (slug mapping is known).
**Key detail:** `permanent: true` uses 308 (not 301). For true 301, use `statusCode: 301`. However, 308 is the modern equivalent and preserves request method. Google treats 308 the same as 301 for SEO purposes.

```typescript
// Source: https://nextjs.org/docs/app/api-reference/config/next-config-js/redirects
async redirects() {
  return [
    {
      source: "/products/:slug",
      destination: "/product/:slug",
      permanent: true, // 308 permanent redirect
    },
    {
      source: "/collections/:slug",
      destination: "/category/:slug",
      permanent: true,
    },
    {
      source: "/pages/:slug",
      destination: "/:slug",
      permanent: true,
    },
  ];
},
```

### Pattern 5: metadataBase for URL Resolution

**What:** Set `metadataBase` in root layout to avoid repeating full URLs.
**When to use:** Always in root layout; child segments can use relative paths.

```typescript
// app/layout.tsx
export const metadata: Metadata = {
  metadataBase: new URL("https://beauteas.com"),
  title: {
    default: "BeauTeas",
    template: "%s | BeauTeas",
  },
  description: brand.description,
};
```

### Anti-Patterns to Avoid

- **Putting JSON-LD in `<head>` manually:** Next.js manages `<head>` through the Metadata API. Use inline `<script>` tags in the component body instead. Google reads JSON-LD from anywhere in the HTML.
- **Using `next-seo` or `next-sitemap` packages:** Unnecessary overhead. Next.js 15 has first-class support for all SEO features.
- **Keeping `public/sitemap.xml` alongside `app/sitemap.ts`:** The static file wins. Delete the static file.
- **Keeping `public/robots.txt` as static:** It hardcodes the sitemap URL. If we move sitemap to `app/sitemap.ts`, the robots.txt reference is fine since the URL stays `/sitemap.xml`, but robots.txt should still be accurate.
- **Omitting XSS sanitization in JSON-LD:** Always use `.replace(/</g, '\\u003c')` on JSON.stringify output.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Sitemap XML generation | Custom XML string builder | `app/sitemap.ts` returning `MetadataRoute.Sitemap` | Next.js handles XML serialization, proper headers, schema namespace |
| Metadata tag rendering | Manual `<meta>` tags in `<head>` | `generateMetadata()` returning `Metadata` object | Next.js handles merging, deduplication, proper OG/Twitter tag format |
| Canonical URL construction | String concatenation per page | `metadataBase` + `alternates.canonical` | Automatic URL resolution, no duplicate slash issues |
| Redirect matching | Custom middleware regex | `next.config.ts` `redirects()` | Built-in path-to-regexp matching, proper HTTP status codes |

**Key insight:** Next.js 15 has comprehensive built-in SEO support. Every SEO requirement in this phase maps to a built-in file convention or API. The only custom code needed is JSON-LD builder functions and data transformation.

## Common Pitfalls

### Pitfall 1: Static public/sitemap.xml Shadowing Dynamic app/sitemap.ts

**What goes wrong:** Both files exist, static file is served instead of dynamic one.
**Why it happens:** Next.js serves `public/` files before route handlers. The existing `public/sitemap.xml` will take precedence.
**How to avoid:** Delete `public/sitemap.xml` when creating `app/sitemap.ts`.
**Warning signs:** Sitemap does not update after adding new products.

### Pitfall 2: Params as Promise in Next.js 15

**What goes wrong:** `params.slug` is undefined or a Promise object instead of a string.
**Why it happens:** Next.js 15 changed `params` to be a Promise that must be awaited: `const { slug } = await params`.
**How to avoid:** Always destructure params with `await`: `const { slug } = await params;`
**Warning signs:** TypeScript error about Promise, or slug is `[object Promise]`.

### Pitfall 3: Money Amount in Cents vs Dollars for Product Schema

**What goes wrong:** Product schema shows price as 1999 instead of 19.99.
**Why it happens:** The MACH data model stores prices as `Money { amount: number, currency: string }` where amount is in cents.
**How to avoid:** Divide `amount` by 100 when building JSON-LD: `price: (variant.price.amount / 100).toFixed(2)`.
**Warning signs:** Google Rich Results Test shows unreasonable prices.

### Pitfall 4: Localized Fields (name/description as string | Record)

**What goes wrong:** Product name renders as `[object Object]` in metadata.
**Why it happens:** MACH model allows `name` and `description` to be either `string` or `Record<string, string>` for localization.
**How to avoid:** Always resolve localized fields: `typeof name === "string" ? name : name?.en || ""`.
**Warning signs:** OG tags or JSON-LD contain `[object Object]`.

### Pitfall 5: Missing Image URL Resolution

**What goes wrong:** OG image or JSON-LD image is a relative path or missing.
**Why it happens:** Product `primary_image` can be a `Media` object with nested URL, a string, or null. R2 paths may be relative.
**How to avoid:** Create a helper to resolve image URLs to absolute URLs, handling all Media object shapes (see existing `getCategoryImageUrl` pattern in category page).
**Warning signs:** Social share previews show no image; Rich Results Test warns about missing image.

### Pitfall 6: Metadata Shallow Merge Overwriting Parent OG Tags

**What goes wrong:** Product page defines `openGraph.title` but loses parent `openGraph.siteName`.
**Why it happens:** Next.js metadata merging is shallow -- defining any `openGraph` field in a child segment replaces the entire parent `openGraph` object.
**How to avoid:** Always include all needed OG fields in each page's `generateMetadata()`, or use shared metadata objects.
**Warning signs:** Missing OG site_name or other tags that were only in the parent layout.

### Pitfall 7: force-dynamic on Root Layout Affecting Sitemap Caching

**What goes wrong:** Sitemap is regenerated on every single request, causing unnecessary DB load.
**Why it happens:** Root layout has `export const dynamic = "force-dynamic"` which propagates.
**How to avoid:** The `app/sitemap.ts` is a special route handler with its own caching behavior. It will be dynamic since it uses DB queries (Dynamic API). For ~30 products this is fine. If performance becomes a concern, the sitemap function could cache results.
**Warning signs:** Slow sitemap responses under load.

## Code Examples

Verified patterns from official sources:

### Product JSON-LD Builder

```typescript
// lib/seo/json-ld.ts
// Source: https://developers.google.com/search/docs/appearance/structured-data/product-snippet

interface ProductJsonLd {
  "@context": "https://schema.org";
  "@type": "Product";
  name: string;
  description?: string;
  image?: string[];
  url: string;
  brand?: { "@type": "Brand"; name: string };
  offers?: {
    "@type": "Offer" | "AggregateOffer";
    price?: string;
    lowPrice?: string;
    highPrice?: string;
    priceCurrency: string;
    availability: string;
    url: string;
  };
  aggregateRating?: {
    "@type": "AggregateRating";
    ratingValue: number;
    reviewCount: number;
    bestRating?: number;
  };
}

const AVAILABILITY_MAP: Record<string, string> = {
  in_stock: "https://schema.org/InStock",
  out_of_stock: "https://schema.org/OutOfStock",
  backorder: "https://schema.org/BackOrder",
  preorder: "https://schema.org/PreOrder",
};

export function buildProductJsonLd(product: Product, url: string): ProductJsonLd {
  const name = typeof product.name === "string" ? product.name : product.name?.en || "";
  const description = typeof product.description === "string"
    ? product.description : product.description?.en || "";
  const images = resolveProductImages(product);

  const defaultVariant = product.variants?.find(v => v.id === product.default_variant_id)
    || product.variants?.[0];

  const jsonLd: ProductJsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name,
    description: description || undefined,
    image: images.length > 0 ? images : undefined,
    url,
  };

  if (product.brand) {
    jsonLd.brand = { "@type": "Brand", name: product.brand };
  }

  if (defaultVariant) {
    const inventoryStatus = defaultVariant.inventory?.status || "out_of_stock";
    jsonLd.offers = {
      "@type": "Offer",
      price: (defaultVariant.price.amount / 100).toFixed(2),
      priceCurrency: defaultVariant.price.currency || "USD",
      availability: AVAILABILITY_MAP[inventoryStatus] || AVAILABILITY_MAP.out_of_stock,
      url,
    };
  }

  if (product.rating && product.rating.count > 0) {
    jsonLd.aggregateRating = {
      "@type": "AggregateRating",
      ratingValue: product.rating.average,
      reviewCount: product.rating.count,
      bestRating: 5,
    };
  }

  return jsonLd;
}
```

### Organization JSON-LD Builder

```typescript
// lib/seo/json-ld.ts
// Source: https://developers.google.com/search/docs/appearance/structured-data/organization

interface OrganizationJsonLd {
  "@context": "https://schema.org";
  "@type": "Organization";
  name: string;
  description: string;
  url: string;
  logo?: string;
  sameAs?: string[];
}

export function buildOrganizationJsonLd(): OrganizationJsonLd {
  const socialLinks = Object.values(brand.social).filter(Boolean);

  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: brand.name,
    description: brand.description,
    url: "https://beauteas.com",
    logo: "https://beauteas.com/favicon.ico", // Update if better logo exists
    sameAs: socialLinks.length > 0 ? socialLinks : undefined,
  };
}
```

### BreadcrumbList JSON-LD Builder

```typescript
// lib/seo/json-ld.ts
// Source: https://developers.google.com/search/docs/appearance/structured-data/breadcrumb

interface BreadcrumbItem {
  name: string;
  url?: string;
}

interface BreadcrumbListJsonLd {
  "@context": "https://schema.org";
  "@type": "BreadcrumbList";
  itemListElement: Array<{
    "@type": "ListItem";
    position: number;
    name: string;
    item?: string;
  }>;
}

export function buildBreadcrumbJsonLd(items: BreadcrumbItem[]): BreadcrumbListJsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem" as const,
      position: index + 1,
      name: item.name,
      ...(item.url ? { item: item.url } : {}),
    })),
  };
}
```

### Shared JSON-LD Render Helper

```typescript
// lib/seo/json-ld.ts
// Source: https://nextjs.org/docs/app/guides/json-ld
// XSS prevention: .replace(/</g, "\\u003c") escapes HTML angle brackets
// so injected <script> tags in product names cannot execute

export function JsonLdScript({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(data).replace(/</g, "\\u003c"),
      }}
    />
  );
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Static `public/sitemap.xml` | `app/sitemap.ts` dynamic generation | Next.js 13.3+ | Sitemap auto-updates with DB content |
| `next-seo` package for metadata | Built-in `generateMetadata()` | Next.js 13.2+ | No external dependency needed |
| `params` as plain object | `params` as Promise (must await) | Next.js 15 | Breaking change -- all dynamic route pages affected |
| `next-sitemap` for generation | `app/sitemap.ts` convention | Next.js 13.3+ | Built-in, no build step needed |
| Separate `viewport` in metadata | `generateViewport()` / `viewport` export | Next.js 14+ | viewport/themeColor moved out of metadata |

**Deprecated/outdated:**
- `themeColor` and `colorScheme` in metadata object: deprecated in Next.js 14, use `viewport` config
- `next-seo` package: unnecessary since Next.js 13.2 built-in Metadata API
- Build-time sitemap generation: Next.js 15 generates sitemaps dynamically per-request

## Open Questions

1. **Product image absolute URLs**
   - What we know: Products use R2 storage. The category page has a helper `getCategoryImageUrl()` that constructs `https://beauteas-images.beauteas.com/` prefixed URLs for relative paths.
   - What's unclear: Whether the same R2 URL pattern applies to product images, and whether all product images are absolute URLs or need resolution.
   - Recommendation: Inspect actual product data in D1 to verify image URL format. Create a shared `resolveImageUrl()` helper.

2. **Sitemap base URL configuration**
   - What we know: The domain is `beauteas.com`. It appears in the static sitemap and robots.txt.
   - What's unclear: Whether a `SITE_URL` env var or config value exists, or if we should hardcode it.
   - Recommendation: Add `siteUrl` to `brand.config.ts` or create a constant in `lib/seo/metadata.ts`. Hardcoding is acceptable for a single-domain site.

3. **SEO-07 redirect completeness (Phase 1 vs Phase 4)**
   - What we know: STATE.md says "Phase 1 stubs redirects, Phase 4 populates them." MIGR-08 generates the full redirect map from migrated data.
   - What's unclear: Which redirects can be stubbed now vs which need migration data.
   - Recommendation: Stub the three pattern-based redirects (`/products/:slug` -> `/product/:slug`, `/collections/:slug` -> `/category/:slug`, `/pages/:slug` -> `/:slug`) in `next.config.ts`. These cover the structural URL differences. Phase 4 adds any product-specific slug changes (if Shopify slugs differ from Mercora slugs).

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | None -- no test framework installed |
| Config file | none -- see Wave 0 |
| Quick run command | `npm run lint` (ESLint only) |
| Full suite command | `npm run lint` |

### Phase Requirements -> Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SEO-01 | Sitemap returns valid XML with products, categories, pages | smoke | `curl -s localhost:3000/sitemap.xml \| head -5` | N/A -- manual |
| SEO-02 | Product page renders OG tags and canonical URL | smoke | `curl -s localhost:3000/product/[slug] \| grep 'og:title'` | N/A -- manual |
| SEO-03 | Category page renders OG tags and canonical URL | smoke | `curl -s localhost:3000/category/[slug] \| grep 'og:title'` | N/A -- manual |
| SEO-04 | Product page includes Product JSON-LD | smoke | `curl -s localhost:3000/product/[slug] \| grep 'application/ld+json'` | N/A -- manual |
| SEO-05 | Root layout includes Organization JSON-LD | smoke | `curl -s localhost:3000/ \| grep 'Organization'` | N/A -- manual |
| SEO-06 | Product/category pages include BreadcrumbList JSON-LD | smoke | `curl -s localhost:3000/product/[slug] \| grep 'BreadcrumbList'` | N/A -- manual |
| SEO-07 | Shopify URL patterns return 301/308 redirects | smoke | `curl -sI localhost:3000/products/test \| grep -i location` | N/A -- manual |

### Sampling Rate

- **Per task commit:** `npm run lint` + manual curl check of affected page
- **Per wave merge:** Full lint + curl-based smoke tests for all 7 requirements
- **Phase gate:** All 7 curl checks pass + Google Rich Results Test validates product page

### Wave 0 Gaps

No test framework exists in the project. Given that:
1. This phase is primarily about server-rendered HTML output (metadata tags, JSON-LD, sitemap XML)
2. The project has "no new npm dependencies" constraint
3. All verification is best done via curl/browser inspection and Google's Rich Results Test

**Recommendation:** Skip formal test infrastructure for Phase 1. Use curl-based smoke tests and the Rich Results Test validator. Test framework setup can be deferred to Phase 2 where business logic testing becomes critical.

## Sources

### Primary (HIGH confidence)
- [Next.js sitemap.ts docs](https://nextjs.org/docs/app/api-reference/file-conventions/metadata/sitemap) - Complete sitemap API, MetadataRoute.Sitemap type, image/video support
- [Next.js generateMetadata docs](https://nextjs.org/docs/app/api-reference/functions/generate-metadata) - Full Metadata type, openGraph, twitter, alternates fields, merging behavior
- [Next.js JSON-LD guide](https://nextjs.org/docs/app/guides/json-ld) - Official recommended approach (inline script tag), XSS prevention, schema-dts typing
- [Next.js redirects config](https://nextjs.org/docs/app/api-reference/config/next-config-js/redirects) - Path matching, wildcard patterns, permanent vs temporary, 308 vs 301
- [Google Product structured data](https://developers.google.com/search/docs/appearance/structured-data/product-snippet) - Required Product properties, Offer properties, AggregateRating
- [Google BreadcrumbList structured data](https://developers.google.com/search/docs/appearance/structured-data/breadcrumb) - ListItem required properties, position/name/item
- [Google Organization structured data](https://developers.google.com/search/docs/appearance/structured-data/organization) - Recommended properties (name, url, logo, sameAs)

### Secondary (MEDIUM confidence)
- Existing codebase `app/[slug]/page.tsx` - Working `generateMetadata()` reference pattern with OG tags and canonical URLs

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All built-in Next.js 15 features, verified against official docs (v16.1.6 docs, backwards compatible)
- Architecture: HIGH - Patterns directly from Next.js official documentation and existing codebase conventions
- Pitfalls: HIGH - Verified through official docs (params Promise change) and codebase inspection (MACH localized fields, Money amounts in cents)
- JSON-LD schemas: HIGH - Verified against Google Search Central documentation

**Research date:** 2026-03-05
**Valid until:** 2026-04-05 (30 days -- stable domain, Next.js 15 well-established)
