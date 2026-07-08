import type { ShippingOption } from "@/lib/types/shipping";
import type { CartItem } from "@/lib/types/cartitem";
import OrderItemCard from "./OrderItemCard";
import DiscountCodeInput from "./DiscountCodeInput";
import GiftCardInput from "./GiftCardInput";
import { useCartStore } from "@/lib/stores/cart-store";
import { stateStyles } from "@/lib/ui/state-styles";
import { Money } from "@/lib/money";

interface Props {
  items: CartItem[];
  shippingOption?: ShippingOption;
  /** integer minor units (e.g. cents) */
  taxAmount: number;
  showDiscountInput?: boolean;
}

export default function OrderSummary({
  items,
  shippingOption,
  taxAmount,
  showDiscountInput = false,
}: Props) {
  const { appliedDiscounts, appliedGiftCard } = useCartStore();

  // Calculate totals from cart store if discounts are applied, otherwise use simple calculation
  const subtotal = items.reduce((acc, item) => acc + item.price * item.quantity, 0);
  const shippingCost = shippingOption?.cost || 0;

  // Calculate discounts
  const cartDiscounts = appliedDiscounts.filter(d => d.type === 'cart');
  const shippingDiscounts = appliedDiscounts.filter(d => d.type === 'shipping');

  const cartDiscountAmount = cartDiscounts.reduce((sum, d) => sum + d.amount, 0);
  const shippingDiscountAmount = shippingDiscounts.reduce((sum, d) => sum + d.amount, 0);

  const discountedSubtotal = Math.max(0, subtotal - cartDiscountAmount);
  const discountedShipping = Math.max(0, shippingCost - shippingDiscountAmount);
  const totalBeforeGiftCard = discountedSubtotal + discountedShipping + taxAmount;

  // Gift card applied as a payment tender against the order total
  const giftCardApplied = appliedGiftCard
    ? Math.min(appliedGiftCard.balance, totalBeforeGiftCard)
    : 0;
  const total = Math.max(0, totalBeforeGiftCard - giftCardApplied);

  return (
    <div className="bg-white text-text-primary p-6 rounded-xl">
      <h2 className="text-lg font-semibold mb-4">Order Summary</h2>

      <div className="space-y-1">
        {items.map((item, idx) => (
          <OrderItemCard key={idx} item={item} />
        ))}
      </div>

      {showDiscountInput && (
        <>
          <hr className="my-4" />
          <DiscountCodeInput />
          <hr className="my-4" />
          <GiftCardInput />
        </>
      )}

      <hr className="my-2" />

      <div className="flex justify-between text-sm">
        <span>Subtotal</span>
        <span>{Money.fromMinor(subtotal, "USD").format()}</span>
      </div>

      {/* Cart Discounts */}
      {cartDiscounts.map((discount) => (
        <div key={discount.promotionId} className={`flex justify-between text-sm ${stateStyles.savings}`}>
          <span>{discount.displayName}</span>
          <span>-{Money.fromMinor(discount.amount, "USD").format()}</span>
        </div>
      ))}

      <div className="flex justify-between text-sm">
        <span>Shipping</span>
        <span>{Money.fromMinor(shippingCost, "USD").format()}</span>
      </div>

      {/* Shipping Discounts */}
      {shippingDiscounts.map((discount) => (
        <div key={discount.promotionId} className={`flex justify-between text-sm ${stateStyles.savings}`}>
          <span>{discount.displayName}</span>
          <span>-{Money.fromMinor(discount.amount, "USD").format()}</span>
        </div>
      ))}

      <div className="flex justify-between text-sm">
        <span>Tax</span>
        <span>{Money.fromMinor(taxAmount, "USD").format()}</span>
      </div>

      {/* Gift card tender */}
      {giftCardApplied > 0 && appliedGiftCard && (
        <div className="flex justify-between text-sm text-secondary-600">
          <span>Gift Card ({appliedGiftCard.code})</span>
          <span>-{Money.fromMinor(giftCardApplied, "USD").format()}</span>
        </div>
      )}

      <hr className="my-2" />

      <div className="flex justify-between font-semibold">
        <span>{giftCardApplied > 0 ? "Total Due" : "Total"}</span>
        <span>{Money.fromMinor(total, "USD").format()}</span>
      </div>
    </div>
  );
}
