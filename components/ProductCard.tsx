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
import { isSellableVariant } from "@/lib/config/commerce";
import { getLightBlurPlaceholder } from "@/lib/utils/image-placeholders";
import { normalizeProductRating } from "@/lib/utils/ratings";
import { resolveProductImageSrc } from "@/lib/utils/product-image";
import { StarRating } from "@/components/reviews/StarRating";
import { stateStyles } from "@/lib/ui/state-styles";
import { Money } from "@/lib/money";
import { boxesLeft, isSoldByTheBox } from "@/lib/sale/year-supply";
import BoxesLeft from "@/components/sale/BoxesLeft";

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
  // Get default or first SELLABLE variant. A withdrawn variant (e.g. the
  // discontinued 3-box packs) must never drive the card's price or
  // availability, even if it happens to be the product's default_variant_id.
  const variants = (product.variants || []).filter((v) => isSellableVariant(v));
  const defaultVariant: ProductVariant | undefined =
    variants.find((v) => v.id === product.default_variant_id) || variants[0];

  // Price logic (amounts are integer minor units)
  const price = defaultVariant?.price?.amount ?? null;
  const currency = defaultVariant?.price?.currency ?? "USD";
  const compareAt = defaultVariant?.compare_at_price?.amount;
  const onSale = compareAt && compareAt > (price ?? 0);

  // Availability logic. `boxesLeft` (not `?? 0`) so an untracked or
  // backorder-allowed variant reads as unlimited rather than sold out - the
  // same semantics isVariantAvailable and hasAvailableStock already use.
  // `defaultVariant` can itself be undefined (every variant withdrawn, e.g.
  // migration 0028) - boxesLeft(undefined) would also return null via its
  // "no inventory record" case, which reads as unlimited/available. A
  // product with no sellable variant at all is never available, so that case
  // is forced to 0 rather than handed to boxesLeft.
  const boxes = defaultVariant ? boxesLeft(defaultVariant) : 0;
  const availability = boxes === 0 ? "coming_soon" : "available";

  // ...but "boxes" is only the honest unit for the tea blends. This card is
  // also drawn for drinkware, mugs, gift cards and the multi-box bundles -
  // PDP recommendations pull from the whole active catalog - and a travel mug
  // reading "25 boxes left" is a unit lie. Everything that is not stocked by
  // the box keeps the In Stock / Sold out label this card carried before the
  // closing sale. See isSoldByTheBox in lib/sale/year-supply.ts.
  const soldByTheBox = isSoldByTheBox(product);

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
  // Both stored shapes, flat ({url}) and MACH ({file:{url}}), resolve here. This
  // used to read `img.url` only, so a product saved through /admin/products —
  // which writes the MACH shape — silently lost its card image to the
  // placeholder while its PDP kept working. See lib/utils/product-image.ts.
  const imageUrl = resolveProductImageSrc(product.primary_image, product.media);
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
          {/*
            Box-stocked products (the tea blends) get the closing-sale count;
            everything else gets the pre-sale label. In the box branch,
            BoxesLeft owns the sold-out label: it renders "Sold out" itself
            at boxes === 0 (both the no-sellable-variant case, forced to 0
            above, and a tracked variant actually at zero). The paragraph
            beside it only ever adds "In Stock" on top of that - never a
            second "Sold out" - so the card shows exactly one sold-out
            message, not two.
          */}
          {soldByTheBox ? (
            <>
              <BoxesLeft boxes={boxes} />
              {availability === "available" && (
                <p className={`mt-2 text-xs ${stateStyles.inStock}`}>In Stock</p>
              )}
            </>
          ) : (
            <p
              className={`mt-2 text-xs ${
                availability === "available"
                  ? stateStyles.inStock
                  : stateStyles.outOfStock
              }`}
            >
              {availability === "available" ? "In Stock" : "Sold out"}
            </p>
          )}

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
