/**
 * Order Confirmation Email (BMC-167)
 *
 * Single place that turns a persisted, hydrated {@link Order} into an
 * order-confirmation email. Extracted from the inline block that used to live
 * in POST /api/orders so BOTH writers that can finalize a paid order share it:
 *
 *   - the storefront order route (client POST), and
 *   - the Stripe `payment_intent.succeeded` webhook, which now promotes a
 *     server-side pending order to paid when the client POST never lands
 *     (redirect payment method returning in a different browser, cleared
 *     localStorage, closed tab). Before BMC-167 that customer got no
 *     confirmation at all; now the webhook sends it.
 *
 * The email is sent at most once per order, gated on winning the pending → paid
 * CAS (see `finalizePaidOrder`). All money fields on the order are integer MINOR
 * units (cents); `buildOrderEmailTotals` formats them for display.
 */

import type { Order } from '@/lib/types/order';
import { Money } from '@/lib/money';
import { buildOrderEmailTotals } from '@/lib/utils/order-email-totals';
import { sendOrderConfirmationEmail, type OrderData } from '@/lib/utils/email';

/** Coerce a possibly-i18n address city field to a plain display string. */
function coerceCity(city: unknown): string {
  if (typeof city === 'string') return city;
  if (city && typeof city === 'object') {
    const first = Object.values(city as Record<string, unknown>)[0];
    return typeof first === 'string' ? first : '';
  }
  return '';
}

/**
 * Send the order-confirmation email for a paid order. Best-effort: any failure
 * is logged and swallowed so it can never block (or retry) the payment
 * finalization that called it.
 *
 * `customerName` is passed by the client POST path (from the Clerk profile);
 * the webhook has no browser session, so it falls back to the shipping
 * recipient. `giftCardTenderCents` (when a gift card was applied) makes the
 * email show the post-redemption amount actually charged.
 */
export async function sendOrderConfirmationForOrder(
  order: Order,
  opts?: { customerName?: string; giftCardTenderCents?: number }
): Promise<void> {
  try {
    const ext = (order.extensions ?? {}) as Record<string, any>;
    const shippingAddr = order.shipping_address;

    let customerName = opts?.customerName;
    if (!customerName) {
      if (shippingAddr?.recipient && typeof shippingAddr.recipient === 'string') {
        customerName = shippingAddr.recipient;
      } else if (shippingAddr?.company && typeof shippingAddr.company === 'string') {
        customerName = shippingAddr.company;
      } else {
        customerName = 'Valued Customer';
      }
    }

    const customerEmail = ext.email || shippingAddr?.email || '';
    if (!customerEmail) {
      console.warn(`[order-confirmation] Order ${order.id}: no customer email; skipping confirmation`);
      return;
    }

    const currency = order.currency_code || 'USD';
    const orderTotalMinor =
      typeof order.total_amount === 'object' ? order.total_amount.amount : (order.total_amount as unknown as number);

    const emailTotals = buildOrderEmailTotals({
      subtotal: ext.subtotal || 0,
      shipping: ext.shipping_cost || 0,
      tax: ext.tax_amount || 0,
      total: orderTotalMinor || 0,
      currency,
      giftCardAmount: opts?.giftCardTenderCents ?? 0,
    });

    const orderData: OrderData = {
      orderNumber: order.id || '',
      customerName,
      customerEmail,
      items: (order.items ?? []).map((item) => {
        const unitPriceMinor =
          typeof item.unit_price === 'object' ? item.unit_price.amount : (item.unit_price as unknown as number);
        const unitPrice = Money.fromMinor(unitPriceMinor || 0, currency);
        return {
          productId: item.product_id,
          name: item.product_name,
          price: unitPrice.format(),
          lineTotal: unitPrice.times(item.quantity).format(),
          quantity: item.quantity,
          imageUrl: (item as any).imageUrl || '',
        };
      }),
      ...emailTotals,
      shippingAddress: shippingAddr
        ? {
            street: [shippingAddr.line1, shippingAddr.line2].filter(Boolean).join(', '),
            city: coerceCity(shippingAddr.city),
            state: shippingAddr.region || '',
            zipCode: shippingAddr.postal_code || '',
            country: shippingAddr.country || 'US',
          }
        : { street: '', city: '', state: '', zipCode: '', country: '' },
      estimatedDelivery: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toLocaleDateString(),
    };

    const emailResult = await sendOrderConfirmationEmail(orderData);
    if (emailResult.success) {
      console.log(`[order-confirmation] Sent for ${order.id}:`, emailResult.id);
    } else {
      console.error(`[order-confirmation] Failed for ${order.id}:`, emailResult.error);
    }
  } catch (emailError) {
    console.error(`[order-confirmation] Preparation failed for ${order?.id}:`, emailError);
  }
}
