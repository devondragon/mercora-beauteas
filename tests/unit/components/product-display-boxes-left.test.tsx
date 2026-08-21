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
    // The catalog's real type for the three blends. isSoldByTheBox gates the
    // box count and the year-supply CTA on it.
    type: "Tea Bags",
    extensions: { servings: "10 tea bags per box" },
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

/**
 * Whole-branch review fix: the PDP renders every product, not just the blends.
 * A travel mug must not read "25 boxes left", and must not be offered a
 * one-click "36 boxes" year supply - that button would put 36 mugs in the
 * cart. Non-box products get the plain In Stock / Sold out label instead, and
 * still never the old "Backordered" wording.
 */
function makeNonBoxProduct(overrides: {
  type: string;
  quantity: number;
  extensions?: Record<string, unknown>;
}): Product {
  return {
    id: "prod_travel_mug",
    name: "BeauTeas 15oz Steel Travel Mug",
    description: "An insulated steel travel mug.",
    slug: "beauteas-15oz-steel-travel-mug",
    type: overrides.type,
    extensions: overrides.extensions ?? {},
    default_variant_id: "var_mug",
    variants: [
      {
        id: "var_mug",
        status: "active",
        option_values: [{ option_id: "title", value: "Default Title" }],
        price: { amount: 2999, currency: "USD" },
        inventory: { quantity: overrides.quantity, track_inventory: true },
      },
    ],
  } as unknown as Product;
}

describe("ProductDisplay: box count and year supply only where a box is the unit", () => {
  it("shows In Stock and no box count or year supply for a travel mug", () => {
    const html = renderToStaticMarkup(
      <ProductDisplay
        product={makeNonBoxProduct({ type: "Drinkware", quantity: 25 })}
        reviews={[]}
        recommendations={[]}
      />
    );

    expect(html).not.toContain("boxes left");
    expect(html).not.toContain("Make it a year");
    expect(html).not.toContain("Take the last");
    expect(html).toContain("In Stock");
    expect(html).toContain("Add to Cart");
    expect(html).not.toContain("Backordered");
  });

  it("shows Sold out exactly once for a mug with no stock left", () => {
    const html = renderToStaticMarkup(
      <ProductDisplay
        product={makeNonBoxProduct({ type: "Mugs", quantity: 0 })}
        reviews={[]}
        recommendations={[]}
      />
    );

    expect(html).not.toContain("boxes left");
    expect(html).not.toContain("Add to Cart");
    expect(html).not.toContain("Backordered");
    expect(countOccurrences(html, "Sold out")).toBe(1);
  });

  it("shows no box count or year supply for a multi-box bundle", () => {
    const html = renderToStaticMarkup(
      <ProductDisplay
        product={makeNonBoxProduct({
          type: "Tea Bags",
          quantity: 82,
          extensions: { contents: "9 boxes · 90 tea bags" },
        })}
        reviews={[]}
        recommendations={[]}
      />
    );

    expect(html).not.toContain("boxes left");
    expect(html).not.toContain("Make it a year");
    expect(html).toContain("In Stock");
  });

  it("still offers the year supply on a blend", () => {
    const html = renderToStaticMarkup(
      <ProductDisplay product={makeProduct({ quantity: 250 })} reviews={[]} recommendations={[]} />
    );

    expect(html).toContain("Make it a year");
  });
});

/**
 * The quantity picker beside Add to Cart. Only its RENDERED opening state is
 * assertable here (no DOM testing library, so the +/- and typing paths are
 * covered by the pure bounds in tests/unit/lib/sale/purchase-quantity.test.ts).
 * What matters at this level is which number the customer lands on, since it
 * is the number one click adds.
 */
describe("ProductDisplay quantity picker", () => {
  function quantityValue(html: string): string | null {
    const match = html.match(/id="purchase-quantity"[^>]*value="(\d+)"/);
    if (match) return match[1];
    // React may emit value= before id= depending on prop order.
    const reversed = html.match(/value="(\d+)"[^>]*id="purchase-quantity"/);
    return reversed ? reversed[1] : null;
  }

  it("opens a blend at the 10-box cart minimum", () => {
    const html = renderToStaticMarkup(
      <ProductDisplay
        product={makeProduct({ quantity: 250 })}
        reviews={[]}
        recommendations={[]}
        minimumBoxes={10}
      />
    );

    expect(quantityValue(html)).toBe("10");
  });

  it("opens at the 10-box minimum even when the caller passes no minimum", () => {
    // minimumBoxes defaults to 0 on the prop; the picker falls back to
    // DEFAULT_MINIMUM_BOXES rather than opening at 1.
    const html = renderToStaticMarkup(
      <ProductDisplay product={makeProduct({ quantity: 250 })} reviews={[]} recommendations={[]} />
    );

    expect(quantityValue(html)).toBe("10");
  });

  it("opens at what is left when fewer than the minimum remain", () => {
    const html = renderToStaticMarkup(
      <ProductDisplay
        product={makeProduct({ quantity: 4 })}
        reviews={[]}
        recommendations={[]}
        minimumBoxes={10}
      />
    );

    expect(quantityValue(html)).toBe("4");
  });

  it("opens a mug at 1, not at the box minimum", () => {
    const html = renderToStaticMarkup(
      <ProductDisplay
        product={makeNonBoxProduct({ type: "Drinkware", quantity: 25 })}
        reviews={[]}
        recommendations={[]}
        minimumBoxes={10}
      />
    );

    expect(quantityValue(html)).toBe("1");
  });

  it("renders no picker at all when the product is sold out", () => {
    const html = renderToStaticMarkup(
      <ProductDisplay product={makeProduct({ quantity: 0 })} reviews={[]} recommendations={[]} />
    );

    expect(html).not.toContain("purchase-quantity");
  });
});
