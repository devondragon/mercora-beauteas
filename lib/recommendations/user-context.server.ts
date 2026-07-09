// lib/recommendations/user-context.server.ts
// Server-side equivalent of the fields useEnhancedUserContext derives client-side,
// scoped to what the recommendation scorer/blend actually reads.

import type { Order } from "@/lib/types";
import type { RecsUserContext } from "@/lib/recommendations/types";
import { getOrdersByUserId } from "@/lib/models/mach/orders";

export async function buildServerUserContext(
  userId: string | null | undefined
): Promise<RecsUserContext | null> {
  if (!userId) return null;

  let orders: Order[] = [];
  try {
    orders = await getOrdersByUserId(userId);
  } catch (err) {
    console.error("buildServerUserContext: failed to load orders", err);
    return null;
  }
  if (!orders.length) {
    return { orders: [], isVipCustomer: false, preferredPriceRange: null, recentPurchases: [] };
  }

  const totalOrderValue = orders.reduce((sum, o) => sum + (o.total_amount?.amount || 0), 0);

  const threeMonthsAgo = new Date();
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
  const recentPurchases = orders
    .filter((o) => o.created_at && new Date(o.created_at) >= threeMonthsAgo)
    .flatMap((o) => (o.items || []).map((item) => String(item.product_id || item.id)))
    .slice(0, 10);

  const orderValues = orders.map((o) => o.total_amount?.amount || 0).filter((v) => v > 0);
  const preferredPriceRange =
    orderValues.length > 0 ? { min: Math.min(...orderValues), max: Math.max(...orderValues) } : null;

  return {
    orders,
    isVipCustomer: totalOrderValue > 1000, // matches useEnhancedUserContext ($1000+ minor-unit sum)
    preferredPriceRange,
    recentPurchases,
  };
}
