"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCartStore, type AppliedDiscount } from "@/lib/stores/cart-store";
import { stateStyles } from "@/lib/ui/state-styles";
import { Loader2, Tag, X } from "lucide-react";

// Type definitions for the API response
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

export default function DiscountCodeInput() {
  const [code, setCode] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { 
    items, 
    appliedDiscounts, 
    applyDiscount, 
    removeDiscount,
    calculateTotals
  } = useCartStore();

  const handleApplyDiscount = async () => {
    if (!code.trim()) {
      setError("Please enter a discount code");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Calculate cart subtotal for validation. Cart store items already hold
      // integer minor units (cents) — /api/validate-discount also operates in
      // cents (its promotion conditions/amounts are stored that way), so no
      // conversion is needed at this boundary.
      const cartSubtotal = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);

      // Prepare cart items for validation. Categories are NOT sent (BMC-198):
      // /api/validate-discount resolves `product_category` from the catalog
      // server-side (the same source the charge floor uses), so the client never
      // supplies — and can't spoof — the categories a discount gates on.
      const cartItems = items.map(item => ({
        productId: item.productId,
        quantity: item.quantity,
        price: item.price, // already integer minor units (cents)
      }));

      const response = await fetch("/api/validate-discount", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          code: code.trim(),
          cartSubtotal, // already integer minor units (cents)
          cartItems,
        }),
      });

      const result: DiscountValidationResponse = await response.json();

      if (result.valid && result.promotion) {
        // discountAmount is already integer minor units (cents); AppliedDiscount.amount is documented as such.
        let discountAmount = result.promotion.discountAmount;
        
        // Handle special case for free shipping (100% shipping discount)
        if (result.promotion.type === 'shipping' && result.promotion.discountValue === 100) {
          discountAmount = 0; // Will be calculated when shipping is selected
        }

        const discount: AppliedDiscount = {
          promotionId: result.promotion.id,
          code: code.trim().toUpperCase(),
          type: result.promotion.type,
          description: result.promotion.description,
          amount: discountAmount,
          displayName: result.promotion.displayName,
        };

        applyDiscount(discount);
        setCode("");
        setError(null);
      } else {
        setError(result.error || "Invalid discount code");
      }
    } catch (err: unknown) {
      console.error("Error applying discount:", err);
      setError("Failed to apply discount code");
    } finally {
      setIsLoading(false);
    }
  };

  const handleRemoveDiscount = (promotionId: string) => {
    removeDiscount(promotionId);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm text-text-muted">
        <Tag className="h-4 w-4" />
        <span>Have a discount code?</span>
      </div>

      {/* Applied Discounts */}
      {appliedDiscounts.length > 0 && (
        <div className="space-y-2">
          {appliedDiscounts.map((discount) => (
            <div
              key={discount.promotionId}
              className="flex items-center justify-between bg-state-success-bg border border-state-success rounded-md px-3 py-2"
            >
              <div className="flex items-center gap-2">
                <Tag className="h-4 w-4 text-state-success" />
                <span className="text-sm font-medium text-state-success">
                  {discount.code}
                </span>
                <span className="text-xs text-state-success">
                  ({discount.displayName})
                </span>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => handleRemoveDiscount(discount.promotionId)}
                className="h-6 w-6 p-0 text-state-success hover:text-state-success hover:bg-state-success-bg"
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* Discount Code Input */}
      <div className="flex gap-2">
        <Input
          type="text"
          placeholder="Enter discount code"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              handleApplyDiscount();
            }
          }}
          disabled={isLoading}
          className="flex-1 text-sm"
        />
        <Button
          onClick={handleApplyDiscount}
          disabled={isLoading || !code.trim()}
          size="sm"
          className="bg-primary-500 hover:bg-primary-600 text-text-inverse"
        >
          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            "Apply"
          )}
        </Button>
      </div>

      {/* Error Message */}
      {error && (
        <div className={stateStyles.errorBox}>
          {error}
        </div>
      )}

      {/* Demo Codes Hint */}
      {process.env.NODE_ENV === 'development' && appliedDiscounts.length === 0 && (
        <div className="text-xs text-text-muted bg-surface-light border border-border-light rounded-md px-3 py-2">
          <strong>Demo codes:</strong> SAVE20, FREESHIP, 10OFF, TOOLS30, VIP25, WELCOME15, HALFSHIP
        </div>
      )}
    </div>
  );
}