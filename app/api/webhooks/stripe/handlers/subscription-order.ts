/**
 * Subscription → Order bridge (BMC-171)
 *
 * Subscription webhooks used to write only `subscription_events` audit rows and
 * send emails — they never created an order, so subscription shipments (initial
 * and every renewal) were invisible to the admin Orders screen, the only
 * fulfillment surface. Merchants had to reconcile against Stripe by hand to know
 * what to ship each cycle.
 *
 * This helper turns a paid subscription invoice into a real, fulfillable, paid
 * order that appears in admin, reusing the same atomic `createOrderPaid` path the
 * MCP/checkout order flows use.
 *
 * Idempotency: the order id is DERIVED deterministically from the funding Stripe
 * invoice id (`SUBORD-<invoiceId>`), so a webhook redelivery — Stripe retries,
 * or the route releasing its claim on a downstream error — collides on the orders
 * PRIMARY KEY instead of creating a second shipment for one charge. A pre-check
 * short-circuits the common case; a caught PK collision covers the concurrent
 * race. This mirrors the MCP place_order guard (BMC-132).
 */

import { createOrderPaid, getOrderById } from '@/lib/models/mach/orders';
import { getSubscriptionPlanById } from '@/lib/models/mach/subscriptions';
import { getProductVariants } from '@/lib/models/mach/products';
import { getProductName } from './utils';
import type { CustomerSubscriptionRow } from '@/lib/db/schema/subscription';
import type { Address, CreateOrderRequest, Money } from '@/lib/types';

/** Deterministic order id for a subscription shipment funded by a Stripe invoice. */
export function subscriptionOrderId(invoiceId: string): string {
  return `SUBORD-${invoiceId}`;
}

interface SubscriptionOrderParams {
  /** The D1 subscription row (source of customer, plan, and shipping address). */
  subscription: CustomerSubscriptionRow;
  /** Stripe invoice id that funded this shipment — the idempotency key. */
  invoiceId: string;
  /** Amount actually paid, in minor units (cents). Typically invoice.amount_paid. */
  amountPaidMinor: number;
  /** ISO 4217 currency (e.g. "USD"). Stripe currencies are lowercase — pass uppercased. */
  currency: string;
  /** Whether this is the first shipment or a recurring renewal (labels only). */
  kind: 'initial' | 'renewal';
}

/**
 * Create the paid order for one subscription shipment. Idempotent and
 * non-throwing on a duplicate delivery; throws only on an unexpected failure so
 * the webhook route can 500 and let Stripe retry.
 */
export async function createSubscriptionOrder(
  params: SubscriptionOrderParams
): Promise<void> {
  const { subscription: sub, invoiceId, amountPaidMinor, currency, kind } = params;
  const orderId = subscriptionOrderId(invoiceId);

  // Fast-path idempotency: this shipment's order already exists (a prior
  // delivery created it). Skip before doing any lookups or writes.
  const existing = await getOrderById(orderId);
  if (existing) {
    console.log(`[webhook] subscription ${kind} order ${orderId} already exists, skipping`);
    return;
  }

  const plan = await getSubscriptionPlanById(sub.plan_id);
  const productId = plan?.product_id;
  const productName = productId ? await getProductName(productId) : 'Subscription';

  // Resolve a SKU + variant for the fulfillment line from the plan's product.
  // Subscription plans target a product (typically single-variant here); fall
  // back to the product id as the SKU if no variant resolves, so a missing
  // variant never blocks a legitimately-paid order.
  let sku = productId ?? sub.plan_id;
  let variantId: string | undefined;
  if (productId) {
    try {
      const variants = await getProductVariants(productId);
      if (variants[0]?.sku) {
        sku = variants[0].sku;
        variantId = variants[0].id;
      }
    } catch (err) {
      console.error(`[webhook] subscription order: variant lookup failed for ${productId}`, err);
    }
  }

  // The invoice is the authoritative "money changed hands" amount. Money.amount
  // is minor units (cents) throughout the order record (admin renders /100).
  const money: Money = { amount: amountPaidMinor, currency };
  const address: Address | undefined = sub.shipping_address ?? undefined;

  const orderData: CreateOrderRequest = {
    id: orderId,
    customer_id: sub.customer_id,
    items: [
      {
        product_id: productId ?? sub.plan_id,
        variant_id: variantId,
        sku,
        quantity: 1,
        unit_price: money,
        total_price: money,
        product_name: productName,
      },
    ],
    total_amount: money,
    currency_code: currency,
    shipping_address: address,
    billing_address: address,
    shipping_method: 'standard',
    payment_method: 'subscription',
    notes: `Subscription ${kind} shipment (${sub.id} · invoice ${invoiceId})`,
    external_references: {
      stripe_subscription_id: sub.stripe_subscription_id,
      stripe_invoice_id: invoiceId,
    },
    extensions: {
      source: 'subscription',
      subscription_id: sub.id,
      plan_id: sub.plan_id,
      shipment_kind: kind,
    },
  };

  try {
    await createOrderPaid(orderData, { status: 'processing' });
    console.log(`[webhook] created subscription ${kind} order ${orderId} for ${sub.id}`);
  } catch (err) {
    // Deterministic id → a concurrent delivery that inserted first collides on
    // the PK here. Treat an existing row as an idempotent success; rethrow
    // anything else so the webhook route 500s and Stripe retries.
    const raced = await getOrderById(orderId);
    if (raced) {
      console.log(`[webhook] subscription ${kind} order ${orderId} PK collision (idempotent), skipping`);
      return;
    }
    throw err;
  }
}
