import { createOrder, markOrderPaid, getOrderByPaymentIntentId } from '../../models/mach/orders';
import { requireOwnedSession } from '../session';
import { OrderRequest, OrderResponse, MCPToolResponse } from '../types';
import { enhanceUserContext } from '../context';
import { MACHAddress as Address } from '../../types/mach/Address';
import { CartItem } from '../../types/cartitem';
import { retrievePaymentIntent } from '../../stripe';
import { verifyOrderChargeSufficient } from '../../services/order-pricing';

/**
 * Compute shipping/tax/total for an order from a goods subtotal (dollars) and a
 * destination address, using the same rules the MCP order path applies. Shared
 * so create_payment_intent charges exactly what place_order will expect (BMC-132).
 */
export function computeOrderTotals(
  subtotal: number,
  address: Address
): { subtotal: number; shipping: number; tax: number; total: number } {
  const shipping = calculateShipping(address, subtotal);
  const tax = calculateTax(subtotal, address);
  return { subtotal, shipping, tax, total: subtotal + shipping + tax };
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
    data: { orderId: '', status: 'failed', total: 0, estimated_delivery: '' },
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
          total: 0,
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
          total: 0,
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
    
    // Calculate order totals
    const subtotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const shipping = calculateShipping(request.shippingAddress, subtotal);
    const tax = calculateTax(subtotal, request.shippingAddress);
    const total = subtotal + shipping + tax;

    // Validate order limits if agent has budget constraints
    if (userContext.budget && total > userContext.budget) {
      return {
        success: false,
        data: {
          orderId: '',
          status: 'budget_exceeded',
          total: total,
          estimated_delivery: ''
        },
        context: {
          session_id: sessionId,
          agent_id: agentId,
          processing_time_ms: Date.now() - startTime
        },
        recommendations: {
          cost_optimization: [
            `Order total $${total} exceeds budget $${userContext.budget}`,
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

    // Create order using existing order system. createOrder always persists as
    // pending/unpaid; we then mark it paid via the verified-payment path below.
    // The id is DERIVED FROM THE PAYMENTINTENT so a duplicate insert (a concurrent
    // double-submit that slips past the early lookup above) collides on the PK and
    // fails atomically — one payment can fund at most one order (BMC-132).
    const orderData = {
      id: `MCP-${paymentIntentId}`,
      customer_id: userContext.userId || agentId,
      total_amount: { amount: total, currency: 'USD' },
      shipping_address: request.shippingAddress,
      billing_address: request.billingAddress || request.shippingAddress,
      items: cart.map(item => ({
        product_id: item.productId,
        variant_id: item.variantId,
        sku: item.variantId || `${item.productId}-default`,
        quantity: item.quantity,
        unit_price: { amount: item.price, currency: 'USD' },
        total_price: { amount: item.price * item.quantity, currency: 'USD' },
        product_name: item.name
      })),
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

    let createdOrder;
    try {
      createdOrder = await createOrder(orderData);
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

    // Payment is verified — move the order to paid/processing via the same path
    // the storefront and Stripe webhook use.
    const order = (await markOrderPaid(createdOrder.id!, {
      status: 'processing',
      notes: `Paid via MCP agent ${agentId} (PaymentIntent ${paymentIntentId})`,
    })) ?? createdOrder;

    // Calculate estimated delivery
    const estimatedDelivery = calculateEstimatedDelivery(
      request.shippingAddress,
      request.shippingOption || 'standard'
    );

    // Generate order confirmation
    const response: OrderResponse = {
      orderId: order.id!.toString(),
      status: order.status,
      total: typeof order.total_amount === 'object' ? (order.total_amount as any).amount : order.total_amount,
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
        cost_optimization: [`Order saved $${(userContext.budget || total) - total} vs budget`]
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
        total: 0,
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
      total: 299.99,
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
        total: 0,
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

function calculateShipping(address: Address, subtotal: number): number {
  // Free shipping over $100
  if (subtotal >= 100) return 0;
  
  // Alaska/Hawaii surcharge
  if (address.region === 'AK' || address.region === 'HI') {
    return 19.99;
  }
  
  // Standard shipping
  return 9.99;
}

function calculateTax(subtotal: number, address: Address): number {
  // Simple tax calculation - in production, use proper tax service
  const taxRates: Record<string, number> = {
    'CA': 0.0875, // California
    'NY': 0.08,   // New York
    'TX': 0.0625, // Texas
    'FL': 0.06    // Florida
  };
  
  const rate = taxRates[address.region || ''] || 0.05; // Default 5%
  return subtotal * rate;
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