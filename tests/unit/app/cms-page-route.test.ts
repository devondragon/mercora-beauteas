/**
 * Regression tests for the CMS page route's control flow.
 *
 * Two of the three cases here are bugs that shipped and were only caught by
 * manual inspection, so they are pinned as unit tests: CI runs `tests/unit/**`
 * only — a Workers-pool or Playwright test would not gate a merge.
 *
 * `next/navigation` is deliberately NOT mocked. redirect() and notFound() work
 * by throwing tagged errors that unstable_rethrow recognizes; substituting a
 * mock would test the mock's idea of that contract rather than Next's, which is
 * precisely the thing that broke.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/models/pages", () => ({ getPageBySlug: vi.fn() }));
vi.mock("@/lib/cms/custom-js-guard", () => ({ getCustomJsEnabled: vi.fn(async () => false) }));
vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn(async () => ({ userId: null })) }));
// PageRenderer is an async server component pulling in the whole render tree;
// the route's control flow is what is under test here.
vi.mock("@/app/[slug]/PageRenderer", () => ({ default: () => null }));

import PublicPage from "@/app/[slug]/page";
import { getPageBySlug } from "@/lib/models/pages";
import { auth } from "@clerk/nextjs/server";

const mockedGetPage = vi.mocked(getPageBySlug);
const mockedAuth = vi.mocked(auth);

function page(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    slug: "brewing-directions",
    title: "Brewing Directions",
    content: "<p>Body.</p>",
    template: "guide",
    is_protected: false,
    ...overrides,
  } as never;
}

/** Next tags its control-flow throws with a `digest`; genuine errors have none. */
function digestOf(error: unknown): string {
  return String((error as { digest?: unknown })?.digest ?? "");
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedAuth.mockResolvedValue({ userId: null } as never);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("PublicPage", () => {
  it("propagates the sign-in redirect for a protected page", async () => {
    // The original try/catch swallowed redirect()'s throw and called notFound()
    // instead, turning a sign-in bounce into a 404 on every protected page.
    mockedGetPage.mockResolvedValue(page({ is_protected: true }));

    const error = await PublicPage({ params: Promise.resolve({ slug: "brewing-directions" }) })
      .then(() => null)
      .catch((e) => e);

    expect(digestOf(error)).toContain("NEXT_REDIRECT");
    expect(digestOf(error)).toContain("/sign-in");
  });

  it("404s when the page does not exist", async () => {
    mockedGetPage.mockResolvedValue(null as never);

    const error = await PublicPage({ params: Promise.resolve({ slug: "nope" }) })
      .then(() => null)
      .catch((e) => e);

    expect(digestOf(error)).toContain("404");
  });

  it("surfaces a lookup failure as an error, not a 404", async () => {
    // A 404 asserts the page does not exist and Google acts on it; a transient
    // D1 error must not be allowed to deindex a live legal page.
    mockedGetPage.mockRejectedValue(new Error("D1_ERROR: connection lost"));

    const error = await PublicPage({ params: Promise.resolve({ slug: "privacy-policy" }) })
      .then(() => null)
      .catch((e) => e);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("D1_ERROR");
    expect(digestOf(error)).not.toContain("404");
  });

  it("renders a published page without throwing", async () => {
    mockedGetPage.mockResolvedValue(page());

    await expect(
      PublicPage({ params: Promise.resolve({ slug: "brewing-directions" }) }),
    ).resolves.toBeDefined();
  });

  it("does not redirect a protected page when the visitor is signed in", async () => {
    mockedGetPage.mockResolvedValue(page({ is_protected: true }));
    mockedAuth.mockResolvedValue({ userId: "user_123" } as never);

    await expect(
      PublicPage({ params: Promise.resolve({ slug: "brewing-directions" }) }),
    ).resolves.toBeDefined();
  });
});
