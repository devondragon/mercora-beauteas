/**
 * === Admin Subscription Dashboard Page ===
 *
 * Subscription management dashboard for administrators. Displays key subscription
 * health metrics (MRR, churn, active count) as stat cards and a filterable,
 * paginated subscription table with status badges and customer details.
 *
 * === Features ===
 * - **Stat Cards**: Active subscriptions, MRR, churn rate, paused, new this month, revenue trend
 * - **Status Filtering**: All / Active / Paused / Canceled tab buttons
 * - **Search**: Debounced search by customer name or email
 * - **Subscription Table**: Status badge, customer, product, frequency, next billing, price, created, payment status
 * - **Pagination**: Server-side pagination with 20 items per page, First/Prev/Next/Last controls
 * - **Row Navigation**: Click any row to navigate to /admin/subscriptions/[id] detail page
 *
 * === Data Source ===
 * - GET /api/admin/subscriptions?limit=20&offset=0&status=active&search=john
 *
 * @returns JSX element with subscription dashboard interface
 */

"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Repeat,
  DollarSign,
  TrendingDown,
  TrendingUp,
  Pause,
  Plus,
  Search,
  RefreshCw,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";

// ---------- Types ----------

interface Subscription {
  id: string;
  customer_id: string;
  plan_id: string;
  stripe_subscription_id: string;
  stripe_customer_id: string;
  status: "active" | "paused" | "canceled" | "past_due" | "incomplete" | "trialing";
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean | null;
  created_at: string | null;
  plan_frequency: string;
  plan_discount_percent: number;
  product_name: string;
  product_slug: string;
  customer_name: string;
  customer_email: string;
  variant_price_amount: number;
}

interface SubscriptionStats {
  activeCount: number;
  pausedCount: number;
  mrr: number;
  churnRate: number;
  newThisMonth: number;
  revenueTrendPercent: number;
}

type StatusFilter = "all" | "active" | "paused" | "canceled";

// ---------- Constants ----------

const SUBS_PER_PAGE = 20;

const STATUS_TABS: { key: StatusFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "paused", label: "Paused" },
  { key: "canceled", label: "Canceled" },
];

const STATUS_BADGE_COLORS: Record<string, string> = {
  active: "bg-green-500 text-white",
  paused: "bg-yellow-500 text-white",
  canceled: "bg-red-500 text-white",
  past_due: "bg-blue-500 text-white",
  incomplete: "bg-gray-500 text-white",
  trialing: "bg-purple-500 text-white",
};

// ---------- Helpers ----------

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function formatDiscountedPrice(priceAmountCents: number, discountPercent: number): string {
  const discounted = priceAmountCents * (1 - discountPercent / 100) / 100;
  return `$${discounted.toFixed(2)}`;
}

// ---------- Component ----------

