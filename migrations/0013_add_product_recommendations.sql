-- Migration: 0013_add_product_recommendations.sql
-- Description: Precomputed per-product recommendation lists (AI-batch provider)
--              + default admin settings for the recommendations feature.

CREATE TABLE IF NOT EXISTS product_recommendations (
  source_product_id TEXT NOT NULL,
  recommended_product_id TEXT NOT NULL,
  rank INTEGER NOT NULL,
  score REAL,
  reason TEXT,
  generated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (source_product_id, recommended_product_id)
);

CREATE INDEX IF NOT EXISTS idx_product_recommendations_source_rank
  ON product_recommendations (source_product_id, rank);

-- Seed recommendations.* settings into already-provisioned DBs
-- (fresh installs also get these via defaultSettings). INSERT OR IGNORE
-- keeps this safe to re-run and avoids clobbering an admin's later edits.
INSERT OR IGNORE INTO admin_settings (key, value, category, description, data_type) VALUES
  ('recommendations.strategy', '"deterministic"', 'recommendations', 'PDP recommendation source: deterministic or ai_batch', 'string'),
  ('recommendations.personalize', 'true', 'recommendations', 'Personalize one slot for logged-in customers with order history', 'boolean'),
  ('recommendations.limit', '3', 'recommendations', 'Number of products shown in the PDP recommendations strip', 'number'),
  ('recommendations.exclude_owned', 'true', 'recommendations', 'Hide products the customer already purchased', 'boolean');
