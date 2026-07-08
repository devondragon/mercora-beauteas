import { MCPToolResponse } from '../types';
import { CartItem } from '../../types/cartitem';
import { normalizeAddress } from './order';
import { Money, toWireMoney } from '../../money';
import type { MachMoney } from '../../money';

export interface ShippingOption {
  id: string;
  name: string;
  description: string;
  estimated_days: string;
  // MACH wire shape (BMC-164 final review fix) — see lib/money/wire.ts
  // toWireMoney, consistent with estimated_cost/estimated_total/total in
  // assess.ts/cart.ts/order.ts.
  price: MachMoney;
  carrier: string;
}

export interface ShippingRequest {
  address: {
    line1: string;
    line2?: string;
    city: string;
    region: string;
    postal_code?: string;
    country?: string;
  };
  cart?: CartItem[];
  agent_context?: any;
}

export interface ShippingResponse {
  shipping_options: ShippingOption[];
  default_option: string;
  total_weight?: number;
  restrictions?: string[];
}

export async function getShippingOptions(
  request: ShippingRequest,
  sessionId: string
): Promise<MCPToolResponse<ShippingResponse>> {
  const startTime = Date.now();
  
  try {
    const { cart = [] } = request;
    // Normalize to MACH shape so both old (street/state) and new (line1/region)
    // agent inputs are handled correctly.
    const address = normalizeAddress(request.address);

    // Calculate total weight and shipping cost factors. cart item prices are
    // CENTS (lib/types/cartitem.ts) — cartTotal is built as a Money in minor
    // units so every downstream comparison/threshold goes through Money
    // instead of a raw cents number compared against a dollar literal
    // (BMC-164 final review fix — was `cartTotal >= 75`, i.e. "free shipping
    // over $0.75").
    const totalWeight = cart.reduce((sum, item) => sum + (item.quantity * 2), 0); // Assume 2lbs per item average
    const cartTotal = Money.fromMinor(
      cart.reduce((sum, item) => sum + (item.price * item.quantity), 0),
      'USD'
    );

    // Determine shipping zone based on region
    const zone = getShippingZone(address.region ?? '', address.country || 'US');

    // Generate shipping options based on zone and cart
    const shippingOptions: ShippingOption[] = [];

    // Standard shipping
    const standardCost = calculateStandardShipping(zone, totalWeight, cartTotal);
    shippingOptions.push({
      id: 'standard',
      name: 'Standard Shipping',
      description: 'USPS Ground - 5-7 business days',
      estimated_days: '5-7 business days',
      price: toWireMoney(standardCost.toMinorUnits(), standardCost.currency),
      carrier: 'USPS'
    });

    // Expedited shipping
    const expeditedCost = calculateExpeditedShipping(zone, totalWeight);
    shippingOptions.push({
      id: 'expedited',
      name: 'Expedited Shipping',
      description: 'UPS 2-Day - 2-3 business days',
      estimated_days: '2-3 business days',
      price: toWireMoney(expeditedCost.toMinorUnits(), expeditedCost.currency),
      carrier: 'UPS'
    });

    // Overnight shipping (only for continental US)
    if (zone === 'continental') {
      const overnightCost = calculateOvernightShipping(totalWeight);
      shippingOptions.push({
        id: 'overnight',
        name: 'Overnight Shipping',
        description: 'FedEx Next Day - 1 business day',
        estimated_days: '1 business day',
        price: toWireMoney(overnightCost.toMinorUnits(), overnightCost.currency),
        carrier: 'FedEx'
      });
    }
    
    // Check for shipping restrictions
    const restrictions = checkShippingRestrictions(address, cart);
    
    const processingTime = Date.now() - startTime;
    
    return {
      success: true,
      data: {
        shipping_options: shippingOptions,
        default_option: 'standard',
        total_weight: totalWeight,
        restrictions
      },
      context: {
        session_id: sessionId,
        agent_id: request.agent_context?.agentId || 'unknown',
        processing_time_ms: processingTime
      },
      recommendations: {
        cost_optimization: generateShippingRecommendations(shippingOptions, cartTotal, request.agent_context?.userPreferences?.budget),
        bundling_opportunities: cart.length > 0 ? ['Consider bulk orders to reduce per-item shipping cost'] : []
      },
      metadata: {
        can_fulfill_percentage: restrictions.length === 0 ? 100 : 75,
        estimated_satisfaction: calculateShippingSatisfaction(shippingOptions, restrictions),
        next_actions: restrictions.length > 0 ? 
          ['Review shipping restrictions', 'Consider alternative items'] :
          ['Select shipping option', 'Proceed to checkout']
      }
    };
  } catch (error) {
    const processingTime = Date.now() - startTime;
    
    return {
      success: false,
      data: {
        shipping_options: [],
        default_option: 'standard',
        restrictions: ['Unable to calculate shipping options']
      },
      context: {
        session_id: sessionId,
        agent_id: request.agent_context?.agentId || 'unknown',
        processing_time_ms: processingTime
      },
      metadata: {
        can_fulfill_percentage: 0,
        estimated_satisfaction: 0,
        next_actions: ['Verify shipping address', 'Check cart contents', 'Contact support']
      }
    };
  }
}

