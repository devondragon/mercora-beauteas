import { getOrderById } from '../models/mach/orders';
import type { Order } from '../types';

/**
 * Read-side order helpers for the MCP order-status / tracking surface (BMC-181).
 *
 * These live here — NOT in lib/mcp/tools/order.ts — so read-only consumers
 * (get_order_status and the order/track route) share the ownership gate and the
 * delivery description WITHOUT dragging the full order-tool module's Stripe /
 * inventory / pricing dependencies (and lib/stripe's import-time warnings) into
 * their bundle (PR #81 review). This module depends only on the orders model.
 */

/**
 * Fetch an order only if it belongs to the calling agent.
 *
 * MCP orders are tagged with the placing agent's id in extensions.agent_id (see
 * placeOrder). Returns the order for its owner; returns null alike for a missing
 * order, an order owned by a DIFFERENT agent, and a non-MCP order (no agent
 * attribution) — the single ownership/IDOR gate. Callers MUST pass the
 * server-authenticated agentId (never a client-supplied value) and surface an
 * IDENTICAL not-found for a null result so an agent can't probe order ids /
 * states it doesn't own.
 */
export async function getOwnedOrder(orderId: string, agentId: string): Promise<Order | null> {
  const order = await getOrderById(orderId);
  if (!order || !order.extensions?.agent_id || order.extensions.agent_id !== agentId) {
    return null;
  }
  return order;
}

/**
 * Human-readable delivery estimate for a persisted order. Terminal statuses
 * report their outcome rather than a forward-looking estimate, which would
 * misleadingly imply an already-delivered/cancelled/refunded order is still in
 * transit. Reads the order's own MACH shipping_address.region (persisted orders
 * are already MACH-shaped; falls back to a legacy `state` key defensively).
 */
export function describeOrderDelivery(
  order: { status: string; shipping_address?: unknown; shipping_method?: string }
): string {
  if (order.status === 'delivered') return 'Delivered';
  if (order.status === 'cancelled') return 'Cancelled';
  if (order.status === 'refunded') return 'Refunded';

  const addr = order.shipping_address as { region?: string; state?: string } | undefined;
  return estimateDelivery(addr?.region ?? addr?.state, order.shipping_method || 'standard');
}

function estimateDelivery(region: string | undefined, shippingOption: string): string {
  if (shippingOption === 'expedited' || shippingOption === 'overnight') {
    return '1-2 business days';
  }
  if (region === 'AK' || region === 'HI') {
    return '5-7 business days';
  }
  return '3-5 business days';
}
