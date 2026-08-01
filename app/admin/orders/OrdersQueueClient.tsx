"use client";

/**
 * BMC-216D: the admin fulfillment queue.
 *
 * Replaces the old page's "load a page, then filter it in React" behaviour: the
 * view, search, sort, counts and pagination are all decided by
 * GET /api/admin/orders in SQL. The only mutations available here are the
 * guarded fulfillment endpoints — there is no generic status write.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertTriangle,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  RefreshCw,
  Search,
} from "lucide-react";
import MarkShippedModal, { type MarkShippedSubmit } from "@/components/admin/orders/MarkShippedModal";
import EditTrackingModal, { type EditTrackingSubmit } from "@/components/admin/orders/EditTrackingModal";
import QueueOrderRow from "@/components/admin/orders/QueueOrderRow";
import {
  QUEUE_VIEWS,
  QUEUE_VIEW_LABELS,
  applyShipmentResult,
  buildQueueQueryString,
  clampOffsetAfterRemoval,
  createRequestSequence,
  deriveEmailState,
  deriveQueueRowState,
  formatTabCount,
  mergeFulfillmentFields,
  type AdminQueueOrder,
  type EmailMode,
  type EmailUiState,
  type FulfillmentEventLike,
  type QueueOrderLike,
  type QueueView,
} from "@/lib/fulfillment/queue-view";

const PAGE_SIZE = 20;
const EMPTY_COUNTS: Record<QueueView, number> = { awaiting: 0, shipped: 0, cancelled: 0, all: 0 };

interface AdminOrdersResponse {
  orders: AdminQueueOrder[];
  total: number;
  counts: Record<QueueView, number>;
}
interface EventsResponse {
  events: FulfillmentEventLike[];
}
interface MutationResponse {
  /**
   * Typed as QueueOrderLike — the fulfillment-owned fields — because that is
   * all this page consumes: mergeFulfillmentFields takes those and preserves
   * every money/display field already on the row. Never spread this wholesale
   * over a queue row.
   *
   * As of BMC-233 the ship/tracking routes do emit the MACH wire shape (major
   * units) that the queue renders. Before that they answered with the internal
   * minor-unit projection, and a wholesale spread would have rendered a $25.00
   * order as $2,500.00.
   */
  order?: QueueOrderLike;
  email?: { attempted?: boolean; success?: boolean; error?: string };
  error?: string;
  code?: string;
  status?: string;
}

type Notice = { tone: "success" | "warning" | "error"; message: string };

