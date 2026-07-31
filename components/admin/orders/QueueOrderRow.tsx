"use client";

/**
 * BMC-216D: one order row in the admin fulfillment queue.
 *
 * All state decisions come from deriveQueueRowState / deriveEmailState — this
 * component only renders them. There is deliberately no inline status, carrier
 * or tracking editing here: every mutation goes through the guarded ship /
 * tracking / shipping-email endpoints.
 */
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Money } from "@/lib/money";
import { defaultOrderStatusStyle, orderStatusConfig } from "@/lib/ui/status-styles";
import { deriveQueueRowState } from "@/lib/fulfillment/queue-view";
import type { AdminQueueOrder, EmailMode, EmailUiState } from "@/lib/fulfillment/queue-view";
import type { OrderStatus } from "@/lib/types/order";
import {
  AlertTriangle,
  Calendar,
  ExternalLink,
  Mail,
  Package,
  Pencil,
  RefreshCw,
  Truck,
  User,
} from "lucide-react";

interface QueueOrderRowProps {
  order: AdminQueueOrder;
  emailState: EmailUiState | null;
  /** True when the last GET .../events fetch for this row failed. */
  emailLoadFailed?: boolean;
  emailBusy: boolean;
  onMarkShipped: (order: AdminQueueOrder) => void;
  onEditTracking: (order: AdminQueueOrder) => void;
  onEmailAction: (order: AdminQueueOrder, mode: EmailMode) => void;
  onRetryEmailStatus?: (orderId: string) => void;
}

export default function QueueOrderRow({
  order,
  emailState,
  emailLoadFailed = false,
  emailBusy,
  onMarkShipped,
  onEditTracking,
  onEmailAction,
  onRetryEmailStatus,
}: QueueOrderRowProps) {
  const row = deriveQueueRowState(order);
  const statusStyle = orderStatusConfig[order.status as OrderStatus] ?? defaultOrderStatusStyle;
  const StatusIcon = statusStyle.icon;
  const recipient = order.shipping_address?.recipient || order.shipping_address?.company || "Guest";
  const email = order.shipping_address?.email || order.extensions?.email || null;
  // GET /api/admin/orders emits the MACH wire shape: total_amount is in MAJOR
  // units, so it goes through Money.fromMajor — never a raw /100.
  const total = Money.fromMajor(
    order.total_amount.amount,
    order.total_amount.currency || order.currency_code,
  );
  const isShippedish = order.status === "shipped" || order.status === "delivered";

  return (
    <div className="space-y-3 p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <Link
            href={`/admin/orders/${order.id}`}
            className="font-medium text-text-primary hover:underline"
          >
            #{order.id}
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-text-secondary">
            <span className="flex items-center">
              <Calendar className="mr-1 h-3 w-3" />
              {order.created_at ? new Date(order.created_at).toLocaleDateString() : "—"}
            </span>
            <span className="flex items-center">
              <User className="mr-1 h-3 w-3" />
              {recipient}
            </span>
            {email && <span className="truncate">{email}</span>}
            <span className="flex items-center">
              <Package className="mr-1 h-3 w-3" />
              {order.items.length} items
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Badge variant={statusStyle.variant} className="text-xs">
            <StatusIcon className="mr-1 h-3 w-3" />
            {statusStyle.label}
          </Badge>
          <span className="text-lg font-semibold text-text-primary">{total.format()}</span>

          {row.action === "mark_shipped" && (
            <Button
              size="sm"
              onClick={() => onMarkShipped(order)}
              className="bg-primary-500 hover:bg-primary-600"
            >
              <Truck className="mr-2 h-4 w-4" />
              Mark shipped
            </Button>
          )}
          {row.action === "edit_tracking" && (
            <Button size="sm" variant="outline" onClick={() => onEditTracking(order)}>
              <Pencil className="mr-2 h-4 w-4" />
              Edit tracking
            </Button>
          )}
        </div>
      </div>

      {isShippedish && (
        <div className="rounded bg-surface p-3 text-sm">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-text-secondary">
            <span>
              Shipped{" "}
              <span className="text-text-primary">
                {row.shippedAt ? new Date(row.shippedAt).toLocaleString() : "—"}
              </span>
            </span>
            <span>
              Carrier <span className="text-text-primary">{row.carrierLabel ?? "not recorded"}</span>
            </span>
            <span>
              Tracking{" "}
              {row.trackingNumber ? (
                row.trackingUrl ? (
                  <a
                    href={row.trackingUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center text-primary-600 hover:underline"
                  >
                    {row.trackingNumber}
                    <ExternalLink className="ml-1 h-3 w-3" />
                  </a>
                ) : (
                  <span className="text-text-primary">{row.trackingNumber}</span>
                )
              ) : (
                <span className="text-text-primary">none</span>
              )}
            </span>
          </div>

          {emailState && (
            <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-border-default pt-3">
              <span
                className={`flex items-center text-sm ${
                  emailState.kind === "failed"
                    ? "text-state-error"
                    : emailState.kind === "sent"
                      ? "text-state-success"
                      : "text-text-secondary"
                }`}
              >
                {emailState.kind === "failed" ? (
                  <AlertTriangle className="mr-2 h-4 w-4" />
                ) : (
                  <Mail className="mr-2 h-4 w-4" />
                )}
                {emailState.message}
              </span>
              {emailState.lastError && (
                <span className="text-xs text-state-error">{emailState.lastError}</span>
              )}
              {/*
                POST .../shipping-email always 409s ("not_shipped") once the
                order has moved past `shipped` to `delivered` — the server
                only allows retry/resend while status === "shipped". Once
                delivered, the email history is frozen, so only the status
                text above is shown; offering a button here would just be a
                guaranteed 409 rendering a raw error code.
              */}
              {order.status === "shipped" && (
                <Button
                  size="sm"
                  variant={emailState.kind === "failed" ? "default" : "outline"}
                  disabled={emailBusy}
                  onClick={() => onEmailAction(order, emailState.mode)}
                >
                  {emailBusy ? (
                    <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Mail className="mr-2 h-4 w-4" />
                  )}
                  {emailState.actionLabel}
                </Button>
              )}
            </div>
          )}

          {/*
            The events fetch failed (network error or non-2xx) — show this
            distinctly from "no email history yet" instead of silently
            rendering as if nothing had ever been attempted, with a way to
            retry the fetch itself (not a shipping-email send).
          */}
          {!emailState && emailLoadFailed && (
            <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-border-default pt-3">
              <span className="flex items-center text-sm text-state-error">
                <AlertTriangle className="mr-2 h-4 w-4" />
                Could not load shipping-email status
              </span>
              {onRetryEmailStatus && (
                <Button size="sm" variant="outline" onClick={() => onRetryEmailStatus(order.id)}>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Retry
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
