"use client";

import { useState, useEffect, useCallback } from "react";
import { useUser } from "@clerk/nextjs";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SubscriptionCard } from "@/components/subscriptions/SubscriptionCard";
import {
  RefreshCw,
  Plus,
  CreditCard,
  Package,
  History,
  AlertCircle,
} from "lucide-react";
import type { Subscription, SubscriptionPlan, SubscriptionInvoice } from "@/lib/types/subscription";

interface SubscriptionWithPlan extends Subscription {
  plan?: SubscriptionPlan;
}

export default function CustomerSubscriptionsPage() {
  const { user, isLoaded } = useUser();
  const [subscriptions, setSubscriptions] = useState<SubscriptionWithPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSubscriptions = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/subscriptions");
      if (!response.ok) {
        throw new Error("Failed to fetch subscriptions");
      }
      const data = await response.json();
      setSubscriptions(data.data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (isLoaded && user) {
      fetchSubscriptions();
    } else if (isLoaded && !user) {
      setLoading(false);
    }
  }, [isLoaded, user, fetchSubscriptions]);

  const handlePause = async (subscriptionId: string) => {
    try {
      const response = await fetch(`/api/subscriptions/${subscriptionId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "pause" }),
      });

      if (!response.ok) {
        throw new Error("Failed to pause subscription");
      }

      await fetchSubscriptions();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to pause subscription");
    }
  };

  const handleResume = async (subscriptionId: string) => {
    try {
      const response = await fetch(`/api/subscriptions/${subscriptionId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "resume" }),
      });

      if (!response.ok) {
        throw new Error("Failed to resume subscription");
      }

      await fetchSubscriptions();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to resume subscription");
    }
  };

  const handleCancel = async (subscriptionId: string) => {
    try {
      const response = await fetch(`/api/subscriptions/${subscriptionId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("Failed to cancel subscription");
      }

      await fetchSubscriptions();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to cancel subscription");
    }
  };

  const handleManage = (subscriptionId: string) => {
    window.location.href = `/account/subscriptions/${subscriptionId}`;
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
            <p className="mb-4 text-gray-400">
              Please sign in to view your subscriptions.
            </p>
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

  const activeSubscriptions = subscriptions.filter((s) =>
    ["active", "trialing", "paused", "past_due"].includes(s.status)
  );
  const inactiveSubscriptions = subscriptions.filter((s) =>
    ["cancelled", "expired"].includes(s.status)
  );

  return (
    <div className="min-h-screen bg-neutral-900 p-6">
      <div className="mx-auto max-w-4xl space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">My Subscriptions</h1>
            <p className="text-gray-400">Manage your recurring subscriptions</p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={fetchSubscriptions}
              disabled={loading}
              className="border-neutral-600 text-gray-300"
            >
              <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button
              onClick={() => (window.location.href = "/subscribe")}
              className="bg-orange-600 hover:bg-orange-700"
            >
              <Plus className="mr-2 h-4 w-4" />
              New Subscription
            </Button>
          </div>
        </div>

        {/* Quick Links */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Card
            className="cursor-pointer border-neutral-700 bg-neutral-800 p-4 transition hover:border-orange-500"
            onClick={() => (window.location.href = "/account/payment-methods")}
          >
            <div className="flex items-center gap-3">
              <CreditCard className="h-6 w-6 text-blue-400" />
              <div>
                <p className="font-medium text-white">Payment Methods</p>
                <p className="text-sm text-gray-400">Manage your cards</p>
              </div>
            </div>
          </Card>

          <Card
            className="cursor-pointer border-neutral-700 bg-neutral-800 p-4 transition hover:border-orange-500"
            onClick={() => (window.location.href = "/subscribe")}
          >
            <div className="flex items-center gap-3">
              <Package className="h-6 w-6 text-green-400" />
              <div>
                <p className="font-medium text-white">Browse Plans</p>
                <p className="text-sm text-gray-400">View available plans</p>
              </div>
            </div>
          </Card>

          <Card
            className="cursor-pointer border-neutral-700 bg-neutral-800 p-4 transition hover:border-orange-500"
            onClick={() => (window.location.href = "/account/billing-history")}
          >
            <div className="flex items-center gap-3">
              <History className="h-6 w-6 text-purple-400" />
              <div>
                <p className="font-medium text-white">Billing History</p>
                <p className="text-sm text-gray-400">View past invoices</p>
              </div>
            </div>
          </Card>
        </div>

        {error && (
          <Card className="border-red-700 bg-red-900/30 p-4">
            <div className="flex items-center gap-2 text-red-400">
              <AlertCircle className="h-5 w-5" />
              <span>{error}</span>
            </div>
          </Card>
        )}

        {/* Active Subscriptions */}
        <div>
          <h2 className="mb-4 text-lg font-semibold text-white">
            Active Subscriptions ({activeSubscriptions.length})
          </h2>
          {activeSubscriptions.length === 0 ? (
            <Card className="border-neutral-700 bg-neutral-800 p-8 text-center">
              <Package className="mx-auto mb-4 h-12 w-12 text-gray-600" />
              <h3 className="mb-2 text-lg font-medium text-gray-400">
                No active subscriptions
              </h3>
              <p className="mb-4 text-gray-500">
                Subscribe to a plan to get started with regular deliveries.
              </p>
              <Button
                onClick={() => (window.location.href = "/subscribe")}
                className="bg-orange-600 hover:bg-orange-700"
              >
                Browse Plans
              </Button>
            </Card>
          ) : (
            <div className="space-y-4">
              {activeSubscriptions.map((subscription) => (
                <SubscriptionCard
                  key={subscription.id}
                  subscription={subscription}
                  onPause={handlePause}
                  onResume={handleResume}
                  onCancel={handleCancel}
                  onManage={handleManage}
                />
              ))}
            </div>
          )}
        </div>

        {/* Inactive Subscriptions */}
        {inactiveSubscriptions.length > 0 && (
          <div>
            <h2 className="mb-4 text-lg font-semibold text-white">
              Past Subscriptions ({inactiveSubscriptions.length})
            </h2>
            <div className="space-y-4">
              {inactiveSubscriptions.map((subscription) => (
                <SubscriptionCard
                  key={subscription.id}
                  subscription={subscription}
                  showActions={false}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
