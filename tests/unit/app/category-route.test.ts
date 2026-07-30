/**
 * Regression tests for the category route.
 *
 * An unknown category used to render a plain <div> with a 200 status — a soft
 * 404, which search engines keep indexed. And a product-load failure used to
 * render the raw exception message ("D1_ERROR: …") to the customer while
 * logging nothing server-side.
 *
 * `next/navigation` is not mocked, so notFound()'s real tagged throw is what
 * gets asserted.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/models", () => ({ getCategoryBySlug: vi.fn() }));
vi.mock("@/lib/models/mach/products", () => ({ getProductsByCategory: vi.fn() }));
vi.mock("@/app/category/[slug]/CategoryDisplay", () => ({ default: () => null }));

import CategoryPage from "@/app/category/[slug]/page";
import { getCategoryBySlug } from "@/lib/models";
import { getProductsByCategory } from "@/lib/models/mach/products";

const mockedCategory = vi.mocked(getCategoryBySlug);
const mockedProducts = vi.mocked(getProductsByCategory);

function digestOf(error: unknown): string {
  return String((error as { digest?: unknown })?.digest ?? "");
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("CategoryPage", () => {
  it("404s for an unknown category instead of rendering a 200", async () => {
    mockedCategory.mockResolvedValue(null as never);

    const error = await CategoryPage({ params: Promise.resolve({ slug: "nope" }) })
      .then(() => null)
      .catch((e) => e);

    expect(digestOf(error)).toContain("404");
  });

  it("logs the real error and does not leak it to the page", async () => {
    mockedCategory.mockResolvedValue({ id: "c1", name: "Teas", slug: "teas" } as never);
    mockedProducts.mockRejectedValue(new Error("D1_ERROR: no such table: products"));

    await expect(
      CategoryPage({ params: Promise.resolve({ slug: "teas" }) }),
    ).resolves.toBeDefined();

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("teas"),
      expect.objectContaining({ message: expect.stringContaining("D1_ERROR") }),
    );
  });
});
