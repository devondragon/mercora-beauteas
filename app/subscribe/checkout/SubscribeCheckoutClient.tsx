"use client";

import { useState } from "react";
import { useUser } from "@clerk/nextjs";
import { useStripe, useElements, PaymentElement } from "@stripe/react-stripe-js";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import Image from "next/image";
import StripeProvider from "@/components/checkout/StripeProvider";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Product } from "@/lib/types";
import type { SubscriptionPlan, SubscriptionFrequency } from "@/lib/types/subscription";

const FREQUENCY_LABELS: Record<SubscriptionFrequency, string> = {
  biweekly: "Every 2 weeks",
  monthly: "Monthly",
  bimonthly: "Every 2 months",
};

interface SubscribeCheckoutClientProps {
  product: Product;
  plan: SubscriptionPlan;
  subscriptionPriceInCents: number;
}

interface ShippingAddress {
  line1: string;
  line2: string;
  city: string;
  region: string;
  postal_code: string;
  country: string;
}

/**
 * Subscription checkout client component.
 *
 * Phase 1: Collect customer info + shipping, create SetupIntent
 * Phase 2: Collect payment method via Stripe PaymentElement, confirm setup, create subscription
 */
export default function SubscribeCheckoutClient({
  product,
  plan,
  subscriptionPriceInCents,
}: SubscribeCheckoutClientProps) {
  const { user } = useUser();
  const router = useRouter();

  // Form state
  const [email, setEmail] = useState(user?.primaryEmailAddress?.emailAddress ?? "");
  const [name, setName] = useState(
    [user?.firstName, user?.lastName].filter(Boolean).join(" ") || ""
  );
  const [address, setAddress] = useState<ShippingAddress>({
    line1: "",
    line2: "",
    city: "",
    region: "",
    postal_code: "",
    country: "US",
  });

  // SetupIntent state
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [isCreatingSetup, setIsCreatingSetup] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);

  // Product image URL
  const imageUrl = resolveImageSrc(product.primary_image);

  const isInfoValid =
    email.trim() !== "" &&
    name.trim() !== "" &&
    address.line1.trim() !== "" &&
    address.city.trim() !== "" &&
    address.region.trim() !== "" &&
    address.postal_code.trim() !== "" &&
    address.country.trim() !== "";

  /** Phase 1: Submit customer info and create SetupIntent */
  async function handleInfoSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isInfoValid) return;

    setIsCreatingSetup(true);
    setSetupError(null);

    try {
      const res = await fetch("/api/setup-intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), name: name.trim() }),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || "Failed to initialize payment setup");
      }

      const data = (await res.json()) as { clientSecret: string; customerId: string };
      setClientSecret(data.clientSecret);
      setCustomerId(data.customerId);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Something went wrong";
      setSetupError(message);
      toast.error(message);
    } finally {
      setIsCreatingSetup(false);
    }
  }

  function handleAddressChange(e: React.ChangeEvent<HTMLInputElement>) {
    setAddress((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  }

  const productName = resolveLocalizedName(product.name);

  // ── Phase 2: Payment method collection (rendered inside StripeProvider) ──

  if (clientSecret) {
    return (
      <div>
        <h1 className="mb-8 text-2xl font-bold">Complete Your Subscription</h1>

        <div className="grid gap-8 lg:grid-cols-5">
          {/* Payment Form */}
          <div className="lg:col-span-3">
            <StripeProvider clientSecret={clientSecret}>
              <PaymentFormInner
                planId={plan.id}
                address={address}
                onSuccess={() =>
                  router.push(
                    `/subscribe/confirmation?plan=${encodeURIComponent(plan.id)}`
                  )
                }
              />
            </StripeProvider>
          </div>

          {/* Order Summary Sidebar */}
          <div className="lg:col-span-2">
            <OrderSummary
              productName={productName}
              imageUrl={imageUrl}
              frequency={plan.frequency}
              subscriptionPriceInCents={subscriptionPriceInCents}
              discountPercent={plan.discount_percent}
            />
          </div>
        </div>
      </div>
    );
  }

  // ── Phase 1: Collect customer info + shipping ──

  return (
    <div>
      <h1 className="mb-8 text-2xl font-bold">Subscribe & Save</h1>

      <div className="grid gap-8 lg:grid-cols-5">
        {/* Info Form */}
        <form onSubmit={handleInfoSubmit} className="space-y-6 lg:col-span-3">
          {/* Contact Info */}
          <div className="rounded-lg border border-neutral-700 bg-neutral-800 p-6">
            <h2 className="mb-4 text-lg font-semibold">Contact Information</h2>
            <div className="space-y-4">
              <div>
                <Label htmlFor="name" className="text-neutral-300">
                  Full Name
                </Label>
                <Input
                  id="name"
                  name="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Full Name"
                  autoComplete="name"
                  required
                  className="mt-1 border-neutral-600 bg-neutral-900 text-white placeholder:text-neutral-500"
                />
              </div>
              <div>
                <Label htmlFor="email" className="text-neutral-300">
                  Email
                </Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Email"
                  autoComplete="email"
                  required
                  className="mt-1 border-neutral-600 bg-neutral-900 text-white placeholder:text-neutral-500"
                />
              </div>
            </div>
          </div>

          {/* Shipping Address */}
          <div className="rounded-lg border border-neutral-700 bg-neutral-800 p-6">
            <h2 className="mb-4 text-lg font-semibold">Shipping Address</h2>
            <div className="space-y-4">
              <div>
                <Label htmlFor="line1" className="text-neutral-300">
                  Street Address
                </Label>
                <Input
                  id="line1"
                  name="line1"
                  value={address.line1}
                  onChange={handleAddressChange}
                  placeholder="Street Address"
                  autoComplete="address-line1"
                  required
                  className="mt-1 border-neutral-600 bg-neutral-900 text-white placeholder:text-neutral-500"
                />
              </div>
              <div>
                <Label htmlFor="line2" className="text-neutral-300">
                  Apt / Suite (optional)
                </Label>
                <Input
                  id="line2"
                  name="line2"
                  value={address.line2}
                  onChange={handleAddressChange}
                  placeholder="Apt, Suite, Unit"
                  autoComplete="address-line2"
                  className="mt-1 border-neutral-600 bg-neutral-900 text-white placeholder:text-neutral-500"
                />
              </div>
              <div className="flex gap-3">
                <div className="flex-[2]">
                  <Label htmlFor="city" className="text-neutral-300">
                    City
                  </Label>
                  <Input
                    id="city"
                    name="city"
                    value={address.city}
                    onChange={handleAddressChange}
                    placeholder="City"
                    autoComplete="address-level2"
                    required
                    className="mt-1 border-neutral-600 bg-neutral-900 text-white placeholder:text-neutral-500"
                  />
                </div>
                <div className="flex-1">
                  <Label htmlFor="region" className="text-neutral-300">
                    State
                  </Label>
                  <Input
                    id="region"
                    name="region"
                    value={address.region}
                    onChange={handleAddressChange}
                    placeholder="State"
                    autoComplete="address-level1"
                    required
                    className="mt-1 border-neutral-600 bg-neutral-900 text-white placeholder:text-neutral-500"
                  />
                </div>
                <div className="flex-1">
                  <Label htmlFor="postal_code" className="text-neutral-300">
                    ZIP
                  </Label>
                  <Input
                    id="postal_code"
                    name="postal_code"
                    value={address.postal_code}
                    onChange={handleAddressChange}
                    placeholder="ZIP"
                    autoComplete="postal-code"
                    inputMode="numeric"
                    required
                    className="mt-1 border-neutral-600 bg-neutral-900 text-white placeholder:text-neutral-500"
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="country" className="text-neutral-300">
                  Country
                </Label>
                <Select
                  value={address.country}
                  onValueChange={(value) =>
                    setAddress((prev) => ({ ...prev, country: value }))
                  }
                >
                  <SelectTrigger className="mt-1 border-neutral-600 bg-neutral-900 text-white">
                    <SelectValue placeholder="Select Country" />
                  </SelectTrigger>
                  <SelectContent className="border-neutral-700 bg-neutral-900 text-white">
                    <SelectItem value="US">United States</SelectItem>
                    <SelectItem value="CA">Canada</SelectItem>
                    <SelectItem value="GB">United Kingdom</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {/* Error */}
          {setupError && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
              {setupError}
            </div>
          )}

          {/* Submit */}
          <Button
            type="submit"
            disabled={!isInfoValid || isCreatingSetup}
            className="w-full bg-orange-500 text-black hover:bg-orange-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isCreatingSetup ? (
              <span className="flex items-center gap-2">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-black border-t-transparent" />
                Setting up...
              </span>
            ) : (
              "Continue to Payment"
            )}
          </Button>
        </form>

        {/* Order Summary Sidebar */}
        <div className="lg:col-span-2">
          <OrderSummary
            productName={productName}
            imageUrl={imageUrl}
            frequency={plan.frequency}
            subscriptionPriceInCents={subscriptionPriceInCents}
            discountPercent={plan.discount_percent}
          />
        </div>
      </div>
    </div>
  );
}

