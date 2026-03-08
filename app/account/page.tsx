import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { getOrdersByUserId } from "@/lib/models/";
import { getSubscriptionsByCustomer } from "@/lib/models/mach/subscriptions";
import { getCustomer, getCustomerDisplayName } from "@/lib/models/mach/customer";
import DashboardCards from "@/components/account/DashboardCards";

export const metadata = {
  title: "My Account - BeauTeas",
};

export default async function AccountDashboard() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const [orders, subscriptions, customer] = await Promise.all([
    getOrdersByUserId(userId),
    getSubscriptionsByCustomer(userId),
    getCustomer(userId),
  ]).catch((error) => {
    console.error("Failed to load account dashboard data:", error);
    throw error; // propagates to Next.js error boundary
  });

  const displayName = customer ? getCustomerDisplayName(customer) : "there";
  const recentOrders = orders.slice(0, 3);
  const activeSubscriptions = subscriptions.filter((s) => s.status === "active");
  const defaultAddress = customer?.addresses?.find((a) => a.is_default) || customer?.addresses?.[0] || null;

  return (
    <div>
      <h1 className="text-2xl sm:text-3xl font-bold mb-2">
        Welcome back, {displayName}
      </h1>
      <p className="text-gray-400 mb-8">Here&rsquo;s an overview of your account.</p>
      <DashboardCards
        recentOrders={recentOrders}
        activeSubscriptionCount={activeSubscriptions.length}
        nextBillingDate={activeSubscriptions[0]?.current_period_end || null}
        defaultAddress={defaultAddress}
      />
    </div>
  );
}
