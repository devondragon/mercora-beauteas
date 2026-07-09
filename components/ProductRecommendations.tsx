/**
 * === Product Recommendations (presentational) ===
 *
 * Renders the server-resolved "Recommended for you" strip on the PDP.
 * Recommendations are computed server-side by lib/recommendations and passed
 * in as a prop — no client fetch, no loading state, no debounce.
 */

import ProductCard from "@/components/ProductCard";
import type { Product } from "@/lib/types";

export default function ProductRecommendations({
  recommendations,
  firstName,
}: {
  recommendations: Product[];
  firstName?: string;
}) {
  if (!recommendations || recommendations.length === 0) {
    return null;
  }

  const sectionTitle = `Recommended for ${firstName || "you"}`;
  const count = recommendations.length;
  const gridClass =
    count === 1
      ? "grid-cols-1 max-w-sm mx-auto"
      : count === 2
        ? "grid-cols-1 sm:grid-cols-2 max-w-2xl mx-auto"
        : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3";

  return (
    <div className="mt-20 text-center relative">
      <div className="border-t border-border-default w-full relative mb-10">
        <span className="text-primary-600 text-xl font-semibold bg-surface-dark px-4 absolute -top-4 left-1/2 transform -translate-x-1/2 font-serif">
          {sectionTitle}
        </span>
      </div>

      <div className={`grid gap-10 ${gridClass}`}>
        {recommendations.map((prod) => (
          <ProductCard key={prod.id} product={prod} />
        ))}
      </div>
    </div>
  );
}
