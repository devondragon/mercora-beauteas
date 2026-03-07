/**
 * Order Transformer
 *
 * Transforms Shopify orders into Mercora order records for the D1 orders table.
 * Resolves customer_id and product IDs from idMap.
 *
 * Status mapping:
 *   fulfillment_status=fulfilled -> 'delivered'
 *   fulfillment_status=partial -> 'shipped'
 *   financial_status=paid + no fulfillment -> 'processing'
 *   financial_status=refunded -> 'refunded'
 *   financial_status=voided/cancelled OR cancelled_at set -> 'cancelled'
 *   Otherwise -> 'pending'
 */

import { nanoid } from 'nanoid';
import type { IdMap } from '../lib/id-map.js';
import type {
  ShopifyOrder,
  ShopifyOrderLineItem,
  ShopifyCustomerAddress,
} from '../lib/types.js';

/** Mercora order record matching the actual orders table columns */
export interface OrderRecord {
  id: string;
  customer_id: string | null;
  status: string;
  total_amount: string; // JSON Money object
  currency_code: string;
  shipping_address: string | null; // JSON Address
  billing_address: string | null; // JSON Address
  items: string; // JSON array of order items
  payment_method: string | null;
  payment_status: string;
  notes: string | null;
  external_references: string | null; // JSON
  extensions: string | null; // JSON
  created_at: string;
  updated_at: string;
}

export interface OrderTransformResult {
  records: OrderRecord[];
  skipped: Array<{ record: ShopifyOrder; reason: string }>;
  warnings: string[];
}

/**
 * Map Shopify financial_status + fulfillment_status to Mercora order status
 */
function mapOrderStatus(order: ShopifyOrder): string {
  const { financial_status, fulfillment_status, cancelled_at } = order;

  // Check cancellation first
  if (
    cancelled_at ||
    financial_status === 'voided' ||
    financial_status === 'cancelled'
  ) {
    return 'cancelled';
  }

  if (financial_status === 'refunded') {
    return 'refunded';
  }

  if (fulfillment_status === 'fulfilled') {
    return 'delivered';
  }

  if (fulfillment_status === 'partial') {
    return 'shipped';
  }

  if (financial_status === 'paid') {
    return 'processing';
  }

  return 'pending';
}

/**
 * Map Shopify financial_status to Mercora payment_status
 */
function mapPaymentStatus(financialStatus?: string): string {
  switch (financialStatus) {
    case 'paid':
    case 'partially_paid':
      return 'paid';
    case 'refunded':
    case 'partially_refunded':
      return 'refunded';
    case 'pending':
    case 'authorized':
      return 'pending';
    default:
      return 'pending';
  }
}

/**
 * Transform Shopify address to Mercora address JSON
 */
function transformAddress(
  addr?: ShopifyCustomerAddress
): string | null {
  if (!addr) return null;

  return JSON.stringify({
    line1: addr.address1 || '',
    line2: addr.address2 || undefined,
    city: addr.city || '',
    state: addr.province || addr.province_code || '',
    postal_code: addr.zip || '',
    country: addr.country_code || addr.country || '',
    first_name: addr.first_name || undefined,
    last_name: addr.last_name || undefined,
    phone: addr.phone || undefined,
  });
}

/**
 * Transform a Shopify line item to Mercora order item
 */
function transformLineItem(
  item: ShopifyOrderLineItem,
  idMap: IdMap,
  currency: string
): Record<string, unknown> {
  return {
    product_id: item.product_id
      ? idMap.resolve('products', String(item.product_id)) || null
      : null,
    variant_id: item.variant_id
      ? idMap.resolve('variants', String(item.variant_id)) || null
      : null,
    name: item.title,
    quantity: item.quantity,
    price: {
      amount: Math.round(parseFloat(item.price || '0') * 100),
      currency,
    },
    sku: item.sku || undefined,
  };
}

/**
 * Transform Shopify orders into Mercora order records.
 */
export function transformOrders(
  orders: ShopifyOrder[],
  idMap: IdMap
): OrderTransformResult {
  const records: OrderRecord[] = [];
  const skipped: Array<{ record: ShopifyOrder; reason: string }> = [];
  const warnings: string[] = [];

  for (const order of orders) {
    const shopifyId = String(order.id);
    const orderId = `ORD-${nanoid(8).toUpperCase()}`;
    const currency = order.currency || 'USD';

    // Resolve customer_id from idMap (null for guest orders)
    const customerId = order.customer?.id
      ? idMap.resolve('customers', String(order.customer.id)) || null
      : null;

    if (order.customer?.id && !customerId) {
      warnings.push(
        `Order ${shopifyId}: customer ${order.customer.id} not found in idMap (guest order fallback)`
      );
    }

    // Total amount as Money object
    const totalAmount = {
      amount: Math.round(parseFloat(order.total_price || '0') * 100),
      currency,
    };

    // Transform line items
    const items = order.line_items.map((item) =>
      transformLineItem(item, idMap, currency)
    );

    // External references
    const externalReferences = {
      shopify_id: shopifyId,
      shopify_order_name: order.name || undefined,
    };

    // Extensions (unmapped Shopify fields)
    const extensions = {
      shopify_financial_status: order.financial_status || undefined,
      shopify_fulfillment_status: order.fulfillment_status || undefined,
      shopify_tags: order.tags || undefined,
    };

    records.push({
      id: orderId,
      customer_id: customerId,
      status: mapOrderStatus(order),
      total_amount: JSON.stringify(totalAmount),
      currency_code: currency,
      shipping_address: transformAddress(order.shipping_address),
      billing_address: transformAddress(order.billing_address),
      items: JSON.stringify(items),
      payment_method: null,
      payment_status: mapPaymentStatus(order.financial_status),
      notes: order.note || null,
      external_references: JSON.stringify(externalReferences),
      extensions: JSON.stringify(extensions),
      created_at: order.created_at || new Date().toISOString(),
      updated_at: order.updated_at || new Date().toISOString(),
    });

    // Register in idMap
    idMap.register('orders', shopifyId, orderId);
  }

  return { records, skipped, warnings };
}
