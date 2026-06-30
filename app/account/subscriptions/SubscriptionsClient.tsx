"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Pause, Play, SkipForward, X, Package } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import type { EnrichedSubscription } from "./page";
import { formatDate, getMediaUrl } from "@/lib/utils/account";

interface SubscriptionsClientProps {
  subscriptions: EnrichedSubscription[];
}

const frequencyLabels: Record<string, string> = {
  biweekly: "Every 2 weeks",
  monthly: "Monthly",
  bimonthly: "Every 2 months",
};

const actionSuccessMessages: Record<string, string> = {
  pause: "Subscription paused",
  resume: "Subscription resumed",
  skip: "Next renewal skipped",
  cancel: "Subscription will be canceled at the end of the billing period",
};

function getStatusBadge(sub: EnrichedSubscription) {
  if (sub.cancel_at_period_end) {
    return {
      label: "Canceling",
      className: "bg-state-warning-bg text-state-warning",
    };
  }

  switch (sub.status) {
    case "active":
      return { label: "Active", className: "bg-state-success-bg text-state-success" };
    case "paused":
      return {
        label: "Paused",
        className: "bg-state-warning-bg text-state-warning",
      };
    case "canceled":
      return { label: "Canceled", className: "bg-state-error-bg text-state-error" };
    case "past_due":
      return { label: "Past Due", className: "bg-state-error-bg text-state-error" };
    default:
      return {
        label: sub.status,
        className: "bg-state-info-bg text-state-info",
      };
  }
}

