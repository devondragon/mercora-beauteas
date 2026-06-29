/**
 * === Cloudflare Image Loader ===
 *
 * Custom Next.js image loader that integrates with Cloudflare's Image
 * Resizing service for optimized image delivery with automatic format
 * conversion and quality adjustments.
 *
 * === Features ===
 * - **Cloudflare Integration**: Uses Cloudflare's image transformation API
 * - **Development Mode**: Bypasses optimization during local development
 * - **Auto Format**: Automatically serves WebP/AVIF when supported
 * - **Quality Control**: Configurable image quality with intelligent defaults
 * - **Path Normalization**: Handles relative and absolute path formats
 * - **CDN Optimization**: Leverages Cloudflare's global edge network
 *
 * === Technical Implementation ===
 * - **Environment Detection**: Different behavior for dev vs production
 * - **URL Construction**: Builds Cloudflare image transformation URLs
 * - **Parameter Encoding**: Properly formats width, quality, and format params
 * - **Source Handling**: Normalizes image paths for consistent processing
 *
 * === Cloudflare Image Parameters ===
 * - **width**: Target image width for responsive sizing
 * - **format=auto**: Automatic format selection (WebP/AVIF/JPEG)
 * - **quality**: Compression quality (1-100, optimized for web delivery)
 *
 * === Usage ===
 * Configured in next.config.ts as the default image loader:
 * ```typescript
 * images: {
 *   loader: 'custom',
 *   loaderFile: './image-loader.ts'
 * }
 * ```
 *
 * === Performance Benefits ===
 * - Automatic format optimization reduces file sizes by 30-50%
 * - Edge caching provides sub-50ms image delivery globally
 * - Dynamic resizing eliminates need for multiple image variants
 * - Progressive JPEG/WebP loading improves perceived performance
 */

// image-loader.ts
import type { ImageLoaderProps } from "next/image";

// Image host for R2-backed media. Set per environment via wrangler vars:
//   prod → "https://beauteas-images.beauteas.com" (Cloudflare Images CDN)
//   dev  → unset → images are served same-origin via the /media R2 route
const IMAGE_CDN = process.env.NEXT_PUBLIC_IMAGE_CDN;

// The prod CDN host, recognized even when hardcoded into a stored src so we can
// re-route it to the active host (e.g. the /media route in dev).
const LEGACY_CDN = "https://beauteas-images.beauteas.com";

/**
 * Reduce an image src to its bare R2 object key (e.g. "products/x.jpg").
 * Returns null for external URLs that should be passed through untouched
 * (Clerk avatars, Stripe, etc.).
 */
function toObjectKey(src: string): string | null {
  // Already pointed at our CDN (possibly hardcoded in stored data)
  if (src.startsWith(LEGACY_CDN)) {
    return src
      .slice(LEGACY_CDN.length)
      .replace(/^\//, "")
      .replace(/^cdn-cgi\/image\/[^/]+\//, "");
  }
  if (IMAGE_CDN && src.startsWith(IMAGE_CDN)) {
    return src.slice(IMAGE_CDN.length).replace(/^\//, "");
  }
  // Other absolute URL → external, leave it alone
  if (/^https?:\/\//.test(src)) return null;
  // Relative path / bare key → strip any leading slash
  return src.replace(/^\//, "");
}

/**
 * Cloudflare image loader for Next.js Image component.
 *
 * @param src - Image source URL or R2 object key
 * @param width - Target width for responsive images
 * @param quality - Optional image quality (1-100)
 * @returns The URL the browser should request for this image
 */
export default function cloudflareLoader({
  src,
  width,
  quality,
}: ImageLoaderProps) {
  // Local dev server: serve as-is (no optimization, faster builds)
  if (process.env.NODE_ENV === "development") {
    return src;
  }

  const key = toObjectKey(src);
  // External image: return untouched
  if (key === null) return src;

  if (IMAGE_CDN) {
    // Production: Cloudflare Images transformation on the CDN domain
    const params = [`width=${width}`, "format=auto"];
    if (quality) params.push(`quality=${quality}`);
    return `${IMAGE_CDN}/cdn-cgi/image/${params.join(",")}/${key}`;
  }

  // No CDN configured (e.g. dev Worker): same-origin R2 media route
  return `/media/${key}`;
}
