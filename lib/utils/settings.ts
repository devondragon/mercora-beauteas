/**
 * === Settings Utilities ===
 *
 * Utility functions for working with admin settings.
 * Provides typed access to configuration values stored in database.
 *
 * === Features ===
 * - **Typed Access**: Get settings with proper type conversion
 * - **Category Filtering**: Retrieve settings by category
 * - **JSON Parsing**: Automatic parsing of JSON values
 * - **Default Values**: Fallback handling for missing settings
 *
 * === Usage ===
 * ```typescript
 * const refundSettings = await getSettings('refund');
 * const allSettings = await getSettings();
 * ```
 */

import { getDbAsync } from '@/lib/db';
import { admin_settings } from '@/lib/db/schema/settings';
import { eq } from 'drizzle-orm';
import type { RecommendationSettings, RecommendationStrategy } from "@/lib/recommendations/types";

/**
 * Get a typed settings object for easy use in components
 * @param category - Optional category filter (store, refund, ai, system)
 * @returns Promise<Record<string, any>> - Settings key-value object
 */
export async function getSettings(category?: string): Promise<Record<string, any>> {
  const db = await getDbAsync();
  
  let settings;
  if (category) {
    settings = await db.select().from(admin_settings).where(eq(admin_settings.category, category));
  } else {
    settings = await db.select().from(admin_settings);
  }
  
  const result: Record<string, any> = {};
  for (const setting of settings) {
    try {
      result[setting.key] = JSON.parse(setting.value as string);
    } catch {
      result[setting.key] = setting.value;
    }
  }
  
  return result;
}

/**
 * Get refund policy settings specifically
 * @returns Promise<RefundPolicy> - Refund policy configuration
 */
export async function getRefundPolicy() {
  const refundSettings = await getSettings('refund');
  
  return {
    refundShipping: refundSettings['refund.shipping_refunded'] || false,
    refundShippingOnFullReturn: refundSettings['refund.shipping_refunded_on_full_return'] || false,
    restockingFeePercent: refundSettings['refund.restocking_fee_percent'] || 0,
    minimumRefundAmount: refundSettings['refund.minimum_refund_amount'] || 0,
    applyRestockingFeeOnPartialReturn: refundSettings['refund.apply_restocking_fee_on_partial'] !== false,
    // BMC-213: defaults to true (parity with an app refund) when unset.
    restockOnExternalRefund: refundSettings['refund.restock_on_external_refund'] !== false,
    // BMC-243: the seeded default is 30 (lib/db/schema/settings.ts). This key
    // has existed since the initial settings seed but was never surfaced here,
    // so nothing could read the return window without querying settings raw.
    // The Chai assistant states this number to customers — see
    // lib/ai/deterministic-answers.ts.
    returnWindowDays: Number(refundSettings['refund.return_window_days'] ?? 30)
  };
}

/**
 * Get store settings specifically
 * @returns Promise<StoreSettings> - Store configuration
 */
export async function getStoreSettings() {
  const storeSettings = await getSettings('store');
  
  return {
    name: storeSettings['store.name'] || 'BeauTeas',
    currency: storeSettings['store.currency'] || 'USD',
    taxRate: storeSettings['store.tax_rate'] || 8.25,
    // Add more store settings as needed
  };
}

/**
 * Get AI settings specifically
 * @returns Promise<AISettings> - AI configuration
 */
export async function getAISettings() {
  const aiSettings = await getSettings('ai');
  
  return {
    personalityMode: aiSettings['ai.personality_mode'] || 'cheeky',
    // Add more AI settings as needed
  };
}

/**
 * Get social media settings specifically
 * @returns Promise<SocialMediaSettings> - Social media links configuration
 */
export async function getSocialMediaSettings() {
  const socialSettings = await getSettings('social');
  
  return {
    instagram: socialSettings['social.instagram'] || '',
    youtube: socialSettings['social.youtube'] || '',
    linkedin: socialSettings['social.linkedin'] || '',
    twitter: socialSettings['social.twitter'] || '',
    facebook: socialSettings['social.facebook'] || '',
    tiktok: socialSettings['social.tiktok'] || '',
  };
}

export interface RefundPolicy {
  refundShipping: boolean;
  refundShippingOnFullReturn: boolean;
  restockingFeePercent: number;
  minimumRefundAmount: number;
  applyRestockingFeeOnPartialReturn: boolean;
  restockOnExternalRefund: boolean;
}

/**
 * Pure normalizer for recommendation settings — tolerates missing/invalid values.
 */
export function normalizeRecommendationSettings(raw: Record<string, any>): RecommendationSettings {
  const strategyRaw = raw["recommendations.strategy"];
  const strategy: RecommendationStrategy = strategyRaw === "ai_batch" ? "ai_batch" : "deterministic";

  const limitRaw = raw["recommendations.limit"];
  const limit = typeof limitRaw === "number" && limitRaw > 0 ? Math.floor(limitRaw) : 3;

  return {
    strategy,
    personalize: raw["recommendations.personalize"] !== false,
    limit,
    excludeOwned: raw["recommendations.exclude_owned"] !== false,
  };
}

/**
 * Get recommendation feature settings for the PDP recommendations strip.
 */
export async function getRecommendationSettings(): Promise<RecommendationSettings> {
  const settings = await getSettings("recommendations");
  return normalizeRecommendationSettings(settings);
}