"use client";

import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  RefreshCw,
  ArrowLeft,
  DollarSign,
  Users,
  TrendingUp,
  TrendingDown,
  Activity,
  Target,
  Percent,
  Calendar,
  AlertCircle,
} from "lucide-react";

interface AnalyticsData {
  mrr: number;
  arr: number;
  activeSubscriptions: number;
  statusBreakdown: Record<string, number>;
  newSubscriptions30Days: number;
  cancellations30Days: number;
  churnRate: number;
  growthRate: number;
  revenue30Days: number;
  arpu: number;
  trialConversionRate: number;
  planDistribution: Array<{
    planId: string;
    planName: string;
    count: number;
  }>;
  recentEvents: Array<{
    id: string;
    subscriptionId: string;
    eventType: string;
    createdAt: string;
  }>;
  generatedAt: string;
}

export default function SubscriptionAnalyticsPage() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAnalytics = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/subscriptions/analytics");
      if (!response.ok) {
        throw new Error("Failed to fetch analytics");
      }
      const result = await response.json();
      setData(result.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAnalytics();
  }, []);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount / 100);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  const getEventIcon = (eventType: string) => {
    switch (eventType) {
      case "created":
      case "activated":
        return <TrendingUp className="h-4 w-4 text-green-400" />;
      case "cancelled":
      case "expired":
        return <TrendingDown className="h-4 w-4 text-red-400" />;
      case "payment_succeeded":
        return <DollarSign className="h-4 w-4 text-green-400" />;
      case "payment_failed":
        return <AlertCircle className="h-4 w-4 text-red-400" />;
      case "paused":
        return <Activity className="h-4 w-4 text-yellow-400" />;
      default:
        return <Activity className="h-4 w-4 text-gray-400" />;
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-neutral-900 p-6">
        <div className="mx-auto max-w-7xl">
          <div className="flex items-center justify-center py-12">
            <RefreshCw className="h-8 w-8 animate-spin text-orange-400" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-900 p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            onClick={() => (window.location.href = "/admin/subscriptions")}
            className="text-gray-400 hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex-1">
            <h1 className="text-2xl font-bold text-white">Subscription Analytics</h1>
            <p className="text-gray-400">
              {data?.generatedAt
                ? `Last updated: ${formatDate(data.generatedAt)}`
                : "Real-time subscription metrics"}
            </p>
          </div>
          <Button
            onClick={fetchAnalytics}
            disabled={loading}
            className="bg-orange-600 hover:bg-orange-700"
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        {error && (
          <Card className="border-red-700 bg-red-900/30 p-4">
            <div className="flex items-center gap-2 text-red-400">
              <AlertCircle className="h-5 w-5" />
              <span>{error}</span>
            </div>
          </Card>
        )}

        {data && (
          <>
            {/* Key Metrics */}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Card className="border-neutral-700 bg-neutral-800 p-6">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm text-gray-400">Monthly Recurring Revenue</p>
                    <p className="mt-1 text-3xl font-bold text-green-400">
                      {formatCurrency(data.mrr)}
                    </p>
                    <p className="mt-1 text-xs text-gray-500">
                      ARR: {formatCurrency(data.arr)}
                    </p>
                  </div>
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-900/50">
                    <DollarSign className="h-5 w-5 text-green-400" />
                  </div>
                </div>
              </Card>

              <Card className="border-neutral-700 bg-neutral-800 p-6">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm text-gray-400">Active Subscribers</p>
                    <p className="mt-1 text-3xl font-bold text-blue-400">
                      {data.activeSubscriptions}
                    </p>
                    <p className="mt-1 text-xs text-gray-500">
                      ARPU: {formatCurrency(data.arpu)}/mo
                    </p>
                  </div>
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-900/50">
                    <Users className="h-5 w-5 text-blue-400" />
                  </div>
                </div>
              </Card>

              <Card className="border-neutral-700 bg-neutral-800 p-6">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm text-gray-400">Growth Rate</p>
                    <p
                      className={`mt-1 text-3xl font-bold ${
                        data.growthRate >= 0 ? "text-green-400" : "text-red-400"
                      }`}
                    >
                      {data.growthRate >= 0 ? "+" : ""}
                      {data.growthRate.toFixed(1)}%
                    </p>
                    <p className="mt-1 text-xs text-gray-500">
                      +{data.newSubscriptions30Days} new this month
                    </p>
                  </div>
                  <div
                    className={`flex h-10 w-10 items-center justify-center rounded-full ${
                      data.growthRate >= 0 ? "bg-green-900/50" : "bg-red-900/50"
                    }`}
                  >
                    {data.growthRate >= 0 ? (
                      <TrendingUp className="h-5 w-5 text-green-400" />
                    ) : (
                      <TrendingDown className="h-5 w-5 text-red-400" />
                    )}
                  </div>
                </div>
              </Card>

              <Card className="border-neutral-700 bg-neutral-800 p-6">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm text-gray-400">Churn Rate</p>
                    <p
                      className={`mt-1 text-3xl font-bold ${
                        data.churnRate <= 5 ? "text-green-400" : "text-red-400"
                      }`}
                    >
                      {data.churnRate.toFixed(1)}%
                    </p>
                    <p className="mt-1 text-xs text-gray-500">
                      {data.cancellations30Days} cancellations
                    </p>
                  </div>
                  <div
                    className={`flex h-10 w-10 items-center justify-center rounded-full ${
                      data.churnRate <= 5 ? "bg-green-900/50" : "bg-red-900/50"
                    }`}
                  >
                    <Percent className="h-5 w-5 text-yellow-400" />
                  </div>
                </div>
              </Card>
            </div>

            {/* Secondary Metrics */}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Card className="border-neutral-700 bg-neutral-800 p-6">
                <div className="flex items-center gap-2 mb-4">
                  <Target className="h-5 w-5 text-purple-400" />
                  <h3 className="font-semibold text-white">Trial Conversion</h3>
                </div>
                <p className="text-4xl font-bold text-purple-400">
                  {data.trialConversionRate.toFixed(1)}%
                </p>
                <p className="mt-1 text-sm text-gray-400">of trials convert to paid</p>
              </Card>

              <Card className="border-neutral-700 bg-neutral-800 p-6">
                <div className="flex items-center gap-2 mb-4">
                  <Calendar className="h-5 w-5 text-cyan-400" />
                  <h3 className="font-semibold text-white">30-Day Revenue</h3>
                </div>
                <p className="text-4xl font-bold text-cyan-400">
                  {formatCurrency(data.revenue30Days)}
                </p>
                <p className="mt-1 text-sm text-gray-400">collected this month</p>
              </Card>

              <Card className="border-neutral-700 bg-neutral-800 p-6">
                <div className="flex items-center gap-2 mb-4">
                  <Activity className="h-5 w-5 text-orange-400" />
                  <h3 className="font-semibold text-white">Status Breakdown</h3>
                </div>
                <div className="space-y-2">
                  {Object.entries(data.statusBreakdown).map(([status, count]) => (
                    <div key={status} className="flex items-center justify-between">
                      <span className="text-sm capitalize text-gray-400">{status}</span>
                      <span className="text-sm font-medium text-white">{count}</span>
                    </div>
                  ))}
                </div>
              </Card>
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
              {/* Plan Distribution */}
              <Card className="border-neutral-700 bg-neutral-800 p-6">
                <h3 className="mb-4 text-lg font-semibold text-white">
                  Plan Distribution
                </h3>
                {data.planDistribution.length === 0 ? (
                  <p className="text-gray-400">No active subscriptions</p>
                ) : (
                  <div className="space-y-4">
                    {data.planDistribution.map((plan) => {
                      const percentage =
                        (plan.count / data.activeSubscriptions) * 100;
                      return (
                        <div key={plan.planId}>
                          <div className="mb-1 flex items-center justify-between">
                            <span className="text-sm text-gray-300">{plan.planName}</span>
                            <span className="text-sm font-medium text-white">
                              {plan.count} ({percentage.toFixed(1)}%)
                            </span>
                          </div>
                          <div className="h-2 rounded-full bg-neutral-700">
                            <div
                              className="h-2 rounded-full bg-orange-500"
                              style={{ width: `${percentage}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </Card>

              {/* Recent Activity */}
              <Card className="border-neutral-700 bg-neutral-800 p-6">
                <h3 className="mb-4 text-lg font-semibold text-white">
                  Recent Activity
                </h3>
                {data.recentEvents.length === 0 ? (
                  <p className="text-gray-400">No recent activity</p>
                ) : (
                  <div className="space-y-3 max-h-80 overflow-y-auto">
                    {data.recentEvents.map((event) => (
                      <div
                        key={event.id}
                        className="flex items-center gap-3 rounded bg-neutral-700/50 p-3"
                      >
                        {getEventIcon(event.eventType)}
                        <div className="flex-1">
                          <p className="text-sm capitalize text-white">
                            {event.eventType.replace(/_/g, " ")}
                          </p>
                          <p className="text-xs text-gray-500">
                            {event.subscriptionId.slice(0, 12)}...
                          </p>
                        </div>
                        <span className="text-xs text-gray-500">
                          {formatDate(event.createdAt)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
