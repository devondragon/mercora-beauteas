"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PlanCard } from "@/components/subscriptions/PlanCard";
import {
  RefreshCw,
  ArrowLeft,
  ArrowRight,
  AlertCircle,
  Check,
  TrendingUp,
  TrendingDown,
  Minus,
} from "lucide-react";
import type { Subscription, SubscriptionPlan } from "@/lib/types/subscription";

export default function ChangePlanPage() {
  const params = useParams();
  const router = useRouter();
  const { user, isLoaded } = useUser();
  const subscriptionId = params.id as string;

  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [currentPlan, setCurrentPlan] = useState<SubscriptionPlan | null>(null);
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [selectedPlan, setSelectedPlan] = useState<SubscriptionPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [changing, setChanging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewData, setPreviewData] = useState<{
    proratedAmount: number;
    effectiveDate: string;
    nextBillingAmount: number;
  } | null>(null);

  const fetchData = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);

    try {
      // Fetch subscription with plan
      const subResponse = await fetch(`/api/subscriptions/${subscriptionId}`);
      if (!subResponse.ok) {
        throw new Error("Failed to fetch subscription");
      }
      const subData = await subResponse.json();
      setSubscription(subData.data);
      setCurrentPlan(subData.data.plan);

      // Fetch all available plans
      const plansResponse = await fetch("/api/subscription-plans?status=active");
      if (!plansResponse.ok) {
        throw new Error("Failed to fetch plans");
      }
      const plansData = await plansResponse.json();
      setPlans(plansData.data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  }, [user, subscriptionId]);

  useEffect(() => {
    if (isLoaded && user) {
      fetchData();
    } else if (isLoaded && !user) {
      setLoading(false);
    }
  }, [isLoaded, user, fetchData]);

  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewIsEstimate, setPreviewIsEstimate] = useState(false);

  // Fetch proration preview from Stripe API when a plan is selected
  useEffect(() => {
    if (!selectedPlan || !currentPlan || !subscription) {
      setPreviewData(null);
      setPreviewIsEstimate(false);
      return;
    }

    const fetchProrationPreview = async () => {
      setPreviewLoading(true);
      try {
        const response = await fetch(
          `/api/subscriptions/${subscriptionId}/preview-change?new_plan_id=${selectedPlan.id}`
        );

        if (response.ok) {
          const data = await response.json();
          const preview = data.data;

          // Calculate net proration (charge minus credit)
          const netProration = (preview.prorated_amount || 0) - (preview.credit_amount || 0);

          setPreviewData({
            proratedAmount: netProration,
            effectiveDate: new Date().toISOString(),
            nextBillingAmount: preview.next_billing_amount || selectedPlan.price.amount,
          });
          setPreviewIsEstimate(preview.is_estimate || false);
        } else {
          // Fallback to client-side estimate if API fails
          const currentPrice = currentPlan.price.amount;
          const newPrice = selectedPlan.price.amount;
          const priceDiff = newPrice - currentPrice;

          const now = new Date();
          const periodEnd = subscription.current_period_end
            ? new Date(subscription.current_period_end)
            : new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
          const totalDays = Math.ceil(
            (periodEnd.getTime() - new Date(subscription.current_period_start || now).getTime()) /
              (24 * 60 * 60 * 1000)
          );
          const daysRemaining = Math.max(
            0,
            Math.ceil((periodEnd.getTime() - now.getTime()) / (24 * 60 * 60 * 1000))
          );
          const proratedAmount = totalDays > 0
            ? Math.round((priceDiff * daysRemaining) / totalDays)
            : 0;

          setPreviewData({
            proratedAmount,
            effectiveDate: now.toISOString(),
            nextBillingAmount: newPrice,
          });
          setPreviewIsEstimate(true);
        }
      } catch {
        // Fallback to client-side estimate
        const currentPrice = currentPlan.price.amount;
        const newPrice = selectedPlan.price.amount;
        setPreviewData({
          proratedAmount: newPrice - currentPrice,
          effectiveDate: new Date().toISOString(),
          nextBillingAmount: newPrice,
        });
        setPreviewIsEstimate(true);
      } finally {
        setPreviewLoading(false);
      }
    };

    fetchProrationPreview();
  }, [selectedPlan, currentPlan, subscription, subscriptionId]);

  const handleChangePlan = async () => {
    if (!selectedPlan) return;

    setChanging(true);
    setError(null);

    try {
      const response = await fetch(`/api/subscriptions/${subscriptionId}/change-plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          new_plan_id: selectedPlan.id,
          proration_behavior: "create_prorations",
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to change plan");
      }

      router.push(`/account/subscriptions/${subscriptionId}?changed=true`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to change plan");
    } finally {
      setChanging(false);
    }
  };

  const formatPrice = (amount: number, currency: string) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency,
    }).format(amount / 100);
  };

  const getPlanComparison = () => {
    if (!selectedPlan || !currentPlan) return null;

    const currentPrice = currentPlan.price.amount;
    const newPrice = selectedPlan.price.amount;

    if (newPrice > currentPrice) {
      return {
        type: "upgrade",
        icon: TrendingUp,
        color: "text-green-400",
        bgColor: "bg-green-900/30",
        borderColor: "border-green-700",
        label: "Upgrade",
      };
    } else if (newPrice < currentPrice) {
      return {
        type: "downgrade",
        icon: TrendingDown,
        color: "text-yellow-400",
        bgColor: "bg-yellow-900/30",
        borderColor: "border-yellow-700",
        label: "Downgrade",
      };
    }
    return {
      type: "same",
      icon: Minus,
      color: "text-gray-400",
      bgColor: "bg-neutral-700",
      borderColor: "border-neutral-600",
      label: "Same Price",
    };
  };

  if (!isLoaded || loading) {
    return (
      <div className="min-h-screen bg-neutral-900 p-6">
        <div className="mx-auto max-w-4xl">
          <div className="flex items-center justify-center py-12">
            <RefreshCw className="h-8 w-8 animate-spin text-orange-400" />
          </div>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-neutral-900 p-6">
        <div className="mx-auto max-w-4xl">
          <Card className="border-neutral-700 bg-neutral-800 p-8 text-center">
            <AlertCircle className="mx-auto mb-4 h-12 w-12 text-yellow-500" />
            <h2 className="mb-2 text-xl font-semibold text-white">Sign In Required</h2>
            <p className="mb-4 text-gray-400">Please sign in to change your plan.</p>
            <Button
              onClick={() => (window.location.href = "/sign-in")}
              className="bg-orange-600 hover:bg-orange-700"
            >
              Sign In
            </Button>
          </Card>
        </div>
      </div>
    );
  }

  const comparison = getPlanComparison();
  const availablePlans = plans.filter((p) => p.id !== currentPlan?.id);

  return (
    <div className="min-h-screen bg-neutral-900 p-6">
      <div className="mx-auto max-w-4xl space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            onClick={() => router.push(`/account/subscriptions/${subscriptionId}`)}
            className="text-gray-400 hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex-1">
            <h1 className="text-2xl font-bold text-white">Change Plan</h1>
            <p className="text-gray-400">
              {currentPlan
                ? `Currently on ${currentPlan.name}`
                : "Select a new subscription plan"}
            </p>
          </div>
        </div>

        {error && (
          <Card className="border-red-700 bg-red-900/30 p-4">
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

        {/* Current Plan */}
        {currentPlan && (
          <Card className="border-neutral-700 bg-neutral-800 p-6">
            <h2 className="mb-4 text-lg font-semibold text-white">Current Plan</h2>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xl font-bold text-white">{currentPlan.name}</p>
                <p className="text-gray-400">{currentPlan.description}</p>
              </div>
              <div className="text-right">
                <p className="text-2xl font-bold text-orange-400">
                  {formatPrice(currentPlan.price.amount, currentPlan.price.currency)}
                </p>
                <p className="text-sm text-gray-400">per {currentPlan.interval}</p>
              </div>
            </div>
          </Card>
        )}

        {/* Available Plans */}
        <div>
          <h2 className="mb-4 text-lg font-semibold text-white">Available Plans</h2>
          {availablePlans.length === 0 ? (
            <Card className="border-neutral-700 bg-neutral-800 p-8 text-center">
              <p className="text-gray-400">No other plans available at this time.</p>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {availablePlans.map((plan) => (
                <PlanCard
                  key={plan.id}
                  plan={plan}
                  isSelected={selectedPlan?.id === plan.id}
                  onSelect={setSelectedPlan}
                />
              ))}
            </div>
          )}
        </div>

        {/* Change Preview */}
        {selectedPlan && comparison && (previewData || previewLoading) && (
          <Card className={`${comparison.bgColor} ${comparison.borderColor} border p-6`}>
            <div className="flex items-center gap-2 mb-4">
              <comparison.icon className={`h-5 w-5 ${comparison.color}`} />
              <h2 className="text-lg font-semibold text-white">
                {comparison.label}: {selectedPlan.name}
              </h2>
            </div>

            {previewLoading ? (
              <div className="flex items-center justify-center py-4">
                <RefreshCw className="h-5 w-5 animate-spin text-gray-400 mr-2" />
                <span className="text-gray-400">Calculating proration...</span>
              </div>
            ) : previewData && (
              <>
                <div className="space-y-3">
                  <div className="flex justify-between">
                    <span className="text-gray-400">Current Price</span>
                    <span className="text-white">
                      {currentPlan && formatPrice(currentPlan.price.amount, currentPlan.price.currency)}
                      /{currentPlan?.interval}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">New Price</span>
                    <span className={`font-bold ${comparison.color}`}>
                      {formatPrice(selectedPlan.price.amount, selectedPlan.price.currency)}/
                      {selectedPlan.interval}
                    </span>
                  </div>
                  {previewData.proratedAmount !== 0 && (
                    <div className="flex justify-between border-t border-neutral-600 pt-3">
                      <span className="text-gray-400">
                        {previewData.proratedAmount > 0 ? "Prorated charge" : "Prorated credit"}
                        {previewIsEstimate && " (estimate)"}
                      </span>
                      <span
                        className={
                          previewData.proratedAmount > 0 ? "text-red-400" : "text-green-400"
                        }
                      >
                        {previewData.proratedAmount > 0 ? "" : "-"}
                        {formatPrice(
                          Math.abs(previewData.proratedAmount),
                          selectedPlan.price.currency
                        )}
                      </span>
                    </div>
                  )}
                </div>

                {previewIsEstimate && (
                  <div className="mt-3 flex items-start gap-2 rounded bg-yellow-900/30 p-3 text-sm">
                    <AlertCircle className="h-4 w-4 text-yellow-400 mt-0.5 flex-shrink-0" />
                    <span className="text-yellow-400">
                      This is an estimate. The final amount will be calculated when you confirm the change.
                    </span>
                  </div>
                )}

                <p className="mt-4 text-sm text-gray-400">
                  {comparison.type === "upgrade"
                    ? "Your new plan will take effect immediately. You'll be charged a prorated amount for the remainder of your current billing period."
                    : comparison.type === "downgrade"
                    ? "Your current plan will remain active until the end of your billing period. The new plan will take effect on your next renewal date."
                    : "This change won't affect your billing amount."}
                </p>
              </>
            )}
          </Card>
        )}

        {/* Action Buttons */}
        <div className="flex justify-end gap-3">
          <Button
            variant="outline"
            onClick={() => router.push(`/account/subscriptions/${subscriptionId}`)}
            className="border-neutral-600 text-gray-300"
          >
            Cancel
          </Button>
          <Button
            onClick={handleChangePlan}
            disabled={!selectedPlan || changing}
            className="bg-orange-600 hover:bg-orange-700"
          >
            {changing ? (
              <>
                <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                Changing Plan...
              </>
            ) : (
              <>
                <Check className="mr-2 h-4 w-4" />
                Confirm Plan Change
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
