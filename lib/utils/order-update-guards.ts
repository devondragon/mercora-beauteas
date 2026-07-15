/**
 * Pure guards for the fulfillment-only PUT /api/orders handler (BMC-158,
 * follow-up to BMC-140).
 *
 * The PUT handler is gated by ORDERS_UPDATE — a scoped webhook/automation
 * permission, NOT full admin. Two order fields it can otherwise write freely
 * are integrity-sensitive and belong to other, verified code paths:
 *
 *  1. `status` → 'refunded' / 'cancelled'. These are not a money vector on
 *     their own, but setting them here produces inconsistent state (an order
 *     marked 'refunded' while `payment_status` stays 'paid' and no Stripe
 *     refund exists) and emails the customer a false cancelled/refunded
 *     notice. Both statuses are owned exclusively by the dedicated
 *     POST /api/orders/refund route, which only flips them after actually
 *     creating a Stripe refund. So this handler must reject them.
 *
 *  2. `extensions.payment_intent_id`. The refund route derives the
 *     PaymentIntent to refund from the order's stored
 *     `extensions.payment_intent_id`. A holder of ORDERS_UPDATE could rebind
 *     an order's PI (or drop it via a wholesale `extensions` overwrite) before
 *     a refund is issued — a refund-fraud / integrity concern. So this handler
 *     must pin the stored value and never let PUT change it.
 *
 * Kept dependency-free (no DB / Cloudflare bindings) so they can be unit
 * tested directly. Consumed by app/api/orders/route.ts.
 */

/** Statuses the schema accepts on an order row. */
export const VALID_ORDER_STATUSES = [
  'pending',
  'processing',
  'shipped',
  'delivered',
  'cancelled',
  'refunded',
] as const;

/**
 * Statuses that PUT /api/orders must NOT set. They are owned exclusively by
 * POST /api/orders/refund, which sets them only after a verified Stripe refund.
 */
export const REFUND_OWNED_STATUSES = ['cancelled', 'refunded'] as const;

/**
 * Validates a status supplied to PUT /api/orders.
 *
 * Returns a discriminated result (never throws) so the route can turn a
 * failure straight into a clean error response:
 *   - unknown status                       → 400
 *   - 'cancelled' / 'refunded' (refund-owned) → 422 (route via /refund)
 */
export function validatePutOrderStatus(
  status: unknown
): { ok: true } | { ok: false; error: string; status: number } {
  if (typeof status !== 'string' || !VALID_ORDER_STATUSES.includes(status as never)) {
    return {
      ok: false,
      error: `Invalid status. Must be one of: ${VALID_ORDER_STATUSES.join(', ')}`,
      status: 400,
    };
  }
  if (REFUND_OWNED_STATUSES.includes(status as never)) {
    return {
      ok: false,
      error:
        `Status "${status}" cannot be set via PUT /api/orders. ` +
        `Cancellations and refunds must go through POST /api/orders/refund, ` +
        `which issues the Stripe refund and updates payment_status atomically.`,
      status: 422,
    };
  }
  return { ok: true };
}

/** Parse a `mode:"json"` value that may already be an object or a raw string. */
function asObject(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  return typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

/**
 * Protects `extensions.payment_intent_id` from being changed by a PUT write.
 *
 * The refund route trusts this field to locate the PaymentIntent it refunds,
 * so PUT must never rebind it, introduce a new one, or drop it via a wholesale
 * `extensions` overwrite. This returns the object to persist: the client's
 * `extensions` with `payment_intent_id` forced back to the currently stored
 * value (or stripped entirely if the order never had one). All other
 * `extensions` keys pass through unchanged.
 *
 * @param incoming  the client-supplied `extensions` from the PUT body
 * @param current   the order's currently persisted `extensions` (object or JSON string)
 */
export function protectPaymentIntentId(
  incoming: unknown,
  current: unknown
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...(asObject(incoming) ?? {}) };
  const storedPi = asObject(current)?.payment_intent_id;

  if (typeof storedPi === 'string' && storedPi.length > 0) {
    // Pin the immutable binding: restore it whether the client changed it,
    // omitted it (wholesale overwrite that would drop it), or left it alone.
    result.payment_intent_id = storedPi;
  } else {
    // No stored PI — PUT may not introduce one (that binding is set only at
    // verified order creation). Strip any client-supplied value.
    delete result.payment_intent_id;
  }

  return result;
}
