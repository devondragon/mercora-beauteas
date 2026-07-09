// lib/recommendations/providers/deterministic.ts
// Base recommendations from tag/category/price scoring over the active catalog.

import type { Product } from "@/lib/types";
import type { ProviderContext, RecommendationProvider, RecsUserContext } from "@/lib/recommendations/types";
import { getPersonalizedRecommendations } from "@/lib/utils/personalized-recommendations";

// Neutral guest context: no orders → scoring reduces to tag/category/onSale.
const GUEST_CONTEXT: RecsUserContext = {
  orders: [],
  isVipCustomer: false,
  preferredPriceRange: null,
  recentPurchases: [],
};

export const deterministicProvider: RecommendationProvider = {
  async getBaseRecommendations(product: Product, count: number, ctx: ProviderContext): Promise<Product[]> {
    return getPersonalizedRecommendations(
      { userContext: GUEST_CONTEXT, currentProducts: [], viewingProduct: product },
      ctx.allProducts,
      count
    );
  },
};
