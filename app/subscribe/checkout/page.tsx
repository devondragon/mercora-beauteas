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

  // Fetch subscription plan
  const plan = await getSubscriptionPlanById(planId);
  if (!plan) {
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
    <main className="min-h-screen bg-neutral-900 px-4 py-12 text-white sm:px-6 lg:px-12">
      <div className="mx-auto max-w-3xl">
        <SubscribeCheckoutClient
          product={product}
          plan={plan}
          subscriptionPriceInCents={subscriptionPriceInCents}
        />
      </div>
    </main>
  );
}
