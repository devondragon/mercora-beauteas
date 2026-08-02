// lib/recommendations/index.ts - Public entry point for PDP recommendations.

import type { Product } from "@/lib/types";
import type { RecsUserContext } from "./types";
import { getRecommendationSettings } from "@/lib/utils/settings";
import { listProducts } from "@/lib/models/mach/products";
import { getProvider } from "./providers/registry";
import { blendRecommendations } from "./blend";
import { isPubliclyPurchasableProduct } from "@/lib/config/commerce";

export async function getRecommendationsForProduct(
  product: Product,
  opts: { userContext?: RecsUserContext | null; limit?: number } = {}
): Promise<Product[]> {
  try {
    const settings = await getRecommendationSettings();
    const limit = opts.limit ?? settings.limit;
    const allProducts = (await listProducts({ status: ["active"] })).filter(isPubliclyPurchasableProduct);
    const provider = getProvider(settings.strategy);

    let base: Product[] = [];
    try {
      base = await provider.getBaseRecommendations(product, limit + 5, { allProducts });
    } catch (err) {
      console.error("getRecommendationsForProduct: provider failed, using catalog top-up", err);
      base = [];
    }

    return blendRecommendations({
      product,
      base,
      allProducts,
      userContext: opts.userContext ?? null,
      limit,
      personalize: settings.personalize,
      excludeOwned: settings.excludeOwned,
    });
  } catch (err) {
    console.error("getRecommendationsForProduct: failed", err);
    return [];
  }
}

export type { RecsUserContext } from "./types";
