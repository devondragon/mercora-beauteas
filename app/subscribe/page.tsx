"use client";

import { useState, useEffect } from "react";
import { useUser } from "@clerk/nextjs";
import { loadStripe } from "@stripe/stripe-js";
import {
  Elements,
  PaymentElement,
  useStripe,
  useElements,
} from "@stripe/react-stripe-js";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PlanCard } from "@/components/subscriptions/PlanCard";
import {
  RefreshCw,
  ArrowLeft,
  ArrowRight,
  Check,
  CreditCard,
  Package,
  AlertCircle,
} from "lucide-react";
import type { SubscriptionPlan } from "@/lib/types/subscription";

const stripePromise = loadStripe(
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || ""
);

type Step = "plans" | "payment" | "confirm";

interface CheckoutFormProps {
  planId: string;
  onSuccess: (subscriptionId: string) => void;
  onError: (error: string) => void;
}

function CheckoutForm({ planId, onSuccess, onError }: CheckoutFormProps) {
  const stripe = useStripe();
  const elements = useElements();
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!stripe || !elements) {
      return;
    }

    setLoading(true);

    try {
      // Submit payment element
      const { error: submitError } = await elements.submit();
      if (submitError) {
        throw new Error(submitError.message);
      }

      // Create payment method
      const { paymentMethod, error: pmError } = await stripe.createPaymentMethod({
        elements,
      });

      if (pmError || !paymentMethod) {
        throw new Error(pmError?.message || "Failed to create payment method");
      }

      // Create subscription
      const response = await fetch("/api/subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plan_id: planId,
          payment_method_id: paymentMethod.id,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to create subscription");
      }

      // If payment confirmation is needed
      if (data.data.client_secret) {
        const { error: confirmError } = await stripe.confirmPayment({
          clientSecret: data.data.client_secret,
          confirmParams: {
            return_url: `${window.location.origin}/account/subscriptions?success=true`,
          },
          redirect: "if_required",
        });

        if (confirmError) {
          throw new Error(confirmError.message);
        }
      }

      onSuccess(data.data.subscription_id);
    } catch (err) {
      onError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <PaymentElement />
      <Button
        type="submit"
        disabled={!stripe || loading}
        className="w-full bg-orange-600 hover:bg-orange-700"
      >
        {loading ? (
          <>
            <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
            Processing...
          </>
        ) : (
          <>
            <CreditCard className="mr-2 h-4 w-4" />
            Subscribe Now
          </>
        )}
      </Button>
    </form>
  );
}

