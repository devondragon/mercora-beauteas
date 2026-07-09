// lib/recommendations/providers/registry.ts

import type { RecommendationProvider, RecommendationStrategy } from "@/lib/recommendations/types";
import { deterministicProvider } from "./deterministic";
import { aiBatchProvider } from "./ai-batch";

/**
 * Resolve a strategy to a provider. Unknown strategies fall back to
 * deterministic so the strip never breaks on a bad config value.
 */
export function getProvider(strategy: RecommendationStrategy): RecommendationProvider {
  switch (strategy) {
    case "ai_batch":
      return aiBatchProvider;
    case "deterministic":
    default:
      return deterministicProvider;
  }
}
