"use client";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { SubscriptionPlan } from "@/lib/types/subscription";
import { Check, Sparkles } from "lucide-react";

interface PlanCardProps {
  plan: SubscriptionPlan;
  onSelect?: (plan: SubscriptionPlan) => void;
  isSelected?: boolean;
  isPopular?: boolean;
  disabled?: boolean;
}

export function PlanCard({
  plan,
  onSelect,
  isSelected = false,
  isPopular = false,
  disabled = false,
}: PlanCardProps) {
  const formatCurrency = (amount: number, currency: string = "USD") => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
    }).format(amount / 100);
  };

  const getIntervalLabel = () => {
    const count = plan.interval_count;
    const interval = plan.interval;
    if (count === 1) {
      return interval;
    }
    return `${count} ${interval}s`;
  };

  const getPerMonthPrice = () => {
    const monthlyAmount = (() => {
      switch (plan.interval) {
        case "day":
          return (plan.price.amount / plan.interval_count) * 30;
        case "week":
          return (plan.price.amount / plan.interval_count) * 4.33;
        case "month":
          return plan.price.amount / plan.interval_count;
        case "year":
          return plan.price.amount / plan.interval_count / 12;
        default:
          return plan.price.amount;
      }
    })();
    return formatCurrency(monthlyAmount, plan.price.currency);
  };

  return (
    <Card
      className={`relative border-2 p-6 transition-all ${
        isSelected
          ? "border-orange-500 bg-neutral-800"
          : "border-neutral-700 bg-neutral-800 hover:border-neutral-600"
      } ${disabled ? "opacity-50" : ""}`}
    >
      {isPopular && (
        <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 bg-orange-600 text-white">
          <Sparkles className="mr-1 h-3 w-3" />
          Most Popular
        </Badge>
      )}

      <div className="mb-4">
        <h3 className="text-xl font-bold text-white">{plan.name}</h3>
        {plan.description && (
          <p className="mt-1 text-sm text-gray-400">{plan.description}</p>
        )}
      </div>

      <div className="mb-6">
        <div className="flex items-baseline">
          <span className="text-4xl font-bold text-white">
            {formatCurrency(plan.price.amount, plan.price.currency)}
          </span>
          <span className="ml-2 text-gray-400">/{getIntervalLabel()}</span>
        </div>
        {plan.interval !== "month" && (
          <p className="mt-1 text-sm text-gray-500">
            {getPerMonthPrice()}/month equivalent
          </p>
        )}
        {plan.trial_period_days > 0 && (
          <Badge className="mt-2 bg-green-600 text-white">
            {plan.trial_period_days}-day free trial
          </Badge>
        )}
      </div>

      {plan.features && plan.features.length > 0 && (
        <ul className="mb-6 space-y-2">
          {plan.features.map((feature, index) => (
            <li key={index} className="flex items-start gap-2 text-sm text-gray-300">
              <Check className="mt-0.5 h-4 w-4 flex-shrink-0 text-green-500" />
              <span>{feature}</span>
            </li>
          ))}
        </ul>
      )}

      {onSelect && (
        <Button
          onClick={() => onSelect(plan)}
          disabled={disabled}
          className={`w-full ${
            isSelected
              ? "bg-orange-600 hover:bg-orange-700"
              : "bg-neutral-700 hover:bg-neutral-600"
          }`}
        >
          {isSelected ? "Selected" : "Select Plan"}
        </Button>
      )}
    </Card>
  );
}
