"use client";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Address } from "@/lib/types";
import { isValidUsPostalCode, normalizeUsRegion } from "@/lib/utils/address";

interface Props {
  address: Partial<Address>;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onSubmit: (address: Partial<Address>) => void;
  error?: string | null;
  disabled?: boolean;
}

export default function ShippingForm({
  address,
  onChange,
  onSubmit,
  error,
  disabled = false,
}: Props) {
  const isSubmitDisabled =
    disabled ||
    !(
      address.recipient &&
      address.email &&
      address.line1 &&
      address.city &&
      address.region &&
      address.postal_code &&
      address.country === "US" &&
      normalizeUsRegion(address.region) &&
      isValidUsPostalCode(address.postal_code)
    );

  return (
    <div
      className={`bg-white text-text-primary p-6 rounded-xl transition-opacity ${
        disabled ? "opacity-50 pointer-events-none" : ""
      }`}
    >
      <h2 className="text-lg font-semibold mb-4">Shipping Address</h2>
      <p className="mb-4 text-sm text-text-secondary">
        Currently shipping within the United States only.
      </p>

      <div className="space-y-4">
        <Input
          name="recipient"
          placeholder="Full Name"
          value={address.recipient || ""}
          onChange={onChange}
          autoComplete="name"
          className="touch-manipulation"
          required
        />
        <Input
          type="email"
          name="email"
          placeholder="Email"
          value={address.email || ""}
          onChange={onChange}
          autoComplete="email"
          inputMode="email"
          className="touch-manipulation"
          required
        />
        <Input
          name="line1"
          placeholder="Street Address"
          value={typeof address.line1 === "string" ? address.line1 : ""}
          onChange={onChange}
          autoComplete="address-line1"
          className="touch-manipulation"
          required
        />
        <Input
          name="line2"
          placeholder="Street Address 2"
          value={typeof address.line2 === "string" ? address.line2 || "" : ""}
          onChange={onChange}
          autoComplete="address-line2"
          className="touch-manipulation"
        />
        <div className="flex gap-2">
          <Input
            name="city"
            placeholder="City"
            className="flex-[2] touch-manipulation"
            value={typeof address.city === "string" ? address.city : ""}
            onChange={onChange}
            autoComplete="address-level2"
            required
          />
          <Input
            name="region"
            placeholder="State"
            className="flex-1 touch-manipulation"
            value={address.region || ""}
            onChange={onChange}
            autoComplete="address-level1"
            required
          />
          <Input
            name="postal_code"
            placeholder="Zip Code"
            className="flex-1 touch-manipulation"
            value={address.postal_code || ""}
            onChange={onChange}
            autoComplete="postal-code"
            inputMode="numeric"
            pattern="[0-9]{5}(-[0-9]{4})?"
            required
          />
        </div>

        <div className="flex gap-2 items-end">
          <div className="flex-[3]">
            <Input
              id="country"
              name="country"
              value="United States"
              aria-label="Country"
              readOnly
              disabled
              className="bg-surface-light text-text-primary"
            />
          </div>
          <div className="flex-1">
            <Button
              onClick={() => onSubmit(address)}
              className="w-full bg-primary-500 text-text-inverse hover:bg-primary-600 touch-manipulation"
              disabled={isSubmitDisabled}
            >
              Use Address
            </Button>
          </div>
        </div>

        {error && (
          <div className="text-state-error text-sm font-medium mt-2">{error}</div>
        )}
      </div>
    </div>
  );
}
