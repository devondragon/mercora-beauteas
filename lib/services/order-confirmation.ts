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
import {
  sendOrderConfirmationEmail,
  sendNewOrderMerchantNotification,
  type OrderData,
} from '@/lib/utils/email';
import { logCritical } from '@/lib/utils/observe';
import { getProduct } from '@/lib/models/mach/products';
import { getOrderCustomerEmail } from '@/lib/orders/customer-email';

/**
 * Resolve a product-image key for each line item.
 *
 * Order line items do NOT persist an image (they carry only product_id,
 * product_name, sku, quantity and prices), so the confirmation email used to
 * render "No image" for every item — confirmed on the first live production
 * order, WEB-GUEST-1785194376707, 2026-07-27.
 *
 * Resolving at send time rather than persisting on the order means this also
 * fixes already-placed orders, and keeps one source of truth for product media.
 * Best-effort by design: a lookup failure yields no image, never a failed email.
 *
 * Returns a map of product_id → relative R2 key (e.g. "products/foo.jpg"),
 * which the email template turns into an absolute CDN URL.
 */
async function resolveItemImages(productIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const unique = [...new Set(productIds.filter(Boolean))];

  await Promise.all(
    unique.map(async (id) => {
      try {
        const product = await getProduct(id);
        const media = (product as any)?.media;
        const first = Array.isArray(media) ? media[0] : undefined;
        const url = typeof first === 'string' ? first : first?.url;
        if (typeof url === 'string' && url.length > 0) out.set(id, url);
      } catch (err) {
        // Never let an image lookup break the confirmation email.
        console.warn(`[order-confirmation] image lookup failed for product ${id}:`, err);
      }
    }),
  );

  return out;
}

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

    // Single source of truth for extensions.email || shipping_address.email —
    // the shipping email and the guest order-status token bind to the same
    // normalized value (BMC-216A).
    const customerEmail = getOrderCustomerEmail(order);
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

    // Line items carry no image, so look one up per product (see above).
    const itemImages = await resolveItemImages(
      (order.items ?? []).map((i) => i.product_id).filter(Boolean) as string[],
    );

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
          // Prefer an image persisted on the line item (future-proofing); fall
          // back to the product's first media entry resolved above.
          imageUrl: (item as any).imageUrl || itemImages.get(item.product_id as string) || '',
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
      // The customer PAID and got no confirmation. Nothing retries this, and the
      // failure is swallowed so it can't break order finalization — which means a
      // plain console.error would leave a broken Resend config (bad key,
      // unverified domain, suspended account) silently eating every confirmation
      // with nobody paged. Route it to the money-path alerting instead (BMC-168).
      console.error(`[order-confirmation] Failed for ${order.id}:`, emailResult.error);
      logCritical(
        'email',
        'order_confirmation_send_failed',
        { orderId: order.id, reason: emailResult.error },
      );
    }

    // Tell the shop owner an order needs fulfilling (stopgap for BMC-216 — the
    // only prior signal was Stripe's payment email, which says money moved but
    // not what to ship). Sent AFTER the customer's confirmation so a merchant
    // failure can never delay or displace it, and alerted on separately: a
    // silently missed order is exactly the failure this exists to prevent.
    const merchantResult = await sendNewOrderMerchantNotification(orderData);
    if (merchantResult.success) {
      console.log(`[merchant-notification] Sent for ${order.id}:`, merchantResult.id);
    } else {
      console.error(`[merchant-notification] Failed for ${order.id}:`, merchantResult.error);
      logCritical(
        'email',
        'merchant_order_notification_failed',
        { orderId: order.id, reason: merchantResult.error },
      );
    }
  } catch (emailError) {
    console.error(`[order-confirmation] Preparation failed for ${order?.id}:`, emailError);
    logCritical('email', 'order_confirmation_prep_failed', { orderId: order?.id }, emailError);
  }
}
