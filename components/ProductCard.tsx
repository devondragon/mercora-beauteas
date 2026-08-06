/**
 * === Product Card Component ===
 *
 * A reusable product display card component that shows essential product information
 * with consistent styling and interactive behavior. Used throughout the application
 * for product listings, recommendations, and search results.
 *
 * === Features ===
 * - **Responsive Design**: Adapts to different screen sizes and grid layouts
 * - **Image Optimization**: Next.js Image component with lazy loading and optimization
 * - **Price Display**: Handles regular pricing, sale pricing, and discount calculations
 * - **Interactive States**: Hover effects and smooth transitions
 * - **Accessibility**: Proper semantic markup and keyboard navigation
 * - **Loading States**: Graceful handling of missing images or data
 *
 * === Visual Elements ===
 * - **Product Image**: Optimized image with fallback placeholder
 * - **Product Name**: Truncated title with full name on hover
 * - **Short Description**: Brief product description
 * - **Pricing**: Regular price, sale price, and discount percentage
 * - **Availability**: Stock status and availability indicators
 *
 * === Usage ===
 * ```tsx
 * <ProductCard product={productData} />
 * ```
 *
 * === Props ===
 * @param product - Complete Product object with all required fields
 *
 * === Styling ===
 * - Dark theme with neutral colors
 * - Hover effects for better UX
 * - Responsive aspect ratios
 * - Consistent spacing and typography
 */

"use client";

import Link from "next/link";
import Image from "next/image";
import type { Product, ProductVariant } from "@/lib/types";
import { getLightBlurPlaceholder } from "@/lib/utils/image-placeholders";
import { normalizeProductRating } from "@/lib/utils/ratings";
import { StarRating } from "@/components/reviews/StarRating";
import { stateStyles } from "@/lib/ui/state-styles";
import { Money } from "@/lib/money";

/**
 * Props interface for ProductCard component
 */
interface ProductCardProps {
  product: Product;
  priority?: boolean; // For above-the-fold images
}

function formatReviewDate(value?: string) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * ProductCard component for displaying product information in a card layout
 *
 * @param product - Product object containing all product data
 * @param priority - Whether to prioritize image loading (for above-the-fold content)
 * @returns JSX element representing a clickable product card
 */
export default function ProductCard({ product, priority = false }: ProductCardProps) {
  // Get default or first variant
  const variants = product.variants || [];
  const defaultVariant: ProductVariant | undefined =
    variants.find((v) => v.id === product.default_variant_id) || variants[0];

  // Price logic (amounts are integer minor units)
  const price = defaultVariant?.price?.amount ?? null;
  const currency = defaultVariant?.price?.currency ?? "USD";
  const compareAt = defaultVariant?.compare_at_price?.amount;
  const onSale = compareAt && compareAt > (price ?? 0);

  // Availability logic
  const quantityInStock = defaultVariant?.inventory?.quantity ?? 0;
  const availability = quantityInStock > 0 ? "available" : "coming_soon";

  // Name/description/slug logic
  const name =
    typeof product.name === "string"
      ? product.name
      : Object.values(product.name || {})[0] || "";
  const shortDescription =
    typeof product.description === "string"
      ? product.description
      : Object.values(product.description || {})[0] || "";
  const slug =
    typeof product.slug === "string"
      ? product.slug
      : Object.values(product.slug || {})[0] || "";
  // Handle consistent flat JSON structure: {"url": "...", "alt_text": "..."}
  const imageUrl = (() => {
    try {
      if (!product.primary_image) return "/placeholder.svg";
      
      // If it's a JSON string, parse it first
      let imageData = product.primary_image;
      if (typeof imageData === "string" && (imageData as string).startsWith("{")) {
        try {
          imageData = JSON.parse(imageData);
        } catch {
          return "/placeholder.svg";
        }
      }
      
      const img = imageData as any;
      const url = img?.url;
      
      if (!url) return "/placeholder.svg";
      
      return url.startsWith("/") ? url : "/" + url;
    } catch {
      return "/placeholder.svg";
    }
  })();
  const imageAlt = name;
  const ratingSummary = normalizeProductRating(product.rating);
  const hasRatings = Boolean(ratingSummary && ratingSummary.count > 0);
  const lastUpdatedLabel = ratingSummary?.lastPublishedAt
    ? formatReviewDate(ratingSummary.lastPublishedAt)
    : null;

  return (
    <Link href={`/product/${slug}`} prefetch={true}>
      <div className="bg-white border border-border-default rounded-lg overflow-hidden shadow hover:shadow-lg transition cursor-pointer touch-manipulation">
        <div className="relative aspect-[3/4] bg-surface-light">
            <Image
              src={imageUrl}
              alt={imageAlt}
              fill
              sizes="(min-width: 1024px) 33vw, (min-width: 768px) 50vw, 100vw"
              className="object-cover transition-opacity duration-300"
              priority={priority}
              loading={priority ? "eager" : "lazy"}
              fetchPriority={priority ? "high" : "low"}
              placeholder="blur"
              blurDataURL={getLightBlurPlaceholder()}
            />
        </div>
        <div className="p-4 sm:p-4 space-y-3">
          <h3 className="text-text-primary text-lg sm:text-xl font-semibold line-clamp-2 leading-snug">
            {name}
          </h3>
          <p className="text-text-secondary text-sm sm:text-sm line-clamp-2 leading-relaxed">
            {shortDescription}
          </p>
          <div className="flex items-center justify-between gap-2 text-xs sm:text-sm">
            {hasRatings ? (
              <div className="flex items-center gap-2">
                <StarRating value={ratingSummary!.average} size="sm" />
                <span className="text-sm font-semibold text-text-primary">
                  {ratingSummary!.average.toFixed(1)}
                </span>
                <span className="text-xs text-text-secondary">({ratingSummary!.count})</span>
              </div>
            ) : (
              <span className="text-xs text-text-muted">Be the first to review</span>
            )}
            {lastUpdatedLabel && (
              <span className="hidden text-[11px] text-text-muted sm:inline">
                Updated {lastUpdatedLabel}
              </span>
            )}
          </div>
          {price !== null && (
            <div className="text-sm">
              {onSale && compareAt != null ? (
                <div>
                  <span className={`${stateStyles.priceOriginal} mr-2`}>
                    {Money.fromMinor(compareAt, currency).format()}
                  </span>
                  <span className={stateStyles.priceSale}>
                    {Money.fromMinor(price, currency).format()}
                  </span>
                  <span className={`ml-2 text-xs ${stateStyles.priceSale}`}>
                    On Sale
                  </span>
                </div>
              ) : (
                <div className="text-text-primary font-semibold">
                  {Money.fromMinor(price, currency).format()}
                </div>
              )}
            </div>
          )}
          <p
            className={`mt-2 text-xs ${
              availability === "available"
                ? stateStyles.inStock
                : stateStyles.outOfStock
            }`}
          >
            {availability === "available" ? "In Stock" : "Sold out"}
          </p>

          {/*
            Not a <Link>: the whole card is already an anchor to this same href
            (see the wrapping <Link> above). Nesting an <a> inside an <a> is
            invalid, and the HTML parser's adoption-agency algorithm silently
            closes the outer anchor, so the browser's DOM never matches the
            server tree — React discarded the SSR HTML and re-rendered the
            homepage on the client (minified error #418). See BMC-220.
          */}
          <span className="text-primary-700 hover:text-primary-800 hover:underline text-sm font-medium">
            Learn more →
          </span>
        </div>
      </div>
    </Link>
  );
}
