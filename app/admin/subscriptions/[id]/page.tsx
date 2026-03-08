/**
 * === Admin Subscription Detail Page ===
 *
 * Detailed view of a single subscription for administrators. Displays a summary
 * card with customer, product, and billing information alongside a vertical event
 * timeline showing the subscription's history with color-coded event types.
 *
 * === Features ===
 * - **Summary Card**: Customer info, product, status badge, frequency, period, Stripe ID
 * - **Event Timeline**: Vertical timeline with color-coded dots (green/yellow/red)
 * - **View in Stripe**: Direct link to Stripe dashboard for the subscription
 * - **Back Navigation**: Return to subscription list
 * - **Human-readable Events**: Translated event descriptions (no raw Stripe data)
 *
 * === Data Source ===
 * - GET /api/admin/subscriptions/:id
 *
 * @returns JSX element with subscription detail interface
 */

"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  ExternalLink,
  Clock,
  RefreshCw,
  AlertCircle,
} from "lucide-react";

// ---------- Types ----------

interface SubscriptionDetail {
  id: string;
  customer_id: string;
  plan_id: string;
  stripe_subscription_id: string;
  status: string;
  current_period_start: string | null;
  current_period_end: string | null;
  created_at: string | null;
  plan_frequency: string;
  plan_discount_percent: number;
  product_name: string;
  product_slug: string;
  customer_name: string;
  customer_email: string;
  variant_price_amount: number;
}

interface SubscriptionEvent {
  id: string;
  subscription_id: string;
  event_type:
    | "created"
    | "renewed"
    | "payment_failed"
    | "paused"
    | "resumed"
    | "skipped"
    | "canceled"
    | "updated";
  stripe_event_id: string | null;
  details: string | null;
  created_at: string | null;
}

// ---------- Constants ----------

const STATUS_BADGE_COLORS: Record<string, string> = {
  active: "bg-green-500 text-white",
  paused: "bg-yellow-500 text-white",
  canceled: "bg-red-500 text-white",
  past_due: "bg-blue-500 text-white",
  incomplete: "bg-gray-500 text-white",
  trialing: "bg-purple-500 text-white",
};

const EVENT_DOT_COLORS: Record<string, { bg: string; dot: string }> = {
  created: { bg: "bg-green-500/20", dot: "bg-green-400" },
  renewed: { bg: "bg-green-500/20", dot: "bg-green-400" },
  paused: { bg: "bg-yellow-500/20", dot: "bg-yellow-400" },
  skipped: { bg: "bg-yellow-500/20", dot: "bg-yellow-400" },
  resumed: { bg: "bg-blue-500/20", dot: "bg-blue-400" },
  canceled: { bg: "bg-red-500/20", dot: "bg-red-400" },
  payment_failed: { bg: "bg-red-500/20", dot: "bg-red-400" },
  updated: { bg: "bg-blue-500/20", dot: "bg-blue-400" },
};

const EVENT_DESCRIPTIONS: Record<string, string> = {
  created: "Subscription created",
  renewed: "Payment succeeded",
  paused: "Subscription paused by customer",
  skipped: "Next delivery skipped",
  resumed: "Subscription resumed",
  canceled: "Subscription canceled",
  payment_failed: "Payment failed",
  updated: "Subscription updated",
};

// ---------- Helpers ----------

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function formatDiscountedPrice(priceAmountCents: number, discountPercent: number): string {
  const discounted = (priceAmountCents * (1 - discountPercent / 100)) / 100;
  return `$${discounted.toFixed(2)}`;
}

function parseEventDetails(details: string | null): string {
  if (!details) return "";
  try {
    if (details.startsWith("{")) {
      const parsed = JSON.parse(details);
      if (parsed.amount) return ` -- $${(Number(parsed.amount) / 100).toFixed(2)} charged`;
      if (parsed.reason) return ` -- ${parsed.reason}`;
      if (parsed.message) return ` -- ${parsed.message}`;
      return "";
    }
    return ` -- ${details}`;
  } catch {
    return ` -- ${details}`;
  }
}

function getEventDescription(event: SubscriptionEvent): string {
  const base = EVENT_DESCRIPTIONS[event.event_type] || capitalize(event.event_type);
  const detailsSuffix = parseEventDetails(event.details);
  return `${base}${detailsSuffix}`;
}

// ---------- Component ----------

