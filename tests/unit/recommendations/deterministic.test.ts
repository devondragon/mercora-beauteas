import { describe, it, expect } from "vitest";
import { deterministicProvider } from "@/lib/recommendations/providers/deterministic";
import type { Product } from "@/lib/types";

function makeProduct(id: string, tags: string[]): Product {
  return {
    id,
    name: `Product ${id}`,
    tags,
    variants: [],
  } as unknown as Product;
}

describe("deterministicProvider", () => {
  it("ranks products sharing tags with the source above unrelated ones", async () => {
    const source = makeProduct("A", ["calendula", "morning"]);
    const shared = makeProduct("B", ["calendula"]);
    const unrelated = makeProduct("C", ["unrelated"]);
    const ctx = { allProducts: [source, shared, unrelated] };

    const result = await deterministicProvider.getBaseRecommendations(source, 5, ctx);
    const ids = result.map((p) => p.id);

    expect(ids).not.toContain("A"); // scorer excludes the source
    expect(ids.indexOf("B")).toBeLessThan(ids.indexOf("C"));
  });

  it("returns at most `count` products", async () => {
    const source = makeProduct("A", ["x"]);
    const ctx = {
      allProducts: [source, makeProduct("B", ["x"]), makeProduct("C", ["x"]), makeProduct("D", ["x"])],
    };
    const result = await deterministicProvider.getBaseRecommendations(source, 2, ctx);
    expect(result.length).toBe(2);
  });
});
