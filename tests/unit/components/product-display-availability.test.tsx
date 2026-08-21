/**
 * PDP availability: a variant at quantity 0 is NOT out of stock when its
 * inventory is untracked (`track_inventory === false`) or backorder is allowed
 * (`allow_backorder === true`). Those flags mean "unlimited", the same reading
 * `isVariantAvailable` (lib/db/schema/products.ts) and the recommendations
 * blend pool (lib/recommendations/blend.ts) already give them. The PDP's
 * `available` computation used `quantityInStock > 0` alone, so it disagreed
 * with the rest of the platform and hid the Add to Cart CTA (rendering the
 * "Coming soon" fallback) for variants that are actually purchasable.
 *
 * No @testing-library/react in this repo, so render to static markup and assert
 * on the HTML string (same pattern as the other ProductDisplay tests).
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

function makeProduct(overrides: {
  quantity: number;
  track_inventory?: boolean;
  allow_backorder?: boolean;
}): Product {
  return {
    id: "prod_avail",
    name: "Test Blend",
    description: "A test blend.",
    slug: "test-blend",
    default_variant_id: "var_1",
    variants: [
      {
        id: "var_1",
        status: "active",
        option_values: [{ option_id: "size", value: "Standard" }],
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

function render(product: Product): string {
  return renderToStaticMarkup(
    <ProductDisplay product={product} reviews={[]} recommendations={[]} />
  );
}

describe("ProductDisplay availability", () => {
  it("offers Add to Cart when the variant has stock", () => {
    const html = render(makeProduct({ quantity: 5 }));
    expect(html).toContain("Add to Cart");
    expect(html).not.toContain("Coming soon");
  });

  it("hides Add to Cart for a plain tracked variant at quantity 0", () => {
    const html = render(makeProduct({ quantity: 0 }));
    expect(html).not.toContain("Add to Cart");
    expect(html).toContain("Coming soon");
  });

  it("treats an untracked variant at quantity 0 as purchasable", () => {
    const html = render(makeProduct({ quantity: 0, track_inventory: false }));
    expect(html).toContain("Add to Cart");
    expect(html).not.toContain("Coming soon");
  });

  it("treats a backorder-allowed variant at quantity 0 as purchasable", () => {
    const html = render(makeProduct({ quantity: 0, allow_backorder: true }));
    expect(html).toContain("Add to Cart");
    expect(html).not.toContain("Coming soon");
  });
});
