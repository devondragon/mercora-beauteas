import {
  MCPToolResponse,
  PaymentIntentCreateRequest,
  PaymentIntentCreateResponse,
} from '../types';
import { CartItem } from '../../types/cartitem';
import { requireOwnedSession } from '../session';
import { computeCatalogSubtotalCents } from '../../services/order-pricing';
import { computeOrderTotals, normalizeAddress } from './order';
import { Money } from '../../money';
import {
  createPaymentIntent,
  formatAmountForStripe,
  isStripeConfigured,
} from '../../stripe';

export interface PaymentMethod {
  id: string;
  type: 'credit_card' | 'paypal' | 'bank_transfer' | 'agent_processed';
  name: string;
  description: string;
  processing_fee: number;
  available: boolean;
  requirements?: string[];
}

export interface PaymentValidationRequest {
  payment_method: string;
  billing_address?: {
    line1?: string;
    line2?: string;
    city?: string;
    region?: string;
    postal_code?: string;
    country?: string;
  };
  cart: CartItem[];
  total_amount: number;
  agent_context?: any;
}

export interface PaymentValidationResponse {
  valid: boolean;
  payment_methods: PaymentMethod[];
  recommended_method: string;
  processing_fee: number;
  estimated_processing_time: string;
  requirements_met: boolean;
  missing_requirements?: string[];
}

export async function validatePayment(
  request: PaymentValidationRequest,
  sessionId: string
): Promise<MCPToolResponse<PaymentValidationResponse>> {
  const startTime = Date.now();
  
  try {
    const { payment_method, billing_address, cart, total_amount } = request;
    
    // Get available payment methods
    const paymentMethods = getAvailablePaymentMethods(total_amount, billing_address?.country || 'US');
    
    // Validate the specific payment method
    const selectedMethod = paymentMethods.find(method => method.id === payment_method);
    const isValid = selectedMethod ? selectedMethod.available : false;
    
    // Check requirements
    const requirementCheck = checkPaymentRequirements(payment_method, billing_address, total_amount);
    
    // Calculate processing fee
    const processingFee = selectedMethod ? selectedMethod.processing_fee : 0;
    
    // Determine recommended method
    const recommendedMethod = getRecommendedPaymentMethod(paymentMethods, total_amount, request.agent_context);
    
    const processingTime = Date.now() - startTime;
    
    return {
      success: true,
      data: {
        valid: isValid && requirementCheck.met,
        payment_methods: paymentMethods,
        recommended_method: recommendedMethod.id,
        processing_fee: processingFee,
        estimated_processing_time: selectedMethod?.type === 'agent_processed' ? 'Instant' : '1-3 business days',
        requirements_met: requirementCheck.met,
        missing_requirements: requirementCheck.missing
      },
      context: {
        session_id: sessionId,
        agent_id: request.agent_context?.agentId || 'unknown',
        processing_time_ms: processingTime
      },
      recommendations: {
        cost_optimization: generatePaymentRecommendations(paymentMethods, total_amount, request.agent_context?.userPreferences?.budget),
        alternative_sites: !isValid ? ['Consider alternative payment processors', 'Check agent payment capabilities'] : []
      },
      metadata: {
        can_fulfill_percentage: isValid ? 100 : 60,
        estimated_satisfaction: calculatePaymentSatisfaction(isValid, paymentMethods, requirementCheck.met),
        next_actions: generatePaymentActions(isValid, requirementCheck.met, requirementCheck.missing)
      }
    };
  } catch (error) {
    const processingTime = Date.now() - startTime;
    
    return {
      success: false,
      data: {
        valid: false,
        payment_methods: [],
        recommended_method: 'agent_processed',
        processing_fee: 0,
        estimated_processing_time: 'Unknown',
        requirements_met: false,
        missing_requirements: ['Payment validation failed']
      },
      context: {
        session_id: sessionId,
        agent_id: request.agent_context?.agentId || 'unknown',
        processing_time_ms: processingTime
      },
      metadata: {
        can_fulfill_percentage: 0,
        estimated_satisfaction: 0,
        next_actions: ['Verify payment information', 'Contact support', 'Try alternative payment method']
      }
    };
  }
}

/**
 * Mint a Stripe PaymentIntent for the caller's current MCP cart (BMC-132).
 *
 * The amount is computed server-side from the D1 catalog (never from client- or
 * session-supplied prices) and the PaymentIntent is stamped with
 * { agentId, sessionId } metadata so place_order can verify the payment is bound
 * to this exact caller and session before creating an order. The agent completes
 * payment with the returned client secret, then calls place_order with the
 * returned paymentIntentId.
 */
