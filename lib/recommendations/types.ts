// lib/recommendations/types.ts - Shared recommendation types

import type { Product } from "@/lib/types";

export type RecommendationStrategy = "deterministic" | "ai_batch";

export interface RecommendationSettings {
  strategy: RecommendationStrategy;
  personalize: boolean;
  limit: number;
  excludeOwned: boolean;
}

/**
 * Minimal shape of an order the scorer actually reads (just enough to pull
 * purchased product ids out of `items`). `Order` (lib/types) is structurally
 * assignable to this, so real callers keep working.
 */
export interface RecsOrderLike {
  items?: Array<{ product_id?: string | number; id?: string | number }>;
}

/**
 * Minimal user context the scorer/blend actually reads. EnhancedUserContext
 * structurally satisfies this, so existing callers keep working.
 */
export interface RecsUserContext {
  orders: RecsOrderLike[];
  isVipCustomer: boolean;
  preferredPriceRange: { min: number; max: number } | null;
  recentPurchases: string[]; // product ids
}

export interface ProviderContext {
  allProducts: Product[];
}

export interface RecommendationProvider {
  /** Ranked base recommendations for a product (may include the source; the seam filters it). */
  getBaseRecommendations(
    product: Product,
    count: number,
    ctx: ProviderContext
  ): Promise<Product[]>;
}
