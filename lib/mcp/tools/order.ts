import { createOrderPaid, getOrderByPaymentIntentId, updateOrderNotes } from '../../models/mach/orders';
import { decrementStockForOrder } from '../../services/inventory-adjustment';
import { requireOwnedSession } from '../session';
import { OrderRequest, OrderResponse, MCPToolResponse } from '../types';
import { enhanceUserContext } from '../context';
import { MACHAddress as Address } from '../../types/mach/Address';
import { CartItem } from '../../types/cartitem';
import { retrievePaymentIntent } from '../../stripe';
import {
  verifyOrderChargeSufficient,
  AMOUNT_TOLERANCE_CENTS,
  canonicalizeOrderItemsDisplay,
  canonicalizeOrderItemsPricing,
  computeOrderTotals,
} from '../../services/order-pricing';
import { Money, toWireMoney } from '../../money';

// Wire-shaped zero total, reused for every failure response (BMC-164) —
// OrderResponse.total is MACH { amount, currency, precision }, not a bare
// number that silently swaps between cents (success path) and dollars
// (failure paths) depending on which branch built it.
const ZERO_TOTAL = toWireMoney(0);

// Re-exported for existing callers (lib/mcp/tools/payment.ts, and unit tests
// that import it directly from this module) — the actual pure math now lives
// in lib/services/order-pricing.ts (Task 7 / BMC-164), so it can be unit
// tested without pulling in this module's Cloudflare/Stripe/DB dependencies.
export { computeOrderTotals };

/**
 * Normalize an inbound MCP address to the MACHAddress shape the pricing and
 * persistence helpers expect. The MCP tool schemas expose flat `street`/`state`/
 * `postal_code` keys, but calculateShipping/calculateTax/formatAddressForDB read
 * MACH fields (`line1`/`region`). Without this, `region` is undefined for every
 * agent-supplied address, so shipping/tax silently fall back to defaults (5% tax,
 * no AK/HI surcharge) and get under-collected (PR #51 review / BMC-132). Accepts
 * either shape and is idempotent for already-MACH addresses.
 */
export function normalizeAddress(input: any): Address {
  const a = input ?? {};
  return {
    ...a,
    line1: a.line1 ?? a.street ?? '',
    line2: a.line2 ?? a.street2,
    city: a.city ?? '',
    region: a.region ?? a.state,
    postal_code: a.postal_code ?? a.postalCode,
    country: a.country ?? 'US',
  } as Address;
}

// Uniform failed-order response for the payment gate below (BMC-132).
function orderFailure(
  sessionId: string,
  agentId: string,
  startTime: number,
  code: string,
  message: string,
  nextActions: string[]
): MCPToolResponse<OrderResponse> {
  return {
    success: false,
    data: { orderId: '', status: 'failed', total: ZERO_TOTAL, estimated_delivery: '' },
    context: {
      session_id: sessionId,
      agent_id: agentId,
      processing_time_ms: Date.now() - startTime
    },
    error: { code, message },
    metadata: {
      can_fulfill_percentage: 0,
      estimated_satisfaction: 0,
      next_actions: nextActions
    }
  };
}

