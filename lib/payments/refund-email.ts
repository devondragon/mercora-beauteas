/**
 * The customer-facing "you have been refunded" email payload.
 *
 * Extracted from `app/api/orders/refund/route.ts` for BMC-224, which gave the
 * message a SECOND sender. The route used to send it the moment Stripe ACCEPTED
 * a refund; on a delayed payment method (Klarna / Cash App Pay / Amazon Pay)
 * acceptance is not settlement, so that told customers their money was back when
 * it demonstrably was not — and a refund that later failed left the claim simply
 * untrue. The route now sends only on a refund that settled synchronously (every
 * card refund), and `refund.updated` sends when a delayed one actually settles.
 *
 * Both callers must produce an identical message, so the builder lives here
 * rather than being duplicated into the webhook handler.
 */

import type { orders } from '@/lib/db/schema/order';
import type { OrderStatusUpdateData } from '@/lib/utils/email';

/**
 * Build the status-update email payload for a refunded order.
 *
 * BMC-230 deleted the PUT handler's transformOrderForEmail() (that route no
 * longer sends email), so this is the only builder for the legacy
 * OrderStatusUpdateData shape. Always uses the 'refunded' status (money has come
 * back by the time anyone calls this), and carries the formatted refund amount
 * plus an `isFullRefund` flag: a full refund also cancels the order (→ "will not
 * be shipped" line), while a partial refund leaves the order active. `order` is
 * the post-write row; its JSON columns arrive already parsed (mode:"json"), but
 * we parse defensively in case a raw string ever slips through.
 */
export function buildRefundStatusEmail(
  order: typeof orders.$inferSelect,
  opts: { isFullRefund: boolean; refundAmount: string }
): OrderStatusUpdateData {
  const parse = (value: unknown): any =>
    typeof value === 'string' ? JSON.parse(value) : value;
  const rawItems = order.items ? parse(order.items) : [];
  const items: any[] = Array.isArray(rawItems) ? rawItems : [];
  const shippingAddr = (order.shipping_address ? parse(order.shipping_address) : {}) || {};
  const extensions = (order.extensions ? parse(order.extensions) : {}) || {};

  return {
    orderNumber: order.id ?? '',
    customerName: shippingAddr.recipient || shippingAddr.company || 'Valued Customer',
    customerEmail: extensions.email || shippingAddr.email || '',
    status: 'refunded',
    refundAmount: opts.refundAmount,
    orderCancelled: opts.isFullRefund,
    carrier: extensions.carrier,
    trackingNumber: order.tracking_number ?? undefined,
    trackingUrl: extensions.trackingUrl,
    notes: order.notes ?? undefined,
    cancellationReason: extensions.cancellationReason,
    items: items.map((item: any) => ({
      productId: item.product_id || item.id,
      name: item.product_name || item.name || item.title,
      price: item.unit_price?.amount || item.unit_price || item.price || 0,
      quantity: item.quantity || 1,
      imageUrl: item.imageUrl || '',
    })),
    shippingAddress: {
      street: [shippingAddr.line1, shippingAddr.line2].filter(Boolean).join(', '),
      city: shippingAddr.city || '',
      state: shippingAddr.region || '',
      zipCode: shippingAddr.postal_code || '',
      country: shippingAddr.country || 'US',
    },
  };
}
