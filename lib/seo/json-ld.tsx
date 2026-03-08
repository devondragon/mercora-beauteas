/**
 * === JSON-LD Structured Data ===
 *
 * Builder functions for schema.org JSON-LD structured data used by Google
 * to generate rich results (product snippets, breadcrumb trails, knowledge panels).
 *
 * All builders return plain objects suitable for JSON serialization.
 * The JsonLdScript component handles XSS-safe rendering into script tags.
 *
 * === Exports ===
 * - JsonLdScript: React server component that renders a JSON-LD script tag
 * - buildProductJsonLd: Builds schema.org Product structured data
 * - buildOrganizationJsonLd: Builds schema.org Organization structured data
 * - buildBreadcrumbJsonLd: Builds schema.org BreadcrumbList structured data
 */

import { resolveLocalizedField, resolveImageUrl, BASE_URL } from "@/lib/seo/metadata";
import { brand } from "@/lib/brand";
import type { MACHProduct } from "@/lib/types/mach/Product";

// ---------------------------------------------------------------------------
// Internal types for JSON-LD structures (not exported)
// ---------------------------------------------------------------------------

interface JsonLdBase {
  "@context": "https://schema.org";
  "@type": string;
  [key: string]: unknown;
}

interface JsonLdOffer {
  "@type": "Offer";
  price: string;
  priceCurrency: string;
  availability: string;
  url?: string;
}

interface JsonLdAggregateOffer {
  "@type": "AggregateOffer";
  lowPrice: string;
  highPrice: string;
  priceCurrency: string;
  offerCount: number;
  availability: string;
  url?: string;
}

interface JsonLdAggregateRating {
  "@type": "AggregateRating";
  ratingValue: number;
  reviewCount: number;
}

interface JsonLdBrand {
  "@type": "Brand";
  name: string;
}

interface JsonLdListItem {
  "@type": "ListItem";
  position: number;
  name: string;
  item?: string;
}

interface BreadcrumbItem {
  name: string;
  url?: string;
}

// ---------------------------------------------------------------------------
// JsonLdScript Component
// ---------------------------------------------------------------------------

/**
 * React server component that renders a JSON-LD script tag with XSS-safe
 * serialization. Uses the official Next.js pattern for injecting structured
 * data via dangerouslySetInnerHTML.
 *
 * The serialization escapes HTML angle brackets (`<`) to their Unicode
 * equivalent (`\u003c`) so that injected `<script>` tags in product names
 * or other user content cannot execute.
 *
 * @param data - A JSON-LD structured data object to serialize
 */
export function JsonLdScript({ data }: { data: Record<string, unknown> }) {
  // XSS-safe JSON-LD serialization: escapes angle brackets to prevent
  // script injection. This is the official Next.js recommended pattern
  // for structured data. See: https://nextjs.org/docs/app/building-your-application/optimizing/metadata#json-ld
  const safeHtml = JSON.stringify(data).replace(/</g, "\\u003c");

  return (
    <script
      type="application/ld+json"
      // eslint-disable-next-line react/no-danger -- Official Next.js JSON-LD pattern with XSS-safe serialization
      dangerouslySetInnerHTML={{ __html: safeHtml }}
    />
  );
}

// ---------------------------------------------------------------------------
// buildProductJsonLd
// ---------------------------------------------------------------------------

/**
 * Builds a schema.org Product JSON-LD object from a MACH product entity.
 *
 * Includes name, description, images, brand, offers (price/availability),
 * and aggregate rating when reviews exist. Price is converted from cents
 * to dollars for schema.org compliance.
 *
 * When multiple variants exist with differing prices, produces an
 * AggregateOffer with lowPrice/highPrice. Otherwise produces a single Offer.
 *
 * @param product - The MACH product entity
 * @param url - Canonical URL for this product page
 * @returns A schema.org Product JSON-LD object
 */
