/**
 * Review Transformer
 *
 * Transforms Judge.me reviews into Mercora product_reviews records.
 *
 * - product_id: resolved via idMap (by product_handle)
 * - order_id: 'IMPORTED' (synthetic value for NOT NULL constraint)
 * - customer_id: matched by reviewer_email via idMap, or 'IMPORTED' if no match
 * - rating: validated 1-5 range
 * - status: 'published' (these were published on Judge.me)
 */

import { nanoid } from 'nanoid';
import type { IdMap } from '../lib/id-map.js';
import type { JudgeMeReview } from '../lib/types.js';

/** Mercora review record matching the actual product_reviews table columns */
export interface ReviewRecord {
  id: string;
  product_id: string;
  order_id: string;
  customer_id: string;
  rating: number;
  title: string | null;
  body: string | null;
  status: string;
  is_verified: number; // SQLite boolean (0/1)
  admin_response: string | null;
  submitted_at: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  metadata: string | null; // JSON
}

export interface ReviewTransformResult {
  records: ReviewRecord[];
  skipped: Array<{ record: JudgeMeReview; reason: string }>;
  warnings: string[];
}

/**
 * Try to resolve a product_id from various idMap keys.
 * Judge.me reviews have product_handle and/or product_id.
 */
function resolveProductId(
  review: JudgeMeReview,
  idMap: IdMap
): string | undefined {
  // Try product_handle first (most reliable for cross-system mapping)
  if (review.product_handle) {
    // Try direct handle lookup
    const byHandle = idMap.resolve('products', review.product_handle);
    if (byHandle) return byHandle;

    // Try with cat_ prefix (matching seed data convention for descriptive IDs)
    const byDescriptive = idMap.resolve(
      'products',
      `prod_${review.product_handle.replace(/-/g, '_')}`
    );
    if (byDescriptive) return byDescriptive;
  }

  // Try product_id (Shopify numeric ID)
  if (review.product_id) {
    const byId = idMap.resolve('products', String(review.product_id));
    if (byId) return byId;
  }

  return undefined;
}

/**
 * Try to resolve customer_id from reviewer email.
 * Looks through the customers idMap entries to find a match.
 */
function resolveCustomerId(
  reviewerEmail: string | undefined,
  idMap: IdMap
): string | undefined {
  if (!reviewerEmail) return undefined;

  // The customers idMap maps shopifyId -> clerkUserId
  // We need to check if any customer entry's email matches
  // Since we don't store emails in the idMap, we use the 'customer_emails'
  // auxiliary map that the customer transformer populates
  const byEmail = idMap.resolve('customer_emails', reviewerEmail.toLowerCase());
  return byEmail;
}

/**
 * Parse a date string to ISO 8601 format.
 */
function parseDate(dateStr?: string): string | null {
  if (!dateStr) return null;
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return null;
    return date.toISOString();
  } catch {
    return null;
  }
}

/**
 * Transform Judge.me reviews into Mercora product_reviews records.
 */
export function transformReviews(
  reviews: JudgeMeReview[],
  idMap: IdMap
): ReviewTransformResult {
  const records: ReviewRecord[] = [];
  const skipped: Array<{ record: JudgeMeReview; reason: string }> = [];
  const warnings: string[] = [];

  for (const review of reviews) {
    // Resolve product_id
    const productId = resolveProductId(review, idMap);
    if (!productId) {
      skipped.push({
        record: review,
        reason: `Product not found in idMap (handle: ${review.product_handle}, id: ${review.product_id})`,
      });
      continue;
    }

    // Validate rating (1-5)
    const rating = typeof review.rating === 'number'
      ? review.rating
      : parseInt(String(review.rating), 10);

    if (isNaN(rating) || rating < 1 || rating > 5) {
      skipped.push({
        record: review,
        reason: `Invalid rating: ${review.rating} (must be 1-5)`,
      });
      continue;
    }

    const reviewId = `REV-${nanoid(10).toUpperCase()}`;

    // Resolve customer_id from reviewer email
    const customerId =
      resolveCustomerId(review.reviewer_email, idMap) || 'IMPORTED';

    // Parse dates
    const reviewDate = parseDate(review.review_date);
    const now = new Date().toISOString();

    // Metadata
    const metadata = {
      source: 'judgeme',
      original_product_handle: review.product_handle || undefined,
      picture_urls: review.picture_urls || undefined,
      reviewer_name: review.reviewer_name || undefined,
    };

    records.push({
      id: reviewId,
      product_id: productId,
      order_id: 'IMPORTED', // Synthetic value for NOT NULL constraint
      customer_id: customerId,
      rating,
      title: review.title || null,
      body: review.body || null,
      status: 'published',
      is_verified: 1, // true -- they were published on Judge.me
      admin_response: review.reply || null,
      submitted_at: reviewDate,
      published_at: reviewDate,
      created_at: reviewDate || now,
      updated_at: now,
      metadata: JSON.stringify(metadata),
    });

    // Register in idMap for tracking
    const reviewKey = `${review.product_handle || ''}_${review.reviewer_email || ''}_${review.review_date || ''}`;
    idMap.register('reviews', reviewKey, reviewId);
  }

  return { records, skipped, warnings };
}
