import type { NextConfig } from "next";
// Security headers (CSP/HSTS/nosniff/frame-options) live in their own module so the
// CSP can be built from env-driven values (image CDN) and unit tested. See BMC-150.
import { buildSecurityHeaders } from "./lib/security-headers";

const SECURITY_HEADERS = buildSecurityHeaders();

const nextConfig: NextConfig = {
  images: {
    loader: "custom",
    loaderFile: "./image-loader.ts",
  },
  // Minimal experimental config to avoid build issues
  experimental: {
    optimizePackageImports: ["@next/font"],
  },
  /**
   * ⚠️ Do NOT re-add a custom `webpack.optimization.splitChunks.cacheGroups`
   * override here (removed in BMC-220).
   *
   * A `{ test: /node_modules/, chunks: "all" }` vendor group sweeps up CSS
   * modules from dependencies as well as JS, so mini-css-extract emits a
   * stylesheet that belongs to the `main-app` entrypoint. Next puts every
   * entrypoint file — `.js` AND `.css` — into `rootMainFiles`
   * (build-manifest-plugin `getEntrypointFiles`), and app-render then feeds
   * that list unfiltered to `ReactDOM.preinit(src, { as: "script" })`
   * (server/app-render/required-scripts.ts). The stylesheet was therefore
   * emitted as `<script src="/_next/static/css/*.css" async>` on every route,
   * and the browser raised `Uncaught SyntaxError: Invalid or unexpected token`
   * parsing CSS as JS. Next never filters the extension, so ANY config that
   * attaches a CSS chunk to `main-app` reintroduces the error site-wide.
   *
   * The override also set `maxSize` (which fragmented vendors into ~70 request-
   * per-page chunks) and `concatenateModules: false` (which disables scope
   * hoisting). It was added in cb4a810 to quiet unused-preload *warnings*; it
   * traded those for a hard error and a slower page. Next's defaults are fine.
   */
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
  // Static permanent redirects for URL changes (e.g., archived CMS page slugs).
  // This is distinct from dynamic Shopify/redirect_map redirects in middleware.ts.
  // /about → /about-us closes the loop after migration 0019 archives the placeholder.
  async redirects() {
    return [
      {
        source: "/about",
        destination: "/about-us",
        permanent: true,
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