export function buildProductJsonLd(
  product: MACHProduct,
  url: string
): JsonLdBase {
  const name = resolveLocalizedField(product.name);
  const description = resolveLocalizedField(product.description);

  // Resolve images
  const images: string[] = [];
  const primaryImage = resolveImageUrl(product.primary_image);
  if (primaryImage) images.push(primaryImage);
  if (product.media) {
    for (const mediaItem of product.media) {
      const resolved = resolveImageUrl(mediaItem);
      if (resolved && !images.includes(resolved)) {
        images.push(resolved);
      }
    }
  }

  // Find default variant
  const defaultVariant =
    product.variants?.find((v) => v.id === product.default_variant_id) ||
    product.variants?.[0];

  // Build offers
  let offers: JsonLdOffer | JsonLdAggregateOffer | undefined;

  if (defaultVariant && product.variants) {
    const prices = product.variants
      .filter((v) => v.price)
      .map((v) => v.price.amount);
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const currency = defaultVariant.price.currency || "USD";

    // Determine availability from default variant
    const inv = defaultVariant.inventory;
    let availability: string;
    if (!inv || !inv.track_inventory || (inv.quantity != null && inv.quantity > 0)) {
      availability = "https://schema.org/InStock";
    } else if (inv.allow_backorder) {
      availability = "https://schema.org/BackOrder";
    } else {
      availability = "https://schema.org/OutOfStock";
    }

    if (prices.length > 1 && minPrice !== maxPrice) {
      offers = {
        "@type": "AggregateOffer",
        lowPrice: (minPrice / 100).toFixed(2),
        highPrice: (maxPrice / 100).toFixed(2),
        priceCurrency: currency,
        offerCount: product.variants.length,
        availability,
        url,
      };
    } else {
      offers = {
        "@type": "Offer",
        price: (defaultVariant.price.amount / 100).toFixed(2),
        priceCurrency: currency,
        availability,
        url,
      };
    }
  }

  // Build aggregate rating (only if reviews exist)
  let aggregateRating: JsonLdAggregateRating | undefined;
  if (product.rating && product.rating.count > 0) {
    aggregateRating = {
      "@type": "AggregateRating",
      ratingValue: product.rating.average,
      reviewCount: product.rating.count,
    };
  }

  const jsonLd: JsonLdBase = {
    "@context": "https://schema.org",
    "@type": "Product",
    name,
    url,
    brand: {
      "@type": "Brand",
      name: product.brand || "BeauTeas",
    } as JsonLdBrand,
  };

  if (description) jsonLd.description = description;
  if (images.length > 0) jsonLd.image = images;
  if (offers) jsonLd.offers = offers;
  if (aggregateRating) jsonLd.aggregateRating = aggregateRating;

  return jsonLd;
}

// ---------------------------------------------------------------------------
// buildOrganizationJsonLd
// ---------------------------------------------------------------------------

/**
 * Builds a schema.org Organization JSON-LD object from the brand configuration.
 *
 * Includes name, description, URL, logo, and social profile links (sameAs).
 * Social links with empty values are filtered out.
 *
 * @returns A schema.org Organization JSON-LD object
 */
export function buildOrganizationJsonLd(): JsonLdBase {
  const socialLinks = Object.values(brand.social).filter(Boolean) as string[];

  const jsonLd: JsonLdBase = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: brand.name,
    description: brand.description,
    url: BASE_URL,
    logo: `${BASE_URL}/favicon.ico`,
  };

  if (socialLinks.length > 0) {
    jsonLd.sameAs = socialLinks;
  }

  return jsonLd;
}

// ---------------------------------------------------------------------------
// buildBreadcrumbJsonLd
// ---------------------------------------------------------------------------

/**
 * Builds a schema.org BreadcrumbList JSON-LD object from a list of breadcrumb items.
 *
 * Per Google structured data guidelines, the last item in the breadcrumb trail
 * should omit the `item` (URL) property since it represents the current page.
 *
 * @param items - Array of breadcrumb items with name and optional URL
 * @returns A schema.org BreadcrumbList JSON-LD object
 */
export function buildBreadcrumbJsonLd(
  items: BreadcrumbItem[]
): JsonLdBase {
  const itemListElement: JsonLdListItem[] = items.map((item, index) => {
    const listItem: JsonLdListItem = {
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
    };
    if (item.url) {
      listItem.item = item.url;
    }
    return listItem;
  });

  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement,
  };
}