export default function AdminSubscriptionDetailPage() {
  const params = useParams();
  const router = useRouter();
  const subscriptionId = params.id as string;

  const [subscription, setSubscription] = useState<SubscriptionDetail | null>(null);
  const [events, setEvents] = useState<SubscriptionEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDetail = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch(`/api/admin/subscriptions/${subscriptionId}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch subscription (${response.status})`);
      }

      const result = (await response.json()) as {
        success: boolean;
        data: {
          subscription: SubscriptionDetail;
          events: SubscriptionEvent[];
        };
      };

      setSubscription(result.data.subscription);
      setEvents(result.data.events);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  }, [subscriptionId]);

  useEffect(() => {
    fetchDetail();
  }, [fetchDetail]);

  // ---------- Loading state ----------

  if (loading) {
    return (
      <div className="p-6">
        <div className="flex flex-col items-center justify-center py-12">
          <RefreshCw className="w-8 h-8 text-orange-400 animate-spin mb-4" />
          <p className="text-gray-400">Loading subscription details...</p>
        </div>
      </div>
    );
  }

  // ---------- Error state ----------

  if (error) {
    return (
      <div className="p-6">
        <div className="flex flex-col items-center justify-center py-12">
          <AlertCircle className="w-12 h-12 text-red-400 mb-4" />
          <p className="text-red-400 mb-4">{error}</p>
          <Button
            onClick={fetchDetail}
            className="bg-orange-600 hover:bg-orange-700"
          >
            Retry
          </Button>
        </div>
      </div>
    );
  }

  // ---------- Not found state ----------

  if (!subscription) {
    return (
      <div className="p-6">
        <div className="flex flex-col items-center justify-center py-12">
          <AlertCircle className="w-12 h-12 text-gray-600 mb-4" />
          <h3 className="text-lg font-medium text-gray-400 mb-4">Subscription not found</h3>
          <Button
            onClick={() => router.push("/admin/subscriptions")}
            className="bg-neutral-700 hover:bg-neutral-600 text-white"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Subscriptions
          </Button>
        </div>
      </div>
    );
  }

  // ---------- Main render ----------

  const statusColorClass = STATUS_BADGE_COLORS[subscription.status] || "bg-gray-500 text-white";

  return (
    <div className="p-6 space-y-6">
      {/* Back Navigation */}
      <Button
        onClick={() => router.push("/admin/subscriptions")}
        variant="ghost"
        className="text-gray-400 hover:text-white -ml-2"
      >
        <ArrowLeft className="w-4 h-4 mr-2" />
        Back to Subscriptions
      </Button>

      {/* Summary Card */}
      <Card className="bg-neutral-800 border-neutral-700 p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Left Column - Subscription Info */}
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-white mb-4">Subscription Info</h2>

            <div>
              <p className="text-sm text-gray-400 mb-1">Status</p>
              <Badge className={`${statusColorClass} text-xs`}>
                {capitalize(subscription.status.replace("_", " "))}
              </Badge>
            </div>

            <div>
              <p className="text-sm text-gray-400 mb-1">Subscription ID</p>
              <p className="text-xs text-gray-500 font-mono">{subscription.id}</p>
            </div>

            <div>
              <p className="text-sm text-gray-400 mb-1">Stripe Subscription ID</p>
              <p className="text-xs text-gray-500 font-mono">
                {subscription.stripe_subscription_id}
              </p>
            </div>

            <div>
              <p className="text-sm text-gray-400 mb-1">Created</p>
              <p className="text-sm text-white">
                {subscription.created_at
                  ? new Date(subscription.created_at).toLocaleDateString()
                  : "N/A"}
              </p>
            </div>
          </div>

          {/* Right Column - Details */}
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-white mb-4">Details</h2>

            <div>
              <p className="text-sm text-gray-400 mb-1">Customer</p>
              <p className="text-sm text-white">{subscription.customer_name || "Unknown"}</p>
              <p className="text-xs text-gray-500">{subscription.customer_email || "--"}</p>
            </div>

            <div>
              <p className="text-sm text-gray-400 mb-1">Product</p>
              <p className="text-sm text-white">{subscription.product_name || "--"}</p>
            </div>

            <div>
              <p className="text-sm text-gray-400 mb-1">Frequency</p>
              <p className="text-sm text-white">{capitalize(subscription.plan_frequency)}</p>
            </div>

            <div>
              <p className="text-sm text-gray-400 mb-1">Price</p>
              <p className="text-sm text-white">
                {formatDiscountedPrice(
                  subscription.variant_price_amount,
                  subscription.plan_discount_percent
                )}
              </p>
            </div>

            <div>
              <p className="text-sm text-gray-400 mb-1">Current Period</p>
              <p className="text-sm text-white">
                {subscription.current_period_start && subscription.current_period_end
                  ? `${new Date(subscription.current_period_start).toLocaleDateString()} - ${new Date(subscription.current_period_end).toLocaleDateString()}`
                  : "N/A"}
              </p>
            </div>
          </div>
        </div>

        {/* View in Stripe Button */}
        <div className="mt-6 pt-6 border-t border-neutral-700">
          <a
            href={`https://dashboard.stripe.com/subscriptions/${subscription.stripe_subscription_id}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Button className="bg-neutral-700 hover:bg-neutral-600 text-white">
              <ExternalLink className="w-4 h-4 mr-2" />
              View in Stripe
            </Button>
          </a>
        </div>
      </Card>

      {/* Event Timeline */}
      <div>
        <div className="flex items-center space-x-2 mb-4">
          <Clock className="w-5 h-5 text-gray-400" />
          <h2 className="text-lg font-semibold text-white">Event Timeline</h2>
        </div>

        {events.length === 0 ? (
          <Card className="bg-neutral-800 border-neutral-700 p-6">
            <p className="text-gray-500 text-center">No events recorded for this subscription.</p>
          </Card>
        ) : (
          <div className="relative pl-3">
            {/* Vertical line */}
            <div className="absolute left-[11px] top-0 bottom-0 w-0.5 bg-neutral-700" />

            <div className="space-y-6">
              {events.map((event) => {
                const colors = EVENT_DOT_COLORS[event.event_type] || {
                  bg: "bg-gray-500/20",
                  dot: "bg-gray-400",
                };

                return (
                  <div key={event.id} className="relative">
                    {/* Colored dot */}
                    <div
                      className={`absolute left-0 w-6 h-6 rounded-full flex items-center justify-center ${colors.bg}`}
                    >
                      <div className={`w-2.5 h-2.5 rounded-full ${colors.dot}`} />
                    </div>

                    {/* Content */}
                    <div className="ml-10">
                      <p className="text-white text-sm">{getEventDescription(event)}</p>
                      <p className="text-xs text-gray-500 mt-1">
                        {event.created_at
                          ? new Date(event.created_at).toLocaleString()
                          : "Unknown date"}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
