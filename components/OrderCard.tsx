"use client";

import { useEffect, useMemo, useState } from "react";
import { Order, OrderStatus, Review } from "@/lib/types";
import Link from "next/link";
import { ReviewForm } from "@/components/reviews/ReviewForm";
import { Badge } from "@/components/ui/badge";
import { orderStatusConfig, defaultOrderStatusStyle } from "@/lib/ui/status-styles";

interface OrderReviewsResponse {
  data?: Review[];
}

function formatOrderDate(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function buildReviewKey(review: Review) {
  return review.order_item_id ?? review.product_id ?? review.id;
}

export default function OrderCard({ order }: { order: Order }) {
  const date = formatOrderDate(order.created_at || "");
  const totalAmount = order.total_amount?.amount ?? 0;
  const total = (totalAmount / 100).toFixed(2);
  const items = Array.isArray(order.items) ? order.items : [];
  const itemCount = items.length;
  const previewItem = items?.[0]?.product_name || "Item";
  const [expanded, setExpanded] = useState(false);
  const [reviews, setReviews] = useState<Record<string, Review>>({});
  const [loadingReviews, setLoadingReviews] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);

  const statusStyle =
    orderStatusConfig[order.status as OrderStatus] ?? defaultOrderStatusStyle;
  const StatusIcon = statusStyle.icon;

  const orderId = order.id ?? "";
  const reviewable =
    order.status === "delivered" ||
    order.status === "refunded" ||
    Boolean(order.delivered_at);
  const disabledReason = reviewable ? null : "Reviews unlock once delivery is confirmed.";

  useEffect(() => {
    if (!orderId || !reviewable) return;
    let cancelled = false;

    async function loadReviews() {
      setLoadingReviews(true);
      setReviewError(null);
      try {
        const response = await fetch(`/api/orders/${orderId}/reviews`);
        if (!response.ok) {
          throw new Error('Unable to load review status.');
        }

        const payload = await response.json() as OrderReviewsResponse;
        if (cancelled) return;

        const incoming: Record<string, Review> = {};
        for (const review of (payload?.data ?? []) as Review[]) {
          const key = buildReviewKey(review);
          incoming[key] = review;
          if (review.product_id) {
            incoming[review.product_id] = review;
          }
        }

        setReviews(incoming);
      } catch (error) {
        if (!cancelled) {
          setReviewError(error instanceof Error ? error.message : 'Unable to load review status.');
        }
      } finally {
        if (!cancelled) {
          setLoadingReviews(false);
        }
      }
    }

    loadReviews();

    return () => {
      cancelled = true;
    };
  }, [orderId, reviewable]);

  const submittedReviewCount = useMemo(() => {
    const ids = new Set(Object.values(reviews).map((review) => review.id));
    return ids.size;
  }, [reviews]);

  function handleReviewSubmitted(review: Review) {
    const key = buildReviewKey(review);
    setReviews((prev) => ({
      ...prev,
      [key]: review,
      ...(review.product_id ? { [review.product_id]: review } : {}),
    }));
  }

  return (
    <div className="rounded-lg border border-border-default bg-white p-4 shadow sm:p-6">
      <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h3 className="truncate text-base font-bold sm:text-lg">
          <Link href={`/account/orders/${order.id}`} className="text-primary-700 hover:text-primary-800 transition-colors">
            Order ID: <span className="text-text-primary">{order.id}</span>
          </Link>
        </h3>
        <Badge variant={statusStyle.variant} className="self-start sm:self-center">
          <StatusIcon className="w-3 h-3" />
          {statusStyle.label}
        </Badge>
      </div>

      <div className="mb-1 text-sm text-text-secondary">Placed on {date}</div>

      <div className="mb-1 text-sm text-text-secondary">
        {itemCount} item{itemCount !== 1 ? "s" : ""}{" "}
        {previewItem && (
          <>
            – <span className="italic">{previewItem}</span>
          </>
        )}
      </div>

      <div className="mt-2 text-lg font-semibold text-text-primary">
        Total: <span className="text-state-success">${total}</span>
      </div>

      <div className="mt-4 flex flex-col gap-2">
        {!reviewable && (
          <p className="text-xs text-state-warning">
            Delivery pending – we’ll invite you to review items once your teas arrive.
          </p>
        )}
        {reviewError && <p className="text-xs text-state-error">{reviewError}</p>}
        {submittedReviewCount > 0 && (
          <p className="text-xs text-state-success">
            {submittedReviewCount} review{submittedReviewCount === 1 ? "" : "s"} submitted for this order.
          </p>
        )}
      </div>

      {itemCount > 0 && (
        <div className="mt-4">
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="flex w-full items-center justify-between rounded-md border border-border-default bg-surface-light px-3 py-2 text-sm font-medium text-text-primary transition hover:border-primary-500 hover:text-primary-700"
            aria-expanded={expanded}
          >
            <span>{expanded ? "Hide order items" : "Review items from this order"}</span>
            <span className="text-xs text-text-secondary">{expanded ? "▲" : "▼"}</span>
          </button>
          {expanded && (
            <div className="mt-4 space-y-4">
              {items.map((item, index) => {
                const itemKey = item.id ?? item.product_id ?? `${orderId}-${index}`;
                const review = reviews[itemKey] ?? (item.product_id ? reviews[item.product_id] : undefined);
                return (
                  <div key={itemKey} className="rounded-lg border border-border-default bg-surface-light p-4">
                    <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
                      <div>
                        <p className="text-sm font-semibold text-text-primary">{item.product_name}</p>
                        <p className="text-xs text-text-secondary">SKU {item.sku}</p>
                      </div>
                      <p className="text-xs text-text-secondary">Quantity: {item.quantity}</p>
                    </div>
                    {reviewable ? (
                      <ReviewForm
                        orderId={orderId}
                        orderItemId={item.id}
                        productId={item.product_id}
                        productName={item.product_name}
                        existingReview={review}
                        onSubmitted={handleReviewSubmitted}
                        disabledReason={disabledReason}
                        canSubmit={reviewable}
                      />
                    ) : (
                      <p className="text-xs text-state-warning">
                        Reviews unlock once delivery is confirmed for this order.
                      </p>
                    )}
                  </div>
                );
              })}
              {loadingReviews && <p className="text-xs text-text-secondary">Checking existing reviews…</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
