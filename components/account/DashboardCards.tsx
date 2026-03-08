import Link from "next/link";
import { Package, Repeat, MapPin, ArrowRight } from "lucide-react";
import type { Order } from "@/lib/types/order";
import type { MACHCustomerAddress } from "@/lib/types/mach/Customer";
import { formatDate, formatAddressInline } from "@/lib/utils/account";

interface DashboardCardsProps {
  recentOrders: Order[];
  activeSubscriptionCount: number;
  nextBillingDate: string | null;
  defaultAddress: MACHCustomerAddress | null;
}

const statusColor: Record<string, string> = {
  pending: "text-yellow-400",
  processing: "text-blue-400",
  shipped: "text-indigo-400",
  delivered: "text-green-400",
  cancelled: "text-red-400",
  refunded: "text-purple-400",
};

export default function DashboardCards({
  recentOrders,
  activeSubscriptionCount,
  nextBillingDate,
  defaultAddress,
}: DashboardCardsProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {/* Recent Orders */}
      <div className="bg-neutral-800 border border-neutral-700 rounded-lg p-5">
        <div className="flex items-center gap-2 mb-4">
          <Package className="h-5 w-5 text-orange-400" />
          <h2 className="font-semibold">Recent Orders</h2>
        </div>
        {recentOrders.length === 0 ? (
          <p className="text-sm text-gray-400">No orders yet</p>
        ) : (
          <div className="space-y-2 mb-3">
            {recentOrders.map((order) => (
              <div key={order.id} className="flex justify-between text-sm">
                <span className="text-gray-300 truncate mr-2">
                  {formatDate(order.created_at)}
                </span>
                <span className={`capitalize ${statusColor[order.status] || "text-gray-400"}`}>
                  {order.status}
                </span>
              </div>
            ))}
          </div>
        )}
        <Link
          href="/account/orders"
          className="inline-flex items-center gap-1 text-sm text-orange-400 hover:text-orange-300 transition-colors"
        >
          View all orders <ArrowRight className="h-3 w-3" />
        </Link>
      </div>

      {/* Subscriptions */}
      <div className="bg-neutral-800 border border-neutral-700 rounded-lg p-5">
        <div className="flex items-center gap-2 mb-4">
          <Repeat className="h-5 w-5 text-orange-400" />
          <h2 className="font-semibold">Subscriptions</h2>
        </div>
        <p className="text-2xl font-bold mb-1">{activeSubscriptionCount}</p>
        <p className="text-sm text-gray-400 mb-1">
          active subscription{activeSubscriptionCount !== 1 ? "s" : ""}
        </p>
        {nextBillingDate && (
          <p className="text-xs text-gray-500">
            Next billing: {formatDate(nextBillingDate)}
          </p>
        )}
        <Link
          href="/account/subscriptions"
          className="inline-flex items-center gap-1 text-sm text-orange-400 hover:text-orange-300 transition-colors mt-3"
        >
          Manage subscriptions <ArrowRight className="h-3 w-3" />
        </Link>
      </div>

      {/* Default Address */}
      <div className="bg-neutral-800 border border-neutral-700 rounded-lg p-5">
        <div className="flex items-center gap-2 mb-4">
          <MapPin className="h-5 w-5 text-orange-400" />
          <h2 className="font-semibold">Default Address</h2>
        </div>
        <p className="text-sm text-gray-300 mb-3">
          {formatAddressInline(defaultAddress)}
        </p>
        <Link
          href="/account/addresses"
          className="inline-flex items-center gap-1 text-sm text-orange-400 hover:text-orange-300 transition-colors"
        >
          Manage addresses <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
    </div>
  );
}
