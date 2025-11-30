/**
 * === Webhook Helper Utilities ===
 *
 * Provides retry mechanisms and state machine validation for
 * webhook operations to ensure data consistency and reliability.
 */

import type { SubscriptionStatus } from "@/lib/types/subscription";

// =====================================================
// Retry Mechanism
// =====================================================

interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  backoffMultiplier?: number;
  onRetry?: (attempt: number, error: Error) => void;
}

const DEFAULT_RETRY_OPTIONS: Required<Omit<RetryOptions, "onRetry">> = {
  maxAttempts: 3,
  baseDelayMs: 100,
  maxDelayMs: 5000,
  backoffMultiplier: 2,
};

/**
 * Executes an async operation with exponential backoff retry
 * @param operation The async operation to execute
 * @param options Retry configuration options
 * @returns The result of the operation
 * @throws The last error if all retries fail
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const config = { ...DEFAULT_RETRY_OPTIONS, ...options };
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt < config.maxAttempts) {
        // Calculate delay with exponential backoff
        const delay = Math.min(
          config.baseDelayMs * Math.pow(config.backoffMultiplier, attempt - 1),
          config.maxDelayMs
        );

        // Call onRetry callback if provided
        config.onRetry?.(attempt, lastError);

        // Wait before retrying
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
}

/**
 * Wraps a database operation with retry logic and logging
 * @param operationName Name of the operation for logging
 * @param operation The database operation to execute
 * @returns The result of the operation
 */
export async function withDbRetry<T>(
  operationName: string,
  operation: () => Promise<T>
): Promise<T> {
  return withRetry(operation, {
    maxAttempts: 3,
    baseDelayMs: 100,
    maxDelayMs: 2000,
    onRetry: (attempt, error) => {
      console.warn(
        `[Webhook] ${operationName} failed (attempt ${attempt}), retrying...`,
        error.message
      );
    },
  });
}

// =====================================================
// Subscription State Machine
// =====================================================

/**
 * Valid subscription status transitions
 * Key: current status, Value: array of valid next statuses
 */
const VALID_STATUS_TRANSITIONS: Record<SubscriptionStatus, SubscriptionStatus[]> = {
  pending: ["active", "trialing", "cancelled", "expired"],
  trialing: ["active", "cancelled", "expired", "past_due"],
  active: ["paused", "past_due", "cancelled", "expired"],
  paused: ["active", "cancelled", "expired"],
  past_due: ["active", "cancelled", "expired", "paused"],
  cancelled: ["active"], // Allow reactivation
  expired: ["active"], // Allow renewal
};

/**
 * Validates if a status transition is allowed
 * @param currentStatus The current subscription status
 * @param newStatus The proposed new status
 * @returns true if the transition is valid
 */
export function isValidStatusTransition(
  currentStatus: SubscriptionStatus,
  newStatus: SubscriptionStatus
): boolean {
  // Same status is always valid (no-op)
  if (currentStatus === newStatus) {
    return true;
  }

  const validNextStatuses = VALID_STATUS_TRANSITIONS[currentStatus];
  if (!validNextStatuses) {
    console.warn(`Unknown subscription status: ${currentStatus}`);
    return false;
  }

  return validNextStatuses.includes(newStatus);
}

/**
 * Gets the list of valid next statuses for a given current status
 * @param currentStatus The current subscription status
 * @returns Array of valid next statuses
 */
export function getValidNextStatuses(
  currentStatus: SubscriptionStatus
): SubscriptionStatus[] {
  return VALID_STATUS_TRANSITIONS[currentStatus] || [];
}

/**
 * Validates and returns the new status if the transition is valid
 * @param currentStatus The current subscription status
 * @param proposedStatus The proposed new status
 * @returns The validated status or null if invalid
 */
export function validateStatusTransition(
  currentStatus: SubscriptionStatus,
  proposedStatus: SubscriptionStatus
): SubscriptionStatus | null {
  if (isValidStatusTransition(currentStatus, proposedStatus)) {
    return proposedStatus;
  }

  console.warn(
    `Invalid subscription status transition: ${currentStatus} -> ${proposedStatus}. ` +
      `Valid transitions from ${currentStatus}: ${getValidNextStatuses(currentStatus).join(", ")}`
  );

  return null;
}

// =====================================================
// Idempotency Helpers
// =====================================================

// In-memory cache for processed webhook events (use Redis in production)
const processedEvents = new Map<string, { timestamp: number; result: string }>();
const EVENT_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Check if a webhook event has already been processed
 * @param eventId The Stripe event ID
 * @returns true if already processed
 */
export function isEventProcessed(eventId: string): boolean {
  const cached = processedEvents.get(eventId);
  if (!cached) {
    return false;
  }

  // Check if cache entry has expired
  if (Date.now() - cached.timestamp > EVENT_CACHE_TTL_MS) {
    processedEvents.delete(eventId);
    return false;
  }

  return true;
}

/**
 * Mark a webhook event as processed
 * @param eventId The Stripe event ID
 * @param result Optional result description
 */
export function markEventProcessed(eventId: string, result: string = "success"): void {
  // Clean up old entries periodically
  if (processedEvents.size > 1000) {
    const now = Date.now();
    for (const [id, entry] of processedEvents.entries()) {
      if (now - entry.timestamp > EVENT_CACHE_TTL_MS) {
        processedEvents.delete(id);
      }
    }
  }

  processedEvents.set(eventId, {
    timestamp: Date.now(),
    result,
  });
}

/**
 * Wrapper for processing webhook events with idempotency
 * @param eventId The Stripe event ID
 * @param processor The event processing function
 * @returns The result of the processor or null if already processed
 */
export async function processEventIdempotently<T>(
  eventId: string,
  processor: () => Promise<T>
): Promise<T | null> {
  if (isEventProcessed(eventId)) {
    console.log(`[Webhook] Event ${eventId} already processed, skipping`);
    return null;
  }

  const result = await processor();
  markEventProcessed(eventId);
  return result;
}
