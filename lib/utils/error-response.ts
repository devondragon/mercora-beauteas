/**
 * Shared helper for gating raw error detail in API responses (BMC-154 / L4).
 *
 * Several admin routes were returning `error.message`/`String(error)` in the
 * JSON response body unconditionally, regardless of NODE_ENV, leaking DB/driver
 * internals to callers (including the lower-trust service token). The
 * generate-product-description and generate-article routes already gated
 * this correctly behind `NODE_ENV === 'development'` — this helper centralizes
 * that same rule so it's defined once and unit-testable.
 *
 * Server-side `console.error(error)` logging is unaffected; only the
 * RESPONSE body must not leak raw error detail outside development.
 */

/**
 * Returns the raw error message/detail only when running in development;
 * otherwise returns `undefined` so callers can omit the field entirely.
 */
export function errorDetails(error: unknown): string | undefined {
  if (process.env.NODE_ENV !== 'development') {
    return undefined;
  }
  return error instanceof Error ? error.message : String(error);
}
