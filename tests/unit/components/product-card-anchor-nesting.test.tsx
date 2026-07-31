/**
 * BMC-220 regression: ProductCard must render exactly ONE anchor.
 *
 * The card body used to be wrapped in a <Link> to /product/{slug} while also
 * rendering a second <Link> to the SAME href for the "Learn more →" affordance.
 * An <a> inside an <a> is invalid, and the HTML parser's adoption-agency
 * algorithm implicitly closes the outer anchor, so the DOM the browser builds
 * does not match the tree React serialized. React threw minified error #418
 * ("server rendered HTML didn't match the client") on every page rendering a
 * card, discarded the SSR markup and re-rendered on the client.
 *
 * This asserts the server-rendered markup, because the bug lived in the HTML
 * React emits — a jsdom tree would already be normalized by the parser and
 * would hide the nesting.
 */
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { Product } from "@/lib/types";

// next/link and next/image need the Next runtime + the project's custom image
// loader; neither is relevant to the markup shape under test.
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
        price: { amount: 1499, currency: "USD" },
        compare_at_price: { amount: 2000, currency: "USD" },
        inventory: { quantity: 12 },
      },
    ],
    ...overrides,
  } as unknown as Product;
}

const anchorsIn = (html: string) => html.match(/<a\b[^>]*>/g) ?? [];

describe("ProductCard anchor nesting (BMC-220)", () => {
  it("renders exactly one anchor, so no <a> can nest inside another", () => {
    const html = renderToStaticMarkup(<ProductCard product={makeProduct()} />);

    expect(anchorsIn(html)).toHaveLength(1);
  });

  it("still exposes the Learn more affordance inside that single anchor", () => {
    const html = renderToStaticMarkup(<ProductCard product={makeProduct()} />);

    expect(html).toContain("Learn more");
    // The affordance must not be its own anchor — that is the exact regression.
    expect(html).not.toMatch(/<a\b[^>]*>[^<]*Learn more/);
  });

  it("keeps a single anchor when the card also renders a rating and date", () => {
    const html = renderToStaticMarkup(
      <ProductCard
        product={makeProduct({
          rating: { average: 4.5, count: 8, last_published_at: "2026-01-15T00:00:00Z" },
        } as Partial<Product>)}
      />,
    );

    expect(anchorsIn(html)).toHaveLength(1);
  });
});
