import { auth } from "@clerk/nextjs/server";
import { getOrdersByUserId } from "@/lib/models/";
import OrderCard from "@/components/OrderCard";

export const metadata = {
  title: "Order History - BeauTeas",
};

export default async function OrdersPage() {
  const { userId } = await auth();
  // Layout already gates auth, but userId needed for query
  const orders = userId ? await getOrdersByUserId(userId) : [];

  return (
    <div>
      <h1 className="text-2xl sm:text-3xl font-bold mb-6">Order History</h1>
      {orders.length === 0 ? (
        <p className="text-gray-400">You haven&rsquo;t placed any orders yet.</p>
      ) : (
        <div className="space-y-4 sm:space-y-6">
          {orders.map((order) => (
            <OrderCard key={order.id} order={order} />
          ))}
        </div>
      )}
    </div>
  );
}
