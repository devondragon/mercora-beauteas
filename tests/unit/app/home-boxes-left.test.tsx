/**
 * SDD Task 5: the homepage hero's shop-wide "N boxes left" line.
 *
 * `app/page.tsx` sums `boxesLeft` (lib/sale/year-supply.ts) across the three
 * featured blends and renders it above the "Shop While It Lasts" button. The
 * brief that added this (task-5-brief.md) shipped no test for it, but the
 * summing logic has real behaviour worth pinning down here, since the
 * brief's own inline code snippet is the only description of it:
 *
 *   - a blend with no trackable count (`boxesLeft` returns null - untracked
 *     inventory or backorder-allowed) contributes nothing to the total,
 *     rather than counting as zero;
 *   - if EVERY blend returns null, the whole line is omitted rather than
 *     rendering "0 boxes left" - a false claim that nothing is left;
 *   - a single blend legitimately at zero stock still contributes zero and
 *     does not suppress the line for the others.
 *
 * Rendered with `renderToStaticMarkup` per the reference pattern in
 * tests/unit/components/product-card-anchor-nesting.test.tsx: next/link and
 * next/image are stubbed (neither is relevant to the markup under test, and
 * next/image needs the Next runtime this suite doesn't have), and
 * `getProductsByCategory` is mocked so no D1 binding is required.
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

const getProductsByCategory = vi.fn();
vi.mock("@/lib/models/mach/products", () => ({
  getProductsByCategory: (...args: unknown[]) => getProductsByCategory(...args),
}));

const { default: HomePage } = await import("@/app/page");

function makeBlend(
  timeOfDay: "morning" | "afternoon" | "evening",
  inventory: { quantity?: number; track_inventory?: boolean; allow_backorder?: boolean } | null,
): Product {
  return {
    id: `prod_${timeOfDay}`,
    name: `Clearly Calendula ${timeOfDay[0].toUpperCase()}${timeOfDay.slice(1)}`,
    description: "An organic tea blend.",
    slug: `clearly-calendula-${timeOfDay}`,
    default_variant_id: `var_${timeOfDay}`,
    categories: ["cat_clearly_calendula"],
    variants: [
      {
        id: `var_${timeOfDay}`,
        price: { amount: 1499, currency: "USD" },
        inventory,
      },
    ],
  } as unknown as Product;
}

async function renderHome(products: Product[]) {
  getProductsByCategory.mockResolvedValueOnce(products);
  const element = await HomePage();
  return renderToStaticMarkup(element);
}

describe("homepage hero: shop-wide boxes-left total (SDD Task 5)", () => {
  it("renders the summed total across the three blends, thousands-grouped", async () => {
    const html = await renderHome([
      makeBlend("morning", { quantity: 500 }),
      makeBlend("afternoon", { quantity: 400 }),
      makeBlend("evening", { quantity: 332 }),
    ]);

    expect(html).toContain("1,232 boxes left in the whole shop.");
  });

  it("excludes blends with an unknown count (untracked / backorder) from the sum, rather than treating them as zero", async () => {
    const html = await renderHome([
      makeBlend("morning", { quantity: 500 }),
      makeBlend("afternoon", { quantity: 10, allow_backorder: true }), // -> null, would corrupt the sum if treated as 0
      makeBlend("evening", { quantity: 300 }),
    ]);

    // 500 + 300, NOT 500 + 0 + 300 (same number here, so also assert the
    // excluded blend's own count never leaks in un-summed) and NOT 810.
    expect(html).toContain("800 boxes left in the whole shop.");
    expect(html).not.toContain("810 boxes left");
  });

  it("omits the line entirely when every blend returns null, rather than rendering 0 boxes left", async () => {
    const html = await renderHome([
      makeBlend("morning", { track_inventory: false }),
      makeBlend("afternoon", { allow_backorder: true }),
      makeBlend("evening", null),
    ]);

    expect(html).not.toContain("boxes left in the whole shop");
    expect(html).not.toContain("0 boxes left in the whole shop");
  });

  it("still shows the line when a single blend is at zero stock, contributing zero rather than suppressing the total", async () => {
    const html = await renderHome([
      makeBlend("morning", { quantity: 0 }),
      makeBlend("afternoon", { quantity: 100 }),
      makeBlend("evening", { quantity: 50 }),
    ]);

    expect(html).toContain("150 boxes left in the whole shop.");
  });
});
