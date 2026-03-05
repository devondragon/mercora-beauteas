/**
 * === SEO Metadata Helpers ===
 *
 * Shared constants and utility functions for generating SEO metadata
 * across product, category, and other dynamic pages.
 *
 * Provides consistent URL resolution, localized field extraction,
 * and image URL handling for Open Graph tags, Twitter cards,
 * and canonical URLs.
 *
 * === Exports ===
 * - BASE_URL: Production site URL for canonical/OG absolute URLs
 * - SITE_NAME: Brand name used in OG siteName and title templates
 * - resolveLocalizedField: Extracts a string from a potentially localized field
 * - resolveImageUrl: Resolves a MACHMedia-shaped object to an absolute image URL
 */

/** Production site base URL for canonical and Open Graph absolute URLs */
export const BASE_URL = "https://beauteas.com";

/** Brand name used for og:site_name and title template suffix */
export const SITE_NAME = "BeauTeas";

/** R2 image CDN base URL for relative image paths */
const IMAGE_CDN = "https://beauteas-images.beauteas.com";

/**
 * Extracts a plain string from a field that may be a string, a localized
 * Record<string, string>, or nullish.
 *
 * Resolution order for Record values: `field.en`, then first value, then fallback.
 *
 * @param field - The potentially localized field value
 * @param fallback - Default string if no value can be resolved
 * @returns A plain string value
 */
export function resolveLocalizedField(
  field: string | Record<string, string> | undefined | null,
  fallback = ""
): string {
  if (typeof field === "string") return field;
  if (field && typeof field === "object") {
    return field.en || Object.values(field)[0] || fallback;
  }
  return fallback;
}

/**
 * Resolves a MACHMedia-shaped object (or string) to an absolute image URL.
 *
 * Handles all shapes encountered in the codebase:
 * - Plain string (relative or absolute URL)
 * - Object with `.url` (string)
 * - Object with `.file.url` (string) -- standard MACHMedia shape
 *
 * Relative paths are prefixed with the R2 image CDN base URL.
 *
 * @param media - A MACHMedia object, string URL, or unknown value
 * @returns An absolute image URL, or null if no URL can be resolved
 */
export function resolveImageUrl(media: unknown): string | null {
  let url: string | null = null;

  if (typeof media === "string") {
    url = media;
  } else if (media && typeof media === "object") {
    const obj = media as Record<string, unknown>;

    if (typeof obj.url === "string") {
      url = obj.url;
    } else if (
      obj.file &&
      typeof obj.file === "object" &&
      typeof (obj.file as Record<string, unknown>).url === "string"
    ) {
      url = (obj.file as Record<string, unknown>).url as string;
    }
  }

  if (!url) return null;

  // Prefix relative paths with the R2 CDN base URL
  if (!url.startsWith("http")) {
    return `${IMAGE_CDN}/${url}`;
  }

  return url;
}
