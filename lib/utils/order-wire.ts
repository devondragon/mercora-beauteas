import { toWireMoney } from '@/lib/money';
import type { MachMoney } from '@/lib/money';
import type { Order, OrderItem } from '@/lib/types/order';

/**
 * MACH wire-shaped order line item / order (BMC-164 review follow-up).
 * Structurally distinct from `OrderItem`/`Order` — money fields are
 * `MachMoney` (decimal major units + required precision), not the internal
 * cents-shaped `Money`. This lets `tsc` catch a wire value being fed back
 * into a cents-typed sink (e.g. priceToCents() in lib/services/order-pricing.ts),
 * which reusing `Order` as the return type could not.
 */
export type WireOrderItem = Omit<OrderItem, 'unit_price' | 'total_price'> & {
  unit_price: MachMoney;
  total_price: MachMoney;
};

export type WireOrder = Omit<Order, 'total_amount' | 'items'> & {
  total_amount: MachMoney;
  items: WireOrderItem[];
};

/**
 * Convert a hydrated (internal, minor-unit/cents) Order to the MACH wire
 * shape for API responses (BMC-164): total_amount and each line's
 * unit_price/total_price become {amount, currency, precision} in major
 * units via toWireMoney. Internal callers (gift-card fulfillment, email)
 * keep reading the cents-based hydrateOrder() output untouched — this
 * conversion is applied last, immediately before NextResponse.json().
 *
 * Shared by GET/POST/PUT /api/orders and GET /api/orders/[id] so every
 * order endpoint emits an identical wire shape from a single definition
 * (BMC-179 review: the detail route previously emitted raw minor units,
 * a 100x mismatch vs. the list route).
 */
export function toWireOrder(order: Order): WireOrder {
  return {
    ...order,
    total_amount: toWireMoney(order.total_amount),
    items: order.items?.map(item => ({
      ...item,
      unit_price: toWireMoney(item.unit_price),
      total_price: toWireMoney(item.total_price),
    })),
  };
}
