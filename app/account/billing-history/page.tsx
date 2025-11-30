"use client";

import { useState, useEffect, useCallback } from "react";
import { useUser } from "@clerk/nextjs";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  RefreshCw,
  ArrowLeft,
  Receipt,
  Download,
  ExternalLink,
  AlertCircle,
  Calendar,
  CheckCircle2,
  Clock,
  XCircle,
  Filter,
} from "lucide-react";
import type { SubscriptionInvoice } from "@/lib/types/subscription";

type InvoiceStatus = "all" | "paid" | "open" | "void" | "draft";

export default function BillingHistoryPage() {
  const { user, isLoaded } = useUser();
  const [invoices, setInvoices] = useState<SubscriptionInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<InvoiceStatus>("all");

  const fetchInvoices = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);

    try {
      // Fetch all subscriptions with invoices
      const response = await fetch("/api/subscriptions?includeInactive=true");
      if (!response.ok) {
        throw new Error("Failed to fetch billing history");
      }
      const data = await response.json();

      // For each subscription, fetch invoices
      const allInvoices: SubscriptionInvoice[] = [];
      for (const subscription of data.data || []) {
        try {
          const invoiceResponse = await fetch(
            `/api/subscriptions/${subscription.id}?includeInvoices=true`
          );
          if (invoiceResponse.ok) {
            const invoiceData = await invoiceResponse.json();
            if (invoiceData.invoices) {
              allInvoices.push(
                ...invoiceData.invoices.map((inv: SubscriptionInvoice) => ({
                  ...inv,
                  subscription_name:
                    invoiceData.data?.plan?.name || "Subscription",
                }))
              );
            }
          }
        } catch {
          // Continue even if one subscription fails
        }
      }

      // Sort by date, newest first
      allInvoices.sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );

      setInvoices(allInvoices);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (isLoaded && user) {
      fetchInvoices();
    } else if (isLoaded && !user) {
      setLoading(false);
    }
  }, [isLoaded, user, fetchInvoices]);

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

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "paid":
        return <CheckCircle2 className="h-4 w-4 text-green-400" />;
      case "open":
        return <Clock className="h-4 w-4 text-yellow-400" />;
      case "void":
      case "uncollectible":
        return <XCircle className="h-4 w-4 text-red-400" />;
      default:
        return <Clock className="h-4 w-4 text-gray-400" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "paid":
        return "bg-green-900/50 text-green-400";
      case "open":
        return "bg-yellow-900/50 text-yellow-400";
      case "void":
      case "uncollectible":
        return "bg-red-900/50 text-red-400";
      default:
        return "bg-gray-900/50 text-gray-400";
    }
  };

  const filteredInvoices =
    statusFilter === "all"
      ? invoices
      : invoices.filter((inv) => inv.status === statusFilter);

  // Calculate totals
  const totals = invoices.reduce(
    (acc, inv) => {
      if (inv.status === "paid") {
        acc.paid += inv.amount_paid;
      } else if (inv.status === "open") {
        acc.outstanding += inv.amount_due - inv.amount_paid;
      }
      return acc;
    },
    { paid: 0, outstanding: 0 }
  );

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
              Please sign in to view your billing history.
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
            <h1 className="text-2xl font-bold text-white">Billing History</h1>
            <p className="text-gray-400">View and download your invoices</p>
          </div>
          <Button
            variant="outline"
            onClick={fetchInvoices}
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

        {/* Summary Cards */}
        <div className="grid gap-4 sm:grid-cols-3">
          <Card className="border-neutral-700 bg-neutral-800 p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-neutral-700">
                <Receipt className="h-5 w-5 text-orange-400" />
              </div>
              <div>
                <p className="text-sm text-gray-400">Total Invoices</p>
                <p className="text-xl font-semibold text-white">
                  {invoices.length}
                </p>
              </div>
            </div>
          </Card>

          <Card className="border-neutral-700 bg-neutral-800 p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-900/50">
                <CheckCircle2 className="h-5 w-5 text-green-400" />
              </div>
              <div>
                <p className="text-sm text-gray-400">Total Paid</p>
                <p className="text-xl font-semibold text-white">
                  {formatPrice(totals.paid, "USD")}
                </p>
              </div>
            </div>
          </Card>

          <Card className="border-neutral-700 bg-neutral-800 p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-yellow-900/50">
                <Clock className="h-5 w-5 text-yellow-400" />
              </div>
              <div>
                <p className="text-sm text-gray-400">Outstanding</p>
                <p className="text-xl font-semibold text-white">
                  {formatPrice(totals.outstanding, "USD")}
                </p>
              </div>
            </div>
          </Card>
        </div>

        {/* Filter */}
        <div className="flex items-center gap-4">
          <Filter className="h-5 w-5 text-gray-400" />
          <div className="flex gap-2">
            {(["all", "paid", "open", "void"] as InvoiceStatus[]).map(
              (status) => (
                <Button
                  key={status}
                  variant={statusFilter === status ? "default" : "outline"}
                  size="sm"
                  onClick={() => setStatusFilter(status)}
                  className={
                    statusFilter === status
                      ? "bg-orange-600"
                      : "border-neutral-600 text-gray-300"
                  }
                >
                  {status.charAt(0).toUpperCase() + status.slice(1)}
                </Button>
              )
            )}
          </div>
        </div>

        {/* Invoices List */}
        {filteredInvoices.length === 0 ? (
          <Card className="border-neutral-700 bg-neutral-800 p-8 text-center">
            <Receipt className="mx-auto mb-4 h-12 w-12 text-gray-600" />
            <h3 className="mb-2 text-lg font-medium text-gray-400">
              No Invoices Found
            </h3>
            <p className="text-gray-500">
              {statusFilter === "all"
                ? "You don't have any invoices yet."
                : `No ${statusFilter} invoices found.`}
            </p>
          </Card>
        ) : (
          <Card className="border-neutral-700 bg-neutral-800">
            <div className="divide-y divide-neutral-700">
              {filteredInvoices.map((invoice) => (
                <div
                  key={invoice.id}
                  className="flex items-center gap-4 p-4 transition hover:bg-neutral-700/50"
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded bg-neutral-700">
                    {getStatusIcon(invoice.status)}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-white">
                        {formatPrice(invoice.amount_due.amount, invoice.amount_due.currency)}
                      </p>
                      <span
                        className={`rounded px-2 py-0.5 text-xs ${getStatusColor(
                          invoice.status
                        )}`}
                      >
                        {invoice.status}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-gray-400">
                      <Calendar className="h-3 w-3" />
                      <span>{formatDate(invoice.created_at)}</span>
                      {(invoice as any).subscription_name && (
                        <>
                          <span>•</span>
                          <span>{(invoice as any).subscription_name}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {invoice.invoice_pdf_url && (
                      <a
                        href={invoice.invoice_pdf_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 rounded bg-neutral-700 px-3 py-1.5 text-sm text-gray-300 transition hover:bg-neutral-600"
                      >
                        <Download className="h-4 w-4" />
                        PDF
                      </a>
                    )}
                    {invoice.hosted_invoice_url && (
                      <a
                        href={invoice.hosted_invoice_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 rounded bg-neutral-700 px-3 py-1.5 text-sm text-gray-300 transition hover:bg-neutral-600"
                      >
                        <ExternalLink className="h-4 w-4" />
                        View
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* Help Text */}
        <p className="text-center text-sm text-gray-500">
          Need help with billing?{" "}
          <a href="/contact" className="text-orange-400 hover:text-orange-300">
            Contact Support
          </a>
        </p>
      </div>
    </div>
  );
}
