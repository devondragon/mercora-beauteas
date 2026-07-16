/**
 * Discount Code Validation API Endpoint
 * 
 * Validates promotion codes and returns discount information
 * following MACH Alliance promotion standards.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCouponInstanceByCode, validateCouponInstance } from '@/lib/models/mach/couponInstance';
import { getPromotionById, checkTimeValidity } from '@/lib/models/mach/promotions';
import { collectCatalogCategoriesByProduct } from '@/lib/services/discount-pricing';
import { enforceRateLimit, getClientIp } from '@/lib/rate-limit';
import type { Promotion } from '@/lib/types';

// Bounds for this public endpoint (BMC-180). Codes are short; a giant string is
// only ever an abuse attempt. cartItems is capped so an anonymous caller can't
// force unbounded per-item work.
const MAX_CODE_LENGTH = 128;
const MAX_CART_ITEMS = 200;

// A client-supplied cart line. `categories` is intentionally NOT accepted here
// (BMC-198): `product_category` conditions are evaluated against catalog-derived
// categories resolved server-side, the SAME source the charge floor uses
// (lib/services/discount-pricing.ts), so the storefront gate and the floor can't
// drift. Any `categories` a client sends is ignored.
interface DiscountValidationRequest {
  code: string;
  cartSubtotal?: number;
  cartItems?: Array<{
    productId: string;
    quantity: number;
    price: number;
  }>;
}

// The line shape the internal condition/amount helpers work on, with categories
// resolved authoritatively from the catalog (never from the client).
interface EvalCartItem {
  productId: string;
  categories: string[];
  quantity: number;
  price: number;
}

interface DiscountValidationResponse {
  valid: boolean;
  promotion?: {
    id: string;
    type: 'cart' | 'product' | 'shipping';
    displayName: string;
    description: string;
    discountAmount: number;
    discountType: 'percentage' | 'fixed';
    discountValue: number;
  };
  error?: string;
}

export async function POST(request: NextRequest) {
  try {
    // Public + brute-forceable (a valid code reveals a real discount). Throttle
    // per IP to blunt code-guessing and per-request table lookups.
    const limited = await enforceRateLimit('PUBLIC_RATE_LIMITER', `discount:${getClientIp(request)}`);
    if (limited) return limited;

    const body: DiscountValidationRequest = await request.json();
    const { code, cartSubtotal = 0 } = body;
    // Normalize to an array immediately — a non-array cartItems (e.g. `{}`) would
    // otherwise slip past the cap and throw later in validatePromotionConditions.
    const cartItems = Array.isArray(body.cartItems) ? body.cartItems : [];

    if (!code || typeof code !== 'string') {
      return NextResponse.json(
        { valid: false, error: 'Discount code is required' },
        { status: 400 }
      );
    }

    if (code.length > MAX_CODE_LENGTH) {
      return NextResponse.json(
        { valid: false, error: 'Invalid or expired discount code' },
        { status: 400 }
      );
    }

    if (cartItems.length > MAX_CART_ITEMS) {
      return NextResponse.json(
        { valid: false, error: 'Too many cart items' },
        { status: 400 }
      );
    }

    // Indexed lookup by (unique) code — no full-table scan. Codes are stored
    // upper-case (unique index; generation/validation enforce it), so upper-case
    // the input to match. The coupon must be currently usable (active + within
    // its validity window + under its usage limit) and its promotion active and
    // in its own window — the SAME gates the charge floor applies
    // (lib/services/discount-pricing.ts), so a code the storefront shows a
    // discount for is exactly one the floor will credit, and vice-versa (BMC-177).
    const couponInstance = await getCouponInstanceByCode(code.trim().toUpperCase());
    if (!couponInstance || !validateCouponInstance(couponInstance).canBeUsed) {
      return NextResponse.json({
        valid: false,
        error: 'Invalid or expired discount code'
      });
    }

    const promotion = await getPromotionById(couponInstance.promotion_id);
    if (!promotion || promotion.status !== 'active' || !checkTimeValidity(promotion)) {
      return NextResponse.json({
        valid: false,
        error: 'Promotion not found or expired'
      });
    }

    // Resolve each line's categories from the CATALOG (never the client, BMC-198),
    // but only when this promotion actually gates on `product_category` — so an
    // ordinary cart-subtotal promo pays no extra catalog reads (parity with the
    // charge floor's lazy resolution in lib/services/discount-pricing.ts). Both
    // the condition check and the item-level amount math below then evaluate
    // categories from the same source the floor credits against.
    const evalItems = await resolveEvalItems(promotion, cartItems);

    // Validate promotion conditions
    const isValidPromotion = validatePromotionConditions(promotion, cartSubtotal, evalItems);
    if (!isValidPromotion.valid) {
      return NextResponse.json({
        valid: false,
        error: isValidPromotion.error || 'Promotion conditions not met'
      });
    }

    // Calculate discount amount
    const discountCalculation = calculateDiscountAmount(promotion, cartSubtotal, evalItems);

    const response: DiscountValidationResponse = {
      valid: true,
      promotion: {
        id: promotion.id,
        type: promotion.type,
        displayName: typeof promotion.name === 'string' ? promotion.name : promotion.name.en,
        description: typeof promotion.description === 'string' ? promotion.description || '' : promotion.description?.en || '',
        discountAmount: discountCalculation.amount,
        discountType: discountCalculation.type,
        discountValue: discountCalculation.value
      }
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Error validating discount code:', error);
    return NextResponse.json(
      { valid: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * Whether a promotion evaluates any `product_category` condition. Only then does
 * the route resolve catalog categories (an extra read per distinct product), so a
 * cart-subtotal-only promotion stays a single indexed coupon/promotion lookup.
 * Covers the item-level branch too: `calculateDiscountAmount`'s
 * `item_percentage_discount` only narrows by category when a `product_category`
 * condition is present, so condition-presence is the exact gate for both.
 */
