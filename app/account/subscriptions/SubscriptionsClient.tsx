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
      className: "bg-orange-500/10 text-orange-400",
    };
  }

  switch (sub.status) {
    case "active":
      return { label: "Active", className: "bg-green-500/10 text-green-400" };
    case "paused":
      return {
        label: "Paused",
        className: "bg-yellow-500/10 text-yellow-400",
      };
    case "canceled":
      return { label: "Canceled", className: "bg-red-500/10 text-red-400" };
    case "past_due":
      return { label: "Past Due", className: "bg-red-500/10 text-red-400" };
    default:
      return {
        label: sub.status,
        className: "bg-neutral-500/10 text-neutral-400",
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
        <Package className="h-12 w-12 text-neutral-600 mb-4" />
        <h2 className="text-xl font-semibold text-white mb-2">
          No subscriptions yet
        </h2>
        <p className="text-neutral-400 mb-6 max-w-md">
          Subscribe to your favorite teas and save on every delivery.
        </p>
        <Link
          href="/"
          className="inline-flex items-center justify-center rounded-md bg-orange-500 px-6 py-3 text-sm font-medium text-white hover:bg-orange-600 transition-colors"
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
            className="bg-neutral-800 border border-neutral-700 rounded-lg p-5"
          >
            {/* Header: image, product name, status badge */}
            <div className="flex items-start gap-4 mb-4">
              <div className="relative h-16 w-16 flex-shrink-0 overflow-hidden rounded bg-neutral-700">
                <Image
                  src={getMediaUrl(sub.product?.image)}
                  alt={sub.product?.name || "Subscription product"}
                  fill
                  sizes="64px"
                  style={{ objectFit: "cover" }}
                />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-lg font-semibold text-white truncate">
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
                <span className="text-neutral-400">Frequency</span>
                <span className="text-white">
                  {sub.plan
                    ? frequencyLabels[sub.plan.frequency] || "Unknown"
                    : "Unknown"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral-400">Next billing date</span>
                <span className="text-white">
                  {formatDate(sub.current_period_end)}
                </span>
              </div>
              {sub.plan && sub.plan.discount_percent > 0 && (
                <div className="flex justify-between">
                  <span className="text-neutral-400">Discount</span>
                  <span className="inline-flex items-center rounded-full bg-green-500/10 px-2.5 py-0.5 text-xs font-medium text-green-400">
                    Save {sub.plan.discount_percent}%
                  </span>
                </div>
              )}
            </div>

            {/* Action buttons */}
            {!isCanceledOrCanceling && (
              <div className="flex flex-wrap gap-2 pt-3 border-t border-neutral-700">
                {isActive && (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleAction(sub.id, "pause")}
                      disabled={isLoading}
                      className="border-neutral-600 text-neutral-300 hover:text-white"
                    >
                      {isLoading && loadingAction?.action === "pause" ? (
                        <span className="h-4 w-4 animate-spin rounded-full border-2 border-neutral-400 border-t-transparent" />
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
                      className="border-neutral-600 text-neutral-300 hover:text-white"
                    >
                      {isLoading && loadingAction?.action === "skip" ? (
                        <span className="h-4 w-4 animate-spin rounded-full border-2 border-neutral-400 border-t-transparent" />
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
                    className="border-neutral-600 text-neutral-300 hover:text-white"
                  >
                    {isLoading && loadingAction?.action === "resume" ? (
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-neutral-400 border-t-transparent" />
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
                      className="border-red-800 text-red-400 hover:bg-red-500/10 hover:text-red-300"
                    >
                      {isLoading && loadingAction?.action === "cancel" ? (
                        <span className="h-4 w-4 animate-spin rounded-full border-2 border-red-400 border-t-transparent" />
                      ) : (
                        <X className="h-4 w-4" />
                      )}
                      Cancel
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent className="bg-neutral-800 border-neutral-700">
                    <AlertDialogHeader>
                      <AlertDialogTitle className="text-white">
                        Cancel Subscription?
                      </AlertDialogTitle>
                      <AlertDialogDescription className="text-neutral-400">
                        Are you sure? Your subscription will remain active until{" "}
                        {formatDate(sub.current_period_end)}.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel className="border-neutral-600 text-neutral-300 hover:text-white bg-transparent hover:bg-neutral-700">
                        Keep Subscription
                      </AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => handleAction(sub.id, "cancel")}
                        className="bg-red-500 hover:bg-red-600 text-white"
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
              <div className="pt-3 border-t border-neutral-700">
                <p className="text-sm text-orange-400">
                  Cancels on {formatDate(sub.current_period_end)}
                </p>
              </div>
            )}
            {sub.status === "canceled" && (
              <div className="pt-3 border-t border-neutral-700">
                <p className="text-sm text-neutral-500">
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
