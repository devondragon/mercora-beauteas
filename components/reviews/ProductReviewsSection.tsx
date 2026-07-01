"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { StarRating } from "@/components/reviews/StarRating";
import type { Review, ProductReviewEligibility } from "@/lib/types";
import type { NormalizedProductRating } from "@/lib/utils/ratings";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

function formatReviewDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function getReviewTimestamp(review: Review): number {
  const candidate = review.published_at ?? review.submitted_at ?? review.created_at ?? null;
  if (!candidate) return 0;
  const date = new Date(candidate);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

interface ProductReviewsSectionProps {
  reviews: Review[];
  ratingSummary: NormalizedProductRating | null;
  eligibility?: ProductReviewEligibility;
}

export function ProductReviewsSection({
  reviews,
  ratingSummary,
  eligibility,
}: ProductReviewsSectionProps) {
  const reviewList = useMemo(() => (Array.isArray(reviews) ? [...reviews] : []), [reviews]);
  const reviewCount = reviewList.length;

  const [ratingFilter, setRatingFilter] = useState<"all" | number>("all");
  const [sortBy, setSortBy] = useState<"recent" | "highest" | "lowest">("recent");

  const highlightPositive = useMemo(() => {
    return (
      reviewList
        .filter((review) => review.rating >= 4 && (review.body?.trim().length ?? 0) > 0)
        .sort((a, b) => {
          if (b.rating !== a.rating) return b.rating - a.rating;
          return getReviewTimestamp(b) - getReviewTimestamp(a);
        })[0] ?? null
    );
  }, [reviewList]);

  const highlightCritical = useMemo(() => {
    const severe = reviewList
      .filter((review) => review.rating <= 2 && (review.body?.trim().length ?? 0) > 0)
      .sort((a, b) => {
        if (a.rating !== b.rating) return a.rating - b.rating;
        return getReviewTimestamp(b) - getReviewTimestamp(a);
      });

    if (severe.length) {
      return severe[0];
    }

    return (
      reviewList
        .filter((review) => review.rating <= 3 && (review.body?.trim().length ?? 0) > 0)
        .sort((a, b) => {
          if (a.rating !== b.rating) return a.rating - b.rating;
          return getReviewTimestamp(b) - getReviewTimestamp(a);
        })[0] ?? null
    );
  }, [reviewList]);

  const highlightEntries = useMemo(() => {
    const entries: Array<{ key: string; tone: "positive" | "critical"; review: Review; label: string }> = [];
    if (highlightPositive) {
      entries.push({
        key: `positive-${highlightPositive.id}`,
        tone: "positive",
        review: highlightPositive,
        label: "Top positive review",
      });
    }
    if (highlightCritical && (!highlightPositive || highlightCritical.id !== highlightPositive.id)) {
      entries.push({
        key: `critical-${highlightCritical.id}`,
        tone: "critical",
        review: highlightCritical,
        label: "Top critical review",
      });
    }
    return entries;
  }, [highlightPositive, highlightCritical]);

  const sortedReviews = useMemo(() => {
    const list = [...reviewList];
    if (!list.length) return list;

    switch (sortBy) {
      case "highest":
        return list.sort((a, b) => {
          if (b.rating !== a.rating) return b.rating - a.rating;
          return getReviewTimestamp(b) - getReviewTimestamp(a);
        });
      case "lowest":
        return list.sort((a, b) => {
          if (a.rating !== b.rating) return a.rating - b.rating;
          return getReviewTimestamp(b) - getReviewTimestamp(a);
        });
      case "recent":
      default:
        return list.sort((a, b) => getReviewTimestamp(b) - getReviewTimestamp(a));
    }
  }, [reviewList, sortBy]);

  const filteredReviews = useMemo(() => {
    if (ratingFilter === "all") {
      return sortedReviews;
    }
    return sortedReviews.filter((review) => review.rating === ratingFilter);
  }, [sortedReviews, ratingFilter]);

  const ratingSelectValue = ratingFilter === "all" ? "all" : String(ratingFilter);

  const hasDistribution = Boolean(
    ratingSummary?.distribution &&
      [1, 2, 3, 4, 5].some((bucket) => (ratingSummary.distribution?.[bucket] ?? 0) > 0)
  );

  const lastPublishedLabel = ratingSummary?.lastPublishedAt
    ? formatReviewDate(ratingSummary.lastPublishedAt)
    : null;

  return (
    <div className="space-y-6">
      {eligibility?.canReview && (
        <div className="rounded-lg border border-border-default bg-white p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-base font-semibold text-text-primary">Share your experience</h2>
              <p className="text-sm text-text-secondary">
                Reviews are limited to verified purchases—head to your order history to add yours.
              </p>
            </div>
            <Link
              href="/account/orders"
              className="inline-flex items-center justify-center rounded-md bg-primary-500 px-4 py-2 text-sm font-semibold text-text-inverse transition hover:bg-primary-600"
            >
              Review your order
            </Link>
          </div>
        </div>
      )}

      {ratingSummary ? (
        <section className="rounded-lg border border-border-default bg-white p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-4">
              <StarRating value={ratingSummary.average} size="lg" />
              <div>
                <p className="text-3xl font-semibold text-text-primary">{ratingSummary.average.toFixed(1)}</p>
                <p className="text-sm text-text-secondary">
                  {ratingSummary.count} review{ratingSummary.count === 1 ? "" : "s"}
                </p>
              </div>
            </div>
            {lastPublishedLabel && (
              <p className="text-xs text-text-muted sm:text-right">Last review {lastPublishedLabel}</p>
            )}
          </div>
          {hasDistribution && ratingSummary?.distribution && (
            <dl className="mt-4 space-y-2">
              {[5, 4, 3, 2, 1].map((bucket) => {
                const count = ratingSummary.distribution?.[bucket] ?? 0;
                const percent = ratingSummary.count > 0 ? Math.round((count / ratingSummary.count) * 100) : 0;
                return (
                  <div key={bucket} className="flex items-center gap-3 text-xs text-text-secondary">
                    <dt className="w-10 font-medium text-text-muted">{bucket}★</dt>
                    <dd className="flex-1">
                      <div className="h-2 rounded-full bg-surface-light">
                        <div
                          className="h-full rounded-full bg-secondary-400"
                          style={{ width: `${percent}%` }}
                        />
                      </div>
                    </dd>
                    <span className="w-10 text-right text-text-muted">{count}</span>
                  </div>
                );
              })}
            </dl>
          )}
        </section>
      ) : (
        <p className="text-sm text-text-muted">
          No reviews yet — be the first to share your experience after delivery.
        </p>
      )}

      {highlightEntries.length > 0 && (
        <section className="rounded-lg border border-border-default bg-white p-4">
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-text-primary">Review highlights</h2>
            <p className="text-sm text-text-secondary">Balanced perspective from shoppers at both ends of the rating scale.</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {highlightEntries.map(({ key, tone, review, label }) => (
              <article
                key={key}
                className="rounded-md border border-border-default bg-surface-light p-4"
                aria-label={label}
              >
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">{label}</p>
                    <div className="mt-1 flex items-center gap-2">
                      <StarRating value={review.rating} size="sm" />
                      <span className="text-sm font-semibold text-text-primary">{review.rating.toFixed(1)}</span>
                    </div>
                  </div>
                  <span
                    className={`text-xs font-medium ${tone === "positive" ? "text-state-success" : "text-state-warning"}`}
                  >
                    {tone === "positive" ? "Positive" : "Critical"}
                  </span>
                </div>
                {review.title && <h3 className="mt-3 text-base font-semibold text-text-primary">{review.title}</h3>}
                {review.body && (
                  <p className="mt-2 text-sm text-text-secondary whitespace-pre-wrap">{review.body}</p>
                )}
                <p className="mt-3 text-xs text-text-muted">
                  {formatReviewDate(review.published_at ?? review.submitted_at ?? review.created_at) ?? "Recently updated"}
                </p>
              </article>
            ))}
          </div>
        </section>
      )}

      {reviewCount > 0 && (
        <section className="rounded-lg border border-border-default bg-white p-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-text-primary">All reviews</h2>
              <p className="text-sm text-text-secondary">
                Showing {filteredReviews.length} of {reviewCount} review{reviewCount === 1 ? "" : "s"}.
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <Select
                value={ratingSelectValue}
                onValueChange={(value) => setRatingFilter(value === "all" ? "all" : Number(value))}
              >
                <SelectTrigger className="w-full bg-white border-border-default text-text-primary hover:bg-surface-light sm:w-40">
                  <SelectValue placeholder="Filter rating" />
                </SelectTrigger>
                <SelectContent className="bg-white border-border-default">
                  <SelectItem value="all" className="text-text-primary hover:bg-surface-light">
                    All ratings
                  </SelectItem>
                  {[5, 4, 3, 2, 1].map((value) => (
                    <SelectItem
                      key={`filter-${value}`}
                      value={String(value)}
                      className="text-text-primary hover:bg-surface-light"
                    >
                      {value} star{value === 1 ? "" : "s"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={sortBy} onValueChange={(value) => setSortBy(value as typeof sortBy)}>
                <SelectTrigger className="w-full bg-white border-border-default text-text-primary hover:bg-surface-light sm:w-40">
                  <SelectValue placeholder="Sort reviews" />
                </SelectTrigger>
                <SelectContent className="bg-white border-border-default">
                  <SelectItem value="recent" className="text-text-primary hover:bg-surface-light">
                    Most recent
                  </SelectItem>
                  <SelectItem value="highest" className="text-text-primary hover:bg-surface-light">
                    Highest rated
                  </SelectItem>
                  <SelectItem value="lowest" className="text-text-primary hover:bg-surface-light">
                    Lowest rated
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="mt-4 space-y-4">
            {filteredReviews.length > 0 ? (
              filteredReviews.map((review) => {
                const submittedLabel =
                  formatReviewDate(review.published_at ?? review.submitted_at ?? review.created_at) ?? "Recently updated";

                return (
                  <article
                    key={review.id}
                    className="rounded-lg border border-border-default bg-surface-light p-4"
                    aria-label={`Review rated ${review.rating} stars`}
                  >
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex items-center gap-2">
                        <StarRating value={review.rating} size="sm" />
                        <span className="text-sm font-semibold text-text-primary">{review.rating.toFixed(1)}</span>
                        {review.is_verified && (
                          <span className="rounded-full bg-state-success-bg px-2 py-1 text-xs font-medium text-state-success">
                            Verified purchase
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-text-muted">{submittedLabel}</p>
                    </div>
                    {review.title && (
                      <h3 className="mt-3 text-base font-semibold text-text-primary">{review.title}</h3>
                    )}
                    {review.body && (
                      <p className="mt-2 text-sm text-text-secondary whitespace-pre-wrap">{review.body}</p>
                    )}
                    {review.media?.length ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {review.media.map((media) => (
                          <a
                            key={media.id ?? media.url}
                            href={media.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs font-medium text-primary-600 underline"
                          >
                            View {media.type === "video" ? "video" : "photo"}
                          </a>
                        ))}
                      </div>
                    ) : null}
                    {review.admin_response && (
                      <div className="mt-4 rounded-md border border-border-default bg-white p-3">
                        <p className="text-xs font-semibold uppercase tracking-wide text-primary-600">Merchant response</p>
                        <p className="mt-1 text-sm text-text-secondary whitespace-pre-wrap">{review.admin_response}</p>
                      </div>
                    )}
                  </article>
                );
              })
            ) : (
              <p className="text-sm text-text-secondary">No reviews match the selected filters yet.</p>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