export default function SubscribePage() {
  const { user, isLoaded } = useUser();
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [selectedPlan, setSelectedPlan] = useState<SubscriptionPlan | null>(null);
  const [step, setStep] = useState<Step>("plans");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [subscriptionId, setSubscriptionId] = useState<string | null>(null);

  useEffect(() => {
    async function fetchPlans() {
      try {
        const response = await fetch("/api/subscription-plans");
        if (!response.ok) {
          throw new Error("Failed to fetch plans");
        }
        const data = await response.json();
        setPlans(data.data || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load plans");
      } finally {
        setLoading(false);
      }
    }

    fetchPlans();
  }, []);

  const handlePlanSelect = (plan: SubscriptionPlan) => {
    setSelectedPlan(plan);
  };

  const handleContinue = () => {
    if (!user) {
      window.location.href = `/sign-in?redirect_url=${encodeURIComponent("/subscribe")}`;
      return;
    }
    if (selectedPlan) {
      setStep("payment");
    }
  };

  const handleSuccess = (subId: string) => {
    setSubscriptionId(subId);
    setStep("confirm");
  };

  const handleError = (errorMessage: string) => {
    setError(errorMessage);
  };

  const formatPrice = (amount: number, currency: string) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency,
    }).format(amount / 100);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-neutral-900 p-6">
        <div className="mx-auto max-w-6xl">
          <div className="flex items-center justify-center py-12">
            <RefreshCw className="h-8 w-8 animate-spin text-orange-400" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-900 p-6">
      <div className="mx-auto max-w-6xl">
        {/* Progress Steps */}
        <div className="mb-8">
          <div className="flex items-center justify-center gap-4">
            <div
              className={`flex items-center gap-2 ${
                step === "plans" ? "text-orange-400" : "text-gray-400"
              }`}
            >
              <div
                className={`flex h-8 w-8 items-center justify-center rounded-full ${
                  step === "plans"
                    ? "bg-orange-600 text-white"
                    : step === "payment" || step === "confirm"
                    ? "bg-green-600 text-white"
                    : "bg-neutral-700 text-gray-400"
                }`}
              >
                {step === "payment" || step === "confirm" ? (
                  <Check className="h-4 w-4" />
                ) : (
                  "1"
                )}
              </div>
              <span className="hidden sm:inline">Choose Plan</span>
            </div>

            <div className="h-px w-12 bg-neutral-600" />

            <div
              className={`flex items-center gap-2 ${
                step === "payment" ? "text-orange-400" : "text-gray-400"
              }`}
            >
              <div
                className={`flex h-8 w-8 items-center justify-center rounded-full ${
                  step === "payment"
                    ? "bg-orange-600 text-white"
                    : step === "confirm"
                    ? "bg-green-600 text-white"
                    : "bg-neutral-700 text-gray-400"
                }`}
              >
                {step === "confirm" ? <Check className="h-4 w-4" /> : "2"}
              </div>
              <span className="hidden sm:inline">Payment</span>
            </div>

            <div className="h-px w-12 bg-neutral-600" />

            <div
              className={`flex items-center gap-2 ${
                step === "confirm" ? "text-orange-400" : "text-gray-400"
              }`}
            >
              <div
                className={`flex h-8 w-8 items-center justify-center rounded-full ${
                  step === "confirm"
                    ? "bg-green-600 text-white"
                    : "bg-neutral-700 text-gray-400"
                }`}
              >
                {step === "confirm" ? <Check className="h-4 w-4" /> : "3"}
              </div>
              <span className="hidden sm:inline">Confirmation</span>
            </div>
          </div>
        </div>

        {error && (
          <Card className="mb-6 border-red-700 bg-red-900/30 p-4">
            <div className="flex items-center gap-2 text-red-400">
              <AlertCircle className="h-5 w-5" />
              <span>{error}</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setError(null)}
                className="ml-auto text-red-400"
              >
                Dismiss
              </Button>
            </div>
          </Card>
        )}

        {/* Step 1: Choose Plan */}
        {step === "plans" && (
          <div className="space-y-6">
            <div className="text-center">
              <h1 className="text-3xl font-bold text-white">
                Choose Your Subscription
              </h1>
              <p className="mt-2 text-gray-400">
                Select a plan that works best for you
              </p>
            </div>

            {plans.length === 0 ? (
              <Card className="border-neutral-700 bg-neutral-800 p-8 text-center">
                <Package className="mx-auto mb-4 h-12 w-12 text-gray-600" />
                <h3 className="mb-2 text-lg font-medium text-gray-400">
                  No Plans Available
                </h3>
                <p className="text-gray-500">
                  Check back soon for subscription options.
                </p>
              </Card>
            ) : (
              <>
                <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                  {plans.map((plan) => (
                    <PlanCard
                      key={plan.id}
                      plan={plan}
                      selected={selectedPlan?.id === plan.id}
                      onSelect={handlePlanSelect}
                    />
                  ))}
                </div>

                <div className="flex justify-center">
                  <Button
                    onClick={handleContinue}
                    disabled={!selectedPlan}
                    className="bg-orange-600 px-8 hover:bg-orange-700"
                  >
                    Continue
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </div>
              </>
            )}
          </div>
        )}

        {/* Step 2: Payment */}
        {step === "payment" && selectedPlan && (
          <div className="mx-auto max-w-2xl space-y-6">
            <Button
              variant="ghost"
              onClick={() => setStep("plans")}
              className="text-gray-400 hover:text-white"
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Plans
            </Button>

            <div className="text-center">
              <h1 className="text-3xl font-bold text-white">Payment Details</h1>
              <p className="mt-2 text-gray-400">
                Complete your subscription setup
              </p>
            </div>

            {/* Selected Plan Summary */}
            <Card className="border-neutral-700 bg-neutral-800 p-6">
              <h3 className="mb-4 text-lg font-semibold text-white">
                Order Summary
              </h3>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-gray-400">{selectedPlan.name}</span>
                  <span className="font-medium text-white">
                    {formatPrice(selectedPlan.price.amount, selectedPlan.price.currency)}
                    <span className="text-sm text-gray-400">
                      /{selectedPlan.interval}
                    </span>
                  </span>
                </div>
                {selectedPlan.trial_period_days > 0 && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-green-400">
                      Free trial: {selectedPlan.trial_period_days} days
                    </span>
                  </div>
                )}
                {selectedPlan.setup_fee && selectedPlan.setup_fee.amount > 0 && (
                  <div className="flex items-center justify-between border-t border-neutral-600 pt-2">
                    <span className="text-gray-400">Setup fee (one-time)</span>
                    <span className="text-white">
                      {formatPrice(
                        selectedPlan.setup_fee.amount,
                        selectedPlan.setup_fee.currency
                      )}
                    </span>
                  </div>
                )}
              </div>
            </Card>

            {/* Payment Form */}
            <Card className="border-neutral-700 bg-neutral-800 p-6">
              <Elements
                stripe={stripePromise}
                options={{
                  mode: "subscription",
                  amount: selectedPlan.price.amount,
                  currency: selectedPlan.price.currency.toLowerCase(),
                  appearance: {
                    theme: "night",
                    variables: {
                      colorPrimary: "#ea580c",
                      colorBackground: "#262626",
                      colorText: "#ffffff",
                      colorDanger: "#ef4444",
                    },
                  },
                }}
              >
                <CheckoutForm
                  planId={selectedPlan.id}
                  onSuccess={handleSuccess}
                  onError={handleError}
                />
              </Elements>
            </Card>

            <p className="text-center text-sm text-gray-500">
              Your subscription will automatically renew each{" "}
              {selectedPlan.interval}. You can cancel anytime.
            </p>
          </div>
        )}

        {/* Step 3: Confirmation */}
        {step === "confirm" && (
          <div className="mx-auto max-w-lg space-y-6 text-center">
            <div className="flex justify-center">
              <div className="flex h-20 w-20 items-center justify-center rounded-full bg-green-600">
                <Check className="h-10 w-10 text-white" />
              </div>
            </div>

            <div>
              <h1 className="text-3xl font-bold text-white">
                Subscription Confirmed!
              </h1>
              <p className="mt-2 text-gray-400">
                Thank you for subscribing. Your first delivery will be on its way
                soon.
              </p>
            </div>

            <Card className="border-neutral-700 bg-neutral-800 p-6">
              <h3 className="mb-4 text-lg font-semibold text-white">
                What&apos;s Next?
              </h3>
              <ul className="space-y-3 text-left text-gray-400">
                <li className="flex items-start gap-2">
                  <Check className="mt-0.5 h-4 w-4 text-green-400" />
                  <span>You&apos;ll receive a confirmation email shortly</span>
                </li>
                <li className="flex items-start gap-2">
                  <Check className="mt-0.5 h-4 w-4 text-green-400" />
                  <span>
                    Manage your subscription from your account dashboard
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <Check className="mt-0.5 h-4 w-4 text-green-400" />
                  <span>Pause or cancel anytime from your account</span>
                </li>
              </ul>
            </Card>

            <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
              <Button
                onClick={() =>
                  (window.location.href = `/account/subscriptions/${subscriptionId}`)
                }
                className="bg-orange-600 hover:bg-orange-700"
              >
                View Subscription
              </Button>
              <Button
                variant="outline"
                onClick={() => (window.location.href = "/")}
                className="border-neutral-600 text-gray-300"
              >
                Continue Shopping
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
