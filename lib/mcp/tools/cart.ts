import { requireOwnedSession, updateSessionCart } from '../session';
import { getProductBySlug } from '../../models/mach/products';
import { CartRequest, CartResponse, MCPToolResponse } from '../types';
import { CartItem } from '../../types/cartitem';
import { ritualBundleSuggestions } from '../catalog';
import { Money, toWireMoney } from '../../money';

// Wire-shaped zero total, reused for every failure/empty-cart response
// (BMC-164) — CartResponse.estimated_total is MACH { amount, currency,
// precision }, not a bare cents number.
const ZERO_ESTIMATED_TOTAL = toWireMoney(0);

function cartOwnershipError(
  ownership: { code: 'SESSION_NOT_FOUND' | 'SESSION_ACCESS_DENIED'; message: string },
  sessionId: string,
  agentId: string,
  processingTime: number
): MCPToolResponse<CartResponse> {
  return {
    success: false,
    data: { cart: [], total_items: 0, estimated_total: ZERO_ESTIMATED_TOTAL },
    context: {
      session_id: sessionId,
      agent_id: agentId,
      processing_time_ms: processingTime
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

export async function addToCart(
  request: CartRequest & { sessionId: string },
  sessionId: string,
  agentId: string
): Promise<MCPToolResponse<CartResponse>> {
  const startTime = Date.now();

  try {
    // Verify the calling agent owns this session before touching its cart
    const ownership = await requireOwnedSession(sessionId, agentId);
    if (!ownership.ok) {
      return cartOwnershipError(ownership, sessionId, agentId, Date.now() - startTime);
    }
    const currentCart = ownership.session.cart;

    // Get product details
    const product = await getProductBySlug(request.productId.toString());
    if (!product) {
      throw new Error('Product not found');
    }

    // Find the specific variant
    const variant = product.variants?.find(v => String(v.id) === String(request.variantId));
    if (!variant) {
      throw new Error('Product variant not found');
    }

    // Check if item already exists in cart
    const existingItemIndex = currentCart.findIndex(item => String(item.variantId) === String(request.variantId));
    
    let updatedCart: CartItem[];
    if (existingItemIndex >= 0) {
      // Update quantity of existing item
      updatedCart = [...currentCart];
      updatedCart[existingItemIndex].quantity += request.quantity || 1;
    } else {
      // Add new item to cart
      const newItem: CartItem = {
        productId: String(product.id!),
        variantId: String(request.variantId),
        quantity: request.quantity || 1,
        name: typeof product.name === 'string' ? product.name : String(product.name || ''),
        price: typeof variant.price === 'number' ? variant.price : (variant.price as any)?.amount || 0,
        primaryImageUrl: (product as any).image_url || ''
      };
      updatedCart = [...currentCart, newItem];
    }
    
    // Update session cart
    await updateSessionCart(sessionId, updatedCart);
    
    // Calculate totals
    const totalItems = updatedCart.reduce((sum, item) => sum + item.quantity, 0);
    const estimatedTotal = updatedCart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    
    const processingTime = Date.now() - startTime;
    
    return {
      success: true,
      data: {
        cart: updatedCart,
        total_items: totalItems,
        estimated_total: toWireMoney(estimatedTotal)
      },
      context: {
        session_id: sessionId,
        agent_id: agentId,
        processing_time_ms: processingTime
      },
      recommendations: {
        bundling_opportunities: generateCartBundlingOpportunities(updatedCart),
        cost_optimization: generateCartOptimizations(updatedCart, request.agent_context?.userPreferences?.budget)
      },
      metadata: {
        can_fulfill_percentage: 100,
        estimated_satisfaction: calculateCartSatisfaction(updatedCart, request.agent_context),
        next_actions: generateCartActions(updatedCart)
      }
    };
  } catch (error) {
    const processingTime = Date.now() - startTime;
    
    return {
      success: false,
      data: { cart: [], total_items: 0, estimated_total: ZERO_ESTIMATED_TOTAL },
      context: {
        session_id: sessionId,
        agent_id: agentId,
        processing_time_ms: processingTime
      },
      metadata: {
        can_fulfill_percentage: 0,
        estimated_satisfaction: 0,
        next_actions: ['Check product ID', 'Verify variant availability']
      }
    };
  }
}

export async function bulkAddToCart(
  request: { items: CartRequest[]; sessionId: string; agent_context?: any },
  sessionId: string,
  agentId: string
): Promise<MCPToolResponse<CartResponse>> {
  const startTime = Date.now();

  try {
    const ownership = await requireOwnedSession(sessionId, agentId);
    if (!ownership.ok) {
      return cartOwnershipError(ownership, sessionId, agentId, Date.now() - startTime);
    }
    let currentCart = ownership.session.cart;
    let addedItems = 0;
    let failedItems: string[] = [];
    
    // Process each item
    for (const item of request.items) {
      try {
        const product = await getProductBySlug(item.productId.toString());
        if (!product) {
          failedItems.push(`Product ${item.productId} not found`);
          continue;
        }

        const variant = product.variants?.find(v => String(v.id) === String(item.variantId));
        if (!variant) {
          failedItems.push(`Variant ${item.variantId} not found for product ${item.productId}`);
          continue;
        }

        // Check if item already exists in cart
        const existingItemIndex = currentCart.findIndex(cartItem => String(cartItem.variantId) === String(item.variantId));
        
        if (existingItemIndex >= 0) {
          // Update quantity of existing item
          currentCart[existingItemIndex].quantity += item.quantity || 1;
        } else {
          // Add new item to cart
          const newItem: CartItem = {
            productId: String(product.id!),
            variantId: String(item.variantId),
            quantity: item.quantity || 1,
            name: typeof product.name === 'string' ? product.name : String(product.name || ''),
            price: typeof variant.price === 'number' ? variant.price : (variant.price as any)?.amount || 0,
            primaryImageUrl: (product as any).image_url || ''
          };
          currentCart.push(newItem);
        }
        
        addedItems++;
      } catch (error) {
        failedItems.push(`Failed to add item ${item.productId}: ${error}`);
      }
    }
    
    // Update session cart
    await updateSessionCart(sessionId, currentCart);
    
    // Calculate totals
    const totalItems = currentCart.reduce((sum, item) => sum + item.quantity, 0);
    const estimatedTotal = currentCart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    
    const processingTime = Date.now() - startTime;
    const successRate = addedItems / request.items.length;
    
    return {
      success: failedItems.length === 0,
      data: {
        cart: currentCart,
        total_items: totalItems,
        estimated_total: toWireMoney(estimatedTotal)
      },
      context: {
        session_id: sessionId,
        agent_id: agentId,
        processing_time_ms: processingTime
      },
      recommendations: failedItems.length > 0 ? {
        alternative_sites: ['Check alternative retailers for failed items'],
        cost_optimization: generateCartOptimizations(currentCart, request.agent_context?.userPreferences?.budget)
      } : {
        bundling_opportunities: generateCartBundlingOpportunities(currentCart),
        cost_optimization: generateCartOptimizations(currentCart, request.agent_context?.userPreferences?.budget)
      },
      metadata: {
        can_fulfill_percentage: successRate * 100,
        estimated_satisfaction: calculateCartSatisfaction(currentCart, request.agent_context),
        next_actions: failedItems.length > 0 ? 
          ['Review failed items', 'Search alternatives', 'Proceed with successful items'] :
          ['Review cart', 'Proceed to checkout']
      }
    };
  } catch (error) {
    const processingTime = Date.now() - startTime;
    
    return {
      success: false,
      data: { cart: [], total_items: 0, estimated_total: ZERO_ESTIMATED_TOTAL },
      context: {
        session_id: sessionId,
        agent_id: agentId,
        processing_time_ms: processingTime
      },
      metadata: {
        can_fulfill_percentage: 0,
        estimated_satisfaction: 0,
        next_actions: ['Check bulk add request format', 'Verify session exists']
      }
    };
  }
}

export async function clearCart(
  sessionId: string,
  agentId: string
): Promise<MCPToolResponse<CartResponse>> {
  const startTime = Date.now();

  try {
    const ownership = await requireOwnedSession(sessionId, agentId);
    if (!ownership.ok) {
      return cartOwnershipError(ownership, sessionId, agentId, Date.now() - startTime);
    }

    await updateSessionCart(sessionId, []);

    const processingTime = Date.now() - startTime;
    
    return {
      success: true,
      data: {
        cart: [],
        total_items: 0,
        estimated_total: ZERO_ESTIMATED_TOTAL
      },
      context: {
        session_id: sessionId,
        agent_id: agentId,
        processing_time_ms: processingTime
      },
      metadata: {
        can_fulfill_percentage: 100,
        estimated_satisfaction: 80,
        next_actions: ['Search for products', 'Get recommendations', 'Start fresh shopping session']
      }
    };
  } catch (error) {
    const processingTime = Date.now() - startTime;
    
    return {
      success: false,
      data: { cart: [], total_items: 0, estimated_total: ZERO_ESTIMATED_TOTAL },
      context: {
        session_id: sessionId,
        agent_id: agentId,
        processing_time_ms: processingTime
      },
      metadata: {
        can_fulfill_percentage: 0,
        estimated_satisfaction: 0,
        next_actions: ['Check session ID', 'Create new session']
      }
    };
  }
}

export async function updateCart(
  request: CartRequest & { sessionId: string },
  sessionId: string,
  agentId: string
): Promise<MCPToolResponse<CartResponse>> {
  const startTime = Date.now();

  try {
    const ownership = await requireOwnedSession(sessionId, agentId);
    if (!ownership.ok) {
      return cartOwnershipError(ownership, sessionId, agentId, Date.now() - startTime);
    }
    const currentCart = ownership.session.cart;
    const itemIndex = currentCart.findIndex(item => String(item.variantId) === String(request.variantId));
    
    if (itemIndex === -1) {
      throw new Error('Item not found in cart');
    }
    
    let updatedCart = [...currentCart];
    
    if (request.quantity && request.quantity > 0) {
      // Update quantity
      updatedCart[itemIndex].quantity = request.quantity;
    } else {
      // Remove item if quantity is 0 or not provided
      updatedCart.splice(itemIndex, 1);
    }
    
    await updateSessionCart(sessionId, updatedCart);
    
    const totalItems = updatedCart.reduce((sum, item) => sum + item.quantity, 0);
    const estimatedTotal = updatedCart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    
    const processingTime = Date.now() - startTime;
    
    return {
      success: true,
      data: {
        cart: updatedCart,
        total_items: totalItems,
        estimated_total: toWireMoney(estimatedTotal)
      },
      context: {
        session_id: sessionId,
        agent_id: agentId,
        processing_time_ms: processingTime
      },
      metadata: {
        can_fulfill_percentage: 100,
        estimated_satisfaction: calculateCartSatisfaction(updatedCart, request.agent_context),
        next_actions: generateCartActions(updatedCart)
      }
    };
  } catch (error) {
    const processingTime = Date.now() - startTime;
    
    return {
      success: false,
      data: { cart: [], total_items: 0, estimated_total: ZERO_ESTIMATED_TOTAL },
      context: {
        session_id: sessionId,
        agent_id: agentId,
        processing_time_ms: processingTime
      },
      metadata: {
        can_fulfill_percentage: 0,
        estimated_satisfaction: 0,
        next_actions: ['Check cart item ID', 'Verify session exists']
      }
    };
  }
}

export async function removeFromCart(
  request: CartRequest & { sessionId: string },
  sessionId: string,
  agentId: string
): Promise<MCPToolResponse<CartResponse>> {
  return updateCart({ ...request, quantity: 0 }, sessionId, agentId);
}

export async function getCartEstimate(
  sessionId: string,
  agentId: string
): Promise<MCPToolResponse<CartResponse>> {
  const startTime = Date.now();

  try {
    const ownership = await requireOwnedSession(sessionId, agentId);
    if (!ownership.ok) {
      return cartOwnershipError(ownership, sessionId, agentId, Date.now() - startTime);
    }
    const cart = ownership.session.cart;
    const totalItems = cart.reduce((sum, item) => sum + item.quantity, 0);
    const estimatedTotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    
    const processingTime = Date.now() - startTime;
    
    return {
      success: true,
      data: {
        cart,
        total_items: totalItems,
        estimated_total: toWireMoney(estimatedTotal)
      },
      context: {
        session_id: sessionId,
        agent_id: agentId,
        processing_time_ms: processingTime
      },
      metadata: {
        can_fulfill_percentage: 100,
        estimated_satisfaction: calculateCartSatisfaction(cart, null),
        next_actions: generateCartActions(cart)
      }
    };
  } catch (error) {
    const processingTime = Date.now() - startTime;
    
    return {
      success: false,
      data: { cart: [], total_items: 0, estimated_total: ZERO_ESTIMATED_TOTAL },
      context: {
        session_id: sessionId,
        agent_id: agentId,
        processing_time_ms: processingTime
      },
      metadata: {
        can_fulfill_percentage: 0,
        estimated_satisfaction: 0,
        next_actions: ['Check session ID', 'Create new session']
      }
    };
  }
}

function generateCartBundlingOpportunities(cart: CartItem[]): string[] {
  // Suggest building/completing the daily ritual based on how many distinct
  // products are already in the cart.
  const distinctProducts = new Set(cart.map(item => item.productId)).size;
  return ritualBundleSuggestions(distinctProducts);
}

function generateCartOptimizations(cart: CartItem[], budget?: number): string[] {
  if (!budget) return [];

  const optimizations: string[] = [];
  // cart item prices are CENTS; budget (agent_context.userPreferences.budget)
  // is a plain major-unit (dollars) number — compare/format both through
  // Money instead of mixing units directly (BMC-164; this used to print
  // cents with a "$" prefix, e.g. "Cart total $2999").
  const total = Money.fromStored(
    cart.reduce((sum, item) => sum + (item.price * item.quantity), 0)
  );
  const budgetMoney = Money.fromMajor(budget);

  if (total.gt(budgetMoney)) {
    optimizations.push(`Cart total ${total.format()} exceeds budget ${budgetMoney.format()}`);
    optimizations.push('Consider reducing quantities or choosing our sample-size blends');
  } else if (total.lt(budgetMoney.applyRate(0.9))) {
    optimizations.push(`Budget allows for ${budgetMoney.subtract(total).format()} in additional blends`);
    optimizations.push('Consider adding a premium blend or gift set within remaining budget');
  }

  return optimizations;
}

function calculateCartSatisfaction(cart: CartItem[], agentContext: any): number {
  let satisfaction = 70; // Base satisfaction for having items
  
  if (cart.length === 0) return 0;
  if (cart.length >= 3) satisfaction += 10;
  if (cart.length >= 5) satisfaction += 10;
  
  // Boost for variety (different product types)
  const uniqueProducts = new Set(cart.map(item => item.productId));
  if (uniqueProducts.size > 1) satisfaction += 10;
  
  return Math.min(100, satisfaction);
}

function generateCartActions(cart: CartItem[]): string[] {
  const actions: string[] = [];
  
  if (cart.length === 0) {
    actions.push('Add products to cart');
    actions.push('Browse product recommendations');
  } else {
    actions.push('Review cart contents');
    actions.push('Proceed to checkout');
    actions.push('Get shipping estimates');
    
    if (cart.length === 1) {
      actions.push('Consider adding complementary items');
    }
  }
  
  return actions;
}