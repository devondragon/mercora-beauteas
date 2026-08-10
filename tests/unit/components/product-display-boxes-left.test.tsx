/**
 * Task 3 (goob-year-of-tea): the PDP's old "N in stock" / "Backordered" line
 * is replaced by the closing-sale box count (BoxesLeft, driven by
 * boxesLeft()). Follows the renderToStaticMarkup pattern from
 * product-display-withdrawn-variant.test.tsx - this repo has no
 * @testing-library/react, so component tests render to static markup and
 * assert on the resulting HTML string.
 *
 * The count assertions below (not just `toContain`) exist because Task 2 hit
 * exactly this defect on the catalog card: BoxesLeft's own "Sold out" and a
 * second, separately-rendered "Sold out" both landed in the markup. A
 * `toContain` check would not have caught that duplication.
 */
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { Product } from "@/lib/types";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("next/image", () => ({
  default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

const { default: ProductDisplay } = await import("@/app/product/[slug]/ProductDisplay");

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

function makeProduct(overrides: {
  quantity: number;
  track_inventory?: boolean;
  allow_backorder?: boolean;
}): Product {
  return {
    id: "prod_boxes_left",
    name: "Clearly Calendula Morning",
    description: "An energizing organic black tea blend.",
    slug: "clearly-calendula-morning",
    default_variant_id: "var_1box",
    variants: [
      {
        id: "var_1box",
        status: "active",
        option_values: [{ option_id: "size", value: "One box (10 tea bags)" }],
        price: { amount: 1499, currency: "USD" },
        inventory: {
          quantity: overrides.quantity,
          ...(overrides.track_inventory !== undefined && {
            track_inventory: overrides.track_inventory,
          }),
          ...(overrides.allow_backorder !== undefined && {
            allow_backorder: overrides.allow_backorder,
          }),
        },
      },
    ],
  } as unknown as Product;
}

describe("ProductDisplay boxes-left readout (goob-year-of-tea Task 3)", () => {
  it("shows the closing-sale box count, not the old stock line", () => {
    const html = renderToStaticMarkup(
      <ProductDisplay product={makeProduct({ quantity: 250 })} reviews={[]} recommendations={[]} />
    );

    expect(html).toContain("250 boxes left");
    expect(html).not.toContain("in stock");
  });

  it("never says Backordered when stock is gone, and shows Sold out exactly once", () => {
    const html = renderToStaticMarkup(
      <ProductDisplay product={makeProduct({ quantity: 0 })} reviews={[]} recommendations={[]} />
    );

    expect(html).not.toContain("Backordered");
    expect(html).not.toContain("Add to Cart");
    expect(countOccurrences(html, "Sold out")).toBe(1);
  });

  // Regression: `boxesLeft` reads track_inventory === false / allow_backorder
  // === true as "unlimited, no count to show" (returns null), the same as
  // isVariantAvailable and hasAvailableStock elsewhere in the codebase. Zero
  // quantity there does not mean sold out. `available` must agree, or the
  // page renders neither the box count nor "Sold out" nor "Add to Cart" -
  // a blank hole where the stock/CTA area should be.
  it("treats an untracked variant at quantity 0 as purchasable, not sold out", () => {
    const html = renderToStaticMarkup(
      <ProductDisplay
        product={makeProduct({ quantity: 0, track_inventory: false })}
        reviews={[]}
        recommendations={[]}
      />
    );

    expect(html).toContain("Add to Cart");
    expect(html).not.toContain("Sold out");
    expect(html).not.toContain("Backordered");
  });

  it("treats a backorder-allowed variant at quantity 0 as purchasable, not sold out", () => {
    const html = renderToStaticMarkup(
      <ProductDisplay
        product={makeProduct({ quantity: 0, allow_backorder: true })}
        reviews={[]}
        recommendations={[]}
      />
    );

    expect(html).toContain("Add to Cart");
    expect(html).not.toContain("Sold out");
    expect(html).not.toContain("Backordered");
  });
});
