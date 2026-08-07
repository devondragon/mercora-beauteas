/**
 * === The storefront's read of the public sale rules (client) ===
 *
 * Three surfaces need the same two numbers from `/api/sale-rules` — the cart
 * drawer and the checkout page render the minimum-order prompt, and checkout
 * also gates the final-sale notice. Each previously had its own copy of the
 * fetch. The copies drifted into the same bug, so the fetch lives here once.
 *
 * The validation is the point. `/api/sale-rules` is rate limited through
 * `PUBLIC_RATE_LIMITER`, and a tripped limiter returns HTTP 429 with a JSON
 * body (`{ error: ... }`) — which means `res.json()` RESOLVES. A `.catch()` on
 * the promise chain never fires, so an unchecked `setMinimumBoxes(r.minimumBoxes)`
 * would store `undefined` and every downstream comparison would go NaN. Check
 * `res.ok` and each value's type before trusting either.
 *
 * Fields validate INDEPENDENTLY (`parseSaleRulesBody`): a malformed
 * `minimumBoxes` must not discard a well-formed `finalSale`, because the two
 * defaults fail in opposite directions and collapsing them would let one bad
 * field silently restore the other's disclosure copy.
 *
 * On any failure both fields fall back to the SALE posture, matching
 * `getSaleRules()` and the route's own catch. For `minimumBoxes` that is copy
 * only — the gates that actually enforce the minimum are `/api/payment-intent`,
 * `/api/orders`, and the two MCP order tools, all reading settings server-side.
 * For `finalSale` it is the disclosure: an unreadable setting must never render
 * a checkout that omits the no-returns statement.
 */
'use client';

import { useEffect, useState } from 'react';
import { DEFAULT_MINIMUM_BOXES } from '@/lib/sale/rules';

/** The public subset of the sale rules — everything the storefront UI reads. */
export interface StorefrontSaleRules {
  minimumBoxes: number;
  finalSale: boolean;
}

/** The sale posture. Used before the fetch resolves and whenever it fails. */
export const SALE_RULES_FALLBACK: StorefrontSaleRules = {
  minimumBoxes: DEFAULT_MINIMUM_BOXES,
  finalSale: true,
};

export interface ParsedSaleRules {
  rules: StorefrontSaleRules;
  /**
   * Fields that failed validation and were defaulted. Returned rather than
   * logged so the parse stays pure and unit-testable; the caller logs them,
   * because a store-wide failure here is otherwise invisible — the fallback
   * renders as perfectly normal copy.
   */
  issues: string[];
}

/** Validate a `/api/sale-rules` body. Never throws; every field has a default. */
export function parseSaleRulesBody(body: unknown): ParsedSaleRules {
  // A non-object body (null, an array, an HTML error page parsed as a string)
  // yields undefined for both reads, so both fall back.
  const raw = (body ?? {}) as { minimumBoxes?: unknown; finalSale?: unknown };
  const issues: string[] = [];

  const rawMinimum = raw.minimumBoxes;
  // `>= 0`, not `> 0`: a deliberately configured 0 means "no minimum" and must
  // survive, or turning the minimum off would silently re-block every cart.
  const minimumValid =
    typeof rawMinimum === 'number' && Number.isFinite(rawMinimum) && rawMinimum >= 0;
  if (!minimumValid) issues.push(`unusable minimumBoxes: ${String(rawMinimum)}`);

  const rawFinalSale = raw.finalSale;
  if (typeof rawFinalSale !== 'boolean') issues.push(`unusable finalSale: ${String(rawFinalSale)}`);

  return {
    rules: {
      minimumBoxes: minimumValid ? rawMinimum : SALE_RULES_FALLBACK.minimumBoxes,
      // Only an explicit `false` drops the final-sale copy. Absent, null, and
      // the string "false" all mean "not known" → keep the disclosure.
      finalSale: rawFinalSale !== false,
    },
    issues,
  };
}

async function fetchSaleRules(): Promise<StorefrontSaleRules> {
  const res = await fetch('/api/sale-rules');
  // A 429/500 body still parses as JSON — status must be checked first.
  if (!res.ok) throw new Error(`/api/sale-rules responded ${res.status}`);

  const { rules, issues } = parseSaleRulesBody(await res.json());
  if (issues.length > 0) {
    console.error('[sale] /api/sale-rules returned unusable fields; using defaults:', issues.join('; '));
  }
  return rules;
}

// `HeaderClient` mounts two CartDrawers (desktop + mobile, one CSS-hidden), so
// every page view fired 2 requests and /checkout fired 3 — all against the
// PUBLIC_RATE_LIMITER budget that /api/payment-intent shares. Collapse them to
// one request per page load. Only successes are cached, so a transient 429
// is still retried by the next mount rather than being pinned for the session.
let cached: StorefrontSaleRules | null = null;
let inFlight: Promise<StorefrontSaleRules> | null = null;

export function readSaleRules(): Promise<StorefrontSaleRules> {
  if (cached) return Promise.resolve(cached);
  inFlight ??= fetchSaleRules()
    .then((rules) => {
      cached = rules;
      return rules;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

export function useSaleRules(): StorefrontSaleRules {
  const [rules, setRules] = useState<StorefrontSaleRules>(SALE_RULES_FALLBACK);

  useEffect(() => {
    let cancelled = false;

    readSaleRules()
      .then((next) => {
        if (!cancelled) setRules(next);
      })
      .catch((error) => {
        // Keep the defaults and say so — see the note on `issues` above.
        console.error('[sale] sale-rules read failed; using defaults', error);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return rules;
}

export function useMinimumBoxes(): number {
  return useSaleRules().minimumBoxes;
}
