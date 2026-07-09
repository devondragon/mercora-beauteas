// lib/recommendations/providers/registry.ts

import type { RecommendationProvider, RecommendationStrategy } from "@/lib/recommendations/types";
import { deterministicProvider } from "./deterministic";

/**
 * Resolve a strategy to a provider. Unknown strategies fall back to
 * deterministic so the strip never breaks on a bad config value.
 * (ai_batch is registered in Task 9.)
 */
export function getProvider(strategy: RecommendationStrategy): RecommendationProvider {
  switch (strategy) {
    case "deterministic":
    default:
      return deterministicProvider;
  }
}
