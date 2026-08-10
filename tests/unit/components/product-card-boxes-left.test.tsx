/**
 * Task 2 review fix: ProductCard must show exactly ONE "Sold out" label,
 * never two.
 *
 * `BoxesLeft` (components/sale/BoxesLeft.tsx) renders its own "Sold out" at
 * `boxes === 0`. ProductCard's availability line used to render "Sold out"
 * independently of that, so any zero-boxes case doubled the label:
 *   - a product with no sellable variant at all (every variant withdrawn,
 *     e.g. migration 0028) - forced to `boxes = 0` in ProductCard so
 *     `BoxesLeft` has something concrete to say, rather than `boxesLeft`'s
 *     own null ("no inventory record") reading as unlimited/available.
 *   - a tracked variant genuinely at `quantity: 0`.
 *
 * These tests pin the COUNT of "Sold out" occurrences (not just presence),
 * because `toContain("Sold out")` alone passes even with the duplicate - that
 * is exactly how the defect shipped past the original regression test.
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

const { default: ProductCard } = await import("@/components/ProductCard");

const soldOutCount = (html: string) => (html.match(/Sold out/g) ?? []).length;

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: "prod_1",
    name: "Clearly Calendula Morning",
    description: "An energizing organic black tea blend.",
    slug: "clearly-calendula-morning",
    // The catalog's real type for the three blends. Without it the card falls
    // back to the plain In Stock / Sold out label (see isSoldByTheBox).
    type: "Tea Bags",
    extensions: { servings: "10 tea bags per box" },
    default_variant_id: "var_1",
    variants: [
      {
        id: "var_1",
        status: "active",
        price: { amount: 1499, currency: "USD" },
        inventory: { quantity: 12 },
      },
    ],
    ...overrides,
  } as unknown as Product;
}

describe("ProductCard + BoxesLeft: exactly one Sold out label", () => {
  it("shows exactly one Sold out when every variant is withdrawn (no sellable defaultVariant)", () => {
    const product = makeProduct({
      default_variant_id: "var_withdrawn",
      variants: [
        {
          id: "var_withdrawn",
          status: "discontinued",
          price: { amount: 3999, currency: "USD" },
          inventory: { quantity: 5 },
        },
      ],
    } as Partial<Product>);

    const html = renderToStaticMarkup(<ProductCard product={product} />);

    expect(soldOutCount(html)).toBe(1);
  });

  it("shows exactly one Sold out for a tracked variant genuinely at zero quantity", () => {
    const product = makeProduct({
      variants: [
        {
          id: "var_1",
          status: "active",
          price: { amount: 1499, currency: "USD" },
          inventory: { quantity: 0, track_inventory: true },
        },
      ],
    } as Partial<Product>);

    const html = renderToStaticMarkup(<ProductCard product={product} />);

    expect(soldOutCount(html)).toBe(1);
  });

  it("shows no Sold out, and In Stock, for a variant with boxes in stock", () => {
    const html = renderToStaticMarkup(<ProductCard product={makeProduct()} />);

    expect(soldOutCount(html)).toBe(0);
    expect(html).toContain("In Stock");
    expect(html).toContain("12 boxes left");
  });

  it("shows no Sold out, and In Stock, for an untracked (unlimited) variant", () => {
    const product = makeProduct({
      variants: [
        {
          id: "var_1",
          status: "active",
          price: { amount: 1499, currency: "USD" },
          inventory: { quantity: 0, track_inventory: false },
        },
      ],
    } as Partial<Product>);

    const html = renderToStaticMarkup(<ProductCard product={product} />);

    expect(soldOutCount(html)).toBe(0);
    expect(html).toContain("In Stock");
  });
});

/**
 * Whole-branch review fix: ProductCard is drawn for the WHOLE active catalog,
 * not just the blends - CategoryDisplay renders it, and PDP recommendations
 * (lib/recommendations/index.ts) draw from every purchasable product. Before
 * this fix a travel mug with 25 units read "25 boxes left" and the Mega Month
 * bundle read "82 boxes left", both false: a mug is not a box and a bundle is
 * nine of them. Non-box products keep the In Stock / Sold out label the card
 * carried before the closing sale.
 */
describe("ProductCard: the box count only where a box is the unit", () => {
  it("gives a tea blend the box count", () => {
    const html = renderToStaticMarkup(<ProductCard product={makeProduct()} />);

    expect(html).toContain("12 boxes left");
    expect(html).toContain("In Stock");
  });

  it("gives a travel mug the In Stock label and no box count", () => {
    const product = makeProduct({
      id: "prod_beauteas_15oz_steel_travel_mug",
      name: "BeauTeas 15oz Steel Travel Mug",
      slug: "beauteas-15oz-steel-travel-mug",
      type: "Drinkware",
      extensions: {},
      variants: [
        {
          id: "var_1",
          status: "active",
          price: { amount: 2999, currency: "USD" },
          inventory: { quantity: 25, track_inventory: true },
        },
      ],
    } as unknown as Partial<Product>);

    const html = renderToStaticMarkup(<ProductCard product={product} />);

    expect(html).not.toContain("boxes left");
    expect(html).not.toContain("25 boxes");
    expect(html).toContain("In Stock");
    expect(soldOutCount(html)).toBe(0);
  });

  it("gives a glossy mug the Sold out label, exactly once, when its stock is gone", () => {
    const product = makeProduct({
      id: "prod_beauteas_white_glossy_mug",
      name: "BeauTeas White Glossy Tea Mug",
      slug: "beauteas-white-glossy-tea-mug",
      type: "Mugs",
      extensions: {},
      variants: [
        {
          id: "var_1",
          status: "active",
          price: { amount: 1899, currency: "USD" },
          inventory: { quantity: 0, track_inventory: true },
        },
      ],
    } as unknown as Partial<Product>);

    const html = renderToStaticMarkup(<ProductCard product={product} />);

    expect(html).not.toContain("boxes left");
    expect(soldOutCount(html)).toBe(1);
    expect(html).not.toContain("In Stock");
  });

  it("gives a multi-box bundle the In Stock label and no box count", () => {
    // Same 'Tea Bags' type as a blend; `extensions.contents` is what marks it
    // as several boxes to a unit, so 82 units are not 82 boxes.
    const product = makeProduct({
      id: "prod_clearly_calendula_full_package",
      name: "Clearly Calendula Mega Month",
      slug: "clearly-calendula-full-package",
      type: "Tea Bags",
      extensions: { contents: "9 boxes · 90 tea bags" },
      variants: [
        {
          id: "var_1",
          status: "active",
          price: { amount: 9999, currency: "USD" },
          inventory: { quantity: 82, track_inventory: true },
        },
      ],
    } as unknown as Partial<Product>);

    const html = renderToStaticMarkup(<ProductCard product={product} />);

    expect(html).not.toContain("boxes left");
    expect(html).not.toContain("82 boxes");
    expect(html).toContain("In Stock");
    expect(soldOutCount(html)).toBe(0);
  });
});
