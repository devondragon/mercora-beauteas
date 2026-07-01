"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/ui/toggle-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { stateStyles } from "@/lib/ui/state-styles";
import type { SubscriptionPlan, SubscriptionFrequency } from "@/lib/types/subscription";

const FREQUENCY_LABELS: Record<SubscriptionFrequency, string> = {
  biweekly: "Every 2 weeks",
  monthly: "Monthly",
  bimonthly: "Every 2 months",
};

interface SubscriptionToggleProps {
  plans: SubscriptionPlan[];
  variantPriceInCents: number;
  compareAtPriceInCents?: number;
  productSlug: string;
  available: boolean;
  onAddToCart: () => void;
}

export default function SubscriptionToggle({
  plans,
  variantPriceInCents,
  compareAtPriceInCents,
  productSlug,
  available,
  onAddToCart,
}: SubscriptionToggleProps) {
  const router = useRouter();

  const [purchaseMode, setPurchaseMode] = useState<"one-time" | "subscribe">(
    "one-time"
  );

  // Default to monthly plan if available, otherwise first plan
  const defaultPlanId = useMemo(() => {
    const monthly = plans.find((p) => p.frequency === "monthly");
    return monthly?.id ?? plans[0]?.id ?? "";
  }, [plans]);

  const [selectedPlanId, setSelectedPlanId] = useState(defaultPlanId);

  const selectedPlan = useMemo(
    () => plans.find((p) => p.id === selectedPlanId) ?? plans[0],
    [plans, selectedPlanId]
  );

  const discountedPrice = useMemo(() => {
    if (!selectedPlan) return variantPriceInCents;
    return Math.round(
      variantPriceInCents * (1 - selectedPlan.discount_percent / 100)
    );
  }, [variantPriceInCents, selectedPlan]);

  // If no plans, render nothing -- product only supports one-time purchase
  if (plans.length === 0) return null;

  const onSale =
    compareAtPriceInCents && compareAtPriceInCents > variantPriceInCents;

  return (
    <div className="space-y-4">
      {/* Purchase Mode Toggle */}
      <ToggleGroup
        type="single"
        value={purchaseMode}
        onValueChange={(value) => {
          if (value) setPurchaseMode(value as "one-time" | "subscribe");
        }}
        className="w-full rounded-lg border border-border-default bg-surface-light p-1"
      >
        <ToggleGroupItem
          value="one-time"
          className="flex-1 rounded-md px-4 py-2.5 text-sm font-semibold text-text-secondary data-[state=on]:bg-primary-500 data-[state=on]:text-text-inverse"
        >
          One-time purchase
        </ToggleGroupItem>
        <ToggleGroupItem
          value="subscribe"
          className="flex-1 rounded-md px-4 py-2.5 text-sm font-semibold text-text-secondary data-[state=on]:bg-primary-500 data-[state=on]:text-text-inverse"
        >
          Subscribe & Save
        </ToggleGroupItem>
      </ToggleGroup>

      {/* Subscription Details (visible only when subscribe is selected) */}
      {purchaseMode === "subscribe" && (
        <div className="space-y-4">
          {/* Frequency Picker */}
          <div>
            <label className="mb-2 block text-sm font-medium text-text-primary">
              Delivery frequency:
            </label>
            <Select value={selectedPlanId} onValueChange={setSelectedPlanId}>
              <SelectTrigger className="w-full border border-border-default bg-white text-text-primary hover:bg-surface-light">
                <SelectValue placeholder="Select frequency" />
              </SelectTrigger>
              <SelectContent className="border border-border-default bg-white text-text-primary">
                {plans.map((plan) => (
                  <SelectItem
                    key={plan.id}
                    value={plan.id}
                    className="text-text-primary hover:bg-surface-light focus:bg-surface-light"
                  >
                    {FREQUENCY_LABELS[plan.frequency] ?? plan.frequency}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Subscription Price Display */}
          <div className="flex items-center gap-3">
            <p className={`text-base ${stateStyles.priceOriginal}`}>
              ${(variantPriceInCents / 100).toFixed(2)}
            </p>
            <p className={`text-lg ${stateStyles.priceSale}`}>
              ${(discountedPrice / 100).toFixed(2)}
            </p>
            {selectedPlan && (
              <Badge className="border-transparent bg-state-success-bg text-state-success">
                Save {selectedPlan.discount_percent}%
              </Badge>
            )}
          </div>
        </div>
      )}

      {/* One-time Price Display (only when one-time mode is active) */}
      {purchaseMode === "one-time" && (
        <>
          {onSale ? (
            <div>
              <p className={`text-base sm:text-lg ${stateStyles.priceOriginal}`}>
                ${(compareAtPriceInCents! / 100).toFixed(2)}
              </p>
              <p className={`text-lg sm:text-xl ${stateStyles.priceSale}`}>
                ${(variantPriceInCents / 100).toFixed(2)}
              </p>
              <p className="text-xs italic text-state-sale sm:text-sm">
                Limited-time offer
              </p>
            </div>
          ) : (
            <p className="text-lg font-semibold text-text-primary sm:text-xl">
              ${(variantPriceInCents / 100).toFixed(2)}
            </p>
          )}
        </>
      )}

      {/* CTA Button */}
      {available ? (
        purchaseMode === "one-time" ? (
          <button
            className="w-full rounded bg-primary-500 px-6 py-3 font-bold text-text-inverse transition hover:bg-primary-600 sm:w-auto"
            onClick={onAddToCart}
          >
            Add to Cart
          </button>
        ) : (
          <button
            className="w-full rounded bg-primary-500 px-6 py-3 font-bold text-text-inverse transition hover:bg-primary-600 sm:w-auto"
            onClick={() =>
              router.push(
                `/subscribe/checkout?product=${encodeURIComponent(productSlug)}&plan=${encodeURIComponent(selectedPlanId)}`
              )
            }
          >
            Subscribe Now
          </button>
        )
      ) : (
        <p className="text-lg font-semibold text-primary-600 sm:text-xl">
          Coming soon
        </p>
      )}
    </div>
  );
}