export default function OrdersQueueClient() {
  const [view, setView] = useState<QueueView>("awaiting");
  const [searchInput, setSearchInput] = useState("");
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);

  const [orders, setOrders] = useState<AdminQueueOrder[]>([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<Record<QueueView, number>>(EMPTY_COUNTS);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  const [emailStates, setEmailStates] = useState<Record<string, EmailUiState>>({});
  const [emailBusyId, setEmailBusyId] = useState<string | null>(null);
  // Orders whose /events fetch failed: distinct from "no state yet" so the
  // row can show an actionable error instead of silently rendering as if no
  // shipping email had ever been attempted.
  const [emailLoadFailed, setEmailLoadFailed] = useState<Record<string, boolean>>({});

  // Identifies the newest list request so a superseded one can be discarded
  // instead of overwriting the current view (C-1).
  const requestSeq = useRef(createRequestSequence());

  const [shipTarget, setShipTarget] = useState<AdminQueueOrder | null>(null);
  const [trackingTarget, setTrackingTarget] = useState<AdminQueueOrder | null>(null);
  const [modalBusy, setModalBusy] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  // Throws on failure (network error or non-2xx) rather than swallowing it to
  // `null` — callers decide how to surface that distinctly from "fetched
  // successfully, no email history yet".
  const fetchEmailState = useCallback(async (orderId: string): Promise<EmailUiState> => {
    const response = await fetch(`/api/admin/orders/${orderId}/events`);
    if (!response.ok) throw new Error(`Failed to load email status (${response.status})`);
    const body = (await response.json()) as EventsResponse;
    return deriveEmailState(body.events ?? []);
  }, []);

  const loadEmailStates = useCallback(
    async (rows: AdminQueueOrder[], isCurrent: () => boolean = () => true) => {
      const shipped = rows.filter((row) => row.status === "shipped" || row.status === "delivered");
      if (!shipped.length) {
        if (!isCurrent()) return;
        setEmailStates({});
        setEmailLoadFailed({});
        return;
      }
      const results = await Promise.all(
        shipped.map(async (row) => {
          try {
            return { id: row.id, state: await fetchEmailState(row.id), failed: false } as const;
          } catch {
            return { id: row.id, state: null, failed: true } as const;
          }
        }),
      );
      // This fan-out is the widest part of a load; by the time it settles the
      // operator may already be on another tab (C-1).
      if (!isCurrent()) return;
      setEmailStates(
        Object.fromEntries(
          results.filter((r) => r.state).map((r) => [r.id, r.state as EmailUiState]),
        ),
      );
      setEmailLoadFailed(Object.fromEntries(results.filter((r) => r.failed).map((r) => [r.id, true])));
    },
    [fetchEmailState],
  );

  const load = useCallback(async () => {
    // C-1: a load is superseded the moment a newer one starts. Without this the
    // LAST RESPONSE wins rather than the last request, so a slow tab's rows can
    // land under a fast tab's header.
    const token = requestSeq.current.start();
    const isCurrent = () => requestSeq.current.isCurrent(token);

    setLoading(true);
    setLoadError(null);
    try {
      const qs = buildQueueQueryString({ view, q: query, limit: PAGE_SIZE, offset });
      const response = await fetch(`/api/admin/orders?${qs}`);
      if (!response.ok) throw new Error(`Failed to load orders (${response.status})`);
      const body = (await response.json()) as AdminOrdersResponse;
      const rows = body.orders ?? [];
      if (!isCurrent()) return;
      setOrders(rows);
      setTotal(body.total ?? 0);
      setCounts(body.counts ?? EMPTY_COUNTS);
      await loadEmailStates(rows, isCurrent);
    } catch (error) {
      // A superseded load must not clear the live view or post its error.
      if (!isCurrent()) return;
      setOrders([]);
      setTotal(0);
      setLoadError(error instanceof Error ? error.message : "Failed to load orders");
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [view, query, offset, loadEmailStates]);

  useEffect(() => {
    load();
  }, [load]);

  const selectView = (next: QueueView) => {
    setView(next);
    setOffset(0);
  };

  const submitSearch = (event: React.FormEvent) => {
    event.preventDefault();
    setQuery(searchInput);
    setOffset(0);
  };

  const refreshEmailState = useCallback(
    async (orderId: string) => {
      try {
        const state = await fetchEmailState(orderId);
        setEmailStates((prev) => ({ ...prev, [orderId]: state }));
        setEmailLoadFailed((prev) => {
          if (!(orderId in prev)) return prev;
          const next = { ...prev };
          delete next[orderId];
          return next;
        });
      } catch {
        setEmailLoadFailed((prev) => ({ ...prev, [orderId]: true }));
        // Also drop any stale emailStates entry: the row render gate is
        // `!emailState && emailLoadFailed`, so leaving a stale (possibly
        // successful-looking, live-button) state in place after a FAILED
        // refresh would keep the old action clickable — e.g. right after a
        // send succeeded but this status refetch 500s, the operator could
        // re-click and send a second shipping email. Clearing it forces the
        // "could not load" + Retry banner instead.
        setEmailStates((prev) => {
          if (!(orderId in prev)) return prev;
          const next = { ...prev };
          delete next[orderId];
          return next;
        });
      }
    },
    [fetchEmailState],
  );

  const handleShipConfirm = useCallback(
    async (input: MarkShippedSubmit) => {
      if (!shipTarget) return;
      setModalBusy(true);
      setModalError(null);
      try {
        const response = await fetch(`/api/admin/orders/${shipTarget.id}/ship`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...(input.carrier ? { carrier: input.carrier } : {}),
            ...(input.trackingNumber ? { trackingNumber: input.trackingNumber } : {}),
          }),
        });
        const body = (await response.json().catch(() => ({}))) as MutationResponse;
        if (!response.ok) {
          setModalError(
            body.error ??
              (body.code ? `${body.code}${body.status ? ` (order is ${body.status})` : ""}` : null) ??
              `Could not mark the order shipped (${response.status})`,
          );
          return;
        }

        const updated: AdminQueueOrder = body.order
          ? mergeFulfillmentFields(shipTarget, body.order)
          : { ...shipTarget, status: "shipped" };
        setOrders((prev) => applyShipmentResult(prev, view, updated));
        setCounts((prev) => ({
          ...prev,
          awaiting: Math.max(0, prev.awaiting - 1),
          shipped: prev.shipped + 1,
        }));
        if (view === "awaiting") setTotal((prev) => Math.max(0, prev - 1));
        setShipTarget(null);

        if (body.email?.attempted && !body.email.success) {
          setNotice({
            tone: "warning",
            message: `Order ${updated.id} is marked shipped, but the shipping email failed to send${
              body.email.error ? `: ${body.email.error}` : ""
            }. Open the Shipped tab and use Retry email.`,
          });
        } else if (body.email?.success) {
          setNotice({
            tone: "success",
            message: `Order ${updated.id} marked shipped and the shipping email was sent.`,
          });
        } else {
          setNotice({ tone: "success", message: `Order ${updated.id} marked shipped.` });
        }
        await refreshEmailState(updated.id);

        // C-2: in the awaiting view the row just left the list. The optimistic
        // splice above can empty the current page — and since `total` drops with
        // it, the `total > PAGE_SIZE` pager guard hides the pager too, stranding
        // the operator on a dead page with an empty state over a queue that
        // isn't empty. Step back to a page that still has rows, then resync from
        // the server so counts and total are authoritative rather than derived
        // from local arithmetic.
        if (view === "awaiting") {
          const nextOffset = clampOffsetAfterRemoval({
            offset,
            pageSize: PAGE_SIZE,
            totalAfter: Math.max(0, total - 1),
          });
          // Changing offset re-runs `load` through its dependency on it; if the
          // page is unchanged we still refetch, so neither path leaves the
          // locally-mutated counts on screen.
          if (nextOffset !== offset) setOffset(nextOffset);
          else await load();
        }
      } catch (error) {
        setModalError(error instanceof Error ? error.message : "Could not mark the order shipped");
      } finally {
        setModalBusy(false);
      }
    },
    [shipTarget, view, offset, total, load, refreshEmailState],
  );

  const handleTrackingConfirm = useCallback(
    async (input: EditTrackingSubmit) => {
      if (!trackingTarget) return;
      setModalBusy(true);
      setModalError(null);
      try {
        const response = await fetch(`/api/admin/orders/${trackingTarget.id}/tracking`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ carrier: input.carrier, trackingNumber: input.trackingNumber }),
        });
        const body = (await response.json().catch(() => ({}))) as MutationResponse;
        if (!response.ok) {
          setModalError(
            body.error ?? body.code ?? `Could not update tracking (${response.status})`,
          );
          return;
        }
        const updated = mergeFulfillmentFields(trackingTarget, body.order);
        setOrders((prev) => prev.map((row) => (row.id === updated.id ? updated : row)));
        setTrackingTarget(null);
        setNotice({
          tone: "success",
          message: `Tracking updated for order ${updated.id}. No email was sent.`,
        });
      } catch (error) {
        setModalError(error instanceof Error ? error.message : "Could not update tracking");
      } finally {
        setModalBusy(false);
      }
    },
    [trackingTarget],
  );

  const handleEmailAction = useCallback(
    async (order: AdminQueueOrder, mode: EmailMode) => {
      setEmailBusyId(order.id);
      try {
        const response = await fetch(`/api/admin/orders/${order.id}/shipping-email`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode }),
        });
        const body = (await response.json().catch(() => ({}))) as MutationResponse;
        if (!response.ok) {
          setNotice({
            tone: "error",
            // Same friendly-code fallback as handleShipConfirm: a raw
            // "not_shipped" is possible if the order moved to `delivered`
            // between the last refresh and this click (409 race), and the
            // status annotation is more actionable than the bare code.
            message:
              body.error ??
              (body.code ? `${body.code}${body.status ? ` (order is ${body.status})` : ""}` : null) ??
              `Email action failed (${response.status})`,
          });
        } else if (body.email?.success) {
          setNotice({ tone: "success", message: `Shipping email sent for order ${order.id}.` });
        } else {
          setNotice({
            tone: "error",
            message: `Shipping email for order ${order.id} failed${
              body.email?.error ? `: ${body.email.error}` : ""
            }.`,
          });
        }
        await refreshEmailState(order.id);
      } catch (error) {
        setNotice({
          tone: "error",
          message: error instanceof Error ? error.message : "Email action failed",
        });
      } finally {
        setEmailBusyId(null);
      }
    },
    [refreshEmailState],
  );

  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const firstShown = total === 0 ? 0 : offset + 1;
  const lastShown = Math.min(offset + PAGE_SIZE, total);

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="mb-2 text-2xl font-bold text-text-primary">Fulfillment</h1>
          <p className="text-text-secondary">Ship paid orders and keep customers informed</p>
        </div>
        <Button onClick={load} disabled={loading} className="bg-primary-500 hover:bg-primary-600">
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {notice && (
        <Card
          className={`admin-card flex items-start gap-3 p-4 ${
            notice.tone === "success"
              ? "border-state-success"
              : notice.tone === "warning"
                ? "border-state-warning"
                : "border-state-error"
          }`}
        >
          {notice.tone === "success" ? (
            <CheckCircle className="mt-0.5 h-5 w-5 shrink-0 text-state-success" />
          ) : (
            <AlertTriangle
              className={`mt-0.5 h-5 w-5 shrink-0 ${
                notice.tone === "warning" ? "text-state-warning" : "text-state-error"
              }`}
            />
          )}
          <p className="flex-1 text-sm text-text-secondary">{notice.message}</p>
          <Button variant="ghost" size="sm" onClick={() => setNotice(null)}>
            Dismiss
          </Button>
        </Card>
      )}

      <Card className="admin-card p-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-2">
            {QUEUE_VIEWS.map((candidate) => (
              <Button
                key={candidate}
                size="sm"
                variant={candidate === view ? "default" : "ghost"}
                onClick={() => selectView(candidate)}
                className={candidate === view ? "" : "text-text-secondary hover:text-text-primary"}
              >
                {QUEUE_VIEW_LABELS[candidate]}
                <span className="ml-2 rounded-full bg-surface px-2 py-0.5 text-xs text-text-secondary">
                  {formatTabCount(counts[candidate])}
                </span>
              </Button>
            ))}
          </div>

          <form onSubmit={submitSearch} className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-secondary" />
              <Input
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="Order number, recipient or email"
                className="admin-input w-72 pl-10"
              />
            </div>
            <Button type="submit" variant="secondary" size="sm">
              Search
            </Button>
            {query && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSearchInput("");
                  setQuery("");
                  setOffset(0);
                }}
              >
                Clear
              </Button>
            )}
          </form>
        </div>
      </Card>

      <Card className="admin-card">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <RefreshCw className="h-8 w-8 animate-spin text-primary-500" />
          </div>
        ) : loadError ? (
          <div className="p-8 text-center">
            <AlertTriangle className="mx-auto mb-4 h-12 w-12 text-state-error" />
            <h3 className="mb-2 text-lg font-medium text-text-secondary">Could not load orders</h3>
            <p className="text-text-muted">{loadError}</p>
          </div>
        ) : orders.length === 0 ? (
          <div className="p-8 text-center">
            <ClipboardList className="mx-auto mb-4 h-12 w-12 text-text-muted" />
            <h3 className="mb-2 text-lg font-medium text-text-secondary">
              Nothing in {QUEUE_VIEW_LABELS[view].toLowerCase()}
            </h3>
            <p className="text-text-muted">
              {query ? "No orders match that search." : "New paid orders will appear here."}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border-default">
            {orders.map((order) => (
              <QueueOrderRow
                key={order.id}
                order={order}
                emailState={emailStates[order.id] ?? null}
                emailLoadFailed={!!emailLoadFailed[order.id]}
                emailBusy={emailBusyId === order.id}
                onMarkShipped={(target) => {
                  setModalError(null);
                  setShipTarget(target);
                }}
                onEditTracking={(target) => {
                  setModalError(null);
                  setTrackingTarget(target);
                }}
                onEmailAction={handleEmailAction}
                onRetryEmailStatus={refreshEmailState}
              />
            ))}
          </div>
        )}
      </Card>

      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between rounded-lg border admin-card p-4">
          <div className="text-sm text-text-secondary">
            Showing{" "}
            <span className="font-medium text-text-primary">
              {firstShown}-{lastShown}
            </span>{" "}
            of <span className="font-medium text-text-primary">{total}</span> orders
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={offset === 0 || loading}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              className="text-text-secondary hover:text-text-primary"
            >
              <ChevronLeft className="h-4 w-4" />
              Previous
            </Button>
            <span className="text-sm text-text-secondary">
              Page <span className="font-medium text-text-primary">{page}</span> of{" "}
              <span className="font-medium text-text-primary">{totalPages}</span>
            </span>
            <Button
              variant="ghost"
              size="sm"
              disabled={offset + PAGE_SIZE >= total || loading}
              onClick={() => setOffset(offset + PAGE_SIZE)}
              className="text-text-secondary hover:text-text-primary"
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {shipTarget && (
        <MarkShippedModal
          key={`ship-${shipTarget.id}`}
          open
          orderId={shipTarget.id}
          recipient={
            shipTarget.shipping_address?.recipient || shipTarget.shipping_address?.company || "the customer"
          }
          submitting={modalBusy}
          error={modalError}
          onCancel={() => {
            setShipTarget(null);
            setModalError(null);
          }}
          onConfirm={handleShipConfirm}
        />
      )}

      {trackingTarget && (
        <EditTrackingModal
          key={`tracking-${trackingTarget.id}`}
          open
          orderId={trackingTarget.id}
          initialCarrier={deriveQueueRowState(trackingTarget).carrier}
          initialTrackingNumber={deriveQueueRowState(trackingTarget).trackingNumber}
          submitting={modalBusy}
          error={modalError}
          onCancel={() => {
            setTrackingTarget(null);
            setModalError(null);
          }}
          onConfirm={handleTrackingConfirm}
        />
      )}
    </div>
  );
}
