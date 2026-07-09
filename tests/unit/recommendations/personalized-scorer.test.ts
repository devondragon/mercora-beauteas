// tests/unit/recommendations/personalized-scorer.test.ts
//
// Focused coverage for the Money-safe scoring paths in
// lib/utils/personalized-recommendations.ts that deterministic.test.ts's
// guest context (isVipCustomer: false, preferredPriceRange: null) never
// exercises: the VIP premium-price boost and the preferredPriceRange
// min/max comparison. Both read `product.variants[0].price` (a Money-shaped
// `{ amount, currency }` in minor units) via `Money.fromStored(...)`.

import { describe, it, expect } from "vitest";
import {
  getPersonalizedRecommendations,
  explainRecommendation,
} from "@/lib/utils/personalized-recommendations";
import type { RecsUserContext } from "@/lib/recommendations/types";
import type { Product } from "@/lib/types";

function makeProduct(id: string, priceMinorUnits: number): Product {
  return {
    id,
    name: `Product ${id}`,
    variants: [
      {
        id: `${id}-variant`,
        sku: `SKU-${id}`,
        option_values: [],
        price: { amount: priceMinorUnits, currency: "USD" },
      },
    ],
  } as unknown as Product;
}

const GUEST_CONTEXT: RecsUserContext = {
  orders: [],
  isVipCustomer: false,
  preferredPriceRange: null,
  recentPurchases: [],
};

describe("personalized scorer — VIP premium-price boost (Money-safe)", () => {
  const vipContext: RecsUserContext = { ...GUEST_CONTEXT, isVipCustomer: true };

  it("explainRecommendation cites the premium reason for a VIP + a >$50 product", () => {
    const premium = makeProduct("premium", 6000); // $60.00
    const explanation = explainRecommendation(premium, vipContext);
    expect(explanation).toContain("premium recommendation for VIP");
  });

  it("explainRecommendation omits the premium reason for a VIP + a $40 product", () => {
    const cheap = makeProduct("cheap", 4000); // $40.00
    const explanation = explainRecommendation(cheap, vipContext);
    expect(explanation).not.toContain("premium recommendation for VIP");
  });

  it("explainRecommendation omits the premium reason for a non-VIP + a >$50 product", () => {
    const premium = makeProduct("premium", 6000);
    const explanation = explainRecommendation(premium, GUEST_CONTEXT);
    expect(explanation).not.toContain("premium recommendation for VIP");
  });

  it("ranks a >$50 product above a $40 product for a VIP user with no other signals", () => {
    const premium = makeProduct("premium", 6000); // $60.00 → VIP boost applies
    const cheap = makeProduct("cheap", 4000); // $40.00 → no VIP boost

    const result = getPersonalizedRecommendations(
      { userContext: vipContext, currentProducts: [] },
      [cheap, premium],
      2
    );

    expect(result.map((p) => p.id)).toEqual(["premium", "cheap"]);
  });
});

describe("personalized scorer — preferredPriceRange boost (Money-safe)", () => {
  it("boosts an in-range product above an out-of-range (above max) product", () => {
    const rangeContext: RecsUserContext = {
      ...GUEST_CONTEXT,
      preferredPriceRange: { min: 2000, max: 5000 }, // $20–$50
    };
    const inRange = makeProduct("in-range", 3000); // $30.00 → +2 boost
    const aboveMax = makeProduct("above-max", 8000); // $80.00 → -1 penalty

    const result = getPersonalizedRecommendations(
      { userContext: rangeContext, currentProducts: [] },
      [aboveMax, inRange],
      2
    );

    expect(result.map((p) => p.id)).toEqual(["in-range", "above-max"]);
  });

  it("does not boost a below-min product, and ranks it below an in-range product but above an above-max one", () => {
    const rangeContext: RecsUserContext = {
      ...GUEST_CONTEXT,
      preferredPriceRange: { min: 2000, max: 5000 }, // $20–$50
    };
    const inRange = makeProduct("in-range", 3000); // +2 boost
    const belowMin = makeProduct("below-min", 1000); // $10.00 → no boost, no penalty
    const aboveMax = makeProduct("above-max", 8000); // -1 penalty

    const result = getPersonalizedRecommendations(
      { userContext: rangeContext, currentProducts: [] },
      [aboveMax, belowMin, inRange],
      3
    );

    expect(result.map((p) => p.id)).toEqual(["in-range", "below-min", "above-max"]);
  });

  it("applies no price-range boost when preferredPriceRange is null (guest context)", () => {
    const inRangePriceButNoPreference = makeProduct("a", 3000);
    const aboveMaxPriceButNoPreference = makeProduct("b", 8000);

    const result = getPersonalizedRecommendations(
      { userContext: GUEST_CONTEXT, currentProducts: [] },
      [aboveMaxPriceButNoPreference, inRangePriceButNoPreference],
      2
    );

    // With no preferredPriceRange, price has no bearing on score — order is
    // stable/input order (both score identically at the base score).
    expect(result.map((p) => p.id).sort()).toEqual(["a", "b"]);
  });
});
