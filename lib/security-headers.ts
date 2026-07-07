/**
 * === Security headers (BMC-150) ===
 *
 * Central definition of the HTTP security headers applied to every response by
 * `next.config.ts`. Kept in its own module (rather than inline in the config) so
 * the Content-Security-Policy can be:
 *   - built from the same env-driven values the app actually uses (image CDN), and
 *   - unit tested (see tests/unit/lib/security-headers.test.ts).
 *
 * CSP is tuned to the origins the browser actually contacts:
 *   - Stripe.js / Elements  → js.stripe.com (script+frame), api/maps/r.stripe.com (xhr),
 *     hooks.stripe.com (3-D Secure frame)
 *   - Clerk auth            → *.clerk.accounts.dev (dev instance) + clerk.beauteas.com /
 *     *.clerk.com (prod FAPI) + img.clerk.com (avatars); Turnstile via challenges.cloudflare.com
 *   - Product/media images  → NEXT_PUBLIC_IMAGE_CDN (falls back to the prod CDN host)
 *
 * 'unsafe-inline' is required for script-src (Next.js injects inline bootstrap/hydration
 * scripts; JSON-LD is rendered via dangerouslySetInnerHTML) and style-src (Stripe/Clerk
 * inject inline styles). Nonce-based CSP is a future hardening (tracked separately).
 *
 * NOTE: at cutover, confirm the live Clerk Frontend API host once the pk_live_ key is set
 * and that NEXT_PUBLIC_IMAGE_CDN is the final image host.
 */

// Clerk auth hosts: dev instance (*.clerk.accounts.dev) + prod FAPI
// (clerk.beauteas.com / *.clerk.com). Declared once so script-src, connect-src and
// frame-src stay in sync.
const CLERK_HOSTS = [
  "https://*.clerk.accounts.dev",
  "https://*.clerk.com",
  "https://clerk.beauteas.com",
];

// Clerk's SDK posts anonymous telemetry to clerk-telemetry.com by default; allow it
// in connect-src so blocked-request console noise doesn't mask real CSP violations.
const CLERK_TELEMETRY = "https://clerk-telemetry.com";

// Fallback image host when NEXT_PUBLIC_IMAGE_CDN is unset at build time. Kept in sync
// with image-loader.ts (LEGACY_CDN).
const LEGACY_IMAGE_CDN = "https://img.beauteas.com";

/**
 * Build the Content-Security-Policy string.
 *
 * Reads env at call time so the value tracks the build environment:
 *   - `img-src` is derived from NEXT_PUBLIC_IMAGE_CDN (same var image-loader.ts uses),
 *     falling back to the prod CDN host so a build without the var still loads images.
 *   - `'unsafe-eval'` is added to `script-src` outside production only, because
 *     Next.js dev tooling (Fast Refresh / Turbopack HMR) evaluates code at runtime.
 *     It is never emitted in production builds.
 */
export function buildContentSecurityPolicy(): string {
  const isProduction = process.env.NODE_ENV === "production";

  const imageHosts = Array.from(
    new Set([
      process.env.NEXT_PUBLIC_IMAGE_CDN || LEGACY_IMAGE_CDN,
      "https://img.clerk.com",
    ]),
  );

  const scriptSrc = [
    "script-src 'self' 'unsafe-inline'",
    isProduction ? null : "'unsafe-eval'",
    "https://js.stripe.com",
    ...CLERK_HOSTS,
    "https://challenges.cloudflare.com",
  ]
    .filter(Boolean)
    .join(" ");

  return [
    "default-src 'self'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${imageHosts.join(" ")}`,
    "font-src 'self' data:",
    `connect-src 'self' https://api.stripe.com https://maps.stripe.com https://r.stripe.com ${CLERK_HOSTS.join(
      " ",
    )} ${CLERK_TELEMETRY}`,
    `frame-src https://js.stripe.com https://hooks.stripe.com ${CLERK_HOSTS.join(
      " ",
    )} https://challenges.cloudflare.com`,
    "worker-src 'self' blob:",
    "media-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

/**
 * Security headers sent on every response.
 *
 * HSTS is only honored by browsers over HTTPS, so it is inert during local http
 * dev/preview; Cloudflare "Always Use HTTPS" handles the http→https redirect in
 * production. (We deliberately omit `upgrade-insecure-requests` so it does not break
 * the http localhost preview workflow.)
 */
export function buildSecurityHeaders(): { key: string; value: string }[] {
  return [
    { key: "Content-Security-Policy", value: buildContentSecurityPolicy() },
    {
      key: "Strict-Transport-Security",
      value: "max-age=63072000; includeSubDomains; preload",
    },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    {
      key: "Permissions-Policy",
      value:
        'camera=(), microphone=(), geolocation=(), payment=(self "https://js.stripe.com")',
    },
  ];
}
