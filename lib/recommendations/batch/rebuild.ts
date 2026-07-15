// lib/recommendations/batch/rebuild.ts
// Precompute per-product recommendations via Vectorize nearest-neighbor.

import { listProducts } from "@/lib/models/mach/products";
import { getDbAsync } from "@/lib/db";
import { product_recommendations } from "@/lib/db/schema/product-recommendations";
import { getCurrentEmbeddingModel } from "@/lib/ai/config";
import { resolveLocalizedField } from "@/lib/seo/metadata";
import { eq, sql } from "drizzle-orm";

const NEIGHBORS_PER_PRODUCT = 10;

// Stored recommendations older than this are considered stale. The empty-rebuild
// guard deliberately preserves rows for products Vectorize returns no neighbors
// for, so those rows can silently age out of date — this threshold surfaces them.
const STALENESS_THRESHOLD_DAYS = 7;

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
): Promise<{
  productsProcessed: number;
  productsSkipped: number;
  rowsWritten: number;
  errors: { productId: string; error: string }[];
  stalenessThresholdDays: number;
  staleRowCount: number;
  oldestGeneratedAt: string | null;
}> {
  const ai = env.AI;
  const vectorize = env.VECTORIZE;
  if (!ai || !vectorize) {
    throw new Error("Missing AI or VECTORIZE binding");
  }

  const neighbors = opts.neighbors ?? NEIGHBORS_PER_PRODUCT;
  const products = await listProducts({ status: ["active"] });
  const db = await getDbAsync();

  let productsProcessed = 0;
  let productsSkipped = 0;
  let rowsWritten = 0;
  const errors: { productId: string; error: string }[] = [];

  for (const product of products) {
    const sourceId = String(product.id);

    try {
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

      // Guard against an empty rebuild wiping good data: a zero-result query
      // (e.g. a transient Vectorize outage or an un-indexed product) must NOT
      // delete this product's existing recommendations. Only replace when we
      // have a non-empty result set; otherwise preserve what's already stored.
      if (ranked.length === 0) {
        productsSkipped += 1;
        continue;
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
      // db.batch requires a non-empty tuple.
      await db.batch(statements as [any, ...any[]]);

      productsProcessed += 1;
      rowsWritten += ranked.length;
    } catch (err) {
      console.error(`Recommendations rebuild: failed to process product ${sourceId}:`, err);
      errors.push({ productId: sourceId, error: String(err) });
      continue;
    }
  }

  // Staleness guard: surface stored recommendations that have not been refreshed
  // in a long time. Products the empty-rebuild guard keeps skipping (e.g. a
  // persistent Vectorize gap) never get a fresh `generated_at`, so their rows can
  // quietly rot; a lightweight aggregate makes that visible. Best-effort — a
  // failure here must never fail an otherwise-successful rebuild.
  let staleRowCount = 0;
  let oldestGeneratedAt: string | null = null;
  try {
    const staleModifier = `-${STALENESS_THRESHOLD_DAYS} days`;
    const rows = await db
      .select({
        stale: sql<number>`sum(case when ${product_recommendations.generated_at} < datetime('now', ${staleModifier}) then 1 else 0 end)`,
        oldest: sql<string | null>`min(${product_recommendations.generated_at})`,
      })
      .from(product_recommendations);
    const row = rows?.[0];
    staleRowCount = Number(row?.stale ?? 0) || 0;
    oldestGeneratedAt = row?.oldest ?? null;
    if (staleRowCount > 0) {
      console.warn(
        `Recommendations rebuild: ${staleRowCount} stored recommendation row(s) older than ` +
          `${STALENESS_THRESHOLD_DAYS}d (oldest generated_at=${oldestGeneratedAt ?? "unknown"}) — ` +
          `not refreshed this run`
      );
    }
  } catch (err) {
    console.error("Recommendations rebuild: staleness check failed:", err);
  }

  return {
    productsProcessed,
    productsSkipped,
    rowsWritten,
    errors,
    stalenessThresholdDays: STALENESS_THRESHOLD_DAYS,
    staleRowCount,
    oldestGeneratedAt,
  };
}
