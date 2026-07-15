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

/**
 * Whether a product has any purchasable stock. A product is excluded only when
 * it has variants and *every* variant reports zero available inventory (and no
 * backorder) — i.e. positive evidence of being out of stock. Products with no
 * variants, or variants with untracked inventory, are left in so we never
 * over-filter the recommendation pool on missing data. Mirrors the storefront's
 * `inventory.quantity > 0` availability convention (ProductCard/ProductDisplay).
 */
function hasAvailableStock(pr: Product): boolean {
  const variants = pr.variants ?? [];
  if (variants.length === 0) return true;
  return variants.some((v) => {
    const inv = v.inventory;
    if (!inv) return true; // untracked variant — treat as purchasable
    if (inv.allow_backorder) return true;
    const qty = typeof inv.quantity === "number" ? inv.quantity : 0;
    return qty > 0;
  });
}

export function blendRecommendations(input: BlendInput): Product[] {
  const { product, base, allProducts, userContext, limit, personalize, excludeOwned } = input;

  const sourceId = String(product.id);
  const ownedIds = new Set(
    excludeOwned && userContext ? userContext.recentPurchases.map(String) : []
  );

  // Exclude the source, owned products, and anything out of stock. Applied on
  // every candidate source below (base, personalized picks, and catalog top-up),
  // so out-of-stock items can never enter the result and the top-up still fills
  // to `limit` from the remaining in-stock catalog.
  const isEligible = (pr: Product) =>
    String(pr.id) !== sourceId && !ownedIds.has(String(pr.id)) && hasAvailableStock(pr);

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
    // Over-fetch by 5: gives `.find()` below headroom to land on a pick
    // outside `baseTop` (and past any owned/source exclusions) without
    // exhausting the ranked list. Any residual shortfall is still rescued
    // by the unconditional top-up pass further down.
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
