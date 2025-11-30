"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SubscriptionStatusBadge } from "@/components/subscriptions/SubscriptionStatusBadge";
import {
  RefreshCw,
  ArrowLeft,
  Calendar,
  CreditCard,
  Package,
  History,
  Pause,
  Play,
  XCircle,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Receipt,
  Truck,
  Edit,
} from "lucide-react";
import type {
  Subscription,
  SubscriptionPlan,
  SubscriptionInvoice,
  SubscriptionEvent,
} from "@/lib/types/subscription";

interface SubscriptionWithDetails extends Subscription {
  plan?: SubscriptionPlan;
}

export default function SubscriptionDetailPage() {
  const params = useParams();
  const { user, isLoaded } = useUser();
  const [subscription, setSubscription] =
    useState<SubscriptionWithDetails | null>(null);
  const [invoices, setInvoices] = useState<SubscriptionInvoice[]>([]);
  const [events, setEvents] = useState<SubscriptionEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [showInvoices, setShowInvoices] = useState(false);
  const [showEvents, setShowEvents] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  const subscriptionId = params.id as string;

  const fetchSubscription = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/subscriptions/${subscriptionId}?includeInvoices=true&includeEvents=true`
      );
      if (!response.ok) {
        throw new Error("Failed to fetch subscription");
      }
      const data = await response.json();
      setSubscription(data.data);
      setInvoices(data.invoices || []);
      setEvents(data.events || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  }, [user, subscriptionId]);

  useEffect(() => {
    if (isLoaded && user) {
      fetchSubscription();
    } else if (isLoaded && !user) {
      setLoading(false);
    }
  }, [isLoaded, user, fetchSubscription]);

  const handleAction = async (action: "pause" | "resume" | "cancel") => {
    setActionLoading(action);

    try {
      let response;
      if (action === "cancel") {
        response = await fetch(`/api/subscriptions/${subscriptionId}`, {
          method: "DELETE",
        });
      } else {
        response = await fetch(`/api/subscriptions/${subscriptionId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        });
      }

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || `Failed to ${action} subscription`);
      }

      await fetchSubscription();
      setShowCancelConfirm(false);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : `Failed to ${action} subscription`
      );
    } finally {
      setActionLoading(null);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  const formatPrice = (amount: number, currency: string) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency,
    }).format(amount / 100);
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
            <h2 className="mb-2 text-xl font-semibold text-white">
              Sign In Required
            </h2>
            <p className="mb-4 text-gray-400">
              Please sign in to view your subscription.
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

  if (!subscription) {
    return (
      <div className="min-h-screen bg-neutral-900 p-6">
        <div className="mx-auto max-w-4xl">
          <Card className="border-neutral-700 bg-neutral-800 p-8 text-center">
            <AlertCircle className="mx-auto mb-4 h-12 w-12 text-red-500" />
            <h2 className="mb-2 text-xl font-semibold text-white">
              Subscription Not Found
            </h2>
            <p className="mb-4 text-gray-400">
              {error || "This subscription could not be found."}
            </p>
            <Button
              onClick={() => (window.location.href = "/account/subscriptions")}
              className="bg-orange-600 hover:bg-orange-700"
            >
              Back to Subscriptions
            </Button>
          </Card>
        </div>
      </div>
    );
  }

  const canPause = ["active", "trialing"].includes(subscription.status);
  const canResume = subscription.status === "paused";
  const canCancel = !["cancelled", "expired"].includes(subscription.status);

  return (
    <div className="min-h-screen bg-neutral-900 p-6">
      <div className="mx-auto max-w-4xl space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            onClick={() => (window.location.href = "/account/subscriptions")}
            className="text-gray-400 hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-white">
                {subscription.plan?.name || "Subscription"}
              </h1>
              <SubscriptionStatusBadge status={subscription.status} showIcon />
            </div>
            <p className="text-gray-400">
              Subscription #{subscription.id.slice(0, 8)}
            </p>
          </div>
          <Button
            variant="outline"
            onClick={fetchSubscription}
            disabled={loading}
            className="border-neutral-600 text-gray-300"
          >
            <RefreshCw
              className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`}
            />
            Refresh
          </Button>
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

        {/* Cancel Confirmation */}
        {showCancelConfirm && (
          <Card className="border-red-700 bg-red-900/30 p-6">
            <h3 className="mb-2 text-lg font-semibold text-white">
              Cancel Subscription?
            </h3>
            <p className="mb-4 text-gray-400">
              Your subscription will remain active until the end of the current
              billing period. After that, you will no longer be charged.
            </p>
            <div className="flex gap-3">
              <Button
                onClick={() => handleAction("cancel")}
                disabled={actionLoading === "cancel"}
                className="bg-red-600 hover:bg-red-700"
              >
                {actionLoading === "cancel" ? (
                  <>
                    <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                    Cancelling...
                  </>
                ) : (
                  "Yes, Cancel Subscription"
                )}
              </Button>
              <Button
                variant="outline"
                onClick={() => setShowCancelConfirm(false)}
                className="border-neutral-600 text-gray-300"
              >
                Keep Subscription
              </Button>
            </div>
          </Card>
        )}

        <div className="grid gap-6 lg:grid-cols-2">
          {/* Subscription Details */}
          <Card className="border-neutral-700 bg-neutral-800 p-6">
            <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-white">
              <Package className="h-5 w-5 text-orange-400" />
              Subscription Details
            </h2>
            <dl className="space-y-3">
              <div className="flex justify-between">
                <dt className="text-gray-400">Plan</dt>
                <dd className="font-medium text-white">
                  {subscription.plan?.name || "—"}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-400">Price</dt>
                <dd className="font-medium text-white">
                  {subscription.plan
                    ? `${formatPrice(
                        subscription.plan.price.amount,
                        subscription.plan.price.currency
                      )}/${subscription.plan.interval}`
                    : "—"}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-400">Quantity</dt>
                <dd className="font-medium text-white">
                  {subscription.quantity}
                </dd>
              </div>
              {subscription.trial_end && (
                <div className="flex justify-between">
                  <dt className="text-gray-400">Trial Ends</dt>
                  <dd className="font-medium text-white">
                    {formatDate(subscription.trial_end)}
                  </dd>
                </div>
              )}
            </dl>
          </Card>

          {/* Billing Cycle */}
          <Card className="border-neutral-700 bg-neutral-800 p-6">
            <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-white">
              <Calendar className="h-5 w-5 text-blue-400" />
              Billing Cycle
            </h2>
            <dl className="space-y-3">
              <div className="flex justify-between">
                <dt className="text-gray-400">Current Period</dt>
                <dd className="font-medium text-white">
                  {subscription.current_period_start &&
                  subscription.current_period_end
                    ? `${formatDate(
                        subscription.current_period_start
                      )} - ${formatDate(subscription.current_period_end)}`
                    : "—"}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-400">Next Billing</dt>
                <dd className="font-medium text-white">
                  {subscription.cancel_at_period_end
                    ? "Cancelled"
                    : subscription.current_period_end
                    ? formatDate(subscription.current_period_end)
                    : "—"}
                </dd>
              </div>
              {subscription.cancel_at_period_end && (
                <div className="flex justify-between">
                  <dt className="text-gray-400">Ends On</dt>
                  <dd className="font-medium text-yellow-400">
                    {subscription.current_period_end
                      ? formatDate(subscription.current_period_end)
                      : "—"}
                  </dd>
                </div>
              )}
              <div className="flex justify-between">
                <dt className="text-gray-400">Started</dt>
                <dd className="font-medium text-white">
                  {formatDate(subscription.created_at)}
                </dd>
              </div>
            </dl>
          </Card>

          {/* Shipping Address */}
          {subscription.shipping_address && (
            <Card className="border-neutral-700 bg-neutral-800 p-6">
              <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-white">
                <Truck className="h-5 w-5 text-green-400" />
                Shipping Address
              </h2>
              <address className="not-italic text-gray-300">
                {subscription.shipping_address.line1}
                {subscription.shipping_address.line2 && (
                  <>
                    <br />
                    {subscription.shipping_address.line2}
                  </>
                )}
                <br />
                {subscription.shipping_address.city},{" "}
                {subscription.shipping_address.state}{" "}
                {subscription.shipping_address.postal_code}
                <br />
                {subscription.shipping_address.country}
              </address>
              <Button
                variant="outline"
                size="sm"
                className="mt-4 border-neutral-600 text-gray-300"
              >
                <Edit className="mr-2 h-4 w-4" />
                Update Address
              </Button>
            </Card>
          )}

          {/* Actions */}
          <Card className="border-neutral-700 bg-neutral-800 p-6">
            <h2 className="mb-4 text-lg font-semibold text-white">
              Manage Subscription
            </h2>
            <div className="space-y-3">
              {canPause && (
                <Button
                  onClick={() => handleAction("pause")}
                  disabled={actionLoading !== null}
                  className="w-full justify-start bg-neutral-700 hover:bg-neutral-600"
                >
                  {actionLoading === "pause" ? (
                    <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Pause className="mr-2 h-4 w-4" />
                  )}
                  Pause Subscription
                </Button>
              )}
              {canResume && (
                <Button
                  onClick={() => handleAction("resume")}
                  disabled={actionLoading !== null}
                  className="w-full justify-start bg-green-600 hover:bg-green-700"
                >
                  {actionLoading === "resume" ? (
                    <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Play className="mr-2 h-4 w-4" />
                  )}
                  Resume Subscription
                </Button>
              )}
              <Button
                onClick={() => (window.location.href = "/account/payment-methods")}
                variant="outline"
                className="w-full justify-start border-neutral-600 text-gray-300"
              >
                <CreditCard className="mr-2 h-4 w-4" />
                Manage Payment Method
              </Button>
              {canCancel && !subscription.cancel_at_period_end && (
                <Button
                  onClick={() => setShowCancelConfirm(true)}
                  disabled={actionLoading !== null}
                  variant="outline"
                  className="w-full justify-start border-red-700 text-red-400 hover:bg-red-900/30"
                >
                  <XCircle className="mr-2 h-4 w-4" />
                  Cancel Subscription
                </Button>
              )}
            </div>
          </Card>
        </div>

        {/* Invoices */}
        <Card className="border-neutral-700 bg-neutral-800">
          <button
            onClick={() => setShowInvoices(!showInvoices)}
            className="flex w-full items-center justify-between p-6 text-left"
          >
            <h2 className="flex items-center gap-2 text-lg font-semibold text-white">
              <Receipt className="h-5 w-5 text-purple-400" />
              Billing History
              <span className="text-sm font-normal text-gray-400">
                ({invoices.length})
              </span>
            </h2>
            {showInvoices ? (
              <ChevronUp className="h-5 w-5 text-gray-400" />
            ) : (
              <ChevronDown className="h-5 w-5 text-gray-400" />
            )}
          </button>
          {showInvoices && (
            <div className="border-t border-neutral-700 p-6">
              {invoices.length === 0 ? (
                <p className="text-center text-gray-400">No invoices yet</p>
              ) : (
                <div className="space-y-3">
                  {invoices.map((invoice) => (
                    <div
                      key={invoice.id}
                      className="flex items-center justify-between rounded bg-neutral-700 p-4"
                    >
                      <div>
                        <p className="font-medium text-white">
                          {formatPrice(invoice.amount_due.amount, invoice.amount_due.currency)}
                        </p>
                        <p className="text-sm text-gray-400">
                          {formatDate(invoice.created_at)}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <span
                          className={`rounded px-2 py-1 text-xs ${
                            invoice.status === "paid"
                              ? "bg-green-900/50 text-green-400"
                              : invoice.status === "open"
                              ? "bg-yellow-900/50 text-yellow-400"
                              : "bg-gray-900/50 text-gray-400"
                          }`}
                        >
                          {invoice.status}
                        </span>
                        {invoice.hosted_invoice_url && (
                          <a
                            href={invoice.hosted_invoice_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm text-orange-400 hover:text-orange-300"
                          >
                            View
                          </a>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </Card>

        {/* Activity Log */}
        <Card className="border-neutral-700 bg-neutral-800">
          <button
            onClick={() => setShowEvents(!showEvents)}
            className="flex w-full items-center justify-between p-6 text-left"
          >
            <h2 className="flex items-center gap-2 text-lg font-semibold text-white">
              <History className="h-5 w-5 text-cyan-400" />
              Activity Log
              <span className="text-sm font-normal text-gray-400">
                ({events.length})
              </span>
            </h2>
            {showEvents ? (
              <ChevronUp className="h-5 w-5 text-gray-400" />
            ) : (
              <ChevronDown className="h-5 w-5 text-gray-400" />
            )}
          </button>
          {showEvents && (
            <div className="border-t border-neutral-700 p-6">
              {events.length === 0 ? (
                <p className="text-center text-gray-400">No activity yet</p>
              ) : (
                <div className="space-y-3">
                  {events.map((event) => (
                    <div
                      key={event.id}
                      className="flex items-start gap-4 rounded bg-neutral-700 p-4"
                    >
                      <div className="flex-1">
                        <p className="font-medium capitalize text-white">
                          {event.event_type.replace(/_/g, " ")}
                        </p>
                        {event.previous_status && event.new_status && (
                          <p className="text-sm text-gray-400">
                            Status: {event.previous_status} → {event.new_status}
                          </p>
                        )}
                        <p className="mt-1 text-xs text-gray-500">
                          {formatDate(event.created_at)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
