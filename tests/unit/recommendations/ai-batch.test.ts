import { describe, it, expect } from "vitest";
import { hydrateBatchRecommendations } from "@/lib/recommendations/providers/ai-batch";
import type { Product } from "@/lib/types";

function p(id: string): Product {
  return { id, name: `P${id}`, variants: [] } as unknown as Product;
}

describe("hydrateBatchRecommendations", () => {
  it("returns products in stored rank order, hydrated from the catalog", () => {
    const rows = [
      { recommended_product_id: "C", rank: 0 },
      { recommended_product_id: "A", rank: 1 },
      { recommended_product_id: "B", rank: 2 },
    ];
    const catalog = [p("A"), p("B"), p("C")];
    const result = hydrateBatchRecommendations(rows, catalog, 5);
    expect(result.map((x) => x.id)).toEqual(["C", "A", "B"]);
  });

  it("skips ids missing from the catalog and respects count", () => {
    const rows = [
      { recommended_product_id: "GONE", rank: 0 },
      { recommended_product_id: "A", rank: 1 },
      { recommended_product_id: "B", rank: 2 },
    ];
    const catalog = [p("A"), p("B")];
    const result = hydrateBatchRecommendations(rows, catalog, 1);
    expect(result.map((x) => x.id)).toEqual(["A"]);
  });

  it("returns empty when there are no rows", () => {
    expect(hydrateBatchRecommendations([], [p("A")], 3)).toEqual([]);
  });
});
