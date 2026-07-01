/**
 * === Product Display Component ===
 *
 * A comprehensive product detail view component that showcases individual
 * products with interactive image gallery, product information, and cart
 * functionality. Designed for optimal user experience on product pages.
 *
 * === Features ===
 * - **Interactive Image Gallery**: Primary image with thumbnail navigation
 * - **Product Information**: Name, pricing, availability, and variant selection
 * - **Cart Integration**: Add to cart functionality with toast notifications
 * - **Responsive Design**: Mobile-first layout with desktop enhancements
 * - **Image Optimization**: Next.js Image component with proper sizing
 * - **Visual Feedback**: Selected thumbnail highlighting and hover states
 * - **AI Recommendations**: Integrated ProductRecommendations component
 * - **Tabbed Content**: Details and reviews separated for a cleaner layout
 *
 * === Usage ===
 * ```tsx
 * <ProductDisplay
 *   product={productData}
 *   reviews={reviewList}
 *   reviewEligibility={eligibility}
 * />
 * ```
 *
 * === Props ===
 * @param product - Product object containing all product information
 * @param reviews - Published product reviews to surface on the product page
 * @param reviewEligibility - Review eligibility data for the authenticated viewer
 */

"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { Check } from "lucide-react";
import ProductRecommendations from "@/components/ProductRecommendations";
import { StarRating } from "@/components/reviews/StarRating";
import { ProductReviewsSection } from "@/components/reviews/ProductReviewsSection";
import { useCartStore } from "@/lib/stores/cart-store";
import { useCartUIStore } from "@/lib/stores/cart-ui-store";
import { normalizeProductRating } from "@/lib/utils/ratings";
import { toast } from "sonner";
import type { Product, Review, ProductReviewEligibility } from "@/lib/types";
import type { SubscriptionPlan } from "@/lib/types/subscription";
import SubscriptionToggle from "@/components/subscription/SubscriptionToggle";
import { stateStyles } from "@/lib/ui/state-styles";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface ProductDisplayProps {
  product: Product;
  reviews: Review[];
  reviewEligibility?: ProductReviewEligibility;
  subscriptionPlans?: SubscriptionPlan[];
}

function getMediaUrl(media: any): string {
  if (!media) return "/placeholder.svg";
  if (typeof media === "string") return media;
  return media.file?.url || "/placeholder.svg";
}

function stringifyDescription(description: Product["description"]): string {
  if (!description) return "";
  if (typeof description === "string") return description;
  if (typeof description === "object") {
    const firstValue = Object.values(description as Record<string, unknown>).find(
      (entry) => typeof entry === "string" && entry.trim().length
    );
    if (typeof firstValue === "string") {
      return firstValue;
    }
  }
  return "";
}

/**
 * Normalize a description into clean paragraphs. Blank lines become paragraph
 * breaks; stray single newlines collapse to spaces. This keeps the copy tight
 * regardless of how the source content (seed, ETL, admin editor) was formatted,
 * avoiding the "overly spaced out" wall of whitespace `whitespace-pre-line` produced.
 */
function formatDescriptionParagraphs(description: Product["description"]): string[] {
  const raw = stringifyDescription(description);
  if (!raw) return [];
  return raw
    .split(/\n\s*\n+/)
    .map((paragraph) => paragraph.replace(/\s*\n\s*/g, " ").replace(/\s{2,}/g, " ").trim())
    .filter(Boolean);
}

interface ProductExtensions {
  ingredients?: string;
  caffeine?: string;
  servings?: string;
  benefits?: string[];
  certifications?: string[];
  brewing?: { temp?: string; time?: string };
}

function titleCase(value: string): string {
  return value
    .split(/[\s-]+/)
    .map((word) => (word ? word[0].toUpperCase() + word.slice(1) : word))
    .join(" ");
}

/** Structured "at a glance" facts derived from a product's extensions. */
function buildProductSpecs(ext: ProductExtensions): Array<{ label: string; value: string }> {
  const specs: Array<{ label: string; value: string }> = [];
  if (ext.caffeine) specs.push({ label: "Caffeine", value: titleCase(ext.caffeine) });
  if (ext.servings) specs.push({ label: "Servings", value: ext.servings });
  if (ext.brewing?.temp) specs.push({ label: "Brew temp", value: ext.brewing.temp });
  if (ext.brewing?.time) specs.push({ label: "Steep time", value: ext.brewing.time });
  if (Array.isArray(ext.certifications) && ext.certifications.length) {
    specs.push({ label: "Certified", value: ext.certifications.join(", ") });
  }
  return specs;
}