// ─── PaymentFormInner (must be inside StripeProvider) ───────────────

interface PaymentFormInnerProps {
  planId: string;
  address: ShippingAddress;
  onSuccess: () => void;
}

function PaymentFormInner({ planId, address, onSuccess }: PaymentFormInnerProps) {
  const stripe = useStripe();
  const elements = useElements();
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!stripe || !elements) return;

    setIsProcessing(true);
    setErrorMessage("");

    try {
      // Confirm the SetupIntent -- CRITICAL: use confirmSetup, NOT confirmPayment
      const { error, setupIntent } = await stripe.confirmSetup({
        elements,
        confirmParams: {
          return_url: `${window.location.origin}/subscribe/confirmation?plan=${encodeURIComponent(planId)}`,
        },
        redirect: "if_required",
      });

      if (error) {
        const msg = error.message || "Payment setup failed. Please try again.";
        setErrorMessage(msg);
        toast.error(msg);
        return;
      }

      if (setupIntent) {
        // SetupIntent confirmed -- create the subscription server-side
        const res = await fetch("/api/subscriptions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            setupIntentId: setupIntent.id,
            planId,
            shippingAddress: address,
          }),
        });

        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(data.error || "Failed to create subscription");
        }

        toast.success("Subscription created!");
        onSuccess();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Something went wrong";
      setErrorMessage(msg);
      toast.error(msg);
    } finally {
      setIsProcessing(false);
    }
  }

  if (!stripe || !elements) {
    return (
      <div className="flex min-h-[300px] items-center justify-center">
        <div className="flex flex-col items-center gap-2">
          <div className="h-6 w-6 animate-spin rounded-full border-b-2 border-orange-500" />
          <p className="text-sm text-neutral-400">Loading payment form...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-neutral-700 bg-neutral-800 p-6">
      <h2 className="mb-4 text-lg font-semibold">Payment Method</h2>
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="min-h-[300px]">
          <PaymentElement
            id="payment-element"
            options={{
              layout: {
                type: "tabs",
                defaultCollapsed: false,
                radios: false,
              },
              paymentMethodOrder: ["card", "apple_pay", "google_pay"],
              wallets: {
                applePay: "auto",
                googlePay: "auto",
              },
            }}
          />
        </div>

        {errorMessage && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
            {errorMessage}
          </div>
        )}

        <Button
          type="submit"
          disabled={!stripe || !elements || isProcessing}
          className="w-full bg-orange-500 text-black hover:bg-orange-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isProcessing ? (
            <span className="flex items-center gap-2">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-black border-t-transparent" />
              Processing...
            </span>
          ) : (
            "Start Subscription"
          )}
        </Button>
      </form>
    </div>
  );
}