export async function createAgentPaymentIntent(
  request: PaymentIntentCreateRequest,
  sessionId: string,
  agentId: string
): Promise<MCPToolResponse<PaymentIntentCreateResponse>> {
  const startTime = Date.now();

  const fail = (
    code: string,
    message: string,
    nextActions: string[]
  ): MCPToolResponse<PaymentIntentCreateResponse> => ({
    success: false,
    data: { clientSecret: null, paymentIntentId: '', amount: 0, currency: 'USD' },
    context: { session_id: sessionId, agent_id: agentId, processing_time_ms: Date.now() - startTime },
    error: { code, message },
    metadata: { can_fulfill_percentage: 0, estimated_satisfaction: 0, next_actions: nextActions },
  });

  try {
    // Verify the calling agent owns this session before pricing/charging its cart.
    const ownership = await requireOwnedSession(sessionId, agentId);
    if (!ownership.ok) {
      return fail(
        ownership.code,
        ownership.message,
        ownership.code === 'SESSION_NOT_FOUND'
          ? ['Create a new session', 'Verify session ID']
          : ['Use a session created by this agent']
      );
    }

    const cart = ownership.session.cart;
    if (cart.length === 0) {
      return fail('EMPTY_CART', 'Cannot create a payment for an empty cart.', ['Add items to cart first']);
    }

    if (!isStripeConfigured()) {
      console.error('[mcp create_payment_intent] STRIPE_SECRET_KEY is not configured in this runtime.');
      return fail('STRIPE_NOT_CONFIGURED', 'Payments are temporarily unavailable. Please try again later.', ['Retry later']);
    }

    // Price the goods from the catalog — the authoritative amount, immune to any
    // session cart price tampering.
    const { subtotalCents, errors } = await computeCatalogSubtotalCents(
      cart.map(item => ({
        product_id: item.productId,
        variant_id: item.variantId,
        quantity: item.quantity,
      }))
    );
    if (errors.length) {
      console.warn(`[mcp create_payment_intent] catalog pricing errors: ${errors.join('; ')}`);
      return fail('CATALOG_PRICE_UNAVAILABLE', 'One or more items are no longer available. Refresh your cart and try again.', ['Refresh cart', 'Retry']);
    }

    // Normalize to MACH shape so shipping/tax read `region` (the MCP schema sends
    // flat `state`/`street`). place_order re-derives and re-verifies this same
    // total against the destination, so the amount charged here matches the gate.
    // subtotalCents is already MINOR units — Money.fromMinor carries it straight
    // through computeOrderTotals with no /100·*100 boundary conversion (BMC-164).
    const address = normalizeAddress(request.shippingAddress);
    const { total: totalMoney } = computeOrderTotals(Money.fromMinor(subtotalCents, 'USD'), address);
    // formatAmountForStripe and this tool's response `amount` field operate in
    // major units (dollars) — unchanged Stripe/response boundary, only the
    // shipping/tax math upstream of it is now Money-typed.
    const total = totalMoney.toMach().amount;

    // Stripe rejects charges under $0.50.
    if (total < 0.5) {
      return fail('AMOUNT_TOO_LOW', 'Order total must be at least $0.50.', ['Add more items to cart']);
    }

    const paymentIntent = await createPaymentIntent({
      amount: formatAmountForStripe(total),
      currency: 'usd',
      // Headless agent flow: no browser is present to complete a redirect, so
      // restrict Stripe to non-redirect methods. Enabling redirect methods
      // would require a return_url at confirmation that an agent can't satisfy.
      automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
      // Binding: place_order requires BOTH to match the authenticated caller.
      metadata: { agentId, sessionId },
      description: `BeauTeas MCP order — agent ${agentId}`,
    });

    return {
      success: true,
      data: {
        clientSecret: (paymentIntent as any).client_secret ?? null,
        paymentIntentId: (paymentIntent as any).id,
        amount: total,
        currency: 'USD',
      },
      context: { session_id: sessionId, agent_id: agentId, processing_time_ms: Date.now() - startTime },
      metadata: {
        can_fulfill_percentage: 100,
        estimated_satisfaction: 90,
        next_actions: ['Complete payment with the client secret', 'Call place_order with the paymentIntentId'],
      },
    };
  } catch (error) {
    console.error('[mcp create_payment_intent] failed:', error);
    return fail('PAYMENT_INTENT_ERROR', 'Failed to create payment intent.', ['Retry', 'Contact support']);
  }
}

function getAvailablePaymentMethods(amount: number, country: string): PaymentMethod[] {
  const methods: PaymentMethod[] = [
    {
      id: 'agent_processed',
      type: 'agent_processed',
      name: 'Agent Processed Payment',
      description: 'Payment handled by your personal shopping agent',
      processing_fee: 0,
      available: true,
      requirements: ['Valid agent credentials', 'Pre-authorized payment method']
    }
  ];
  
  // Credit card processing (for direct payments)
  if (amount >= 5 && amount <= 5000) {
    methods.push({
      id: 'credit_card',
      type: 'credit_card',
      name: 'Credit/Debit Card',
      description: 'Direct card processing via Stripe',
      processing_fee: Math.max(0.30, amount * 0.029), // Stripe-like fees
      available: true,
      requirements: ['Valid billing address', 'Card verification']
    });
  }
  
  // PayPal (US only for now)
  if (country === 'US' && amount >= 1) {
    methods.push({
      id: 'paypal',
      type: 'paypal',
      name: 'PayPal',
      description: 'PayPal checkout integration',
      processing_fee: amount * 0.0349, // PayPal merchant fees
      available: true,
      requirements: ['PayPal account', 'Email verification']
    });
  }
  
  // Bank transfer for larger amounts
  if (amount >= 100) {
    methods.push({
      id: 'bank_transfer',
      type: 'bank_transfer',
      name: 'Bank Transfer (ACH)',
      description: 'Direct bank account transfer',
      processing_fee: 0.50,
      available: country === 'US',
      requirements: ['Valid bank account', 'Identity verification', '3-5 business days processing time']
    });
  }
  
  return methods;
}

