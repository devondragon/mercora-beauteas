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
        className="w-full rounded-lg border border-neutral-700 bg-neutral-900 p-1"
      >
        <ToggleGroupItem
          value="one-time"
          className="flex-1 rounded-md px-4 py-2.5 text-sm font-semibold text-gray-400 data-[state=on]:bg-orange-500 data-[state=on]:text-black"
        >
          One-time purchase
        </ToggleGroupItem>
        <ToggleGroupItem
          value="subscribe"
          className="flex-1 rounded-md px-4 py-2.5 text-sm font-semibold text-gray-400 data-[state=on]:bg-orange-500 data-[state=on]:text-black"
        >
          Subscribe & Save
        </ToggleGroupItem>
      </ToggleGroup>

      {/* Subscription Details (visible only when subscribe is selected) */}
      {purchaseMode === "subscribe" && (
        <div className="space-y-4">
          {/* Frequency Picker */}
          <div>
            <label className="mb-2 block text-sm font-medium text-white">
              Delivery frequency:
            </label>
            <Select value={selectedPlanId} onValueChange={setSelectedPlanId}>
              <SelectTrigger className="w-full border border-neutral-700 bg-neutral-900 text-white hover:bg-neutral-800">
                <SelectValue placeholder="Select frequency" />
              </SelectTrigger>
              <SelectContent className="border border-neutral-700 bg-neutral-900 text-white">
                {plans.map((plan) => (
                  <SelectItem
                    key={plan.id}
                    value={plan.id}
                    className="text-white hover:bg-neutral-800 focus:bg-neutral-800"
                  >
                    {FREQUENCY_LABELS[plan.frequency] ?? plan.frequency}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Subscription Price Display */}
          <div className="flex items-center gap-3">
            <p className="text-base text-gray-500 line-through">
              ${(variantPriceInCents / 100).toFixed(2)}
            </p>
            <p className="text-lg font-bold text-green-400">
              ${(discountedPrice / 100).toFixed(2)}
            </p>
            {selectedPlan && (
              <Badge className="border-transparent bg-green-500/10 text-green-400">
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
              <p className="text-base text-gray-500 line-through sm:text-lg">
                ${(compareAtPriceInCents! / 100).toFixed(2)}
              </p>
              <p className="text-lg font-bold text-green-400 sm:text-xl">
                ${(variantPriceInCents / 100).toFixed(2)}
              </p>
              <p className="text-xs italic text-orange-400 sm:text-sm">
                Limited-time offer
              </p>
            </div>
          ) : (
            <p className="text-lg font-semibold text-white sm:text-xl">
              ${(variantPriceInCents / 100).toFixed(2)}
            </p>
          )}
        </>
      )}

      {/* CTA Button */}
      {available ? (
        purchaseMode === "one-time" ? (
          <button
            className="w-full rounded bg-orange-500 px-6 py-3 font-bold text-black transition hover:bg-orange-400 sm:w-auto"
            onClick={onAddToCart}
          >
            Add to Cart
          </button>
        ) : (
          <button
            className="w-full rounded bg-orange-500 px-6 py-3 font-bold text-black transition hover:bg-orange-400 sm:w-auto"
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
        <p className="text-lg font-semibold text-orange-500 sm:text-xl">
          Coming soon
        </p>
      )}
    </div>
  );
}
