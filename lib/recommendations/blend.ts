// lib/recommendations/blend.ts
// Pure blend: personalization slot + owned exclusion + count top-up guarantee.

import type { Product } from "@/lib/types";
import type { RecsUserContext } from "@/lib/recommendations/types";
import { getPersonalizedRecommendations } from "@/lib/utils/personalized-recommendations";

export interface BlendInput {
  product: Product;
  base: Product[];
  allProducts: Product[];
  userContext: RecsUserContext | null;
  limit: number;
  personalize: boolean;
  excludeOwned: boolean;
}

export function blendRecommendations(input: BlendInput): Product[] {
  const { product, base, allProducts, userContext, limit, personalize, excludeOwned } = input;

  const sourceId = String(product.id);
  const ownedIds = new Set(
    excludeOwned && userContext ? userContext.recentPurchases.map(String) : []
  );

  const isEligible = (pr: Product) => String(pr.id) !== sourceId && !ownedIds.has(String(pr.id));

  // De-dupe the base list, preserving order, dropping source + owned.
  const seen = new Set<string>();
  const cleanBase: Product[] = [];
  for (const pr of base) {
    const id = String(pr.id);
    if (!isEligible(pr) || seen.has(id)) continue;
    seen.add(id);
    cleanBase.push(pr);
  }

  let result: Product[];

  if (personalize && userContext && userContext.orders.length > 0) {
    // Reserve one slot for a purchase-history-aware pick.
    const personalized = getPersonalizedRecommendations(
      { userContext, currentProducts: [], viewingProduct: product },
      allProducts,
      limit + 5
    ).filter(isEligible);

    const baseTop = cleanBase.slice(0, Math.max(0, limit - 1));
    const baseTopIds = new Set(baseTop.map((pr) => String(pr.id)));
    const pick = personalized.find((pr) => !baseTopIds.has(String(pr.id)));

    result = pick ? [...baseTop, pick] : cleanBase.slice(0, limit);
  } else {
    result = cleanBase.slice(0, limit);
  }

  // Top-up guarantee: fill remaining slots from cleanBase, then the catalog.
  const have = new Set(result.map((pr) => String(pr.id)));
  const topUp = (candidates: Product[]) => {
    for (const pr of candidates) {
      if (result.length >= limit) break;
      const id = String(pr.id);
      if (!isEligible(pr) || have.has(id)) continue;
      have.add(id);
      result.push(pr);
    }
  };
  topUp(cleanBase);
  topUp(allProducts);

  return result.slice(0, limit);
}
