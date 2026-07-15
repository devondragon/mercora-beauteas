/**
 * BMC-189 regression: the batch rebuild must NOT wipe a product's existing
 * recommendations when a Vectorize rebuild yields zero neighbors. Only a
 * non-empty result set may trigger the delete-then-insert replace.
 *
 * Pure unit test: @/lib/models/mach/products, @/lib/db, @/lib/ai/config and
 * @/lib/seo/metadata are mocked so the rebuild runs with no Cloudflare runtime.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/models/mach/products", () => ({ listProducts: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDbAsync: vi.fn() }));
vi.mock("@/lib/ai/config", () => ({ getCurrentEmbeddingModel: () => "@cf/baai/bge-base-en-v1.5" }));
vi.mock("@/lib/seo/metadata", () => ({
  resolveLocalizedField: (v: unknown) => (typeof v === "string" ? v : ""),
}));

import { rebuildProductRecommendations } from "@/lib/recommendations/batch/rebuild";
import { listProducts } from "@/lib/models/mach/products";
import { getDbAsync } from "@/lib/db";

function makeDb() {
  const batch = vi.fn().mockResolvedValue([]);
  const db = {
    delete: vi.fn(() => ({ where: vi.fn(() => ({ __op: "delete" })) })),
    insert: vi.fn(() => ({ values: vi.fn(() => ({ __op: "insert" })) })),
    batch,
  };
  return { db, batch };
}

function makeEnv(matches: Array<{ metadata?: { productId?: string }; score?: number }>) {
  return {
    AI: { run: vi.fn().mockResolvedValue({ data: [[0.1, 0.2, 0.3]] }) },
    VECTORIZE: { query: vi.fn().mockResolvedValue({ matches }) },
  };
}

const PRODUCT = { id: "SRC", name: "Src", description: "d", tags: ["t"] };

beforeEach(() => {
  vi.clearAllMocks();
  (listProducts as any).mockResolvedValue([PRODUCT]);
});

describe("rebuildProductRecommendations empty-rebuild guard", () => {
  it("does NOT delete existing recs when the rebuild yields zero neighbors", async () => {
    const { db, batch } = makeDb();
    (getDbAsync as any).mockResolvedValue(db);
    const env = makeEnv([]); // Vectorize returns nothing

    const summary = await rebuildProductRecommendations(env);

    expect(batch).not.toHaveBeenCalled();
    expect(db.delete).not.toHaveBeenCalled();
    expect(summary.productsProcessed).toBe(0);
    expect(summary.productsSkipped).toBe(1);
    expect(summary.rowsWritten).toBe(0);
    expect(summary.errors).toEqual([]);
  });

  it("skips (does not wipe) when the only neighbor is the source product itself", async () => {
    const { db, batch } = makeDb();
    (getDbAsync as any).mockResolvedValue(db);
    // Self-match gets filtered out → ranked ends up empty → must be skipped.
    const env = makeEnv([{ metadata: { productId: "SRC" }, score: 0.99 }]);

    const summary = await rebuildProductRecommendations(env);

    expect(batch).not.toHaveBeenCalled();
    expect(summary.productsSkipped).toBe(1);
    expect(summary.rowsWritten).toBe(0);
  });

  it("replaces recs (delete + insert batch) when neighbors exist", async () => {
    const { db, batch } = makeDb();
    (getDbAsync as any).mockResolvedValue(db);
    const env = makeEnv([
      { metadata: { productId: "N1" }, score: 0.9 },
      { metadata: { productId: "N2" }, score: 0.8 },
    ]);

    const summary = await rebuildProductRecommendations(env);

    expect(batch).toHaveBeenCalledTimes(1);
    expect(db.delete).toHaveBeenCalledTimes(1);
    // One delete + two inserts in the atomic batch.
    const stmts = batch.mock.calls[0][0];
    expect(stmts).toHaveLength(3);
    expect(summary.productsProcessed).toBe(1);
    expect(summary.productsSkipped).toBe(0);
    expect(summary.rowsWritten).toBe(2);
  });
});
