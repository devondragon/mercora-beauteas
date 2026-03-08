import { auth } from "@clerk/nextjs/server";
import { getSubscriptionsByCustomer, getSubscriptionPlanById } from "@/lib/models/mach/subscriptions";
import { getProduct } from "@/lib/models/mach/products";
import type { SubscriptionPlan, CustomerSubscription } from "@/lib/types/subscription";
import SubscriptionsClient from "./SubscriptionsClient";

export interface EnrichedSubscription extends CustomerSubscription {
  plan: SubscriptionPlan | null;
  product: {
    name: string;
    slug: string;
    image: any;
  } | null;
}

export const metadata = {
  title: "My Subscriptions - BeauTeas",
};

export default async function SubscriptionsPage() {
  const { userId } = await auth();
  const subscriptions = userId ? await getSubscriptionsByCustomer(userId) : [];

  const enrichedSubscriptions: EnrichedSubscription[] = await Promise.all(
    subscriptions.map(async (sub) => {
      const plan = await getSubscriptionPlanById(sub.plan_id);
      const product = plan ? await getProduct(plan.product_id) : null;
      return {
        ...sub,
        plan: plan || null,
        product: product
          ? {
              name: typeof product.name === "string" ? product.name : "",
              slug: typeof product.slug === "string" ? product.slug : "",
              image: product.primary_image,
            }
          : null,
      };
    })
  );

  return (
    <div>
      <h1 className="text-2xl sm:text-3xl font-bold mb-8">My Subscriptions</h1>
      <SubscriptionsClient subscriptions={enrichedSubscriptions} />
    </div>
  );
}
