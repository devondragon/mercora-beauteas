import { describe, it, expect } from "vitest";
import { blendRecommendations } from "@/lib/recommendations/blend";
import type { Product } from "@/lib/types";
import type { RecsUserContext } from "@/lib/recommendations/types";

function p(id: string, tags: string[] = []): Product {
  return { id, name: `P${id}`, tags, variants: [] } as unknown as Product;
}

/** Build a product carrying a single variant with an explicit stock quantity. */
function pStock(id: string, qty: number, tags: string[] = []): Product {
  return {
    id,
    name: `P${id}`,
    tags,
    variants: [{ id: `${id}-v`, inventory: { quantity: qty } }],
  } as unknown as Product;
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
    // Top-up must pull genuinely distinct products from allProducts, not
    // duplicate-pad the too-short base (e.g. [A, A, A] would also satisfy
    // length===3 and the "no SRC" check above, but is a regression).
    expect(new Set(result.map((x) => x.id)).size).toBe(3);
    // Deterministic catalog iteration order (catalog = [source, A, B, C, D, E],
    // base = [A]): base contributes A, then top-up walks the catalog in order
    // and picks the next eligible, un-seen ids: B, then C.
    expect(result.map((x) => x.id)).toEqual(["A", "B", "C"]);
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

  it("does not personalize a logged-in user with no order history", () => {
    // userContext is present (logged in) but orders is empty — the
    // `orders.length > 0` gate must exclude this from the personalized
    // branch, same as the guest case above.
    const ctx: RecsUserContext = {
      orders: [],
      isVipCustomer: false,
      preferredPriceRange: null,
      recentPurchases: [],
    };
    const result = blendRecommendations({
      product: source,
      base: [p("C"), p("D"), p("E")],
      allProducts: catalog,
      userContext: ctx,
      limit: 3,
      personalize: true,
      excludeOwned: false,
    });
    expect(result.map((x) => x.id)).toEqual(["C", "D", "E"]);
  });

  it("never surfaces an owned product, even as the reserved personalized pick", () => {
    // User owns "A" — which is also the strongest personalized candidate
    // (tag match on "calendula" against the source product). The reserved
    // personalized slot must skip it and fall through to the next-best
    // eligible candidate ("B"), and the count must still fill to `limit`.
    const ctx: RecsUserContext = {
      orders: [{}],
      isVipCustomer: false,
      preferredPriceRange: null,
      recentPurchases: ["A"],
    };
    const result = blendRecommendations({
      product: source,
      base: [p("C"), p("D"), p("E")], // base has NO tag matches
      allProducts: catalog,
      userContext: ctx,
      limit: 3,
      personalize: true,
      excludeOwned: true,
    });
    expect(result.length).toBe(3);
    expect(new Set(result.map((x) => x.id)).size).toBe(3);
    expect(result.map((x) => x.id)).not.toContain("A");
    // 2 base slots preserved + personalized pick falls through owned "A" to "B"
    expect(result.map((x) => x.id)).toEqual(["C", "D", "B"]);
  });

  it("never recommends an out-of-stock product from the base list", () => {
    const src = pStock("SRC", 5, ["calendula"]);
    const result = blendRecommendations({
      product: src,
      // OOS product is the top base pick — must be dropped, not surfaced.
      base: [pStock("OOS", 0), pStock("A", 3), pStock("B", 3)],
      allProducts: [src, pStock("OOS", 0), pStock("A", 3), pStock("B", 3)],
      userContext: null,
      limit: 3,
      personalize: false,
      excludeOwned: false,
    });
    expect(result.map((x) => x.id)).not.toContain("OOS");
    // Still fills to the requested count from the remaining in-stock catalog.
    expect(result.map((x) => x.id)).toEqual(["A", "B"]);
  });

  it("tops up to `limit` from in-stock catalog, skipping OOS items", () => {
    const src = pStock("SRC", 5);
    const result = blendRecommendations({
      product: src,
      base: [pStock("A", 3)],
      // C is out of stock and must be skipped by the top-up in favor of D.
      allProducts: [src, pStock("A", 3), pStock("B", 3), pStock("C", 0), pStock("D", 3)],
      userContext: null,
      limit: 3,
      personalize: false,
      excludeOwned: false,
    });
    expect(result.length).toBe(3);
    expect(result.map((x) => x.id)).not.toContain("C");
    expect(result.map((x) => x.id)).toEqual(["A", "B", "D"]);
  });

  it("treats a variant with no inventory data as purchasable (no over-filtering)", () => {
    const src = pStock("SRC", 5);
    // `p()` products have `variants: []` — untracked, so they must remain eligible.
    const result = blendRecommendations({
      product: src,
      base: [p("A"), p("B")],
      allProducts: [src, p("A"), p("B"), p("C")],
      userContext: null,
      limit: 3,
      personalize: false,
      excludeOwned: false,
    });
    expect(result.map((x) => x.id)).toEqual(["A", "B", "C"]);
  });

  it("keeps a product in stock when any one of several variants has stock", () => {
    const src = pStock("SRC", 5);
    const multi = {
      id: "MULTI",
      name: "PMULTI",
      tags: [],
      variants: [
        { id: "m1", inventory: { quantity: 0 } },
        { id: "m2", inventory: { quantity: 4 } },
      ],
    } as unknown as Product;
    const result = blendRecommendations({
      product: src,
      base: [multi],
      allProducts: [src, multi],
      userContext: null,
      limit: 3,
      personalize: false,
      excludeOwned: false,
    });
    expect(result.map((x) => x.id)).toEqual(["MULTI"]);
  });

  it("returns exactly `limit` distinct products at the exhaustion boundary", () => {
    // Eligible pool (after dropping source + owned) is exactly `limit` —
    // guards the top-up loop's `result.length >= limit` break against an
    // off-by-one that would drop or overrun the last eligible item.
    const ctx: RecsUserContext = {
      orders: [],
      isVipCustomer: false,
      preferredPriceRange: null,
      recentPurchases: ["OWNED"],
    };
    const boundaryCatalog = [source, p("OWNED"), p("A"), p("B"), p("C")];
    const result = blendRecommendations({
      product: source,
      base: [],
      allProducts: boundaryCatalog,
      userContext: ctx,
      limit: 3,
      personalize: false,
      excludeOwned: true,
    });
    expect(result.length).toBe(3);
    expect(new Set(result.map((x) => x.id)).size).toBe(3);
    expect(result.map((x) => x.id)).toEqual(["A", "B", "C"]);
  });
});
