// lib/models/mach/orders.ts - MACH Alliance Order Operations

import { eq, desc, and, sql } from "drizzle-orm";
import { getDbAsync } from "@/lib/db";
import { orders, order_webhooks } from "@/lib/db/schema/order";
import { Order, CreateOrderRequest, Money, Address, OrderItem } from "@/lib/types";

/**
 * MACH Alliance Order Operations
 * 
 * These functions provide MACH-compliant order management operations:
 * - Create orders with proper financial modeling
 * - Retrieve orders by customer or order ID
 * - Update order status and shipping information
 * - Handle webhooks and notifications
 */

// Build the raw order row for insert. Shared by createOrder and createOrderPaid
// so the two paths can never diverge on column shape.
// Encoding contract: total_amount / shipping_address / billing_address / items /
// external_references / extensions are `text(..., { mode: "json" })` columns —
// Drizzle serializes them on write and parses on read. Pass the RAW objects
// here; a manual JSON.stringify would double-encode (a JSON string inside a JSON
// string) and break json_extract() in SQL.
function buildOrderRecord(orderData: CreateOrderRequest) {
  // Use a caller-supplied id when present (its uniqueness is then enforced by the
  // PK on insert — see CreateOrderRequest.id / BMC-132); otherwise generate one.
  const orderId = orderData.id ?? `ORD-${Date.now()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

  return {
    id: orderId,
    customer_id: orderData.customer_id,
    status: "pending" as const,
    total_amount: orderData.total_amount,
    currency_code: orderData.currency_code,
    shipping_address: orderData.shipping_address ?? null,
    billing_address: orderData.billing_address ?? null,
    items: orderData.items,
    shipping_method: orderData.shipping_method,
    payment_method: orderData.payment_method,
    payment_status: "pending" as const,
    notes: orderData.notes,
    external_references: orderData.external_references ?? null,
    extensions: orderData.extensions ?? null,
  };
}

// Create a new order
export async function createOrder(orderData: CreateOrderRequest): Promise<Order> {
  const db = await getDbAsync();

  const orderRecord = buildOrderRecord(orderData);

  const [newOrder] = await db.insert(orders).values(orderRecord).returning();

  // Items are stored as a JSON array in the orders table per schema; no separate order_items table logic needed.

  return hydrateOrder(newOrder);
}

/**
 * Create an order AND mark it paid as a single atomic D1 batch (BMC-132).
 *
 * The MCP order path funds an order against an already-captured Stripe payment,
 * so it must never leave a persisted-but-unpaid order stranded: if create and
 * mark-paid were two separate awaits, a failure on the second one would leave a
 * `pending` order against real money with no recovery path (the replay guard
 * blocks a retry, and the Stripe webhook only reconciles orders whose id is in
 * the PaymentIntent metadata — which MCP PIs do not carry). Running the insert
 * and the paid-update in one `db.batch` makes them succeed or fail together;
 * D1 has no interactive transactions, so db.batch is the atomic primitive here
 * (same pattern as gift-card issuance). The order still reaches its paid state
 * through the canonical markOrderPaid field-set, never a hardcoded status.
 */
export async function createOrderPaid(
  orderData: CreateOrderRequest,
  paid?: { status?: Order['status']; notes?: string }
): Promise<Order> {
  const db = await getDbAsync();

  const orderRecord = buildOrderRecord(orderData);

  const paidUpdate: Record<string, unknown> = {
    payment_status: 'paid',
    status: paid?.status ?? 'processing',
    updated_at: sql`CURRENT_TIMESTAMP`,
  };
  if (paid?.notes) {
    paidUpdate.notes = paid.notes;
  }

  const [, updatedRows] = await db.batch([
    db.insert(orders).values(orderRecord),
    db
      .update(orders)
      .set(paidUpdate)
      .where(eq(orders.id, orderRecord.id))
      .returning(),
  ]);

  return hydrateOrder(updatedRows[0]);
}

// Get orders for a specific customer.
//
// BMC-167 (M1): since a server-side UNPAID `pending` order is now persisted at
// PaymentIntent creation, every abandoned checkout-past-shipping leaves a
// phantom draft under the customer. Exclude those unpaid drafts by default so
// they don't surface in the customer's order history or skew order-history-based
// personalization. Pass { includePending: true } to include them. (Rows with a
// NULL payment_status — legacy/imported — are kept; only explicit 'pending' is
// hidden.)
export async function getOrdersByCustomer(
  customerId: string,
  opts?: { includePending?: boolean }
): Promise<Order[]> {
  const db = await getDbAsync();

  const where = opts?.includePending
    ? eq(orders.customer_id, customerId)
    : and(
        eq(orders.customer_id, customerId),
        sql`(${orders.payment_status} IS NULL OR ${orders.payment_status} != 'pending')`
      );

  const orderRecords = await db
    .select()
    .from(orders)
    .where(where)
    .orderBy(desc(orders.created_at));

  return orderRecords.map(hydrateOrder);
}

// Get a specific order by ID
export async function getOrderById(orderId: string): Promise<Order | null> {
  const db = await getDbAsync();
  
  const orderRecords = await db
    .select()
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);
  
  if (orderRecords.length === 0) {
    return null;
  }
  
  return hydrateOrder(orderRecords[0]);
}

/**
 * Find an order by the Stripe PaymentIntent id recorded in its
 * external_references. Used as the friendly, early replay check (BMC-132): a
 * succeeded PaymentIntent must fund at most one order, so the MCP place_order
 * path rejects a PI that already backs an existing order with a clear error.
 *
 * This lookup alone is check-then-insert and NOT atomic (D1 has no multi-
 * statement transactions), so it cannot by itself stop a deliberately
 * concurrent double-submit — without a hard guard that race would create TWO
 * paid orders for ONE payment (two shipments, one charge). The atomic guarantee
 * therefore comes from the DB, not this query: place_order derives the order's
 * PRIMARY KEY deterministically from the PaymentIntent id, so a second insert
 * for the same PI fails on the PK. This function is the fast-path UX check; the
 * PK collision is the backstop.
 */
export async function getOrderByPaymentIntentId(paymentIntentId: string): Promise<Order | null> {
  const db = await getDbAsync();

  // The PaymentIntent id is recorded under `external_references.payment_intent_id`
  // by the MCP order path AND, for the storefront pending order (BMC-167), also
  // under `extensions.payment_intent_id`. Match either so a PI lookup finds an
  // order regardless of which writer created it.
  const orderRecords = await db
    .select()
    .from(orders)
    .where(
      sql`json_extract(${orders.external_references}, '$.payment_intent_id') = ${paymentIntentId}
        OR json_extract(${orders.extensions}, '$.payment_intent_id') = ${paymentIntentId}`
    )
    .limit(1);

  if (orderRecords.length === 0) {
    return null;
  }

  return hydrateOrder(orderRecords[0]);
}

/**
 * Promote an order from pending → paid with a guarded compare-and-swap (BMC-167).
 *
 * D1 has no interactive transactions, so "at most one writer marks this order
 * paid" is enforced with a conditional UPDATE: the `WHERE payment_status =
 * 'pending'` clause makes the flip atomic. Exactly one caller can match a row
 * whose payment_status is still 'pending' and get it back via RETURNING; every
 * other concurrent or later caller (the client POST and the Stripe webhook both
 * race to promote the same pending order) sees zero rows changed. The winner
 * (`promoted: true`) is the sole owner of the one-time side effects — order
 * confirmation email, gift-card fulfillment — so those never double-fire.
 *
 * Returns `{ promoted: false }` when the row was already paid (idempotent
 * no-op) or does not exist; `order` carries the current row (post-update on a
 * win, current state on a loss) or null when the id is unknown.
 */
export async function promoteOrderToPaid(
  orderId: string,
  opts?: { status?: Order['status']; notes?: string }
): Promise<{ promoted: boolean; order: Order | null }> {
  const db = await getDbAsync();

  const updateData: Record<string, unknown> = {
    payment_status: 'paid',
    status: opts?.status ?? 'processing',
    updated_at: sql`CURRENT_TIMESTAMP`,
  };
  if (opts?.notes) {
    updateData.notes = opts.notes;
  }

  const updated = await db
    .update(orders)
    .set(updateData)
    .where(and(eq(orders.id, orderId), eq(orders.payment_status, 'pending')))
    .returning();

  if (updated.length > 0) {
    return { promoted: true, order: hydrateOrder(updated[0]) };
  }

  // Not promoted: either already paid (another writer won the CAS) or the row
  // does not exist. Surface the current state so the caller can distinguish
  // "already paid → idempotent success" from "missing → defer/retry".
  const current = await getOrderById(orderId);
  return { promoted: false, order: current };
}

// Update order status
export async function updateOrderStatus(orderId: string, status: Order['status']): Promise<Order | null> {
  const db = await getDbAsync();
  
  const [updated] = await db
    .update(orders)
    .set({
      status,
      updated_at: sql`CURRENT_TIMESTAMP`,
    })
    .where(eq(orders.id, orderId))
    .returning();
  
  if (!updated) {
    return null;
  }

  return hydrateOrder(updated);
}

/**
 * Mark an order as paid (and, by default, move it into fulfillment).
 *
 * Writes directly to D1 — used by both the order-creation path (after
 * server-side PaymentIntent verification) and the Stripe webhook. Returns null
 * if the order row doesn't exist yet (e.g. webhook wins the race with the
 * client's order-creation call), so the caller can defer/retry.
 */
export async function markOrderPaid(
  orderId: string,
  opts?: { status?: Order['status']; notes?: string }
): Promise<Order | null> {
  const db = await getDbAsync();

  const updateData: Record<string, unknown> = {
    payment_status: 'paid',
    status: opts?.status ?? 'processing',
    updated_at: sql`CURRENT_TIMESTAMP`,
  };
  if (opts?.notes) {
    updateData.notes = opts.notes;
  }

  const [updated] = await db
    .update(orders)
    .set(updateData)
    .where(eq(orders.id, orderId))
    .returning();

  return updated ? hydrateOrder(updated) : null;
}

/**
 * Revert an order to unpaid/pending.
 *
 * Used to undo a paid decision (BMC-131 / H1) when gift-card tender that the
 * sufficiency check counted on was not actually redeemed (e.g. a lost balance
 * race): the cash collected no longer covers the goods, so the order must not
 * remain paid/processing. Idempotent — re-reverting an already-pending order is
 * a no-op write.
 */
export async function markOrderUnpaid(
  orderId: string,
  opts?: { notes?: string }
): Promise<Order | null> {
  const db = await getDbAsync();

  const updateData: Record<string, unknown> = {
    payment_status: 'pending',
    status: 'pending',
    updated_at: sql`CURRENT_TIMESTAMP`,
  };
  if (opts?.notes) {
    updateData.notes = opts.notes;
  }

  const [updated] = await db
    .update(orders)
    .set(updateData)
    .where(eq(orders.id, orderId))
    .returning();

  return updated ? hydrateOrder(updated) : null;
}

/**
 * Overwrite an order's free-text notes (BMC-167 / M4). Used to flag a captured-
 * but-unpriceable order for manual review without touching its payment state.
 */
export async function updateOrderNotes(orderId: string, notes: string): Promise<void> {
  const db = await getDbAsync();
  await db
    .update(orders)
    .set({ notes, updated_at: sql`CURRENT_TIMESTAMP` })
    .where(eq(orders.id, orderId));
}

// Update order with shipping information
export async function updateOrderShipping(
  orderId: string,
  shippingData: {
    status?: Order['status'];
    tracking_number?: string;
    shipped_at?: string;
    delivered_at?: string;
  }
): Promise<Order | null> {
  const db = await getDbAsync();
  
  const updateData: any = {
    updated_at: sql`CURRENT_TIMESTAMP`,
  };
  
  if (shippingData.status) {
    updateData.status = shippingData.status;
  }
  
  if (shippingData.tracking_number) {
    updateData.tracking_number = shippingData.tracking_number;
  }
  
  if (shippingData.shipped_at) {
    updateData.shipped_at = shippingData.shipped_at;
  } else if (shippingData.status === "shipped") {
    updateData.shipped_at = new Date().toISOString();
  }
  
  if (shippingData.delivered_at) {
    updateData.delivered_at = shippingData.delivered_at;
  } else if (shippingData.status === "delivered") {
    updateData.delivered_at = new Date().toISOString();
  }
  
  const [updated] = await db
    .update(orders)
    .set(updateData)
    .where(eq(orders.id, orderId))
    .returning();
  
  if (!updated) {
    return null;
  }
  
  return hydrateOrder(updated);
}

// Cancel order
export async function cancelOrder(
  orderId: string, 
  reason: string, 
  notes?: string
): Promise<Order | null> {
  const db = await getDbAsync();
  
  const [updated] = await db
    .update(orders)
    .set({
      status: "cancelled",
      notes: notes || reason,
      updated_at: sql`CURRENT_TIMESTAMP`,
    })
    .where(eq(orders.id, orderId))
    .returning();
  
  if (!updated) {
    return null;
  }
  
  return hydrateOrder(updated);
}

// Get orders by status
export async function getOrdersByStatus(status: Order['status']): Promise<Order[]> {
  const db = await getDbAsync();
  
  const orderRecords = await db
    .select()
    .from(orders)
    .where(eq(orders.status, status))
    .orderBy(desc(orders.created_at));
  
  return orderRecords.map(hydrateOrder);
}

// Items are always accessed via the items field on the order record (JSON array).

// Utility function to convert database record to Order type.
// Encoding contract: the json-mode columns are already parsed by Drizzle on
// read, so a value normally arrives as an object. We still defensively parse
// when it's a string — this transparently handles any legacy rows that were
// double-encoded before the write path was fixed (Drizzle unwraps the outer
// layer to a string, and this parses the inner JSON).
function parseJsonField<T>(value: unknown): T | undefined {
  if (value == null) return undefined;
  return (typeof value === 'string' ? JSON.parse(value) : value) as T;
}

/**
 * Map a raw `orders` row to the API-facing `Order` shape. Exported for the
 * fulfillment service (BMC-216B), which owns its own guarded writes but must
 * return the same projection every other order API returns.
 */
export function hydrateOrder(orderRecord: typeof orders.$inferSelect): Order {
  return {
    id: orderRecord.id ?? undefined,
    customer_id: orderRecord.customer_id ?? undefined,
    status: orderRecord.status,
    total_amount: (parseJsonField<Money>(orderRecord.total_amount) ?? {
      amount: 0,
      currency: orderRecord.currency_code,
    }) as Money,
    currency_code: orderRecord.currency_code,
    shipping_address: parseJsonField<Address>(orderRecord.shipping_address),
    billing_address: parseJsonField<Address>(orderRecord.billing_address),
    items: parseJsonField<OrderItem[]>(orderRecord.items) ?? [],
    shipping_method: orderRecord.shipping_method ?? undefined,
    payment_method: orderRecord.payment_method ?? undefined,
    payment_status: orderRecord.payment_status ?? 'pending',
    shipping_carrier: orderRecord.shipping_carrier ?? undefined,
    tracking_number: orderRecord.tracking_number ?? undefined,
    shipped_at: orderRecord.shipped_at ?? undefined,
    delivered_at: orderRecord.delivered_at ?? undefined,
    notes: orderRecord.notes ?? undefined,
    external_references: parseJsonField(orderRecord.external_references),
    extensions: parseJsonField(orderRecord.extensions),
    created_at: orderRecord.created_at ?? undefined,
    updated_at: orderRecord.updated_at ?? undefined,
  };
}

// Webhook operations
export async function createOrderWebhook(
  orderId: string,
  webhookType: "order_created" | "order_updated" | "payment_completed" | "shipment_created" | "delivery_confirmed",
  payload: Record<string, any>
): Promise<void> {
  const db = await getDbAsync();
  
  await db.insert(order_webhooks).values({
    id: `wh_${Date.now()}_${Math.random().toString(36).slice(2,8)}`,
    order_id: orderId,
    webhook_type: webhookType,
    status: "pending",
    payload: JSON.stringify(payload),
    attempts: 0,
    max_attempts: 3,
  });
}

export async function getPendingWebhooks() {
  const db = await getDbAsync();
  
  return db
    .select()
    .from(order_webhooks)
    .where(eq(order_webhooks.status, "pending"));
}

export async function markWebhookCompleted(webhookId: string): Promise<void> {
  const db = await getDbAsync();
  
  await db
    .update(order_webhooks)
    .set({
      status: "completed",
      completed_at: sql`CURRENT_TIMESTAMP`,
      updated_at: sql`CURRENT_TIMESTAMP`,
    })
    .where(eq(order_webhooks.id, webhookId));
}

// Legacy support functions for backward compatibility
export async function getOrdersByUserId(userId: string): Promise<Order[]> {
  // In MACH architecture, userId maps to customer_id
  return getOrdersByCustomer(userId);
}
