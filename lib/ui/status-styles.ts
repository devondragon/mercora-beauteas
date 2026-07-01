import {
  Clock,
  RefreshCw,
  Truck,
  CheckCircle,
  XCircle,
  AlertCircle,
  AlertTriangle,
  Pause,
  type LucideIcon,
} from "lucide-react";
import type { OrderStatus } from "@/lib/types/order";
import type { SubscriptionStatus } from "@/lib/types/subscription";

// Matches components/ui/badge.tsx's variant names ("destructive", not "error").
export type StatusVariant = "success" | "warning" | "destructive" | "info";

export interface StatusStyle {
  variant: StatusVariant;
  icon: LucideIcon;
  label: string;
}

/**
 * Order status → badge variant + icon. The state palette only has 4 semantic
 * colors, so pairs like pending/processing and cancelled/refunded intentionally
 * share a color — the icon is what keeps each of the 6 statuses distinguishable.
 */
export const orderStatusConfig: Record<OrderStatus, StatusStyle> = {
  pending: { variant: "warning", icon: Clock, label: "Pending" },
  processing: { variant: "warning", icon: RefreshCw, label: "Processing" },
  shipped: { variant: "info", icon: Truck, label: "Shipped" },
  delivered: { variant: "success", icon: CheckCircle, label: "Delivered" },
  cancelled: { variant: "destructive", icon: XCircle, label: "Cancelled" },
  refunded: { variant: "destructive", icon: AlertCircle, label: "Refunded" },
};

export const defaultOrderStatusStyle: StatusStyle = {
  variant: "info",
  icon: AlertCircle,
  label: "Unknown",
};

export const subscriptionStatusConfig: Partial<Record<SubscriptionStatus, StatusStyle>> = {
  active: { variant: "success", icon: CheckCircle, label: "Active" },
  paused: { variant: "warning", icon: Pause, label: "Paused" },
  canceled: { variant: "destructive", icon: XCircle, label: "Canceled" },
  past_due: { variant: "destructive", icon: AlertTriangle, label: "Past Due" },
  incomplete: { variant: "warning", icon: AlertCircle, label: "Incomplete" },
  trialing: { variant: "info", icon: Clock, label: "Trialing" },
};

export const defaultSubscriptionStatusStyle: StatusStyle = {
  variant: "info",
  icon: AlertCircle,
  label: "Unknown",
};