export async function placeOrder(
  request: OrderRequest,
  sessionId: string,
  agentId: string
): Promise<MCPToolResponse<OrderResponse>> {
  const startTime = Date.now();

  try {
    // Anti-spoof: agent_context is client-controlled, so normalize its agentId
    // to the authenticated agent before it is read for attribution or persisted
    // onto the order below. Access control already relies on the authenticated
    // `agentId` param (via requireOwnedSession); this closes the attribution gap.
    if (request.agent_context) {
      request.agent_context.agentId = agentId;
    }

    // Verify the calling agent owns this session before reading/placing its cart
    const ownership = await requireOwnedSession(sessionId, agentId);
    if (!ownership.ok) {
      return {
        success: false,
        data: {
          orderId: '',
          status: 'failed',
          total: ZERO_TOTAL,
          estimated_delivery: ''
        },
        context: {
          session_id: sessionId,
          agent_id: agentId,
          processing_time_ms: Date.now() - startTime
        },
        error: {
          code: ownership.code,
          message: ownership.message
        },
        metadata: {
          can_fulfill_percentage: 0,
          estimated_satisfaction: 0,
          next_actions: ownership.code === 'SESSION_NOT_FOUND'
            ? ['Create a new session', 'Verify session ID']
            : ['Use a session created by this agent']
        }
      };
    }

    // Get current cart from session
    const cart = ownership.session.cart;

    if (cart.length === 0) {
      return {
        success: false,
        data: {
          orderId: '',
          status: 'failed',
          total: ZERO_TOTAL,
          estimated_delivery: ''
        },
        context: {
          session_id: sessionId,
          agent_id: agentId,
          processing_time_ms: Date.now() - startTime
        },
        metadata: {
          can_fulfill_percentage: 0,
          estimated_satisfaction: 0,
          next_actions: ['Add items to cart before placing order']
        }
      };
    }

    // Enhanced user context for order
    const userContext = enhanceUserContext(request.agent_context || null);

    // Normalize the agent-supplied address(es) to MACH shape up front so pricing
    // reads `region` and persistence stores the right fields (see normalizeAddress).
    const shippingAddress = normalizeAddress(request.shippingAddress);
    const billingAddress = request.billingAddress ? normalizeAddress(request.billingAddress) : shippingAddress;

    // Calculate order totals for the budget gate + post-order recommendations.
    // Cart `item.price` is the catalog variant price in CENTS (see the cart tool /
    // variant.price.amount). Money.fromStored treats a bare number as MINOR units,
    // so this builds the subtotal directly in cents — no cents/dollars conversion
    // (and no /100 or *100) at this boundary, which is what used to make the
    // free-shipping threshold silently compare a cents value against a dollars
    // literal (BMC-161). computeOrderTotals/calculateShipping/calculateTax are now
    // Money-typed end to end, so that class of bug is impossible at the type level.
    // (The authoritative payment total is still recomputed from catalog cents below
    // via computeOrderTotals(Money.fromMinor(charge.goodsCents, …), …); this block
    // only feeds the budget check and the savings copy.)
    const subtotal = cart.reduce(
      (sum, item) => sum.add(Money.fromStored(item.price).times(item.quantity)),
      Money.zero('USD')
    );
    const { shipping, tax, total } = computeOrderTotals(subtotal, shippingAddress);
    // Budget preferences (agent_context.userPreferences.budget) are a plain
    // major-unit (dollars) number, not a wire Money value — compare/display the
    // order total in the same major units.
    const totalMajor = total.toMach().amount;

    // Validate order limits if agent has budget constraints
    if (userContext.budget && totalMajor > userContext.budget) {
      return {
        success: false,
        data: {
          orderId: '',
          status: 'budget_exceeded',
          total: total.toMach(),
          estimated_delivery: ''
        },
        context: {
          session_id: sessionId,
          agent_id: agentId,
          processing_time_ms: Date.now() - startTime
        },
        recommendations: {
          cost_optimization: [
            `Order total $${totalMajor} exceeds budget $${userContext.budget}`,
            'Consider removing items or choosing our sample-size blends'
          ]
        },
        metadata: {
          can_fulfill_percentage: 100,
          estimated_satisfaction: 30,
          next_actions: ['Reduce cart total', 'Remove expensive items', 'Choose alternative products']
        }
      };
    }

    // SECURITY (BMC-132 / C5): an MCP order MUST be backed by a real,
    // server-verified Stripe payment. This path previously called createOrder()
    // with no Stripe check at all, so any authenticated agent could persist an
    // order for free. Require a PaymentIntent that we minted for THIS agent+
    // session (via create_payment_intent) and that:
    //   (a) actually succeeded,
    //   (b) is bound to this caller (metadata.agentId + metadata.sessionId),
    //   (c) collected at least the CATALOG value of the goods (never the
    //       client/session-supplied prices), and
    //   (d) has not already funded another order (replay guard).
    // Any failure is fatal: we return an error and DO NOT create an order. The
    // order is only ever marked paid via markOrderPaid — the same path the
    // storefront and Stripe webhook use — never a hardcoded 'confirmed'.
    const paymentIntentId = request.paymentIntentId;
    if (!paymentIntentId || typeof paymentIntentId !== 'string') {
      return orderFailure(sessionId, agentId, startTime, 'PAYMENT_REQUIRED',
        'A verified paymentIntentId is required to place an order. Create one with create_payment_intent, complete payment, then retry.',
        ['Call create_payment_intent', 'Complete the payment', 'Retry place_order with the paymentIntentId']);
    }

    let verifiedPi: Awaited<ReturnType<typeof retrievePaymentIntent>>;
    try {
      verifiedPi = await retrievePaymentIntent(paymentIntentId);
    } catch (piError) {
      console.error(`place_order: PaymentIntent ${paymentIntentId} retrieval failed`, piError);
      return orderFailure(sessionId, agentId, startTime, 'PAYMENT_VERIFICATION_FAILED',
        'Could not verify the PaymentIntent with Stripe.',
        ['Verify the paymentIntentId', 'Retry once payment is confirmed']);
    }

    if (verifiedPi.status !== 'succeeded') {
      return orderFailure(sessionId, agentId, startTime, 'PAYMENT_NOT_COMPLETED',
        `PaymentIntent status is '${verifiedPi.status}'; a succeeded payment is required.`,
        ['Complete the payment', 'Retry place_order once it succeeds']);
    }

    if (verifiedPi.metadata?.agentId !== agentId || verifiedPi.metadata?.sessionId !== sessionId) {
      return orderFailure(sessionId, agentId, startTime, 'PAYMENT_NOT_BOUND',
        'PaymentIntent is not bound to this agent and session.',
        ['Create a PaymentIntent for this session with create_payment_intent']);
    }

    // (d) Replay guard: a succeeded PI must fund at most one order. This early
    // lookup gives a clean error for the ordinary re-submit; the hard guarantee
    // is the deterministic PK below, which makes a concurrent double-submit fail
    // atomically at the DB (see orderId derivation).
    const existingOrder = await getOrderByPaymentIntentId(paymentIntentId);
    if (existingOrder) {
      return orderFailure(sessionId, agentId, startTime, 'PAYMENT_ALREADY_USED',
        'This PaymentIntent has already been used to place an order.',
        ['Use get_order_status to look up the existing order', 'Create a new PaymentIntent for a new order']);
    }

    // (c) Cash collected must cover the catalog value of the goods. Use ONLY the
    // captured amount (amount_received), never the authorized pi.amount.
    const charge = await verifyOrderChargeSufficient({
      items: cart.map(item => ({
        product_id: item.productId,
        variant_id: item.variantId,
        quantity: item.quantity,
      })),
      paidAmountCents: verifiedPi.amount_received ?? 0,
    });
    if (!charge.ok) {
      return orderFailure(sessionId, agentId, startTime, 'PAYMENT_INSUFFICIENT',
        `Payment does not cover the order: ${charge.reason}`,
        ['Create a PaymentIntent for the full order total', 'Retry place_order']);
    }

    // (c2) Cash must also cover server-computed shipping + tax for the ACTUAL
    // destination — not just the goods. Recompute the full total from the CATALOG
    // goods value and the normalized shipping address, then require the captured
    // amount to cover it. Without this, an agent could mint a PaymentIntent against
    // a cheap/empty address (low shipping/tax) and still place an order shipped to
    // AK/HI or a high-tax state, under-collecting the difference (PR #51 review).
    // charge.goodsCents is already MINOR units (cents), so no /100·*100 boundary
    // conversion is needed — Money carries cents through to requiredTotal directly.
    const { total: requiredTotal } = computeOrderTotals(Money.fromMinor(charge.goodsCents, 'USD'), shippingAddress);
    const requiredTotalCents = requiredTotal.toMinorUnits();
    if ((verifiedPi.amount_received ?? 0) + AMOUNT_TOLERANCE_CENTS < requiredTotalCents) {
      return orderFailure(sessionId, agentId, startTime, 'PAYMENT_INSUFFICIENT',
        `Payment does not cover the order total including shipping and tax (required ${requiredTotalCents}c for this destination).`,
        ['Create a PaymentIntent for the full order total (shipping + tax included)', 'Retry place_order']);
    }

    // M1 (BMC-161): overwrite each line's display fields (product_name, imageUrl)
    // with catalog truth before persisting, so a spoofed name can't make the
    // packing slip or admin view describe the wrong product. Mirrors the storefront
    // POST /api/orders path. Fails soft — canonicalization errors keep the
    // session-supplied display rather than blocking a legitimately-paid order.
    const rawItems = cart.map(item => {
      const unit = Money.fromStored(item.price);
      return {
        product_id: item.productId,
        variant_id: item.variantId,
        sku: item.variantId || `${item.productId}-default`,
        quantity: item.quantity,
        unit_price: unit.toJSON(),
        total_price: unit.times(item.quantity).toJSON(),
        product_name: item.name,
        // Seed the session image so the fail-soft path (canonicalization error or
        // unresolved product) still persists a display image rather than dropping
        // it; canonicalizeOrderItemsDisplay overwrites it with catalog truth on
        // success.
        imageUrl: item.primaryImageUrl,
      };
    });
    let canonicalItems = rawItems;
    try {
      canonicalItems = await canonicalizeOrderItemsDisplay(rawItems);
    } catch (canonError) {
      console.error(`place_order: display canonicalization failed; using session display`, canonError);
    }

    // BMC-161 follow-up: overwrite each line's unit_price/total_price with catalog
    // truth too. M1 fixed name/image + the order-level total_amount, but per-line
    // prices were still session/client-supplied, so a spoofed unit_price would be
    // persisted verbatim onto a paid order. Derive unit_price from the same catalog
    // variant the charge gate priced against and recompute total_price =
    // unit_price * quantity server-side (all in CENTS, like total_amount). Fails
    // soft per line — a line whose catalog price can't be resolved keeps its
    // session price rather than blocking a legitimately-paid order.
    try {
      canonicalItems = await canonicalizeOrderItemsPricing(canonicalItems);
    } catch (priceError) {
      console.error(`place_order: price canonicalization failed; using session prices`, priceError);
    }

    // Create order using existing order system. createOrder always persists as
    // pending/unpaid; we then mark it paid via the verified-payment path below.
    // The id is DERIVED FROM THE PAYMENTINTENT so a duplicate insert (a concurrent
    // double-submit that slips past the early lookup above) collides on the PK and
    // fails atomically — one payment can fund at most one order (BMC-132).
    const orderData = {
      id: `MCP-${paymentIntentId}`,
      customer_id: userContext.userId || agentId,
      // M1 (BMC-161): persist the catalog-derived total, not the session-cart
      // total. requiredTotal is derived from charge.goodsCents (catalog) plus
      // server-computed shipping/tax — the same components the payment gate
      // verified against. Money.toJSON() persists CENTS (Money.amount is cents
      // throughout the order record — item.unit_price above, and the admin UI
      // renders total_amount.amount / 100).
      total_amount: requiredTotal.toJSON(),
      shipping_address: shippingAddress,
      billing_address: billingAddress,
      items: canonicalItems,
      shipping_method: request.shippingOption || 'standard',
      payment_method: request.paymentMethod || 'agent-processed',
      notes: request.specialInstructions,
      // Bind the PaymentIntent to the order for the early replay lookup above.
      external_references: { payment_intent_id: paymentIntentId },
      // Preserve agent attribution (createOrder does not persist top-level agent
      // fields; keep them in extensions).
      extensions: {
        agent_id: agentId,
        agent_context: request.agent_context ?? undefined,
      },
      currency_code: 'USD'
    };

    // Payment is verified — persist the order AND mark it paid in one atomic
    // batch (createOrderPaid). A captured payment must never strand a persisted-
    // but-unpaid order: a two-step create-then-markPaid could fail on the second
    // step and leave a 'pending' order against real money that neither a retry
    // (blocked by the replay guard) nor the Stripe webhook (MCP PIs carry no
    // orderId metadata) could recover. The order still reaches paid/processing
    // via the canonical markOrderPaid field-set — never a hardcoded status.
    let order;
    try {
      order = await createOrderPaid(orderData, {
        status: 'processing',
        notes: `Paid via MCP agent ${agentId} (PaymentIntent ${paymentIntentId})`,
      });
    } catch (createError) {
      // A PK collision here means another concurrent place_order already created
      // the order for this PaymentIntent — treat as a replay, not a crash, so we
      // never double-fulfill a single payment.
      const raced = await getOrderByPaymentIntentId(paymentIntentId);
      if (raced) {
        return orderFailure(sessionId, agentId, startTime, 'PAYMENT_ALREADY_USED',
          'This PaymentIntent has already been used to place an order.',
          ['Use get_order_status to look up the existing order', 'Create a new PaymentIntent for a new order']);
      }
      throw createError;
    }

    // Inventory decrement (BMC-178) — runs exactly once per order: a duplicate
    // place_order collides on the order PK and returns via the replay guard
    // above. Tracked, non-backorderable lines decrement with a guarded CAS that
    // can't oversell; a capture-time race yields `oversold` lines, which we flag
    // for manual review without unwinding the captured payment. Wrapped so an
    // inventory failure can never turn a successfully-paid order into an MCP error.
    try {
      const { oversold } = await decrementStockForOrder(order.items as any);
      if (oversold.length) {
        const summary = oversold
          .map((o) => `${o.product_name ?? o.variant_id} (requested ${o.requested}, ${o.available} on hand)`)
          .join('; ');
        console.error(
          `[mcp:place_order] Order ${order.id}: OVERSOLD on ${oversold.length} line(s) — ${summary}. ` +
            `Order left paid; flagged for manual review.`
        );
        try {
          const existingNotes = order.notes ? `${order.notes}\n\n` : '';
          await updateOrderNotes(order.id!, `${existingNotes}NEEDS REVIEW (BMC-178): oversold — ${summary}`);
        } catch (noteError) {
          console.error(`[mcp:place_order] Order ${order.id}: failed to record oversold review note`, noteError);
        }
      }
    } catch (invError) {
      console.error(`[mcp:place_order] Inventory decrement failed for ${order.id}:`, invError);
    }

    // Calculate estimated delivery
    const estimatedDelivery = calculateEstimatedDelivery(
      shippingAddress,
      request.shippingOption || 'standard'
    );

    // Generate order confirmation
    const response: OrderResponse = {
      orderId: order.id!.toString(),
      status: order.status,
      total: toWireMoney(order.total_amount),
      tracking_number: order.tracking_number || undefined,
      estimated_delivery: estimatedDelivery
    };

    const processingTime = Date.now() - startTime;

    return {
      success: true,
      data: response,
      context: {
        session_id: sessionId,
        agent_id: agentId,
        processing_time_ms: processingTime
      },
      recommendations: {
        bundling_opportunities: generatePostOrderRecommendations(cart),
        cost_optimization: [`Order saved $${(userContext.budget || totalMajor) - totalMajor} vs budget`]
      },
      metadata: {
        can_fulfill_percentage: 100,
        estimated_satisfaction: 95,
        next_actions: ['Track order status', 'Save order confirmation', 'Plan future purchases']
      }
    };

  } catch (error) {
    const processingTime = Date.now() - startTime;
    
    return {
      success: false,
      data: {
        orderId: '',
        status: 'failed',
        total: ZERO_TOTAL,
        estimated_delivery: ''
      },
      context: {
        session_id: sessionId,
        agent_id: agentId,
        processing_time_ms: processingTime
      },
      metadata: {
        can_fulfill_percentage: 0,
        estimated_satisfaction: 0,
        next_actions: ['Check order details', 'Verify payment method', 'Retry order placement']
      }
    };
  }
}