export default function ProductDisplay({
  product,
  reviews,
  reviewEligibility,
  subscriptionPlans = [],
}: ProductDisplayProps) {
  const allImages = useMemo(() => {
    try {
      const primaryImg = (product.primary_image as any)?.url || (product.primary_image as any)?.file?.url;
      const mediaImages = Array.isArray(product.media)
        ? product.media
            .map((item: any) => {
              try {
                return item?.url || item?.file?.url;
              } catch (error) {
                return null;
              }
            })
            .filter(Boolean)
        : [];
      return Array.from(new Set([primaryImg, ...mediaImages].filter(Boolean))) as string[];
    } catch (error) {
      console.warn("Error processing product images:", error);
      return ["/placeholder.svg"];
    }
  }, [product.media, product.primary_image]);

  const [selectedImage, setSelectedImage] = useState<string | null>(allImages[0] || "/placeholder.svg");
  const [activeTab, setActiveTab] = useState<"details" | "reviews">("details");

  // Variant selection state
  const variants = product.variants || [];
  const defaultVariant = variants.find((variant) => variant.id === product.default_variant_id) || variants[0];
  const [selectedVariantId, setSelectedVariantId] = useState<string | undefined>(defaultVariant?.id);
  const selectedVariant = variants.find((variant) => variant.id === selectedVariantId) || defaultVariant;

  // Price logic (MACH: price is on variant)
  const price = selectedVariant?.price?.amount ?? 0;
  const compareAt = selectedVariant?.compare_at_price?.amount;
  const onSale = compareAt && compareAt > price;

  // Stock logic (MACH: inventory is on variant)
  const quantityInStock = selectedVariant?.inventory?.quantity ?? 0;
  const available = quantityInStock > 0;

  const ratingSummary = useMemo(() => normalizeProductRating(product.rating), [product.rating]);
  const descriptionParagraphs = useMemo(
    () => formatDescriptionParagraphs(product.description),
    [product.description]
  );

  const extensions = useMemo(
    () => (product.extensions ?? {}) as ProductExtensions,
    [product.extensions]
  );
  const benefits = useMemo(
    () => (Array.isArray(extensions.benefits) ? extensions.benefits.filter(Boolean) : []),
    [extensions.benefits]
  );
  const specs = useMemo(() => buildProductSpecs(extensions), [extensions]);
  const ingredients = extensions.ingredients?.trim();

  const reviewsTabLabel = useMemo(() => {
    if (ratingSummary) {
      return `Reviews · ${ratingSummary.average.toFixed(1)}`;
    }
    if (reviews.length) {
      return `Reviews (${reviews.length})`;
    }
    return "Reviews";
  }, [ratingSummary, reviews.length]);

  return (
    <>
      {/* Main Product Display Grid */}
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2 lg:gap-12">
        {/* Image Gallery Section */}
        <div>
          <div className="relative aspect-[3/4] w-full overflow-hidden rounded bg-surface-light">
            <Image
              src={getMediaUrl(selectedImage)}
              alt={typeof product.name === "string" ? product.name : ""}
              fill
              sizes="(min-width: 1024px) 50vw, 100vw"
              style={{ objectFit: "cover" }}
              className="object-cover"
            />
          </div>

          <div className="mt-3 flex gap-2 overflow-x-auto pb-2 sm:mt-4 sm:gap-3">
            {allImages.map((imageUrl, index) => (
              <button
                type="button"
                key={`thumb-${index}`}
                onClick={() => setSelectedImage(imageUrl)}
                className={`relative h-16 w-16 flex-shrink-0 overflow-hidden rounded border sm:h-20 sm:w-20 ${
                  selectedImage === imageUrl ? "border-primary-500" : "border-border-default"
                }`}
              >
                <Image
                  src={getMediaUrl(imageUrl)}
                  alt={`Thumbnail ${index + 1}`}
                  fill
                  style={{ objectFit: "cover" }}
                />
              </button>
            ))}
          </div>
        </div>

        {/* Product Information Section */}
        <div className="mt-6 lg:mt-0">
          <h1 className="text-2xl font-extrabold sm:text-3xl lg:text-4xl">
            {typeof product.name === "string" ? product.name : ""}
          </h1>

          {ratingSummary ? (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-text-secondary">
              <StarRating value={ratingSummary.average} size="sm" />
              <span>
                {ratingSummary.average.toFixed(1)} · {ratingSummary.count} review{ratingSummary.count === 1 ? "" : "s"}
              </span>
              <button
                type="button"
                onClick={() => setActiveTab("reviews")}
                className="rounded-full border border-transparent px-3 py-1 text-xs font-semibold text-primary-700 transition hover:border-primary-500 hover:text-primary-800"
              >
                Read reviews
              </button>
            </div>
          ) : (
            <p className="mt-3 text-sm text-text-muted">Be the first to share feedback once your order is delivered.</p>
          )}

          <div className="mt-6">
            <div className="rounded-lg border border-border-default bg-white">
              <div className="flex flex-wrap border-b border-border-default">
                <button
                  type="button"
                  onClick={() => setActiveTab("details")}
                  className={`flex-1 px-4 py-3 text-sm font-semibold sm:flex-none sm:px-6 ${
                    activeTab === "details"
                      ? "border-b-2 border-primary-500 text-text-primary"
                      : "text-text-secondary hover:text-text-primary"
                  }`}
                >
                  Details
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("reviews")}
                  className={`flex-1 px-4 py-3 text-sm font-semibold sm:flex-none sm:px-6 ${
                    activeTab === "reviews"
                      ? "border-b-2 border-primary-500 text-text-primary"
                      : "text-text-secondary hover:text-text-primary"
                  }`}
                >
                  {reviewsTabLabel}
                </button>
              </div>
              <div className="p-6">
                {activeTab === "details" ? (
                  <div className="space-y-6 text-sm text-text-secondary">
                    {descriptionParagraphs.length ? (
                      <div className="space-y-3 leading-relaxed">
                        {descriptionParagraphs.map((paragraph, index) => (
                          <p key={`desc-${index}`}>{paragraph}</p>
                        ))}
                      </div>
                    ) : (
                      <p className="text-text-muted">Product description coming soon.</p>
                    )}

                    {benefits.length > 0 && (
                      <div>
                        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-primary">
                          Skin benefits
                        </h3>
                        <ul className="grid grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-2">
                          {benefits.map((benefit, index) => (
                            <li key={`benefit-${index}`} className="flex items-start gap-2">
                              <Check className="mt-0.5 h-4 w-4 flex-shrink-0 text-state-success" aria-hidden="true" />
                              <span>{benefit}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {specs.length > 0 && (
                      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-md bg-surface-light/60 p-4 sm:grid-cols-3">
                        {specs.map((spec) => (
                          <div key={spec.label}>
                            <dt className="text-xs uppercase tracking-wide text-text-muted">{spec.label}</dt>
                            <dd className="mt-0.5 font-medium text-text-primary">{spec.value}</dd>
                          </div>
                        ))}
                      </dl>
                    )}

                    {ingredients && (
                      <div>
                        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-text-primary">
                          Ingredients
                        </h3>
                        <p className="leading-relaxed">{ingredients}</p>
                      </div>
                    )}
                  </div>
                ) : (
                  <ProductReviewsSection
                    reviews={reviews}
                    ratingSummary={ratingSummary}
                    eligibility={reviewEligibility}
                  />
                )}
              </div>
            </div>
          </div>

          <div className="mt-6 space-y-6">
            {variants.length > 1 && (
              <div>
                <label className="mb-2 block text-sm font-medium text-text-primary">Choose an option:</label>
                <Select value={selectedVariantId} onValueChange={setSelectedVariantId}>
                  <SelectTrigger className="w-full border border-border-default bg-white text-text-primary hover:bg-surface-light sm:w-auto">
                    <SelectValue placeholder="Select a variant" />
                  </SelectTrigger>
                  <SelectContent className="bg-white border border-border-default text-text-primary">
                    {variants.map((variant) => {
                      const optionDisplay = variant.option_values?.map((value) => `${value.value}`).join(", ") || `Variant ${variant.id}`;
                      const priceDisplay = variant.price ? `$${(variant.price.amount / 100).toFixed(2)}` : "";

                      return (
                        <SelectItem
                          key={variant.id}
                          value={variant.id}
                          className="text-text-primary hover:bg-surface-light focus:bg-surface-light"
                        >
                          <div className="flex w-full items-center justify-between">
                            <span>{optionDisplay}</span>
                            {priceDisplay && (
                              <span className="ml-2 text-primary-600 font-semibold">{priceDisplay}</span>
                            )}
                          </div>
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>
            )}

            {subscriptionPlans.length > 0 ? (
              <>
                <SubscriptionToggle
                  plans={subscriptionPlans}
                  variantPriceInCents={price}
                  compareAtPriceInCents={compareAt}
                  productSlug={typeof product.slug === "string" ? product.slug : ""}
                  available={available}
                  onAddToCart={() => {
                    const productName = typeof product.name === "string" ? product.name : "";
                    const variantDisplay = selectedVariant?.option_values?.map((value) => `${value.value}`).join(", ") || "";
                    const fullName = variantDisplay ? `${productName} - ${variantDisplay}` : productName;

                    useCartStore.getState().addItem({
                      productId: product.id,
                      variantId: selectedVariant?.id,
                      name: fullName,
                      price: price / 100,
                      quantity: 1,
                      primaryImageUrl: (() => {
                        try {
                          return (
                            (product.primary_image as any)?.url ||
                            (product.primary_image as any)?.file?.url ||
                            "/placeholder.svg"
                          );
                        } catch (error) {
                          return "/placeholder.svg";
                        }
                      })(),
                    });

                    toast("Added to Cart", {
                      description: `${fullName} has been added to your cart.`,
                      icon: "\uD83D\uDD25",
                      action: {
                        label: "View Cart",
                        onClick: () => useCartUIStore.getState().openCart(),
                      },
                    });
                  }}
                />

                {selectedVariant?.inventory && (
                  <p className="text-xs text-text-muted">
                    {quantityInStock > 0 ? `${quantityInStock} in stock` : "Backordered"}
                  </p>
                )}
              </>
            ) : (
              <>
                {onSale ? (
                  <div>
                    <p className={`text-base sm:text-lg ${stateStyles.priceOriginal}`}>${(compareAt! / 100).toFixed(2)}</p>
                    <p className={`text-lg sm:text-xl ${stateStyles.priceSale}`}>${(price / 100).toFixed(2)}</p>
                    <p className="text-xs italic text-primary-600 sm:text-sm">Limited-time offer</p>
                  </div>
                ) : (
                  <p className="text-lg font-semibold text-text-primary sm:text-xl">${(price / 100).toFixed(2)}</p>
                )}

                {selectedVariant?.inventory && (
                  <p className="text-xs text-text-muted">
                    {quantityInStock > 0 ? `${quantityInStock} in stock` : "Backordered"}
                  </p>
                )}

                {available ? (
                  <button
                    className="w-full rounded bg-primary-500 px-6 py-3 font-bold text-text-inverse transition hover:bg-primary-600 sm:w-auto"
                    onClick={() => {
                      const productName = typeof product.name === "string" ? product.name : "";
                      const variantDisplay = selectedVariant?.option_values?.map((value) => `${value.value}`).join(", ") || "";
                      const fullName = variantDisplay ? `${productName} - ${variantDisplay}` : productName;

                      useCartStore.getState().addItem({
                        productId: product.id,
                        variantId: selectedVariant?.id,
                        name: fullName,
                        price: price / 100,
                        quantity: 1,
                        primaryImageUrl: (() => {
                          try {
                            return (
                              (product.primary_image as any)?.url ||
                              (product.primary_image as any)?.file?.url ||
                              "/placeholder.svg"
                            );
                          } catch (error) {
                            return "/placeholder.svg";
                          }
                        })(),
                      });

                      toast("Added to Cart", {
                        description: `${fullName} has been added to your cart.`,
                        icon: "\uD83D\uDD25",
                        action: {
                          label: "View Cart",
                          onClick: () => useCartUIStore.getState().openCart(),
                        },
                      });
                    }}
                  >
                    Add to Cart
                  </button>
                ) : (
                  <p className={`text-lg font-semibold sm:text-xl ${stateStyles.outOfStock}`}>Coming soon</p>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* AI-Powered Product Recommendations */}
      <ProductRecommendations product={product} />
    </>
  );
}
