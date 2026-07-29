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
//   prod → "https://img.beauteas.com" (Cloudflare Images CDN)
//   dev  → unset → images are served same-origin via the /media R2 route
const IMAGE_CDN = process.env.NEXT_PUBLIC_IMAGE_CDN;

// Whether to route images through Cloudflare Image Transformations
// (`/cdn-cgi/image/...`). This REQUIRES Transformations to be enabled for the
// zone — when it is off, every transform URL 404s and the entire storefront
// renders with broken images. That is exactly what happened on 2026-07-27:
// prod sets NEXT_PUBLIC_IMAGE_CDN and so used transforms, while dev leaves it
// unset and falls back to the /media route, so the fault never appeared in dev.
//
// Fallback path: set NEXT_PUBLIC_IMAGE_TRANSFORMS="false" and redeploy. Images
// are then served as raw objects straight from the CDN host — larger (no
// resizing; ~917KB vs ~108KB for a typical product shot) but never broken.
// Kept as an explicit switch so recovery is a config change, not a code change.
const IMAGE_TRANSFORMS_ENABLED = process.env.NEXT_PUBLIC_IMAGE_TRANSFORMS !== "false";

// The prod CDN host, recognized even when hardcoded into a stored src so we can
// re-route it to the active host (e.g. the /media route in dev).
const LEGACY_CDN = "https://img.beauteas.com";

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
  // Local, bundled assets are served straight from /public — never route through R2/CDN.
  // `/chai` covers the mascot marks (chai.svg, chai-mark.svg). Omitting them sent the
  // mascot to R2, where a public/-bundled file does not exist, so it rendered broken in
  // every deployed environment while still working under `next dev` (which returns src
  // untouched below) — which is why it went unnoticed.
  if (
    src.startsWith("/placeholder") ||
    src.startsWith("/logo") ||
    src.startsWith("/chai")
  ) {
    return src;
  }

  // Local dev server: serve as-is (no optimization, faster builds)
  if (process.env.NODE_ENV === "development") {
    return src;
  }

  const key = toObjectKey(src);
  // External image: return untouched
  if (key === null) return src;

  if (IMAGE_CDN) {
    // Fallback: raw object straight off the CDN host. No resizing, but it does
    // not depend on Transformations being enabled for the zone.
    if (!IMAGE_TRANSFORMS_ENABLED) return `${IMAGE_CDN}/${key}`;

    // Production: Cloudflare Images transformation on the CDN domain
    const params = [`width=${width}`, "format=auto"];
    if (quality) params.push(`quality=${quality}`);
    return `${IMAGE_CDN}/cdn-cgi/image/${params.join(",")}/${key}`;
  }

  // No CDN configured (e.g. dev Worker): same-origin R2 media route
  return `/media/${key}`;
}