export async function getOrderStatus(
  orderId: string,
  agentId: string
): Promise<MCPToolResponse<OrderResponse>> {
  const startTime = Date.now();
  
  try {
    // In a real implementation, you'd fetch from orders table
    // For now, return a mock response
    const response: OrderResponse = {
      orderId,
      status: 'confirmed',
      total: Money.fromMajor(299.99, 'USD').toMach(),
      tracking_number: `BT${Date.now()}`,
      estimated_delivery: '3-5 business days'
    };

    return {
      success: true,
      data: response,
      context: {
        session_id: 'status-check',
        agent_id: agentId,
        processing_time_ms: Date.now() - startTime
      },
      metadata: {
        can_fulfill_percentage: 100,
        estimated_satisfaction: 90,
        next_actions: ['Track shipment', 'Contact customer service if needed']
      }
    };
  } catch (error) {
    return {
      success: false,
      data: {
        orderId: '',
        status: 'error',
        total: ZERO_TOTAL,
        estimated_delivery: ''
      },
      context: {
        session_id: 'status-check',
        agent_id: agentId,
        processing_time_ms: Date.now() - startTime
      },
      metadata: {
        can_fulfill_percentage: 0,
        estimated_satisfaction: 0,
        next_actions: ['Verify order ID', 'Contact support']
      }
    };
  }
}

function calculateEstimatedDelivery(address: Address, shippingOption: string): string {
  if (shippingOption === 'expedited' || shippingOption === 'overnight') {
    return '1-2 business days';
  }
  
  if (address.region === 'AK' || address.region === 'HI') {
    return '5-7 business days';
  }
  
  return '3-5 business days';
}

function formatAddressForDB(address: Address): string {
  return JSON.stringify({
    street: address.line1,
    street2: address.line2,
    city: address.city,
    state: address.region,
    postal_code: address.postal_code,
    country: address.country || 'US'
  });
}

function generatePostOrderRecommendations(cart: CartItem[]): string[] {
  const recommendations: string[] = [];

  if (cart.length === 0) return recommendations;

  const distinctProducts = new Set(cart.map(item => item.productId)).size;
  if (distinctProducts === 1) {
    recommendations.push('Build your daily ritual: add our Morning, Afternoon, and Evening blends for full-day skin support.');
  }

  // Subscriptions are a first-class BeauTeas feature — encourage recurring delivery.
  recommendations.push('Subscribe & save: set up a recurring delivery so you never run out of your blend.');

  return recommendations;
}