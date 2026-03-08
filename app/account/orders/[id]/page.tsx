import { auth } from "@clerk/nextjs/server";
import { notFound } from "next/navigation";
import { getOrderById } from "@/lib/models/mach/orders";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { OrderItem } from "@/lib/types/order";
import { formatDate, formatAddress, formatMoney } from "@/lib/utils/account";

export const metadata = {
  title: "Order Details - BeauTeas",
};

const statusSteps = ["pending", "processing", "shipped", "delivered"];

function StatusTimeline({ status }: { status: string }) {
  const currentIndex = statusSteps.indexOf(status);
  const isCanceled = status === "cancelled" || status === "refunded";
  const isUnknown = !isCanceled && currentIndex === -1;

  if (isUnknown) {
    return (
      <div className="flex items-center gap-2">
        <div className="w-3 h-3 rounded-full bg-yellow-500" />
        <span className="text-sm text-yellow-400 capitalize">{status.replace(/_/g, " ")}</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {statusSteps.map((step, i) => (
        <div key={step} className="flex items-center gap-2">
          <div
            className={`w-3 h-3 rounded-full ${
              isCanceled
                ? "bg-red-500"
                : i <= currentIndex
                  ? "bg-orange-500"
                  : "bg-neutral-600"
            }`}
          />
          <span
            className={`text-xs capitalize ${
              i <= currentIndex ? "text-white" : "text-neutral-500"
            }`}
          >
            {step}
          </span>
          {i < statusSteps.length - 1 && (
            <div
              className={`w-8 h-0.5 ${
                i < currentIndex ? "bg-orange-500" : "bg-neutral-600"
              }`}
            />
          )}
        </div>
      ))}
    </div>
  );
}

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { userId } = await auth();
  if (!userId) notFound(); // defence-in-depth: layout redirects, but guard here too
  const { id } = await params;
  const order = await getOrderById(id);

  // Verify order exists and belongs to current user
  if (!order || order.customer_id !== userId) {
    notFound();
  }

  const items = Array.isArray(order.items) ? order.items : [];

  return (
    <div>
      <Link
        href="/account/orders"
        className="inline-flex items-center gap-2 text-sm text-gray-400 hover:text-white mb-6 transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to orders
      </Link>

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-6 gap-2">
        <h1 className="text-2xl font-bold">Order {order.id}</h1>
        <span className="text-sm text-gray-400">
          Placed {formatDate(order.created_at, true)}
        </span>
      </div>

      {/* Status timeline */}
      <div className="bg-neutral-800 border border-neutral-700 rounded-lg p-5 mb-6">
        <h2 className="text-sm font-medium text-gray-400 mb-3">Status</h2>
        <StatusTimeline status={order.status} />
      </div>

      {/* Order items */}
      <div className="bg-neutral-800 border border-neutral-700 rounded-lg p-5 mb-6">
        <h2 className="text-sm font-medium text-gray-400 mb-4">Items</h2>
        <div className="space-y-3">
          {items.map((item: OrderItem, i: number) => (
            <div
              key={item.id || i}
              className="flex justify-between items-center py-2 border-b border-neutral-700 last:border-0"
            >
              <div>
                <p className="text-white font-medium">{item.product_name}</p>
                <p className="text-xs text-gray-400">
                  {item.sku && `SKU: ${item.sku} · `}Qty: {item.quantity}
                </p>
              </div>
              <p className="text-white">
                {formatMoney(item.unit_price || item.total_price)}
              </p>
            </div>
          ))}
        </div>
        <div className="mt-4 pt-3 border-t border-neutral-700 flex justify-between font-semibold">
          <span>Total</span>
          <span className="text-green-400">{formatMoney(order.total_amount)}</span>
        </div>
      </div>

      {/* Shipping & Billing */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="bg-neutral-800 border border-neutral-700 rounded-lg p-5">
          <h2 className="text-sm font-medium text-gray-400 mb-2">
            Shipping Address
          </h2>
          <p className="text-white text-sm whitespace-pre-line">
            {formatAddress(order.shipping_address)}
          </p>
        </div>
        <div className="bg-neutral-800 border border-neutral-700 rounded-lg p-5">
          <h2 className="text-sm font-medium text-gray-400 mb-2">
            Payment
          </h2>
          <p className="text-white text-sm">
            {order.payment_method || "Card"} · {order.payment_status}
          </p>
        </div>
      </div>
    </div>
  );
}
