"use client";

import { ShippingOption } from "@/lib/types/shipping";
import { Address } from "@/lib/types";
import { CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Money } from "@/lib/money";

interface Props {
  address: Partial<Address>;
  options: ShippingOption[];
  selectedOptionId?: string;
  onSelect: (option: ShippingOption) => void;
  disabled?: boolean;
}

/**
 * Shipping-method picker.
 *
 * Choosing here is not a passive radio selection: `onSelect` computes tax,
 * creates the PaymentIntent, and moves the checkout to the payment step. Two
 * consequences shape this component.
 *
 * The rows are `role="radio"` BUTTONS rather than native `<input type="radio">`
 * in a roving-focus group. A native radiogroup commits a selection on arrow-key
 * navigation, which here would fire the whole advance mid-keypress; buttons
 * commit only on click/Enter/Space, which is what an irreversible-feeling step
 * should require. They are still real widgets, unlike the bare `div onClick`
 * this replaced, which no keyboard could reach at all.
 *
 * `selectedOptionId` must reflect a choice made THIS session. The caller used to
 * pass the cart store's persisted `shippingOption`, so a returning customer saw
 * the option pre-checked while the advance had never run — the step looked
 * finished and the required click looked redundant. See CheckoutClient's
 * `shippingChosen`.
 */
export default function ShippingOptions({
  address,
  options,
  selectedOptionId,
  onSelect,
  disabled = false,
}: Props) {
  const nothingChosen = !selectedOptionId && options.length > 0;

  return (
    <div
      className={cn(
        "bg-white text-text-primary p-6 rounded-xl transition-opacity",
        disabled && "opacity-50 pointer-events-none"
      )}
    >
      <h2 className={cn("text-lg font-semibold", nothingChosen ? "mb-1" : "mb-4")}>
        Shipping Method
      </h2>
      {nothingChosen && (
        <p className="mb-4 text-sm text-text-secondary">
          Choose a method to continue to payment.
        </p>
      )}

      <div
        className="space-y-4"
        role={options.length > 0 ? "radiogroup" : undefined}
        aria-label={options.length > 0 ? "Shipping method" : undefined}
      >
        {options.length === 0 && (
          <p className="text-text-muted text-sm">
            No shipping options available.
          </p>
        )}

        {options.map((option) => {
          const isSelected = option.id === selectedOptionId;
          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={isSelected}
              disabled={disabled}
              onClick={() => !disabled && onSelect(option)}
              className={cn(
                "w-full border p-4 rounded-md cursor-pointer flex justify-between items-center gap-4 text-left transition-all",
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2",
                isSelected
                  ? "border-primary-500 bg-primary-50"
                  : "hover:border-primary-300"
              )}
            >
              <div>
                <div className="font-medium text-sm">{option.label}</div>
                <div className="text-sm text-text-muted">
                  {Money.fromMinor(option.cost, "USD").format()} – Estimated {option.estimatedDays}{" "}
                  days
                </div>
              </div>
              {isSelected ? (
                <CheckCircle2 className="text-primary-600 w-6 h-6 shrink-0" />
              ) : (
                <span className="text-sm font-medium text-primary-700 shrink-0">
                  Select
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