export default function SubscriptionsClient({
  subscriptions,
}: SubscriptionsClientProps) {
  const router = useRouter();
  const [loadingAction, setLoadingAction] = useState<{
    id: string;
    action: string;
  } | null>(null);

  async function handleAction(
    subscriptionId: string,
    action: "pause" | "resume" | "skip" | "cancel"
  ) {
    setLoadingAction({ id: subscriptionId, action });
    try {
      const res = await fetch(`/api/subscriptions/${subscriptionId}/${action}`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error || `Failed to ${action} subscription`);
      }
      toast.success(actionSuccessMessages[action]);
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : `Failed to ${action} subscription`
      );
    } finally {
      setLoadingAction(null);
    }
  }

  // Empty state
  if (subscriptions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <Package className="h-12 w-12 text-text-muted mb-4" />
        <h2 className="text-xl font-semibold text-text-primary mb-2">
          No subscriptions yet
        </h2>
        <p className="text-text-secondary mb-6 max-w-md">
          Subscribe to your favorite teas and save on every delivery.
        </p>
        <Link
          href="/"
          className="inline-flex items-center justify-center rounded-md bg-primary-500 px-6 py-3 text-sm font-medium text-text-inverse hover:bg-primary-600 transition-colors"
        >
          Browse Products
        </Link>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {subscriptions.map((sub) => {
        const status = getStatusBadge(sub);
        const isLoading = loadingAction?.id === sub.id;
        const isActive = sub.status === "active" && !sub.cancel_at_period_end;
        const isPaused = sub.status === "paused";
        const isCanceledOrCanceling =
          sub.status === "canceled" || sub.cancel_at_period_end;

        return (
          <div
            key={sub.id}
            className="bg-white border border-border-default rounded-lg p-5"
          >
            {/* Header: image, product name, status badge */}
            <div className="flex items-start gap-4 mb-4">
              <div className="relative h-16 w-16 flex-shrink-0 overflow-hidden rounded bg-surface-light">
                <Image
                  src={getMediaUrl(sub.product?.image)}
                  alt={sub.product?.name || "Subscription product"}
                  fill
                  sizes="64px"
                  style={{ objectFit: "cover" }}
                />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-lg font-semibold text-text-primary truncate">
                  {sub.product?.name || "Unknown Product"}
                </h3>
                <span
                  className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium mt-1 ${status.className}`}
                >
                  {status.label}
                </span>
              </div>
            </div>

            {/* Content: frequency, next billing, discount */}
            <div className="space-y-2 text-sm mb-4">
              <div className="flex justify-between">
                <span className="text-text-secondary">Frequency</span>
                <span className="text-text-primary">
                  {sub.plan
                    ? frequencyLabels[sub.plan.frequency] || "Unknown"
                    : "Unknown"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-secondary">Next billing date</span>
                <span className="text-text-primary">
                  {formatDate(sub.current_period_end)}
                </span>
              </div>
              {sub.plan && sub.plan.discount_percent > 0 && (
                <div className="flex justify-between">
                  <span className="text-text-secondary">Discount</span>
                  <span className="inline-flex items-center rounded-full bg-state-success-bg px-2.5 py-0.5 text-xs font-medium text-state-success">
                    Save {sub.plan.discount_percent}%
                  </span>
                </div>
              )}
            </div>

            {/* Action buttons */}
            {!isCanceledOrCanceling && (
              <div className="flex flex-wrap gap-2 pt-3 border-t border-border-default">
                {isActive && (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleAction(sub.id, "pause")}
                      disabled={isLoading}
                      className="border-border-default text-text-secondary hover:text-text-primary"
                    >
                      {isLoading && loadingAction?.action === "pause" ? (
                        <span className="h-4 w-4 animate-spin rounded-full border-2 border-border-default border-t-transparent" />
                      ) : (
                        <Pause className="h-4 w-4" />
                      )}
                      Pause
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleAction(sub.id, "skip")}
                      disabled={isLoading}
                      className="border-border-default text-text-secondary hover:text-text-primary"
                    >
                      {isLoading && loadingAction?.action === "skip" ? (
                        <span className="h-4 w-4 animate-spin rounded-full border-2 border-border-default border-t-transparent" />
                      ) : (
                        <SkipForward className="h-4 w-4" />
                      )}
                      Skip Next
                    </Button>
                  </>
                )}

                {isPaused && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleAction(sub.id, "resume")}
                    disabled={isLoading}
                    className="border-border-default text-text-secondary hover:text-text-primary"
                  >
                    {isLoading && loadingAction?.action === "resume" ? (
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-border-default border-t-transparent" />
                    ) : (
                      <Play className="h-4 w-4" />
                    )}
                    Resume
                  </Button>
                )}

                {/* Cancel with confirmation dialog */}
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={isLoading}
                      className="border-state-error text-state-error hover:bg-state-error-bg"
                    >
                      {isLoading && loadingAction?.action === "cancel" ? (
                        <span className="h-4 w-4 animate-spin rounded-full border-2 border-state-error border-t-transparent" />
                      ) : (
                        <X className="h-4 w-4" />
                      )}
                      Cancel
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent className="bg-white border-border-default">
                    <AlertDialogHeader>
                      <AlertDialogTitle className="text-text-primary">
                        Cancel Subscription?
                      </AlertDialogTitle>
                      <AlertDialogDescription className="text-text-secondary">
                        Are you sure? Your subscription will remain active until{" "}
                        {formatDate(sub.current_period_end)}.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel className="border-border-default text-text-secondary hover:text-text-primary bg-transparent hover:bg-surface-light">
                        Keep Subscription
                      </AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => handleAction(sub.id, "cancel")}
                        className="bg-state-error hover:bg-state-error/90 text-text-inverse"
                      >
                        Confirm Cancellation
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            )}

            {/* Canceled/Canceling info */}
            {sub.cancel_at_period_end && sub.status !== "canceled" && (
              <div className="pt-3 border-t border-border-default">
                <p className="text-sm text-state-warning">
                  Cancels on {formatDate(sub.current_period_end)}
                </p>
              </div>
            )}
            {sub.status === "canceled" && (
              <div className="pt-3 border-t border-border-default">
                <p className="text-sm text-text-muted">
                  Canceled {sub.canceled_at ? `on ${formatDate(sub.canceled_at)}` : ""}
                </p>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
