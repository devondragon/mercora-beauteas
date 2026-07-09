// lib/db/schema/product-recommendations.ts - Precomputed recommendation lists

import { sqliteTable, text, integer, real, primaryKey } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const product_recommendations = sqliteTable(
  "product_recommendations",
  {
    source_product_id: text("source_product_id").notNull(),
    recommended_product_id: text("recommended_product_id").notNull(),
    rank: integer("rank").notNull(),
    score: real("score"),
    reason: text("reason"),
    generated_at: text("generated_at").default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.source_product_id, t.recommended_product_id] }),
  })
);