// ─── Order Summary ─────────────────────────────────────────────────

interface OrderSummaryProps {
  productName: string;
  imageUrl: string | null;
  frequency: SubscriptionFrequency;
  subscriptionPriceInCents: number;
  discountPercent: number;
}

function OrderSummary({
  productName,
  imageUrl,
  frequency,
  subscriptionPriceInCents,
  discountPercent,
}: OrderSummaryProps) {
  return (
    <div className="rounded-lg border border-neutral-700 bg-neutral-800 p-6">
      <h2 className="mb-4 text-lg font-semibold">Order Summary</h2>

      <div className="flex gap-4">
        {imageUrl && (
          <div className="relative h-20 w-20 flex-shrink-0 overflow-hidden rounded-md">
            <Image src={imageUrl} alt={productName} fill className="object-cover" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="font-medium text-white">{productName}</p>
          <p className="mt-1 text-sm text-neutral-400">
            {FREQUENCY_LABELS[frequency]}
          </p>
        </div>
      </div>

      <div className="mt-6 space-y-3 border-t border-neutral-700 pt-4">
        <div className="flex items-center justify-between">
          <span className="text-neutral-400">Subscription price</span>
          <span className="font-semibold text-white">
            ${(subscriptionPriceInCents / 100).toFixed(2)}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-neutral-400">Discount</span>
          <Badge className="border-transparent bg-green-500/10 text-green-400">
            Save {discountPercent}%
          </Badge>
        </div>
      </div>
    </div>
  );
}

// ─── Helpers ───────────────────────────────────────────────────────

function resolveLocalizedName(
  field: string | Record<string, string> | undefined | null
): string {
  if (!field) return "Product";
  if (typeof field === "string") return field;
  return Object.values(field)[0] ?? "Product";
}

function resolveImageSrc(media: unknown): string | null {
  if (!media) return null;
  if (typeof media === "string") return media;
  if (typeof media === "object") {
    const obj = media as Record<string, unknown>;
    if (typeof obj.url === "string") return obj.url;
    if (
      obj.file &&
      typeof obj.file === "object" &&
      typeof (obj.file as Record<string, unknown>).url === "string"
    ) {
      return (obj.file as Record<string, unknown>).url as string;
    }
  }
  return null;
}
