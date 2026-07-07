import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildContentSecurityPolicy,
  buildSecurityHeaders,
} from "@/lib/security-headers";

afterEach(() => {
  vi.unstubAllEnvs();
});

/** Extract a single CSP directive (e.g. "img-src ...") from the policy string. */
function directive(csp: string, name: string): string | undefined {
  return csp
    .split(";")
    .map((d) => d.trim())
    .find((d) => d === name || d.startsWith(`${name} `));
}

describe("buildContentSecurityPolicy", () => {
  it("includes the core hardening directives", () => {
    const csp = buildContentSecurityPolicy();
    expect(directive(csp, "default-src")).toBe("default-src 'self'");
    expect(directive(csp, "object-src")).toBe("object-src 'none'");
    expect(directive(csp, "base-uri")).toBe("base-uri 'self'");
    expect(directive(csp, "form-action")).toBe("form-action 'self'");
    // Clickjacking protection must always be present.
    expect(directive(csp, "frame-ancestors")).toBe("frame-ancestors 'none'");
  });

  it("allows the third-party origins the app depends on", () => {
    const csp = buildContentSecurityPolicy();
    const scriptSrc = directive(csp, "script-src")!;
    const connectSrc = directive(csp, "connect-src")!;
    const frameSrc = directive(csp, "frame-src")!;

    // Stripe.js + Elements
    expect(scriptSrc).toContain("https://js.stripe.com");
    expect(connectSrc).toContain("https://api.stripe.com");
    expect(frameSrc).toContain("https://hooks.stripe.com");
    // Clerk FAPI (prod + dev instance) must be reachable for auth
    expect(connectSrc).toContain("https://clerk.beauteas.com");
    expect(connectSrc).toContain("https://*.clerk.accounts.dev");
    // Turnstile challenge
    expect(scriptSrc).toContain("https://challenges.cloudflare.com");
    // Clerk telemetry (kept out of console noise during smoke tests)
    expect(connectSrc).toContain("https://clerk-telemetry.com");
  });

  it("derives img-src from NEXT_PUBLIC_IMAGE_CDN when set", () => {
    vi.stubEnv("NEXT_PUBLIC_IMAGE_CDN", "https://cdn.example.com");
    const imgSrc = directive(buildContentSecurityPolicy(), "img-src")!;
    expect(imgSrc).toContain("https://cdn.example.com");
    expect(imgSrc).toContain("https://img.clerk.com");
    expect(imgSrc).toContain("data:");
    expect(imgSrc).toContain("blob:");
  });

  it("falls back to the prod image host when NEXT_PUBLIC_IMAGE_CDN is unset", () => {
    vi.stubEnv("NEXT_PUBLIC_IMAGE_CDN", "");
    const imgSrc = directive(buildContentSecurityPolicy(), "img-src")!;
    expect(imgSrc).toContain("https://img.beauteas.com");
  });

  it("adds 'unsafe-eval' to script-src only outside production", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(directive(buildContentSecurityPolicy(), "script-src")).toContain(
      "'unsafe-eval'",
    );

    vi.stubEnv("NODE_ENV", "production");
    expect(directive(buildContentSecurityPolicy(), "script-src")).not.toContain(
      "'unsafe-eval'",
    );
  });
});

describe("buildSecurityHeaders", () => {
  it("emits the full security header set", () => {
    const headers = buildSecurityHeaders();
    const byKey = Object.fromEntries(headers.map((h) => [h.key, h.value]));

    expect(byKey["Content-Security-Policy"]).toContain("default-src 'self'");
    expect(byKey["Strict-Transport-Security"]).toBe(
      "max-age=63072000; includeSubDomains; preload",
    );
    expect(byKey["X-Content-Type-Options"]).toBe("nosniff");
    expect(byKey["X-Frame-Options"]).toBe("DENY");
    expect(byKey["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(byKey["Permissions-Policy"]).toContain("geolocation=()");
    expect(byKey["Permissions-Policy"]).toContain(
      'payment=(self "https://js.stripe.com")',
    );
  });
});
