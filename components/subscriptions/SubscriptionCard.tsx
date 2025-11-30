"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SubscriptionStatusBadge } from "./SubscriptionStatusBadge";
import type { Subscription, SubscriptionPlan } from "@/lib/types/subscription";
import {
  Calendar,
  CreditCard,
  Package,
  ChevronDown,
  ChevronUp,
  Pause,
  Play,
  XCircle,
  Edit,
  RefreshCw,
} from "lucide-react";

interface SubscriptionCardProps {
  subscription: Subscription & { plan?: SubscriptionPlan };
  onPause?: (id: string) => Promise<void>;
  onResume?: (id: string) => Promise<void>;
  onCancel?: (id: string) => Promise<void>;
  onManage?: (id: string) => void;
  showActions?: boolean;
}

export function SubscriptionCard({
  subscription,
  onPause,
  onResume,
  onCancel,
  onManage,
  showActions = true,
}: SubscriptionCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);

  const plan = subscription.plan;
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

  const getIntervalLabel = () => {
    if (!plan) return "";
    const count = plan.interval_count;
    const interval = plan.interval;
    if (count === 1) {
      return `/${interval}`;
    }
    return `/${count} ${interval}s`;
  };

  const handlePause = async () => {
    if (!onPause) return;
    setLoading(true);
    try {
      await onPause(subscription.id);
    } finally {
      setLoading(false);
    }
  };

  const handleResume = async () => {
    if (!onResume) return;
    setLoading(true);
    try {
      await onResume(subscription.id);
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = async () => {
    if (!onCancel) return;
    if (!confirm("Are you sure you want to cancel this subscription?")) return;
    setLoading(true);
    try {
      await onCancel(subscription.id);
    } finally {
      setLoading(false);
    }
  };

  const canPause = subscription.status === "active";
  const canResume = subscription.status === "paused";
  const canCancel = ["active", "trialing", "paused", "past_due"].includes(
    subscription.status
  );

  return (
    <Card className="border-neutral-700 bg-neutral-800 p-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h3 className="text-lg font-semibold text-white">
              {plan?.name || "Subscription"}
            </h3>
            <SubscriptionStatusBadge status={subscription.status} />
          </div>
          {plan?.description && (
            <p className="mt-1 text-sm text-gray-400">{plan.description}</p>
          )}
        </div>
        <div className="text-right">
          <p className="text-xl font-bold text-white">
            {plan ? formatCurrency(plan.price.amount, plan.price.currency) : "—"}
            <span className="text-sm font-normal text-gray-400">
              {getIntervalLabel()}
            </span>
          </p>
          {subscription.quantity > 1 && (
            <p className="text-sm text-gray-400">
              Qty: {subscription.quantity}
            </p>
          )}
        </div>
      </div>

      {/* Summary Row */}
      <div className="mt-4 flex flex-wrap items-center gap-4 text-sm text-gray-400">
        <div className="flex items-center gap-1">
          <Calendar className="h-4 w-4" />
          <span>
            {subscription.status === "trialing" ? "Trial ends" : "Next billing"}:{" "}
            {formatDate(subscription.current_period_end)}
          </span>
        </div>
        {subscription.cancel_at_period_end && (
          <div className="flex items-center gap-1 text-yellow-500">
            <XCircle className="h-4 w-4" />
            <span>Cancels at period end</span>
          </div>
        )}
      </div>

      {/* Expandable Details */}
      <div className="mt-4">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex w-full items-center justify-between rounded border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-gray-300 transition hover:border-orange-500"
        >
          <span>{expanded ? "Hide details" : "Show details"}</span>
          {expanded ? (
            <ChevronUp className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
        </button>

        {expanded && (
          <div className="mt-4 space-y-3 rounded bg-neutral-900 p-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-gray-500">Subscription ID</p>
                <p className="font-mono text-gray-300">{subscription.id}</p>
              </div>
              <div>
                <p className="text-gray-500">Started</p>
                <p className="text-gray-300">
                  {formatDate(subscription.created_at)}
                </p>
              </div>
              <div>
                <p className="text-gray-500">Current Period</p>
                <p className="text-gray-300">
                  {formatDate(subscription.current_period_start)} -{" "}
                  {formatDate(subscription.current_period_end)}
                </p>
              </div>
              {subscription.trial_end && (
                <div>
                  <p className="text-gray-500">Trial Ends</p>
                  <p className="text-gray-300">
                    {formatDate(subscription.trial_end)}
                  </p>
                </div>
              )}
              {subscription.cancelled_at && (
                <div>
                  <p className="text-gray-500">Cancelled On</p>
                  <p className="text-gray-300">
                    {formatDate(subscription.cancelled_at)}
                  </p>
                </div>
              )}
              {subscription.cancel_reason && (
                <div className="col-span-2">
                  <p className="text-gray-500">Cancel Reason</p>
                  <p className="text-gray-300">{subscription.cancel_reason}</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Actions */}
      {showActions && (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-neutral-700 pt-4">
          {onManage && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onManage(subscription.id)}
              className="border-neutral-600 text-gray-300 hover:bg-neutral-700 hover:text-white"
            >
              <Edit className="mr-1 h-4 w-4" />
              Manage
            </Button>
          )}
          {canPause && onPause && (
            <Button
              variant="outline"
              size="sm"
              onClick={handlePause}
              disabled={loading}
              className="border-neutral-600 text-gray-300 hover:bg-neutral-700 hover:text-white"
            >
              {loading ? (
                <RefreshCw className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <Pause className="mr-1 h-4 w-4" />
              )}
              Pause
            </Button>
          )}
          {canResume && onResume && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleResume}
              disabled={loading}
              className="border-green-600 text-green-400 hover:bg-green-600 hover:text-white"
            >
              {loading ? (
                <RefreshCw className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <Play className="mr-1 h-4 w-4" />
              )}
              Resume
            </Button>
          )}
          {canCancel && onCancel && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleCancel}
              disabled={loading}
              className="border-red-600 text-red-400 hover:bg-red-600 hover:text-white"
            >
              {loading ? (
                <RefreshCw className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <XCircle className="mr-1 h-4 w-4" />
              )}
              Cancel
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}
