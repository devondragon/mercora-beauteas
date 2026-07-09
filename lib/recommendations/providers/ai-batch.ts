// lib/recommendations/providers/ai-batch.ts
// Reads precomputed product->product recommendations; hydrates from the catalog.

import type { Product } from "@/lib/types";
import type { ProviderContext, RecommendationProvider } from "@/lib/recommendations/types";
import { getDbAsync } from "@/lib/db";
import { product_recommendations } from "@/lib/db/schema/product-recommendations";
import { eq } from "drizzle-orm";

interface BatchRow {
  recommended_product_id: string;
  rank: number;
}

/** Pure: order rows by rank and hydrate from the in-memory catalog. */
export function hydrateBatchRecommendations(
  rows: BatchRow[],
  allProducts: Product[],
  count: number
): Product[] {
  const byId = new Map(allProducts.map((pr) => [String(pr.id), pr]));
  return [...rows]
    .sort((a, b) => a.rank - b.rank)
    .map((r) => byId.get(String(r.recommended_product_id)))
    .filter((pr): pr is Product => pr !== undefined)
    .slice(0, count);
}

export const aiBatchProvider: RecommendationProvider = {
  async getBaseRecommendations(product: Product, count: number, ctx: ProviderContext): Promise<Product[]> {
    const db = await getDbAsync();
    const rows = await db
      .select({
        recommended_product_id: product_recommendations.recommended_product_id,
        rank: product_recommendations.rank,
      })
      .from(product_recommendations)
      .where(eq(product_recommendations.source_product_id, String(product.id)));
    return hydrateBatchRecommendations(rows as BatchRow[], ctx.allProducts, count);
  },
};
