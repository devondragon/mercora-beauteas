/**
 * BMC-216D: pure view-model for the admin fulfillment queue.
 *
 * Everything the queue UI decides — which action a row offers, how a carrier and
 * tracking link render, how counts and query strings are formed, what happens to
 * the list after a successful shipment — lives here so it can be unit-tested.
 * The components in components/admin/orders/ are thin JSX over these functions.
 *
 * Tracking URLs come from lib/fulfillment/tracking.ts. The queue must NEVER
 * build a tracking URL itself: the old client-side generateTrackingUrl leaked
 * tracking numbers to a Google search URL for unknown carriers.
 */
import { buildTrackingUrl, normalizeLegacyCarrier } from "./tracking";
import { CARRIER_LABELS, CARRIERS, type Carrier } from "./types";

// Re-exported so queue components have a single import for their view-model.
// The labels themselves are owned by lib/fulfillment/types.ts (BMC-216A) —
// duplicating them here would let the queue drift from the carrier list that
// buildTrackingUrl and migration 0022 agree on.
export { CARRIER_LABELS, CARRIERS };
export type { Carrier };

export const QUEUE_VIEWS = ["awaiting", "shipped", "cancelled", "all"] as const;
export type QueueView = (typeof QUEUE_VIEWS)[number];

export const QUEUE_VIEW_LABELS: Record<QueueView, string> = {
  awaiting: "Awaiting shipment",
  shipped: "Shipped",
  cancelled: "Cancelled / refunded",
  all: "All",
};

/** The minimum an order row must expose for queue state derivation. */
export interface QueueOrderLike {
  id?: string;
  status: string;
  payment_status?: string | null;
  shipping_carrier?: string | null;
  tracking_number?: string | null;
  shipped_at?: string | null;
  created_at?: string | null;
}

/** The wire-shaped order the queue page actually renders. */
export interface AdminQueueOrder extends QueueOrderLike {
  id: string;
  total_amount: { amount: number; currency: string; precision?: number };
  currency_code: string;
  shipping_address?: { recipient?: string; company?: string; email?: string } | null;
  extensions?: { email?: string } | null;
  items: Array<{ product_name: string; quantity: number }>;
}

export type QueueRowAction = "mark_shipped" | "edit_tracking" | "none";

export interface QueueRowState {
  action: QueueRowAction;
  carrier: Carrier | null;
  carrierLabel: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  shippedAt: string | null;
}

export function deriveQueueRowState(order: QueueOrderLike): QueueRowState {
  const carrier = normalizeLegacyCarrier(order.shipping_carrier);
  const trackingNumber =
    typeof order.tracking_number === "string" && order.tracking_number.trim()
      ? order.tracking_number.trim()
      : null;

  // `shipped` is the terminal operator-managed state (product decision 13):
  // `delivered` is read-only legacy/carrier state, so it offers no action.
  const action: QueueRowAction =
    order.status === "processing" && order.payment_status === "paid"
      ? "mark_shipped"
      : order.status === "shipped"
        ? "edit_tracking"
        : "none";

  return {
    action,
    carrier,
    carrierLabel: carrier ? CARRIER_LABELS[carrier] : null,
    trackingNumber,
    trackingUrl: buildTrackingUrl(carrier, trackingNumber),
    shippedAt: order.shipped_at ?? null,
  };
}

export function formatTabCount(count: number): string {
  if (!Number.isFinite(count) || count <= 0) return "0";
  return count > 99 ? "99+" : String(Math.floor(count));
}

export function buildQueueQueryString(params: {
  view: QueueView;
  q?: string;
  limit: number;
  offset: number;
}): string {
  const search = new URLSearchParams();
  search.set("view", params.view);
  if (params.q && params.q.trim()) search.set("q", params.q.trim());
  search.set("limit", String(params.limit));
  search.set("offset", String(params.offset));
  return search.toString();
}

/**
 * After a successful shipment the order is no longer awaiting shipment, so the
 * awaiting view drops it immediately; every other view shows the updated row.
 */
export function applyShipmentResult<T extends QueueOrderLike>(
  rows: T[],
  view: QueueView,
  updated: T,
): T[] {
  if (view === "awaiting") return rows.filter((row) => row.id !== updated.id);
  return rows.map((row) => (row.id === updated.id ? updated : row));
}

/**
 * Fold a mutation response's order into the row already on screen.
 *
 * The ship / tracking routes return the INTERNAL order projection, whose
 * `total_amount` is in minor units, while the queue renders the MACH wire shape
 * (major units) from GET /api/admin/orders. Replacing the row wholesale would
 * render a $25.00 order as $2,500.00, so only the fulfillment-owned fields are
 * merged and every money/display field on the existing row is preserved.
 */
export function mergeFulfillmentFields<T extends QueueOrderLike>(
  row: T,
  updated: QueueOrderLike | undefined | null,
): T {
  if (!updated) return row;
  return {
    ...row,
    status: updated.status ?? row.status,
    payment_status: updated.payment_status ?? row.payment_status,
    shipping_carrier: updated.shipping_carrier ?? null,
    tracking_number: updated.tracking_number ?? null,
    shipped_at: updated.shipped_at ?? null,
  };
}

/** A fulfillment event as returned by GET /api/admin/orders/[id]/events. */
export interface FulfillmentEventLike {
  id: string;
  type: string;
  actorType?: string | null;
  actorId?: string | null;
  fromStatus?: string | null;
  toStatus?: string | null;
  details?: Record<string, unknown> | null;
  createdAt: string;
}