function promotionUsesCategories(promotion: Promotion): boolean {
  return (promotion.rules.conditions ?? []).some((c) => c.type === 'product_category');
}

/**
 * Attach each line's CATALOG categories (BMC-198). Returns items with empty
 * categories when the promotion doesn't gate on category (no catalog read needed);
 * otherwise resolves them server-side via the shared floor helper so the
 * storefront gate and the charge floor evaluate `product_category` identically.
 */
async function resolveEvalItems(
  promotion: Promotion,
  cartItems: Array<{ productId: string; quantity: number; price: number }>
): Promise<EvalCartItem[]> {
  if (!promotionUsesCategories(promotion)) {
    return cartItems.map((i) => ({ ...i, categories: [] }));
  }
  const byProduct = await collectCatalogCategoriesByProduct(cartItems.map((i) => i.productId));
  return cartItems.map((i) => ({ ...i, categories: byProduct.get(i.productId) ?? [] }));
}

/**
 * Validate promotion conditions against cart state
 */
function validatePromotionConditions(
  promotion: Promotion,
  cartSubtotal: number,
  cartItems: EvalCartItem[]
): { valid: boolean; error?: string } {
  if (!promotion.rules.conditions || promotion.rules.conditions.length === 0) {
    return { valid: true };
  }

  for (const condition of promotion.rules.conditions) {
    switch (condition.type) {
      case 'cart_subtotal':
        if (condition.operator === 'gte') {
          const minAmount = typeof condition.value === 'object' && condition.value?.amount 
            ? condition.value.amount 
            : (condition.value as number) || 0;
          if (cartSubtotal < minAmount) {
            return {
              valid: false,
              error: `Minimum order of $${(minAmount / 100).toFixed(2)} required`
            };
          }
        }
        break;

      case 'product_category':
        if (condition.operator === 'in') {
          const requiredCategories = Array.isArray(condition.value) ? condition.value : [condition.value];
          const hasRequiredCategory = cartItems.some(item =>
            item.categories.some(cat => requiredCategories.includes(cat))
          );
          if (!hasRequiredCategory) {
            return {
              valid: false,
              error: 'This discount requires specific products in your cart'
            };
          }
        }
        break;

      default:
        // Skip unknown condition types for now
        break;
    }
  }

  return { valid: true };
}

/**
 * Calculate discount amount based on promotion rules
 */
function calculateDiscountAmount(
  promotion: Promotion,
  cartSubtotal: number,
  cartItems: EvalCartItem[]
): { amount: number; type: 'percentage' | 'fixed'; value: number } {
  const action = promotion.rules.actions[0]; // Take first action for simplicity
  
  switch (action.type) {
    case 'percentage_discount':
      const percentageValue = action.value as number;
      return {
        amount: Math.round(cartSubtotal * (percentageValue / 100)),
        type: 'percentage',
        value: percentageValue
      };

    case 'fixed_discount':
      const fixedValue = (action.value as any)?.amount || action.value;
      return {
        amount: Math.min(fixedValue, cartSubtotal), // Don't exceed cart total
        type: 'fixed',
        value: fixedValue
      };

    case 'shipping_percentage_discount':
      const shippingPercentage = action.value as number;
      // For shipping discounts, we'll return a placeholder amount
      // The actual calculation will happen in the frontend when shipping is known
      return {
        amount: shippingPercentage === 100 ? 999999 : 0, // Special case for free shipping
        type: 'percentage',
        value: shippingPercentage
      };

    case 'shipping_fixed_discount':
      const shippingFixed = (action.value as any)?.amount || action.value;
      return {
        amount: shippingFixed,
        type: 'fixed',
        value: shippingFixed
      };

    case 'item_percentage_discount':
      const itemPercentageValue = action.value as number;
      // Calculate discount on qualifying items only
      let itemDiscountAmount = 0;
      
      // For item-level discounts, we need to check which items qualify
      // This is a simplified approach - in practice you'd want more sophisticated rules
      for (const item of cartItems) {
        // Check if item qualifies based on promotion conditions
        let itemQualifies = true;
        
        // Check category conditions if they exist
        if (promotion.rules.conditions) {
          for (const condition of promotion.rules.conditions) {
            if (condition.type === 'product_category' && condition.operator === 'in') {
              const requiredCategories = Array.isArray(condition.value) ? condition.value : [condition.value];
              if (!item.categories.some(cat => requiredCategories.includes(cat))) {
                itemQualifies = false;
                break;
              }
            }
          }
        }
        
        if (itemQualifies) {
          itemDiscountAmount += Math.round((item.price * item.quantity) * (itemPercentageValue / 100));
        }
      }
      
      return {
        amount: itemDiscountAmount,
        type: 'percentage',
        value: itemPercentageValue
      };

    default:
      return {
        amount: 0,
        type: 'fixed',
        value: 0
      };
  }
}