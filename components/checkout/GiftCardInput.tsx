"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCartStore } from "@/lib/stores/cart-store";
import { Loader2, Gift, X } from "lucide-react";

interface GiftCardValidationResponse {
  valid: boolean;
  code?: string;
  balance?: number; // cents
  currency?: string;
  error?: string;
}

export default function GiftCardInput() {
  const [code, setCode] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { appliedGiftCard, applyGiftCard, removeGiftCard } = useCartStore();

  const handleApply = async () => {
    if (!code.trim()) {
      setError("Please enter a gift card code");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/gift-cards/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.trim() }),
      });

      const result: GiftCardValidationResponse = await response.json();

      if (result.valid && result.code && typeof result.balance === "number") {
        applyGiftCard({ code: result.code, balance: result.balance / 100 });
        setCode("");
        setError(null);
      } else {
        setError(result.error || "Invalid gift card code");
      }
    } catch (err: unknown) {
      console.error("Error applying gift card:", err);
      setError("Failed to apply gift card");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm text-gray-600">
        <Gift className="h-4 w-4" />
        <span>Have a gift card?</span>
      </div>

      {appliedGiftCard ? (
        <div className="flex items-center justify-between bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
          <div className="flex items-center gap-2">
            <Gift className="h-4 w-4 text-amber-600" />
            <span className="text-sm font-medium text-amber-700">
              {appliedGiftCard.code}
            </span>
            <span className="text-xs text-amber-600">
              (${appliedGiftCard.balance.toFixed(2)} available)
            </span>
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={removeGiftCard}
            className="h-6 w-6 p-0 text-amber-600 hover:text-amber-700 hover:bg-amber-100"
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      ) : (
        <div className="flex gap-2">
          <Input
            type="text"
            placeholder="Enter gift card code"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                handleApply();
              }
            }}
            disabled={isLoading}
            className="flex-1 text-sm"
          />
          <Button
            onClick={handleApply}
            disabled={isLoading || !code.trim()}
            size="sm"
            className="bg-amber-500 hover:bg-amber-600 text-white"
          >
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Apply"}
          </Button>
        </div>
      )}

      {error && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
          {error}
        </div>
      )}
    </div>
  );
}