function getShippingZone(state: string, country: string): string {
  if (country !== 'US') {
    return 'international';
  }
  
  if (['AK', 'HI'].includes(state.toUpperCase())) {
    return 'extended';
  }
  
  return 'continental';
}

function calculateStandardShipping(zone: string, weight: number, cartTotal: Money): Money {
  // Free shipping over $75
  const freeShippingThreshold = Money.fromMajor(75, cartTotal.currency);
  if (cartTotal.gte(freeShippingThreshold)) {
    return Money.zero(cartTotal.currency);
  }

  let baseCost = Money.zero(cartTotal.currency);
  switch (zone) {
    case 'continental':
      baseCost = Money.fromMajor(8.99, cartTotal.currency);
      break;
    case 'extended':
      baseCost = Money.fromMajor(19.99, cartTotal.currency);
      break;
    case 'international':
      baseCost = Money.fromMajor(29.99, cartTotal.currency);
      break;
  }

  // Add weight-based surcharge for heavy orders
  if (weight > 10) {
    baseCost = baseCost.add(Money.fromMajor(Math.ceil((weight - 10) / 5) * 5, cartTotal.currency));
  }

  return baseCost;
}

function calculateExpeditedShipping(zone: string, weight: number): Money {
  let baseCost = Money.zero();
  switch (zone) {
    case 'continental':
      baseCost = Money.fromMajor(19.99);
      break;
    case 'extended':
      baseCost = Money.fromMajor(39.99);
      break;
    case 'international':
      baseCost = Money.fromMajor(59.99);
      break;
  }

  // Weight surcharge
  if (weight > 5) {
    baseCost = baseCost.add(Money.fromMajor(Math.ceil((weight - 5) / 3) * 8));
  }

  return baseCost;
}

function calculateOvernightShipping(weight: number): Money {
  let baseCost = Money.fromMajor(39.99);

  // Higher weight surcharge for overnight
  if (weight > 3) {
    baseCost = baseCost.add(Money.fromMajor(Math.ceil((weight - 3) / 2) * 12));
  }

  return baseCost;
}

function checkShippingRestrictions(address: any, _cart: CartItem[]): string[] {
  const restrictions: string[] = [];

  // Organic tea blends carry no hazmat restrictions. International orders may
  // still need customs documentation for food/botanical products.
  if (address.country && address.country !== 'US') {
    restrictions.push('International shipping may require additional customs documentation for food and botanical products');
  }

  return restrictions;
}

function generateShippingRecommendations(options: ShippingOption[], cartTotal: Money, budget?: number): string[] {
  const recommendations: string[] = [];

  // Free shipping threshold
  const freeShippingThreshold = Money.fromMajor(75, cartTotal.currency);
  const nearFreeShippingThreshold = Money.fromMajor(60, cartTotal.currency);
  if (cartTotal.lt(freeShippingThreshold) && cartTotal.gte(nearFreeShippingThreshold)) {
    recommendations.push(`Add ${freeShippingThreshold.subtract(cartTotal).format()} to cart for free standard shipping`);
  }

  // Budget-based recommendations
  if (budget) {
    const shippingBudget = Money.fromMajor(budget).applyRate(0.1); // 10% of budget for shipping
    const affordableOptions = options.filter(opt =>
      Money.fromMajor(opt.price.amount, opt.price.currency).lte(shippingBudget)
    );
    if (affordableOptions.length > 0) {
      const fastest = affordableOptions.reduce((prev, curr) =>
        parseInt(prev.estimated_days) < parseInt(curr.estimated_days) ? prev : curr
      );
      recommendations.push(`Within shipping budget: ${fastest.name} recommended`);
    } else {
      recommendations.push('Consider standard shipping to stay within budget');
    }
  }

  return recommendations;
}

function calculateShippingSatisfaction(options: ShippingOption[], restrictions: string[]): number {
  let satisfaction = 80; // Base satisfaction for having shipping options
  
  if (restrictions.length > 0) {
    satisfaction -= restrictions.length * 10;
  }
  
  if (options.length >= 3) {
    satisfaction += 10; // Bonus for having multiple options
  }
  
  if (options.some(opt => opt.price.amount === 0)) {
    satisfaction += 10; // Bonus for free shipping
  }
  
  return Math.max(0, Math.min(100, satisfaction));
}