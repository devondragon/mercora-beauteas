"use client";

import { useState, useEffect, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { SubscriptionStatusBadge } from "@/components/subscriptions/SubscriptionStatusBadge";
import {
  RefreshCw,
  Search,
  Filter,
  Plus,
  Users,
  DollarSign,
  TrendingUp,
  Calendar,
  ChevronDown,
  ChevronRight,
  Eye,
  Settings,
  CreditCard,
} from "lucide-react";
import type { Subscription, SubscriptionPlan, SubscriptionStatus } from "@/lib/types/subscription";

interface SubscriptionWithPlan extends Subscription {
  plan?: SubscriptionPlan;
}

export default function AdminSubscriptionsPage() {
  const [subscriptions, setSubscriptions] = useState<SubscriptionWithPlan[]>([]);
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedSubs, setExpandedSubs] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<"subscriptions" | "plans">("subscriptions");
  const [mrr, setMrr] = useState(0);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [subsRes, plansRes] = await Promise.all([
        fetch("/api/subscriptions?admin=true"),
        fetch("/api/subscription-plans?includeInactive=true"),
      ]);

      if (subsRes.ok) {
        const subsData = await subsRes.json();
        setSubscriptions(subsData.data || []);
      }

      if (plansRes.ok) {
        const plansData = await plansRes.json();
        setPlans(plansData.data || []);
      }

      // Calculate MRR from active subscriptions
      // This is a simplified calculation
      const activeCount = subscriptions.filter(
        (s) => s.status === "active" || s.status === "trialing"
      ).length;
      // TODO: Get actual MRR from API
    } catch (error) {
      console.error("Error fetching data:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const formatCurrency = (amount: number, currency: string = "USD") => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
    }).format(amount / 100);
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return "—";
    return new Date(dateString).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  const toggleExpansion = (id: string) => {
    setExpandedSubs((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

  const filteredSubscriptions = subscriptions.filter((sub) => {
    const matchesStatus = statusFilter === "all" || sub.status === statusFilter;
    const matchesSearch =
      searchQuery === "" ||
      sub.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      sub.customer_id.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesStatus && matchesSearch;
  });

  const activeCount = subscriptions.filter(
    (s) => s.status === "active" || s.status === "trialing"
  ).length;
  const trialingCount = subscriptions.filter((s) => s.status === "trialing").length;
  const pastDueCount = subscriptions.filter((s) => s.status === "past_due").length;

  if (loading) {
    return (
      <div className="p-6">
        <div className="flex items-center justify-center py-12">
          <RefreshCw className="h-8 w-8 animate-spin text-orange-400" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="mb-2 text-2xl font-bold text-white">Subscriptions</h1>
          <p className="text-gray-400">Manage subscription plans and customer subscriptions</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={fetchData}
            disabled={loading}
            variant="outline"
            className="border-neutral-600 text-gray-300"
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
          <Button
            onClick={() => (window.location.href = "/admin/subscriptions/plans/new")}
            className="bg-orange-600 hover:bg-orange-700"
          >
            <Plus className="mr-2 h-4 w-4" />
            New Plan
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <Card className="border-neutral-700 bg-neutral-800 p-4">
          <div className="flex items-center space-x-3">
            <Users className="h-8 w-8 text-blue-400" />
            <div>
              <p className="text-sm text-gray-400">Active Subscribers</p>
              <p className="text-2xl font-bold text-white">{activeCount}</p>
            </div>
          </div>
        </Card>

        <Card className="border-neutral-700 bg-neutral-800 p-4">
          <div className="flex items-center space-x-3">
            <TrendingUp className="h-8 w-8 text-green-400" />
            <div>
              <p className="text-sm text-gray-400">In Trial</p>
              <p className="text-2xl font-bold text-white">{trialingCount}</p>
            </div>
          </div>
        </Card>

        <Card className="border-neutral-700 bg-neutral-800 p-4">
          <div className="flex items-center space-x-3">
            <DollarSign className="h-8 w-8 text-orange-400" />
            <div>
              <p className="text-sm text-gray-400">Past Due</p>
              <p className="text-2xl font-bold text-white">{pastDueCount}</p>
            </div>
          </div>
        </Card>

        <Card className="border-neutral-700 bg-neutral-800 p-4">
          <div className="flex items-center space-x-3">
            <CreditCard className="h-8 w-8 text-purple-400" />
            <div>
              <p className="text-sm text-gray-400">Active Plans</p>
              <p className="text-2xl font-bold text-white">
                {plans.filter((p) => p.status === "active").length}
              </p>
            </div>
          </div>
        </Card>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-neutral-700">
        <button
          onClick={() => setActiveTab("subscriptions")}
          className={`px-4 py-2 text-sm font-medium transition ${
            activeTab === "subscriptions"
              ? "border-b-2 border-orange-500 text-orange-500"
              : "text-gray-400 hover:text-white"
          }`}
        >
          Subscriptions ({subscriptions.length})
        </button>
        <button
          onClick={() => setActiveTab("plans")}
          className={`px-4 py-2 text-sm font-medium transition ${
            activeTab === "plans"
              ? "border-b-2 border-orange-500 text-orange-500"
              : "text-gray-400 hover:text-white"
          }`}
        >
          Plans ({plans.length})
        </button>
      </div>

      {activeTab === "subscriptions" && (
        <>
          {/* Filters */}
          <Card className="border-neutral-700 bg-neutral-800 p-4">
            <div className="flex flex-col gap-4 sm:flex-row">
              <div className="flex-1">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                  <Input
                    placeholder="Search by subscription ID or customer..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="border-neutral-600 bg-neutral-700 pl-10 text-white"
                  />
                </div>
              </div>

              <div className="flex items-center space-x-2">
                <Filter className="h-4 w-4 text-gray-400" />
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="rounded-md border border-neutral-600 bg-neutral-700 px-3 py-2 text-white"
                >
                  <option value="all">All Status</option>
                  <option value="active">Active</option>
                  <option value="trialing">Trialing</option>
                  <option value="paused">Paused</option>
                  <option value="past_due">Past Due</option>
                  <option value="cancelled">Cancelled</option>
                  <option value="expired">Expired</option>
                </select>
              </div>
            </div>
          </Card>

          {/* Subscriptions List */}
          <Card className="border-neutral-700 bg-neutral-800">
            {filteredSubscriptions.length === 0 ? (
              <div className="p-8 text-center">
                <Users className="mx-auto mb-4 h-12 w-12 text-gray-600" />
                <h3 className="mb-2 text-lg font-medium text-gray-400">
                  No subscriptions found
                </h3>
                <p className="text-gray-500">No subscriptions match your filters</p>
              </div>
            ) : (
              <div className="divide-y divide-neutral-700">
                {filteredSubscriptions.map((sub) => {
                  const isExpanded = expandedSubs.has(sub.id);
                  return (
                    <div key={sub.id} className="p-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-4">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => toggleExpansion(sub.id)}
                            className="p-1 text-gray-400 hover:text-white"
                          >
                            {isExpanded ? (
                              <ChevronDown className="h-4 w-4" />
                            ) : (
                              <ChevronRight className="h-4 w-4" />
                            )}
                          </Button>

                          <div>
                            <h3 className="font-medium text-white">
                              {sub.plan?.name || "Unknown Plan"}
                            </h3>
                            <div className="flex items-center space-x-3 text-sm text-gray-400">
                              <span className="font-mono">{sub.id}</span>
                              <span>•</span>
                              <span>Customer: {sub.customer_id}</span>
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center space-x-3">
                          <SubscriptionStatusBadge status={sub.status} />
                          <span className="text-lg font-semibold text-white">
                            {sub.plan
                              ? formatCurrency(
                                  sub.plan.price.amount * sub.quantity,
                                  sub.plan.price.currency
                                )
                              : "—"}
                          </span>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              (window.location.href = `/admin/subscriptions/${sub.id}`)
                            }
                            className="text-gray-400 hover:text-white"
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>

                      {isExpanded && (
                        <div className="mt-4 space-y-3 rounded bg-neutral-900 p-4 pl-12">
                          <div className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
                            <div>
                              <p className="text-gray-500">Period Start</p>
                              <p className="text-gray-300">
                                {formatDate(sub.current_period_start)}
                              </p>
                            </div>
                            <div>
                              <p className="text-gray-500">Period End</p>
                              <p className="text-gray-300">
                                {formatDate(sub.current_period_end)}
                              </p>
                            </div>
                            <div>
                              <p className="text-gray-500">Quantity</p>
                              <p className="text-gray-300">{sub.quantity}</p>
                            </div>
                            <div>
                              <p className="text-gray-500">Created</p>
                              <p className="text-gray-300">{formatDate(sub.created_at)}</p>
                            </div>
                          </div>
                          {sub.cancel_at_period_end && (
                            <p className="text-sm text-yellow-500">
                              Scheduled to cancel at end of period
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </>
      )}

      {activeTab === "plans" && (
        <Card className="border-neutral-700 bg-neutral-800">
          {plans.length === 0 ? (
            <div className="p-8 text-center">
              <CreditCard className="mx-auto mb-4 h-12 w-12 text-gray-600" />
              <h3 className="mb-2 text-lg font-medium text-gray-400">No plans found</h3>
              <p className="mb-4 text-gray-500">Create your first subscription plan</p>
              <Button
                onClick={() => (window.location.href = "/admin/subscriptions/plans/new")}
                className="bg-orange-600 hover:bg-orange-700"
              >
                <Plus className="mr-2 h-4 w-4" />
                Create Plan
              </Button>
            </div>
          ) : (
            <div className="divide-y divide-neutral-700">
              {plans.map((plan) => (
                <div key={plan.id} className="flex items-center justify-between p-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium text-white">{plan.name}</h3>
                      <Badge
                        className={
                          plan.status === "active"
                            ? "bg-green-600 text-white"
                            : plan.status === "inactive"
                            ? "bg-yellow-600 text-white"
                            : "bg-gray-600 text-white"
                        }
                      >
                        {plan.status}
                      </Badge>
                    </div>
                    <p className="text-sm text-gray-400">
                      {plan.description || "No description"}
                    </p>
                  </div>

                  <div className="flex items-center space-x-4">
                    <div className="text-right">
                      <p className="text-lg font-semibold text-white">
                        {formatCurrency(plan.price.amount, plan.price.currency)}
                      </p>
                      <p className="text-sm text-gray-400">
                        per {plan.interval_count > 1 ? `${plan.interval_count} ` : ""}
                        {plan.interval}
                        {plan.interval_count > 1 ? "s" : ""}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        (window.location.href = `/admin/subscriptions/plans/${plan.id}`)
                      }
                      className="text-gray-400 hover:text-white"
                    >
                      <Settings className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
