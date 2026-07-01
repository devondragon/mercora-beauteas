"use client";

import { ShippingOption } from "@/lib/types/shipping";
import { Address } from "@/lib/types";
import { CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  address: Partial<Address>;
  options: ShippingOption[];
  selectedOptionId?: string;
  onSelect: (option: ShippingOption) => void;
  disabled?: boolean;
}

export default function ShippingOptions({
  address,
  options,
  selectedOptionId,
  onSelect,
  disabled = false,
}: Props) {
  return (
    <div
      className={cn(
        "bg-white text-text-primary p-6 rounded-xl transition-opacity",
        disabled && "opacity-50 pointer-events-none"
      )}
    >
      <h2 className="text-lg font-semibold mb-4">Shipping Method</h2>

      <div className="space-y-4">
        {options.length === 0 && (
          <p className="text-text-muted text-sm">
            No shipping options available.
          </p>
        )}

        {options.map((option) => {
          const isSelected = option.id === selectedOptionId;
          return (
            <div
              key={option.id}
              onClick={() => !disabled && onSelect(option)}
              className={cn(
                "border p-4 rounded-md cursor-pointer flex justify-between items-center transition-all",
                isSelected
                  ? "border-primary-500 bg-primary-50"
                  : "hover:border-primary-300"
              )}
            >
              <div>
                <div className="font-medium text-sm">{option.label}</div>
                <div className="text-sm text-text-muted">
                  ${option.cost.toFixed(2)} – Estimated {option.estimatedDays}{" "}
                  days
                </div>
              </div>
              {isSelected && (
                <CheckCircle2 className="text-primary-600 w-6 h-6" />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
