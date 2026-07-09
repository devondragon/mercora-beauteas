import { describe, it, expect } from "vitest";
import { normalizeRecommendationSettings } from "@/lib/utils/settings";

describe("normalizeRecommendationSettings", () => {
  it("returns defaults when nothing is set", () => {
    expect(normalizeRecommendationSettings({})).toEqual({
      strategy: "deterministic",
      personalize: true,
      limit: 3,
      excludeOwned: true,
    });
  });

  it("reads stored values", () => {
    const raw = {
      "recommendations.strategy": "ai_batch",
      "recommendations.personalize": false,
      "recommendations.limit": 4,
      "recommendations.exclude_owned": false,
    };
    expect(normalizeRecommendationSettings(raw)).toEqual({
      strategy: "ai_batch",
      personalize: false,
      limit: 4,
      excludeOwned: false,
    });
  });

  it("falls back to deterministic for an unknown strategy", () => {
    expect(normalizeRecommendationSettings({ "recommendations.strategy": "bogus" }).strategy).toBe("deterministic");
  });

  it("clamps a non-positive or non-numeric limit to 3", () => {
    expect(normalizeRecommendationSettings({ "recommendations.limit": 0 }).limit).toBe(3);
    expect(normalizeRecommendationSettings({ "recommendations.limit": "x" }).limit).toBe(3);
  });
});
