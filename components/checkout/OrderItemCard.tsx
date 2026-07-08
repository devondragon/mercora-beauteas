import Image from "next/image";
import type { CartItem } from "@/lib/types/cartitem";
import { Money } from "@/lib/money";

interface OrderItemCardProps {
  item: CartItem;
}

export default function OrderItemCard({ item }: OrderItemCardProps) {
  return (
    <div className="flex items-center gap-3 border rounded-lg p-1 bg-white">
      <div className="relative w-10 h-10 rounded overflow-hidden">
        {item.primaryImageUrl && (
          <Image
            src={item.primaryImageUrl}
            alt={item.name}
            sizes="40px"
            fill
            className="object-cover"
          />
        )}
      </div>

      <div className="flex-1">
        <div className="font-medium text-sm leading-tight">{item.name}</div>
        <div className="text-xs text-text-muted">
          {item.quantity} × {Money.fromMinor(item.price, "USD").format()}
        </div>
      </div>

      <div className="text-sm font-medium text-right min-w-[64px]">
        {Money.fromMinor(item.price * item.quantity, "USD").format()}
      </div>
    </div>
  );
}