export type EmailMode = "retry" | "resend";

export interface EmailUiState {
  kind: "sent" | "failed" | "never_attempted";
  /** Matches POST /api/admin/orders/[id]/shipping-email's `mode` contract. */
  mode: EmailMode;
  actionLabel: string;
  message: string;
  lastError: string | null;
  lastAttemptAt: string | null;
}

const EMAIL_EVENT_TYPES = new Set([
  "shipping_email_sent",
  "shipping_email_failed",
  "shipping_email_resent",
]);

/** Matches the server's SUCCESSFUL_SEND_EVENTS (shipping-email/route.ts). */
const SUCCESSFUL_SEND_TYPES = new Set(["shipping_email_sent", "shipping_email_resent"]);

/**
 * `resend` is valid only once a successful send (initial OR resend) has ever
 * happened — that is exactly the server's `hasSuccessfulSend`/`wrong_mode`
 * rule, so the button never sends a request the route would 409. This mode
 * decision is independent of whether the MOST RECENT attempt succeeded: a
 * failed resend after an earlier successful send still requires `resend`,
 * not `retry`, going forward.
 *
 * `kind`/`message`/`lastError`, by contrast, reflect only the last event —
 * a failed resend must show red, never a stale green "sent" from an earlier
 * success.
 */
export function deriveEmailState(events: FulfillmentEventLike[]): EmailUiState {
  const emailEvents = events.filter((event) => EMAIL_EVENT_TYPES.has(event.type));
  const last = emailEvents.length ? emailEvents[emailEvents.length - 1] : null;
  const hasSucceededOnce = emailEvents.some((event) => SUCCESSFUL_SEND_TYPES.has(event.type));
  const mode: EmailMode = hasSucceededOnce ? "resend" : "retry";

  if (!last) {
    return {
      kind: "never_attempted",
      mode: "retry",
      actionLabel: "Send email",
      message: "No shipping email sent yet",
      lastError: null,
      lastAttemptAt: null,
    };
  }

  if (last.type === "shipping_email_failed") {
    const error = typeof last.details?.error === "string" ? last.details.error : null;
    return {
      kind: "failed",
      mode,
      actionLabel: "Retry email",
      message: "Shipping email failed to send",
      lastError: error,
      lastAttemptAt: last.createdAt,
    };
  }

  return {
    kind: "sent",
    mode: "resend",
    actionLabel: "Resend email",
    message: "Shipping email sent",
    lastError: null,
    lastAttemptAt: last.createdAt,
  };
}

export interface TimelineEntry {
  id: string;
  title: string;
  details: string[];
  actor: string;
  timestamp: string;
  tone: "info" | "success" | "error";
}

const ACTOR_LABELS: Record<string, string> = {
  admin: "Admin",
  service: "Service token",
  system: "System",
};

function actorLabel(event: FulfillmentEventLike): string {
  const base = ACTOR_LABELS[event.actorType ?? ""] ?? "Unknown actor";
  return event.actorId ? `${base} (${event.actorId})` : base;
}

function carrierText(value: unknown): string {
  const carrier = normalizeLegacyCarrier(value);
  return carrier ? CARRIER_LABELS[carrier] : "no carrier";
}

function trackingText(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : "no tracking number";
}

/**
 * Turns one audit row into display strings. The spec forbids rendering raw
 * event JSON, so every field is read individually and formatted in words —
 * unknown keys (idempotencyKey, trackingUrl, …) are deliberately not surfaced.
 */
export function formatFulfillmentEvent(event: FulfillmentEventLike): TimelineEntry {
  const details: string[] = [];
  const payload = (event.details ?? {}) as Record<string, unknown>;
  let title = "Fulfillment update";
  let tone: TimelineEntry["tone"] = "info";

  switch (event.type) {
    case "shipment_created": {
      title = "Marked shipped";
      tone = "success";
      details.push(`Carrier: ${carrierText(payload.carrier)}`);
      details.push(`Tracking: ${trackingText(payload.trackingNumber)}`);
      if (event.fromStatus && event.toStatus) {
        details.push(`Status: ${event.fromStatus} → ${event.toStatus}`);
      }
      break;
    }
    case "tracking_updated": {
      title = "Tracking updated";
      const previous = (payload.previous ?? {}) as Record<string, unknown>;
      const next = (payload.next ?? {}) as Record<string, unknown>;
      details.push(`Carrier: ${carrierText(previous.carrier)} → ${carrierText(next.carrier)}`);
      details.push(
        `Tracking: ${trackingText(previous.trackingNumber)} → ${trackingText(next.trackingNumber)}`,
      );
      break;
    }
    case "shipping_email_sent":
      title = "Shipping email sent";
      tone = "success";
      break;
    case "shipping_email_resent":
      title = "Shipping email resent";
      tone = "success";
      break;
    case "shipping_email_failed": {
      title = "Shipping email failed";
      tone = "error";
      if (typeof payload.error === "string" && payload.error.trim()) {
        details.push(`Error: ${payload.error.trim()}`);
      }
      break;
    }
    default:
      break;
  }

  return { id: event.id, title, details, actor: actorLabel(event), timestamp: event.createdAt, tone };
}

export function formatFulfillmentTimeline(events: FulfillmentEventLike[]): TimelineEntry[] {
  return events.map(formatFulfillmentEvent);
}