function checkPaymentRequirements(
  paymentMethod: string,
  billingAddress?: any,
  amount?: number
): { met: boolean; missing: string[] } {
  const missing: string[] = [];
  
  switch (paymentMethod) {
    case 'credit_card':
      if (!billingAddress) {
        missing.push('Billing address required for credit card payments');
      }
      if (amount && amount < 5) {
        missing.push('Minimum $5.00 required for credit card payments');
      }
      if (amount && amount > 5000) {
        missing.push('Credit card payments limited to $5,000 per transaction');
      }
      break;
      
    case 'paypal':
      if (!billingAddress?.country || billingAddress.country !== 'US') {
        missing.push('PayPal currently only available for US customers');
      }
      break;
      
    case 'bank_transfer':
      if (amount && amount < 100) {
        missing.push('Minimum $100.00 required for bank transfer');
      }
      if (!billingAddress?.country || billingAddress.country !== 'US') {
        missing.push('ACH transfers only available for US bank accounts');
      }
      break;
      
    case 'agent_processed':
      // Agent processed payments have minimal requirements
      break;
      
    default:
      missing.push(`Unknown payment method: ${paymentMethod}`);
  }
  
  return {
    met: missing.length === 0,
    missing
  };
}

function getRecommendedPaymentMethod(
  methods: PaymentMethod[],
  amount: number,
  agentContext?: any
): PaymentMethod {
  // Always prefer agent processed for seamless agent experience
  const agentProcessed = methods.find(m => m.id === 'agent_processed');
  if (agentProcessed?.available) {
    return agentProcessed;
  }
  
  // For small amounts, prefer credit card
  if (amount < 50) {
    const creditCard = methods.find(m => m.id === 'credit_card' && m.available);
    if (creditCard) return creditCard;
  }
  
  // For larger amounts, consider bank transfer to save on fees
  if (amount > 200) {
    const bankTransfer = methods.find(m => m.id === 'bank_transfer' && m.available);
    if (bankTransfer) return bankTransfer;
  }
  
  // Default to first available method
  return methods.find(m => m.available) || methods[0];
}

function generatePaymentRecommendations(methods: PaymentMethod[], amount: number, budget?: number): string[] {
  const recommendations: string[] = [];
  
  // Fee optimization
  const lowestFeeMethod = methods
    .filter(m => m.available)
    .reduce((prev, curr) => prev.processing_fee < curr.processing_fee ? prev : curr);
    
  if (lowestFeeMethod.processing_fee > 0) {
    recommendations.push(`Save on fees: ${lowestFeeMethod.name} has lowest processing cost ($${lowestFeeMethod.processing_fee.toFixed(2)})`);
  }
  
  // Budget considerations
  if (budget) {
    const totalWithFee = amount + lowestFeeMethod.processing_fee;
    if (totalWithFee > budget) {
      recommendations.push(`Payment fees will exceed budget by $${(totalWithFee - budget).toFixed(2)}`);
    }
  }
  
  // Speed recommendations
  const agentMethod = methods.find(m => m.id === 'agent_processed' && m.available);
  if (agentMethod) {
    recommendations.push('For fastest processing, use agent-handled payment');
  }
  
  return recommendations;
}

function calculatePaymentSatisfaction(isValid: boolean, methods: PaymentMethod[], requirementsMet: boolean): number {
  let satisfaction = 60; // Base satisfaction
  
  if (isValid && requirementsMet) {
    satisfaction += 30;
  }
  
  // Bonus for having multiple payment options
  const availableMethods = methods.filter(m => m.available).length;
  satisfaction += Math.min(10, availableMethods * 2);
  
  // Bonus for agent processed availability
  if (methods.some(m => m.id === 'agent_processed' && m.available)) {
    satisfaction += 10;
  }
  
  return Math.min(100, satisfaction);
}

function generatePaymentActions(isValid: boolean, requirementsMet: boolean, missingRequirements?: string[]): string[] {
  const actions: string[] = [];
  
  if (!isValid) {
    actions.push('Select valid payment method');
    actions.push('Check available payment options');
  }
  
  if (!requirementsMet && missingRequirements) {
    actions.push('Complete missing payment requirements');
    missingRequirements.forEach(req => {
      actions.push(`Address: ${req}`);
    });
  }
  
  if (isValid && requirementsMet) {
    actions.push('Proceed with payment processing');
    actions.push('Review order total and fees');
  }
  
  return actions;
}