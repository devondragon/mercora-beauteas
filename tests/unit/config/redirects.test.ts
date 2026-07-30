/**
 * Migration 0019 archives the duplicate `about` page, which is listed in the
 * live sitemap. The static redirect in next.config.ts is the only thing keeping
 * that URL alive — middleware's redirect_map is consulted only for /products/,
 * /collections/, /pages/, /blogs/ and /policies/, none of which match a bare
 * /about. Nothing else covers this, so it is pinned here.
 */
import { describe, it, expect } from "vitest";
import nextConfig from "@/next.config";

describe("next.config redirects", () => {
  it("redirects /about to /about-us permanently", async () => {
    const redirects = await nextConfig.redirects!();

    expect(redirects).toContainEqual(
      expect.objectContaining({
        source: "/about",
        destination: "/about-us",
        // `permanent: true` — Next emits 308, not 301.
        permanent: true,
      }),
    );
  });
});
