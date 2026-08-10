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
