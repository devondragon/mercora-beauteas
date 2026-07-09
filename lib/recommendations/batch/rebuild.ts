// lib/recommendations/batch/rebuild.ts
// Precompute per-product recommendations via Vectorize nearest-neighbor.

import { listProducts } from "@/lib/models/mach/products";
import { getDbAsync } from "@/lib/db";
import { product_recommendations } from "@/lib/db/schema/product-recommendations";
import { getCurrentEmbeddingModel } from "@/lib/ai/config";
import { resolveLocalizedField } from "@/lib/seo/metadata";
import { eq } from "drizzle-orm";

const NEIGHBORS_PER_PRODUCT = 10;

/** Build the text we embed to find similar products. */
function productText(product: any): string {
  const name = resolveLocalizedField(product.name) || "";
  const description = resolveLocalizedField(product.description) || "";
  const tags = Array.isArray(product.tags) ? product.tags.join(", ") : "";
  return [name, description, tags].filter(Boolean).join(". ");
}

export async function rebuildProductRecommendations(
  env: any,
  opts: { neighbors?: number } = {}
): Promise<{ productsProcessed: number; rowsWritten: number }> {
  const ai = env.AI;
  const vectorize = env.VECTORIZE;
  if (!ai || !vectorize) {
    throw new Error("Missing AI or VECTORIZE binding");
  }

  const neighbors = opts.neighbors ?? NEIGHBORS_PER_PRODUCT;
  const products = await listProducts({ status: ["active"] });
  const db = await getDbAsync();

  let productsProcessed = 0;
  let rowsWritten = 0;

  for (const product of products) {
    const sourceId = String(product.id);

    // Embed the product's own text, then query nearest neighbors.
    const embedding = await ai.run(getCurrentEmbeddingModel(), { text: productText(product) });
    const results = await vectorize.query(embedding.data[0], {
      topK: neighbors + 5, // over-fetch; self + non-product snippets get filtered
      returnMetadata: true,
    });

    const seen = new Set<string>();
    const ranked: { id: string; score: number }[] = [];
    for (const match of results?.matches ?? []) {
      const pid = match.metadata?.productId;
      if (!pid || String(pid) === sourceId || seen.has(String(pid))) continue;
      seen.add(String(pid));
      ranked.push({ id: String(pid), score: typeof match.score === "number" ? match.score : 0 });
      if (ranked.length >= neighbors) break;
    }

    // Replace this source product's rows atomically (D1 has no transaction()).
    const statements: any[] = [
      db.delete(product_recommendations).where(eq(product_recommendations.source_product_id, sourceId)),
    ];
    ranked.forEach((r, rank) => {
      statements.push(
        db.insert(product_recommendations).values({
          source_product_id: sourceId,
          recommended_product_id: r.id,
          rank,
          score: r.score,
          reason: "vector_similarity",
        })
      );
    });
    if (statements.length > 0) {
      // db.batch requires a non-empty tuple.
      await db.batch(statements as [any, ...any[]]);
    }

    productsProcessed += 1;
    rowsWritten += ranked.length;
  }

  return { productsProcessed, rowsWritten };
}
