import type { NextConfig } from "next";

// === Content-Security-Policy ===
// Tuned to the origins the browser actually contacts (see BMC-150). Third parties:
//   - Stripe.js / Elements  → js.stripe.com (script+frame), api/maps/r.stripe.com (xhr),
//     hooks.stripe.com (3-D Secure frame)
//   - Clerk auth            → *.clerk.accounts.dev (dev instance) + clerk.beauteas.com /
//     *.clerk.com (prod FAPI + img.clerk.com avatars); Turnstile via challenges.cloudflare.com
//   - Product/media images  → img.beauteas.com (NEXT_PUBLIC_IMAGE_CDN)
// 'unsafe-inline' is required for script-src (Next.js injects inline bootstrap/hydration
// scripts; JSON-LD is rendered via dangerouslySetInnerHTML) and style-src (Stripe/Clerk
// inject inline styles). Nonce-based CSP is a future hardening (tracked separately).
// NOTE: at cutover, confirm the live Clerk Frontend API host once the pk_live_ key is set
// and img.beauteas.com is the final NEXT_PUBLIC_IMAGE_CDN.
const CLERK_HOSTS =
  "https://*.clerk.accounts.dev https://*.clerk.com https://clerk.beauteas.com";
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' https://js.stripe.com ${CLERK_HOSTS} https://challenges.cloudflare.com`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://img.beauteas.com https://img.clerk.com",
  "font-src 'self' data:",
  `connect-src 'self' https://api.stripe.com https://maps.stripe.com https://r.stripe.com ${CLERK_HOSTS}`,
  `frame-src https://js.stripe.com https://hooks.stripe.com ${CLERK_HOSTS} https://challenges.cloudflare.com`,
  "worker-src 'self' blob:",
  "media-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

// Sent on every response. HSTS is only honored by browsers over HTTPS, so it is inert
// during local http dev/preview; Cloudflare "Always Use HTTPS" handles the http→https
// redirect in production. (We deliberately omit `upgrade-insecure-requests` so it does
// not break the http localhost preview workflow.)
const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: CONTENT_SECURITY_POLICY },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: 'camera=(), microphone=(), geolocation=(), payment=(self "https://js.stripe.com")',
  },
];

const nextConfig: NextConfig = {
  images: {
    loader: "custom",
    loaderFile: "./image-loader.ts",
  },
  // Minimal experimental config to avoid build issues
  experimental: {
    optimizePackageImports: ["@next/font"],
  },
  // Configure webpack for better performance without problematic optimizations
  webpack: (config, { isServer }) => {
    if (!isServer) {
      // Basic chunk optimization with reduced preloading
      config.optimization = {
        ...config.optimization,
        splitChunks: {
          ...config.optimization.splitChunks,
          cacheGroups: {
            ...config.optimization.splitChunks.cacheGroups,
            vendor: {
              test: /[\\/]node_modules[\\/]/,
              name: 'vendors',
              chunks: 'all',
              priority: 10,
              reuseExistingChunk: true,
              maxSize: 150000, // Smaller chunks to reduce preloading
            },
            common: {
              name: 'common',
              minChunks: 2,
              priority: 5,
              chunks: 'all',
              maxSize: 100000, // Keep common chunks small
            },
          },
        },
      };
      
      // Reduce module concatenation which can cause larger chunks
      config.optimization.concatenateModules = false;
    }
    return config;
  },
  // Basic headers for performance and resource loading control
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          ...SECURITY_HEADERS,
          {
            key: "X-DNS-Prefetch-Control",
            value: "on",
          },
          // Reduce resource hints aggressiveness
          {
            key: "X-Resource-Hint-Control",
            value: "conservative",
          },
          // Suppress browser preload warnings
          {
            key: "Link-Policy",
            value: "suppress-warnings",
          },
        ],
      },
      {
        // Specific headers for static assets to prevent over-eager preloading
        source: "/_next/static/(.*)",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
      {
        // Prevent preloading of non-critical webpack chunks
        source: "/_next/static/chunks/webpack-(.*)",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=86400",
          },
        ],
      },
    ];
  },
  // Shopify URL redirects are handled entirely in middleware.ts so that
  // slug-level redirect_map lookups (from migration) take priority over
  // structural pattern redirects. See middleware.ts for details.
};

export default nextConfig;

// Only start the Cloudflare dev proxy during `next dev` — it requires Cloudflare
// credentials and will fail in CI / `next build` / `next lint` contexts.
if (process.env.NODE_ENV === "development") {
  import("@opennextjs/cloudflare").then(m => m.initOpenNextCloudflareForDev());
}
