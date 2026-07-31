"use client";

/**
 * BMC-216D: fulfillment audit history for one order.
 *
 * Rendering is driven entirely by formatFulfillmentTimeline, which converts each
 * audit row into words. Raw event JSON must never reach the page.
 */
import { Card } from "@/components/ui/card";
import { AlertTriangle, CheckCircle, History, Info, RefreshCw } from "lucide-react";
import { formatFulfillmentTimeline, type FulfillmentEventLike } from "@/lib/fulfillment/queue-view";

interface FulfillmentTimelineProps {
  events: FulfillmentEventLike[];
  loading: boolean;
  error: string | null;
}

export default function FulfillmentTimeline({ events, loading, error }: FulfillmentTimelineProps) {
  const entries = formatFulfillmentTimeline(events);

  return (
    <Card className="admin-card p-6">
      <h3 className="mb-4 flex items-center text-lg font-semibold text-text-primary">
        <History className="mr-2 h-5 w-5 text-text-secondary" />
        Fulfillment History
      </h3>

      {loading ? (
        <div className="flex items-center py-4 text-sm text-text-secondary">
          <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
          Loading history…
        </div>
      ) : error ? (
        <p className="flex items-center text-sm text-state-error">
          <AlertTriangle className="mr-2 h-4 w-4" />
          {error}
        </p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-text-muted">
          No fulfillment actions recorded for this order yet.
        </p>
      ) : (
        <ol className="space-y-3">
          {entries.map((entry) => (
            <li
              key={entry.id}
              className={`rounded border-l-4 bg-surface p-4 ${
                entry.tone === "error"
                  ? "border-state-error"
                  : entry.tone === "success"
                    ? "border-state-success"
                    : "border-state-info"
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center font-medium text-text-primary">
                  {entry.tone === "error" ? (
                    <AlertTriangle className="mr-2 h-4 w-4 text-state-error" />
                  ) : entry.tone === "success" ? (
                    <CheckCircle className="mr-2 h-4 w-4 text-state-success" />
                  ) : (
                    <Info className="mr-2 h-4 w-4 text-state-info" />
                  )}
                  {entry.title}
                </span>
                <span className="text-xs text-text-secondary">
                  {new Date(entry.timestamp).toLocaleString()}
                </span>
              </div>
              {entry.details.length > 0 && (
                <ul className="mt-2 space-y-1 text-sm text-text-secondary">
                  {entry.details.map((detail) => (
                    <li key={detail}>{detail}</li>
                  ))}
                </ul>
              )}
              <p className="mt-2 text-xs text-text-muted">By {entry.actor}</p>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