export default function AdminSubscriptionsPage() {
  const router = useRouter();

  // Data state
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [stats, setStats] = useState<SubscriptionStats>({
    activeCount: 0,
    pausedCount: 0,
    mrr: 0,
    churnRate: 0,
    newThisMonth: 0,
    revenueTrendPercent: 0,
  });

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalSubscriptions, setTotalSubscriptions] = useState(0);

  // Filter state
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");

  // UI state
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Debounce ref
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // ---------- Data fetching ----------

  const fetchSubscriptions = useCallback(
    async (page: number, status: StatusFilter, search: string) => {
      try {
        setLoading(true);
        setError(null);

        const offset = (page - 1) * SUBS_PER_PAGE;
        const params = new URLSearchParams({
          limit: String(SUBS_PER_PAGE),
          offset: String(offset),
        });
        if (status !== "all") params.set("status", status);
        if (search.trim()) params.set("search", search.trim());

        const response = await fetch(`/api/admin/subscriptions?${params.toString()}`);
        if (!response.ok) {
          throw new Error(`Failed to fetch subscriptions (${response.status})`);
        }

        const result = (await response.json()) as {
          success: boolean;
          data: Subscription[];
          stats: SubscriptionStats;
          meta: { total: number; limit: number; offset: number };
        };

        setSubscriptions(result.data);
        setStats(result.stats);
        setTotalSubscriptions(result.meta.total);
        setTotalPages(Math.max(1, Math.ceil(result.meta.total / SUBS_PER_PAGE)));
        setCurrentPage(page);
      } catch (err) {
        setError(err instanceof Error ? err.message : "An unexpected error occurred");
      } finally {
        setLoading(false);
      }
    },
    []
  );

  // Fetch on mount and when filter changes
  useEffect(() => {
    fetchSubscriptions(1, statusFilter, searchQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  // Debounced search
  useEffect(() => {
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = setTimeout(() => {
      fetchSubscriptions(1, statusFilter, searchQuery);
    }, 300);
    return () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery]);

  // ---------- Pagination handler ----------

  const handlePageChange = (page: number) => {
    fetchSubscriptions(page, statusFilter, searchQuery);
  };

  // ---------- Render helpers ----------

  const renderStatusBadge = (status: string) => {
    const colorClass = STATUS_BADGE_COLORS[status] || "bg-gray-500 text-white";
    return <Badge className={`${colorClass} text-xs`}>{capitalize(status.replace("_", " "))}</Badge>;
  };

  const renderPaymentBadge = (status: string) => {
    if (status === "active") {
      return <Badge className="bg-green-500/20 text-green-400 text-xs">Current</Badge>;
    }
    if (status === "past_due") {
      return <Badge className="bg-red-500/20 text-red-400 text-xs">Past Due</Badge>;
    }
    return <Badge className="bg-gray-500/20 text-gray-400 text-xs">N/A</Badge>;
  };

  // ---------- Loading state ----------

  if (loading && subscriptions.length === 0) {
    return (
      <div className="p-6">
        <div className="flex flex-col items-center justify-center py-12">
          <RefreshCw className="w-8 h-8 text-orange-400 animate-spin mb-4" />
          <p className="text-gray-400">Loading subscriptions...</p>
        </div>
      </div>
    );
  }

  // ---------- Error state ----------

  if (error && subscriptions.length === 0) {
    return (
      <div className="p-6">
        <div className="flex flex-col items-center justify-center py-12">
          <AlertCircle className="w-12 h-12 text-red-400 mb-4" />
          <p className="text-red-400 mb-4">{error}</p>
          <Button
            onClick={() => fetchSubscriptions(1, statusFilter, searchQuery)}
            className="bg-orange-600 hover:bg-orange-700"
          >
            Retry
          </Button>
        </div>
      </div>
    );
  }

  // ---------- Main render ----------

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white mb-2">Subscription Management</h1>
          <p className="text-gray-400">Monitor subscription health and browse customer subscriptions</p>
        </div>
        <Button
          onClick={() => fetchSubscriptions(currentPage, statusFilter, searchQuery)}
          disabled={loading}
          className="bg-orange-600 hover:bg-orange-700"
        >
          <RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        {/* Active Subscriptions */}
        <Card className="bg-neutral-800 border-neutral-700 p-6">
          <div className="flex items-center space-x-3">
            <Repeat className="w-8 h-8 text-green-400" />
            <div>
              <p className="text-sm text-gray-400">Active</p>
              <p className="text-2xl font-bold text-white">{stats.activeCount}</p>
              <p className="text-xs text-gray-500">subscriptions</p>
            </div>
          </div>
        </Card>

        {/* Monthly Recurring Revenue */}
        <Card className="bg-neutral-800 border-neutral-700 p-6">
          <div className="flex items-center space-x-3">
            <DollarSign className="w-8 h-8 text-green-400" />
            <div>
              <p className="text-sm text-gray-400">MRR</p>
              <p className="text-2xl font-bold text-white">${stats.mrr.toFixed(2)}</p>
              <p className="text-xs text-gray-500">monthly recurring</p>
            </div>
          </div>
        </Card>

        {/* Churn Rate */}
        <Card className="bg-neutral-800 border-neutral-700 p-6">
          <div className="flex items-center space-x-3">
            <TrendingDown className={`w-8 h-8 ${stats.churnRate > 5 ? "text-red-400" : "text-green-400"}`} />
            <div>
              <p className="text-sm text-gray-400">Churn Rate</p>
              <p className={`text-2xl font-bold ${stats.churnRate > 5 ? "text-red-400" : "text-white"}`}>
                {stats.churnRate.toFixed(1)}%
              </p>
              <p className="text-xs text-gray-500">30-day rolling</p>
            </div>
          </div>
        </Card>

        {/* Paused */}
        <Card className="bg-neutral-800 border-neutral-700 p-6">
          <div className="flex items-center space-x-3">
            <Pause className="w-8 h-8 text-yellow-400" />
            <div>
              <p className="text-sm text-gray-400">Paused</p>
              <p className="text-2xl font-bold text-white">{stats.pausedCount}</p>
              <p className="text-xs text-gray-500">subscriptions</p>
            </div>
          </div>
        </Card>

        {/* New This Month */}
        <Card className="bg-neutral-800 border-neutral-700 p-6">
          <div className="flex items-center space-x-3">
            <Plus className="w-8 h-8 text-blue-400" />
            <div>
              <p className="text-sm text-gray-400">New This Month</p>
              <p className="text-2xl font-bold text-white">{stats.newThisMonth}</p>
              <p className="text-xs text-gray-500">subscriptions</p>
            </div>
          </div>
        </Card>

        {/* Revenue Trend */}
        <Card className="bg-neutral-800 border-neutral-700 p-6">
          <div className="flex items-center space-x-3">
            {stats.revenueTrendPercent >= 0 ? (
              <TrendingUp className="w-8 h-8 text-green-400" />
            ) : (
              <TrendingDown className="w-8 h-8 text-red-400" />
            )}
            <div>
              <p className="text-sm text-gray-400">Revenue Trend</p>
              <p className={`text-2xl font-bold ${stats.revenueTrendPercent >= 0 ? "text-green-400" : "text-red-400"}`}>
                {stats.revenueTrendPercent > 0 ? "+" : ""}
                {stats.revenueTrendPercent.toFixed(1)}%
              </p>
              <p className="text-xs text-gray-500">vs last month</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Filter Bar */}
      <div className="flex flex-col sm:flex-row gap-4">
        {/* Status Tabs */}
        <div className="flex items-center space-x-2">
          {STATUS_TABS.map((tab) => (
            <Button
              key={tab.key}
              onClick={() => setStatusFilter(tab.key)}
              className={
                statusFilter === tab.key
                  ? "bg-orange-600 hover:bg-orange-700 text-white"
                  : "bg-neutral-800 text-gray-400 hover:bg-neutral-700 hover:text-white"
              }
              size="sm"
            >
              {tab.label}
            </Button>
          ))}
        </div>

        {/* Search */}
        <div className="flex-1">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
            <Input
              placeholder="Search by customer name or email..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 bg-neutral-700 border-neutral-600 text-white"
            />
          </div>
        </div>
      </div>

      {/* Subscription Table */}
      {subscriptions.length === 0 && !loading ? (
        <Card className="bg-neutral-800 border-neutral-700 p-8">
          <div className="flex flex-col items-center justify-center py-8">
            <Repeat className="w-12 h-12 text-gray-600 mb-4" />
            <h3 className="text-lg font-medium text-gray-400 mb-2">No subscriptions yet</h3>
            <p className="text-gray-500">
              Subscriptions will appear here once customers subscribe to products.
            </p>
          </div>
        </Card>
      ) : (
        <Card className="bg-neutral-800 border-neutral-700 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-neutral-700">
                  <th className="text-left text-xs font-medium text-gray-400 uppercase tracking-wider px-4 py-3">
                    Status
                  </th>
                  <th className="text-left text-xs font-medium text-gray-400 uppercase tracking-wider px-4 py-3">
                    Customer
                  </th>
                  <th className="text-left text-xs font-medium text-gray-400 uppercase tracking-wider px-4 py-3">
                    Product
                  </th>
                  <th className="text-left text-xs font-medium text-gray-400 uppercase tracking-wider px-4 py-3">
                    Frequency
                  </th>
                  <th className="text-left text-xs font-medium text-gray-400 uppercase tracking-wider px-4 py-3">
                    Next Billing
                  </th>
                  <th className="text-left text-xs font-medium text-gray-400 uppercase tracking-wider px-4 py-3">
                    Price
                  </th>
                  <th className="text-left text-xs font-medium text-gray-400 uppercase tracking-wider px-4 py-3">
                    Created
                  </th>
                  <th className="text-left text-xs font-medium text-gray-400 uppercase tracking-wider px-4 py-3">
                    Payment Status
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-700">
                {subscriptions.map((sub) => (
                  <tr
                    key={sub.id}
                    onClick={() => router.push(`/admin/subscriptions/${sub.id}`)}
                    className="cursor-pointer hover:bg-neutral-800/50 transition-colors"
                  >
                    <td className="px-4 py-3">{renderStatusBadge(sub.status)}</td>
                    <td className="px-4 py-3">
                      <div className="text-white text-sm">{sub.customer_name || "Unknown"}</div>
                      <div className="text-xs text-gray-500">{sub.customer_email || "--"}</div>
                    </td>
                    <td className="px-4 py-3 text-sm text-white">{sub.product_name || "--"}</td>
                    <td className="px-4 py-3 text-sm text-white">{capitalize(sub.plan_frequency)}</td>
                    <td className="px-4 py-3 text-sm text-white">
                      {sub.current_period_end
                        ? new Date(sub.current_period_end).toLocaleDateString()
                        : "--"}
                    </td>
                    <td className="px-4 py-3 text-sm text-white">
                      {formatDiscountedPrice(sub.variant_price_amount, sub.plan_discount_percent)}
                    </td>
                    <td className="px-4 py-3 text-sm text-white">
                      {sub.created_at ? new Date(sub.created_at).toLocaleDateString() : "--"}
                    </td>
                    <td className="px-4 py-3">{renderPaymentBadge(sub.status)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Pagination Controls */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between bg-neutral-800 border border-neutral-700 rounded-lg p-4">
          <div className="flex items-center space-x-2 text-sm text-gray-400">
            <span>Showing</span>
            <span className="font-medium text-white">
              {Math.min((currentPage - 1) * SUBS_PER_PAGE + 1, totalSubscriptions)}-
              {Math.min(currentPage * SUBS_PER_PAGE, totalSubscriptions)}
            </span>
            <span>of</span>
            <span className="font-medium text-white">{totalSubscriptions}</span>
            <span>subscriptions</span>
          </div>

          <div className="flex items-center space-x-1">
            {/* First */}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handlePageChange(1)}
              disabled={currentPage === 1 || loading}
              className="text-gray-400 hover:text-white"
            >
              <ChevronsLeft className="w-4 h-4" />
            </Button>

            {/* Previous */}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handlePageChange(currentPage - 1)}
              disabled={currentPage === 1 || loading}
              className="text-gray-400 hover:text-white"
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>

            {/* Page Numbers */}
            <div className="flex items-center space-x-1">
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                let pageNum: number;
                if (totalPages <= 5) {
                  pageNum = i + 1;
                } else if (currentPage <= 3) {
                  pageNum = i + 1;
                } else if (currentPage >= totalPages - 2) {
                  pageNum = totalPages - 4 + i;
                } else {
                  pageNum = currentPage - 2 + i;
                }

                return (
                  <Button
                    key={pageNum}
                    variant={currentPage === pageNum ? "default" : "ghost"}
                    size="sm"
                    onClick={() => handlePageChange(pageNum)}
                    disabled={loading}
                    className={`min-w-[2rem] ${
                      currentPage === pageNum
                        ? "bg-orange-600 hover:bg-orange-700 text-white"
                        : "text-gray-400 hover:text-white"
                    }`}
                  >
                    {pageNum}
                  </Button>
                );
              })}
            </div>

            {/* Next */}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handlePageChange(currentPage + 1)}
              disabled={currentPage === totalPages || loading}
              className="text-gray-400 hover:text-white"
            >
              <ChevronRight className="w-4 h-4" />
            </Button>

            {/* Last */}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handlePageChange(totalPages)}
              disabled={currentPage === totalPages || loading}
              className="text-gray-400 hover:text-white"
            >
              <ChevronsRight className="w-4 h-4" />
            </Button>
          </div>

          <div className="flex items-center space-x-2">
            <span className="text-sm text-gray-400">Page</span>
            <span className="font-medium text-white">{currentPage}</span>
            <span className="text-sm text-gray-400">of</span>
            <span className="font-medium text-white">{totalPages}</span>
          </div>
        </div>
      )}
    </div>
  );
}
