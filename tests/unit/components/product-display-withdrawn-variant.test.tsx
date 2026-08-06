/**
 * Final-review fix wave, item 1: the withdrawn 3-box variants (BTCCM3 /
 * BTCCA3 / BTCCE3, migration 0028) must never be offered to a customer.
 * `computeCatalogLineCents` already refuses them server-side via
 * `isSellableVariant` — this covers the client side, which had no filter at
 * all: ProductDisplay's variant <Select> and default-variant resolution, and
 * ProductCard's default-variant price/availability.
 *
 * Follows the renderToStaticMarkup pattern from
 * product-display-subscription-gate.test.tsx.
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
const { default: ProductCard } = await import("@/components/ProductCard");

function makeProductWithWithdrawnVariant(overrides: Partial<Product> = {}): Product {
  return {
    id: "prod_1",
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
        inventory: { quantity: 12 },
      },
      {
        id: "var_3box",
        status: "discontinued",
        option_values: [{ option_id: "size", value: "Three boxes (30 tea bags)" }],
        price: { amount: 3999, currency: "USD" },
        inventory: { quantity: 5 },
      },
    ],
    ...overrides,
  } as unknown as Product;
}

function makeProductAllVariantsWithdrawn(): Product {
  return {
    id: "prod_2",
    name: "Clearly Calendula Afternoon",
    description: "A calming organic tea blend.",
    slug: "clearly-calendula-afternoon",
    default_variant_id: "var_3box_only",
    variants: [
      {
        id: "var_3box_only",
        status: "discontinued",
        option_values: [{ option_id: "size", value: "Three boxes (30 tea bags)" }],
        price: { amount: 3999, currency: "USD" },
        inventory: { quantity: 5 },
      },
    ],
  } as unknown as Product;
}

describe("ProductDisplay withdrawn-variant filtering (final-review fix, item 1)", () => {
  it("does not offer a discontinued variant in the option select", () => {
    const html = renderToStaticMarkup(
      <ProductDisplay
        product={makeProductWithWithdrawnVariant()}
        reviews={[]}
        recommendations={[]}
      />
    );

    expect(html).not.toContain("Three boxes (30 tea bags)");
    // Only one sellable variant remains, so the <Select> (gated on
    // variants.length > 1) must not render at all.
    expect(html).not.toContain("Choose an option");
  });

  it("prices from the remaining sellable variant when default_variant_id points at a withdrawn variant", () => {
    const html = renderToStaticMarkup(
      <ProductDisplay
        product={makeProductWithWithdrawnVariant({ default_variant_id: "var_3box" })}
        reviews={[]}
        recommendations={[]}
      />
    );

    expect(html).toContain("$14.99");
    expect(html).not.toContain("$39.99");
    expect(html).toContain("Add to Cart");
  });

  it("degrades to Sold out, without crashing, when every variant is withdrawn", () => {
    const html = renderToStaticMarkup(
      <ProductDisplay
        product={makeProductAllVariantsWithdrawn()}
        reviews={[]}
        recommendations={[]}
      />
    );

    expect(html).toContain("Sold out");
    expect(html).not.toContain("Add to Cart");
  });
});

describe("ProductCard withdrawn-variant filtering (final-review fix, item 1)", () => {
  it("prices from the remaining sellable variant when default_variant_id points at a withdrawn variant", () => {
    const html = renderToStaticMarkup(
      <ProductCard product={makeProductWithWithdrawnVariant({ default_variant_id: "var_3box" })} />
    );

    expect(html).toContain("$14.99");
    expect(html).not.toContain("$39.99");
    expect(html).toContain("In Stock");
  });

  it("degrades to Sold out, without crashing, when every variant is withdrawn", () => {
    const html = renderToStaticMarkup(<ProductCard product={makeProductAllVariantsWithdrawn()} />);

    expect(html).toContain("Sold out");
  });
});
