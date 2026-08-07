/**
 * /subscribe/checkout - Subscription Checkout Page (Server Component)
 *
 * Requires Clerk authentication. Reads product and plan from search params,
 * fetches plan/product data, calculates discounted price, and renders
 * the SubscribeCheckoutClient with all necessary props.
 */

import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { getSubscriptionPlanById } from "@/lib/models/mach/subscriptions";
import { getSaleRules } from "@/lib/sale/settings";
import { getProduct, getProductBySlug } from "@/lib/models/mach/products";
import SubscribeCheckoutClient from "./SubscribeCheckoutClient";

export default async function SubscribeCheckoutPage({
  searchParams,
}: {
  searchParams: Promise<{ product?: string; plan?: string }>;
}) {
  // Require authentication
  const { userId } = await auth();
  if (!userId) {
    redirect("/sign-in");
  }

  const params = await searchParams;
  const productSlug = params.product;
  const planId = params.plan;

  // Validate required params
  if (!productSlug || !planId) {
    redirect("/");
  }

  // Fetch subscription plan. The sale flag is read alongside it because this
  // page is bookmarkable: without it, a saved link renders a full subscribe
  // form during the closing sale. This redirect is UX only — the real boundary
  // is the 403 in /api/setup-intent and /api/subscriptions, which this form
  // posts to. `plan.is_active` is checked here too; it was missing, so an
  // inactive plan also rendered a working-looking checkout.
  const [{ subscriptionsEnabled }, plan] = await Promise.all([
    getSaleRules(),
    getSubscriptionPlanById(planId),
  ]);
  if (!subscriptionsEnabled || !plan || !plan.is_active) {
    redirect("/");
  }

  // Fetch product (by slug first, fall back to plan's product_id)
  let product = await getProductBySlug(productSlug);
  if (!product) {
    product = await getProduct(plan.product_id);
  }
  if (!product) {
    redirect("/");
  }

  // Calculate subscription price from the default variant
  const defaultVariant = product.default_variant_id
    ? product.variants?.find((v) => v.id === product!.default_variant_id)
    : product.variants?.[0];

  const variantPriceInCents = defaultVariant?.price?.amount ?? 0;
  const subscriptionPriceInCents = Math.round(
    variantPriceInCents * (1 - plan.discount_percent / 100)
  );

  return (
    <div className="min-h-screen px-4 py-12 sm:px-6 lg:px-12">
      <div className="mx-auto max-w-3xl">
        <SubscribeCheckoutClient
          product={product}
          plan={plan}
          subscriptionPriceInCents={subscriptionPriceInCents}
        />
      </div>
    </div>
  );
}
