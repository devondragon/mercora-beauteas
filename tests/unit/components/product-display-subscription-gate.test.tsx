/**
 * Task 9 regression: ProductDisplay's purchase area must gate on BOTH
 * `subscriptionsEnabled` and a non-empty `subscriptionPlans` array before
 * rendering <SubscriptionToggle/> (app/product/[slug]/ProductDisplay.tsx):
 *
 *   subscriptionsEnabled && subscriptionPlans.length > 0
 *     ? <SubscriptionToggle/>
 *     : <price + Add to Cart>
 *
 * That branch had no test even though it guards the one thing that must not
 * break during a clearance sale: the Add to Cart button. This asserts that
 * with subscriptions turned off store-wide (subscriptionsEnabled={false})
 * but a product that still has subscription plans configured (non-empty
 * subscriptionPlans), the plain price + Add to Cart path renders and no
 * subscribe copy leaks through.
 */
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { Product } from "@/lib/types";
import type { SubscriptionPlan } from "@/lib/types/subscription";

// next/link and next/image need the Next runtime + the project's custom image
// loader; neither is relevant to the markup shape under test. next/navigation's
// useRouter is only invoked inside SubscriptionToggle, which this scenario
// never mounts, but ProductDisplay imports SubscriptionToggle unconditionally
// so the module must still resolve.
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

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: "prod_1",
    name: "Clearly Calendula Morning",
    description: "An energizing organic black tea blend.",
    slug: "clearly-calendula-morning",
    default_variant_id: "var_1",
    // Single variant so ProductDisplay's own variant <Select> doesn't render
    // (that Select is gated on variants.length > 1) and stays out of the way
    // of the assertion under test.
    variants: [
      {
        id: "var_1",
        price: { amount: 1499, currency: "USD" },
        inventory: { quantity: 12 },
      },
    ],
    ...overrides,
  } as unknown as Product;
}

function makePlans(): SubscriptionPlan[] {
  return [
    {
      id: "plan_1",
      product_id: "prod_1",
      frequency: "monthly",
      discount_percent: 10,
      stripe_price_id: null,
      is_active: true,
      created_at: null,
      updated_at: null,
    },
  ];
}

describe("ProductDisplay subscription gate (Task 9)", () => {
  it("renders Add to Cart and no subscribe copy when subscriptions are disabled, even with plans configured", () => {
    const html = renderToStaticMarkup(
      <ProductDisplay
        product={makeProduct()}
        reviews={[]}
        subscriptionPlans={makePlans()}
        subscriptionsEnabled={false}
        recommendations={[]}
      />
    );

    expect(html).toContain("Add to Cart");
    expect(html).not.toContain("Subscribe & Save");
    expect(html).not.toContain("Subscribe Now");
    expect(html).not.toContain("One-time purchase");
    expect(html).not.toContain("Delivery frequency");
  });
});
