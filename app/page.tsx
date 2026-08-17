/**
 * === Home Page Component ===
 *
 * The main landing page component that showcases the brand identity and
 * featured products. Designed to create immediate engagement and drive
 * users deeper into the product catalog.
 *
 * === Features ===
 * - **Hero Section**: Bold branding with compelling value proposition
 * - **Featured Products**: Curated selection of top products (3 items)
 * - **Call-to-Action**: Direct link to featured category for exploration
 * - **Responsive Design**: Mobile-first layout with desktop enhancements
 * - **Brand Voice**: Warm, wellness-focused messaging centered on skin health
 * - **Visual Hierarchy**: Strategic typography and spacing for impact
 *
 * === Layout Structure ===
 * - **Hero**: Large heading + description + CTA button
 * - **Products Grid**: 3-column responsive grid of featured products
 * - **Responsive**: 1 column mobile, 2 tablet, 3 desktop
 *
 * === Technical Implementation ===
 * - **Server Component**: Static generation for optimal performance
 * - **Data Loading**: Server-side product fetching with category filtering
 * - **SEO Optimized**: Proper heading hierarchy and semantic markup
 * - **Performance**: Minimal client-side JavaScript, fast initial load
 *
 * === Business Logic ===
 * - Displays first 3 products from "featured" category
 * - Drives traffic to full featured category page
 * - Establishes brand positioning and product appeal
 *
 * === Usage ===
 * This is the root page component rendered at "/"
 * 
 * @returns JSX element with complete home page layout
 */

import Link from "next/link";
import ProductCard from "@/components/ProductCard";
import { getProductsByCategory } from "@/lib/models/mach/products";
import { isPubliclyPurchasableProduct, isSellableVariant } from "@/lib/config/commerce";
import { boxesLeft } from "@/lib/sale/year-supply";

/**
 * Home page component - main landing page for the application
 * 
 * @returns Server-rendered home page with hero section and featured products
 */
export default async function HomePage() {
  // Feature the three time-of-day blends in ritual order (Morning → Afternoon
  // → Evening), excluding bundles like the Mega Month and Sample Pack.
  const TIME_OF_DAY_ORDER = ["morning", "afternoon", "evening"];
  const productKey = (product: { slug?: unknown; name?: unknown }) => {
    const raw = product.slug ?? product.name;
    const value = typeof raw === "string" ? raw : Object.values(raw || {})[0];
    return (typeof value === "string" ? value : "").toLowerCase();
  };
  const featuredProducts = (await getProductsByCategory("cat_clearly_calendula"))
    .filter(isPubliclyPurchasableProduct)
    .map((product) => ({ product, rank: TIME_OF_DAY_ORDER.findIndex((t) => productKey(product).includes(t)) }))
    .filter(({ rank }) => rank !== -1)
    .sort((a, b) => a.rank - b.rank)
    .slice(0, 3)
    .map(({ product }) => product);

  // Live shop total. `force-dynamic` on the root layout overrides this page's
  // `revalidate`, so every request re-renders and the number is current -
  // verified against dev, which returns `cache-control: no-store`.
  //
  // Blends whose count is unknown (untracked / backorder) contribute nothing,
  // and if NONE of them report a number the line is omitted entirely rather
  // than claiming zero boxes remain.
  //
  // Withdrawn variants (e.g. the discontinued 3-box packs from migration
  // 0028) are filtered out before the default/first lookup, same as
  // ProductCard and ProductDisplay - they still carry live inventory, and an
  // unfiltered find/fallback could let a withdrawn variant's stock into a
  // customer-facing total.
  const blendBoxCounts = featuredProducts
    .map((product) => {
      const variants = (product.variants || []).filter((v) => isSellableVariant(v));
      return boxesLeft(variants.find((v) => v.id === product.default_variant_id) ?? variants[0]);
    })
    .filter((count): count is number => count !== null);
  const totalBoxesLeft = blendBoxCounts.length > 0
    ? blendBoxCounts.reduce((sum, count) => sum + count, 0)
    : null;

  return (
    <div className="px-4 sm:px-6 lg:px-12 py-12 sm:py-16">
      {/* Hero Section — GOOB: leads with the closing story, per /thank-you */}
      <section className="max-w-3xl mx-auto text-center mb-16 sm:mb-20">
        {/* The rules are dropped on narrow screens, where the label wraps to two
            lines and they would flank only the first of them. */}
        <p className="flex items-center justify-center gap-4 text-[0.7rem] sm:text-xs font-semibold uppercase tracking-[0.2em] sm:tracking-[0.28em] text-secondary-600 mb-5 sm:mb-6">
          <span aria-hidden="true" className="hidden sm:block h-px w-10 bg-secondary-300" />
          Closing Sale · While Supplies Last
          <span aria-hidden="true" className="hidden sm:block h-px w-10 bg-secondary-300" />
        </p>
        <h1 className="text-4xl sm:text-5xl lg:text-6xl font-normal tracking-tight text-balance leading-[1.08] mb-5 sm:mb-6">
          We&rsquo;re closing BeauTeas{" "}
          <em className="italic text-primary-700">for good</em>
        </h1>
        <p className="text-text-secondary text-base sm:text-lg text-pretty max-w-xl mx-auto mb-4">
          After a lot of thought, we&rsquo;ve decided to wind the shop down. Everything
          left is USDA-certified organic and priced to clear, and once it&rsquo;s gone,
          it&rsquo;s gone.
        </p>
        {/* Own line, not trailing the paragraph — inline it wrapped mid-phrase
            and split its underline across two lines. */}
        <p className="mb-8 sm:mb-10">
          <Link
            href="/thank-you"
            className="inline-flex items-center gap-2 rounded-sm text-base font-semibold text-primary-700 underline decoration-primary-300 underline-offset-4 transition-colors hover:decoration-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-dark"
          >
            Read the whole story
            <span aria-hidden="true">&rarr;</span>
          </Link>
        </p>
        {/* sm:items-stretch so the counter and the button share one height */}
        <div className="flex flex-col sm:flex-row items-center sm:items-stretch justify-center gap-4 sm:gap-6">
          {totalBoxesLeft !== null && (
            <p className="inline-flex items-stretch gap-4 sm:gap-5 rounded-md border border-secondary-200 bg-white px-5 sm:px-6 py-3 sm:py-4 text-left">
              <span className="font-serif self-center text-3xl sm:text-4xl leading-none tabular-nums text-primary-700">
                {totalBoxesLeft.toLocaleString("en-US")}
              </span>
              <span aria-hidden="true" className="w-px self-stretch bg-secondary-200" />
              <span className="self-center text-[0.68rem] sm:text-xs font-semibold uppercase leading-[1.55] tracking-[0.16em] text-text-secondary">
                boxes left
                <br />
                in the whole shop
              </span>
            </p>
          )}
          <Link
            href="/category/clearly-calendula"
            className="inline-flex items-center justify-center rounded-md bg-primary-700 px-7 sm:px-8 py-4 text-base sm:text-lg font-semibold tracking-wide text-text-inverse transition-colors hover:bg-primary-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-700 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-dark"
          >
            Shop While It Lasts
          </Link>
        </div>
      </section>

      {/* Featured Products Grid */}
      <section className="max-w-6xl mx-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 sm:gap-8 lg:gap-10 mb-12 sm:mb-16">
        {featuredProducts.map((product, index) => (
          <ProductCard 
            key={product.id} 
            product={product} 
            priority={index === 0} // Only prioritize the first product image
          />
        ))}
      </section>
    </div>
  );
}

// Enable static generation with revalidation for better performance
export const revalidate = 3600; // Revalidate every hour
