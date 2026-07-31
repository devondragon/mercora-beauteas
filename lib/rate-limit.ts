/**
 * Per-IP / per-user rate limiting for public API routes (BMC-180).
 *
 * Backed by Cloudflare's native rate-limit bindings declared in `wrangler.jsonc`
 * (`ratelimits`). Two limiters:
 *   - `AI_RATE_LIMITER`     — the paid AI path (`/api/agent-chat`): tight budget.
 *   - `PUBLIC_RATE_LIMITER` — the other public POSTs (tax, validate-discount,
 *                             gift-cards/validate, payment-intent).
 *
 * The limiters are best-effort and per-colocation (see the Cloudflare docs); that
 * is acceptable for cost-DoS mitigation, which is what these guard against.
 *
 * Design note — this FAILS OPEN. If the binding is missing (e.g. plain
 * `next dev`, which has no Workers runtime, or a misconfigured deploy) or the
 * limiter call throws, the request is allowed through. A limiter outage must
 * never take down checkout or chat — rate limiting is abuse mitigation, not a
 * correctness gate. Every fail-open path is logged so it is observable.
 */
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { NextResponse } from "next/server";

export type RateLimiterBinding = "AI_RATE_LIMITER" | "PUBLIC_RATE_LIMITER";

interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

/**
 * Best-effort client IP from a bare header bag. Server components have no
 * `Request` — `headers()` from `next/headers` hands back a Headers-like object
 * — so this is the flavour the guest order-status page (BMC-216E) uses. Same
 * precedence and same "unknown" bucket as {@link getClientIp}.
 */
export function getClientIpFromHeaders(headers: { get(name: string): string | null }): string {
  const cfIp = headers.get("CF-Connecting-IP");
  if (cfIp) return cfIp.trim();

  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }

  return "unknown";
}

/**
 * Best-effort client IP for use as a rate-limit key. Cloudflare sets
 * `CF-Connecting-IP` on every request at the edge; the `x-forwarded-for`
 * fallback covers non-CF/local runs. Returns `"unknown"` when neither is
 * present, which buckets all such callers into one shared limit — a safe,
 * conservative default (it can only over-throttle, never under-throttle).
 *
 * Delegates to {@link getClientIpFromHeaders} so the header precedence has
 * exactly one implementation shared by route handlers and server components.
 */
export function getClientIp(req: Request): string {
  return getClientIpFromHeaders(req.headers);
}

/**
 * Enforce a rate limit for `key` against the named binding.
 *
 * Returns a `429` {@link NextResponse} when the caller is over the limit, or
 * `null` when the request is allowed (including when the limiter is unavailable
 * — see the fail-open note above). Intended usage at the top of a handler:
 *
 * ```ts
 * const limited = await enforceRateLimit("PUBLIC_RATE_LIMITER", `tax:${getClientIp(req)}`);
 * if (limited) return limited;
 * ```
 */
export async function enforceRateLimit(
  binding: RateLimiterBinding,
  key: string
): Promise<NextResponse | null> {
  let limiter: RateLimiter | undefined;

  try {
    const { env } = await getCloudflareContext({ async: true });
    limiter = (env as unknown as Record<string, RateLimiter | undefined>)[binding];
  } catch (err) {
    // No Workers runtime in this environment (e.g. `next dev`). Allow through.
    console.warn(`[rate-limit] Cloudflare context unavailable for ${binding}; allowing request`, err);
    return null;
  }

  if (!limiter || typeof limiter.limit !== "function") {
    console.warn(`[rate-limit] binding ${binding} not configured; allowing request`);
    return null;
  }

  try {
    const { success } = await limiter.limit({ key });
    if (success) return null;

    return NextResponse.json(
      { error: "Too many requests. Please slow down and try again in a moment." },
      { status: 429, headers: { "Retry-After": "60" } }
    );
  } catch (err) {
    console.error(`[rate-limit] ${binding}.limit() failed; allowing request`, err);
    return null;
  }
}
