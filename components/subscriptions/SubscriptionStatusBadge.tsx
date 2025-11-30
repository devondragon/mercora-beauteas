"use client";

import { cn } from "@/lib/utils";
import type { SubscriptionStatus } from "@/lib/types/subscription";
import {
  Clock,
  CheckCircle,
  PauseCircle,
  AlertCircle,
  XCircle,
  Hourglass,
  Ban,
} from "lucide-react";

interface SubscriptionStatusBadgeProps {
  status: SubscriptionStatus;
  className?: string;
  showIcon?: boolean;
}

const statusConfig: Record<
  SubscriptionStatus,
  { color: string; icon: typeof Clock; label: string }
> = {
  pending: { color: "bg-yellow-600", icon: Clock, label: "Pending" },
  trialing: { color: "bg-blue-600", icon: Hourglass, label: "Trial" },
  active: { color: "bg-green-600", icon: CheckCircle, label: "Active" },
  paused: { color: "bg-gray-600", icon: PauseCircle, label: "Paused" },
  past_due: { color: "bg-red-600", icon: AlertCircle, label: "Past Due" },
  cancelled: { color: "bg-neutral-600", icon: XCircle, label: "Cancelled" },
  expired: { color: "bg-neutral-700", icon: Ban, label: "Expired" },
};

export function SubscriptionStatusBadge({
  status,
  className,
  showIcon = true,
}: SubscriptionStatusBadgeProps) {
  const config = statusConfig[status] || statusConfig.pending;
  const Icon = config.icon;

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium text-white",
        config.color,
        className
      )}
    >
      {showIcon && <Icon className="mr-1 h-3 w-3" />}
      {config.label}
    </span>
  );
}
