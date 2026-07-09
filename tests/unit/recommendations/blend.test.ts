import { describe, it, expect } from "vitest";
import { blendRecommendations } from "@/lib/recommendations/blend";
import type { Product } from "@/lib/types";
import type { RecsUserContext } from "@/lib/recommendations/types";

function p(id: string, tags: string[] = []): Product {
  return { id, name: `P${id}`, tags, variants: [] } as unknown as Product;
}

const source = p("SRC", ["calendula"]);
const catalog = [source, p("A", ["calendula"]), p("B", ["calendula"]), p("C"), p("D"), p("E")];

describe("blendRecommendations", () => {
  it("always returns exactly `limit` when the catalog allows (top-up guarantee)", () => {
    // base is deliberately short (only one item) — must be topped up to 3
    const result = blendRecommendations({
      product: source,
      base: [p("A")],
      allProducts: catalog,
      userContext: null,
      limit: 3,
      personalize: false,
      excludeOwned: false,
    });
    expect(result.length).toBe(3);
    expect(result.map((x) => x.id)).not.toContain("SRC"); // never the source product
  });

  it("never exceeds `limit` and de-dupes", () => {
    const result = blendRecommendations({
      product: source,
      base: [p("A"), p("A"), p("B"), p("C")],
      allProducts: catalog,
      userContext: null,
      limit: 3,
      personalize: false,
      excludeOwned: false,
    });
    expect(result.length).toBe(3);
    expect(new Set(result.map((x) => x.id)).size).toBe(3);
  });

  it("returns fewer than `limit` only when the catalog is exhausted", () => {
    const tiny = [source, p("A")];
    const result = blendRecommendations({
      product: source,
      base: [p("A")],
      allProducts: tiny,
      userContext: null,
      limit: 3,
      personalize: false,
      excludeOwned: false,
    });
    expect(result.map((x) => x.id)).toEqual(["A"]);
  });

  it("excludes owned products when excludeOwned is on", () => {
    const ctx: RecsUserContext = {
      orders: [{}],
      isVipCustomer: false,
      preferredPriceRange: null,
      recentPurchases: ["A"],
    };
    const result = blendRecommendations({
      product: source,
      base: [p("A"), p("B"), p("C")],
      allProducts: catalog,
      userContext: ctx,
      limit: 3,
      personalize: false,
      excludeOwned: true,
    });
    expect(result.map((x) => x.id)).not.toContain("A");
    expect(result.length).toBe(3);
  });

  it("reserves exactly one personalized slot for a user with order history", () => {
    // User owns nothing; personalized scorer will favor tag matches ("calendula").
    const ctx: RecsUserContext = {
      orders: [{}],
      isVipCustomer: false,
      preferredPriceRange: null,
      recentPurchases: [],
    };
    const result = blendRecommendations({
      product: source,
      base: [p("C"), p("D"), p("E")], // base has NO tag matches
      allProducts: catalog,
      userContext: ctx,
      limit: 3,
      personalize: true,
      excludeOwned: false,
    });
    expect(result.length).toBe(3);
    // 2 base slots preserved + 1 personalized pick appended
    expect(result.slice(0, 2).map((x) => x.id)).toEqual(["C", "D"]);
    // personalized pick is a tag-match (A or B), not the 3rd base item (E)
    expect(["A", "B"]).toContain(result[2].id);
  });

  it("does not personalize a guest (no user context)", () => {
    const result = blendRecommendations({
      product: source,
      base: [p("C"), p("D"), p("E")],
      allProducts: catalog,
      userContext: null,
      limit: 3,
      personalize: true,
      excludeOwned: false,
    });
    expect(result.map((x) => x.id)).toEqual(["C", "D", "E"]);
  });
});
