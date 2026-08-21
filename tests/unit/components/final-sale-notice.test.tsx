/**
 * `sale.final_sale` used to gate Chai's refund answer only — the checkout
 * notice rendered unconditionally, so the setting did not do what it claimed.
 * Now FinalSaleNotice self-gates on the flag.
 *
 * The component is tested directly rather than through CheckoutClient: the
 * notice only renders on the payment step, which needs Stripe and a live
 * payment intent to reach. That CheckoutClient passes the prop at all is held
 * by the type checker (the prop is required), not by this test.
 */
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { default: FinalSaleNotice } = await import("@/components/checkout/FinalSaleNotice");

describe("FinalSaleNotice", () => {
  it("renders the disclosure when final sale is on", () => {
    const html = renderToStaticMarkup(<FinalSaleNotice finalSale={true} />);
    expect(html).toContain("every order is final");
    expect(html).toContain("No returns");
    expect(html).toContain('href="/thank-you"');
  });

  it("renders nothing when final sale is explicitly off", () => {
    expect(renderToStaticMarkup(<FinalSaleNotice finalSale={false} />)).toBe("");
  });

  it("keeps its own bottom margin so the call site needs no wrapper", () => {
    // The mb-4 moved in from CheckoutClient when the wrapper <div> was removed;
    // leaving it behind would have rendered an empty spacer div when gated off.
    expect(renderToStaticMarkup(<FinalSaleNotice finalSale={true} />)).toContain("mb-4");
  });
});
