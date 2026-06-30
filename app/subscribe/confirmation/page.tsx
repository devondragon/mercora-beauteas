/**
 * /subscribe/confirmation - Subscription Confirmation Page (Server Component)
 *
 * Displayed after successful subscription creation. Shows product info,
 * frequency, next billing date, discount, and links to manage subscriptions
 * or continue shopping.
 *
 * Requires Clerk authentication.
 */

import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { CheckCircle2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  getSubscriptionPlanById,
  getSubscriptionsByCustomer,
} from "@/lib/models/mach/subscriptions";
import { getProduct } from "@/lib/models/mach/products";
import {
  resolveLocalizedField,
  resolveImageUrl,
} from "@/lib/seo/metadata";
import type { SubscriptionFrequency } from "@/lib/types/subscription";

const FREQUENCY_LABELS: Record<SubscriptionFrequency, string> = {
  biweekly: "Every 2 weeks",
  monthly: "Monthly",
  bimonthly: "Every 2 months",
};

export default async function SubscribeConfirmationPage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string }>;
}) {
  const { userId } = await auth();
  if (!userId) {
    redirect("/sign-in");
  }

  const params = await searchParams;
  const planId = params.plan;

  // If no plan ID, show generic success
  if (!planId) {
    return <GenericSuccess />;
  }

  // Fetch plan
  const plan = await getSubscriptionPlanById(planId);
  if (!plan) {
    return <GenericSuccess />;
  }

  // Fetch product
  const product = await getProduct(plan.product_id);
  if (!product) {
    return <GenericSuccess />;
  }

  // Get the customer's most recent subscription matching this plan
  const subscriptions = await getSubscriptionsByCustomer(userId);
  const matchingSub = subscriptions.find((s) => s.plan_id === planId);

  // Format next billing date
  let nextBillingDate = "Processing...";
  if (matchingSub?.current_period_end) {
    try {
      nextBillingDate = new Date(matchingSub.current_period_end).toLocaleDateString(
        "en-US",
        { year: "numeric", month: "long", day: "numeric" }
      );
    } catch {
      nextBillingDate = "Processing...";
    }
  }

  // Calculate subscription price
  const defaultVariant = product.default_variant_id
    ? product.variants?.find((v) => v.id === product.default_variant_id)
    : product.variants?.[0];

  const variantPriceInCents = defaultVariant?.price?.amount ?? 0;
  const subscriptionPriceInCents = Math.round(
    variantPriceInCents * (1 - plan.discount_percent / 100)
  );

  const productName = resolveLocalizedField(product.name, "Product");
  const imageUrl = resolveImageUrl(product.primary_image);

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-lg">
        {/* Success Icon */}
        <div className="mb-6 text-center">
          <CheckCircle2 className="mx-auto h-16 w-16 text-state-success" />
          <h1 className="mt-4 text-2xl font-bold text-text-primary">Subscription Created!</h1>
          <p className="mt-2 text-text-secondary">
            Your subscription is now active. Here are the details.
          </p>
        </div>

        {/* Subscription Details Card */}
        <div className="rounded-lg border border-border-default bg-white p-6">
          <div className="flex gap-4">
            {imageUrl && (
              <div className="relative h-16 w-16 flex-shrink-0 overflow-hidden rounded-md">
                <Image
                  src={imageUrl}
                  alt={productName}
                  fill
                  className="object-cover"
                />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-lg font-semibold text-text-primary">{productName}</p>
              <p className="mt-1 text-sm text-text-secondary">Subscription</p>
            </div>
          </div>

          <div className="mt-6 space-y-3 border-t border-border-default pt-4">
            <div className="flex items-center justify-between">
              <span className="text-text-secondary">Frequency</span>
              <span className="font-medium text-text-primary">
                {FREQUENCY_LABELS[plan.frequency] ?? plan.frequency}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-text-secondary">Next billing date</span>
              <span className="font-medium text-text-primary">{nextBillingDate}</span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-text-secondary">Subscription price</span>
              <span className="font-medium text-text-primary">
                ${(subscriptionPriceInCents / 100).toFixed(2)}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-text-secondary">Discount</span>
              <Badge className="border-transparent bg-state-success-bg text-state-success">
                Save {plan.discount_percent}%
              </Badge>
            </div>
          </div>
        </div>

        {/* Action Links */}
        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <Link
            href="/account/subscriptions"
            className="flex-1 rounded-lg bg-primary-500 px-6 py-3 text-center font-semibold text-text-inverse transition hover:bg-primary-600"
          >
            Manage Subscriptions
          </Link>
          <Link
            href="/"
            className="flex-1 rounded-lg border border-border-default px-6 py-3 text-center font-semibold text-text-primary transition hover:border-border-dark hover:bg-surface-light"
          >
            Continue Shopping
          </Link>
        </div>
      </div>
    </main>
  );
}

/** Generic success fallback when plan/product data unavailable */
function GenericSuccess() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-lg text-center">
        <CheckCircle2 className="mx-auto h-16 w-16 text-state-success" />
        <h1 className="mt-4 text-2xl font-bold text-text-primary">Subscription Created!</h1>
        <p className="mt-2 text-text-secondary">
          Your subscription has been set up successfully.
        </p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Link
            href="/account/subscriptions"
            className="rounded-lg bg-primary-500 px-6 py-3 font-semibold text-text-inverse transition hover:bg-primary-600"
          >
            Manage Subscriptions
          </Link>
          <Link
            href="/"
            className="rounded-lg border border-border-default px-6 py-3 font-semibold text-text-primary transition hover:border-border-dark hover:bg-surface-light"
          >
            Continue Shopping
          </Link>
        </div>
      </div>
    </main>
  );
}
