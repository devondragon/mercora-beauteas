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
 *
 * `minimumKnown` is what keeps "copy only" true. The checkout page and the cart
 * drawer don't just PRINT the minimum, they block on it — the step flow refuses
 * to render and the drawer's checkout button is disabled. Applied to the
 * fallback that is a lockout, not copy: a customer whose cart the server would
 * happily accept (say the minimum was lowered to 4 mid-sale, or dropped to 0)
 * hits a 429 from the PUBLIC_RATE_LIMITER that `/api/payment-intent` also draws
 * on, keeps the fallback 10, and cannot check out — with no retry, since the
 * fetch runs once per mount and only successes are cached. So both surfaces
 * enforce the minimum ONLY when it came from the server. Failing open here is
 * safe precisely because the real gates are server-side: an under-minimum cart
 * that gets through the UI is rejected at `/api/payment-intent` with the same
 * message the UI would have shown.
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

/**
 * The rules plus whether `minimumBoxes` is the server's number or the fallback.
 * Only a server-stated minimum may be ENFORCED in the UI — see the module note.
 */
export interface SaleRulesState extends StorefrontSaleRules {
  minimumKnown: boolean;
}

/** Pre-fetch / post-failure state: the sale posture, minimum not enforceable. */
export const SALE_RULES_FALLBACK_STATE: SaleRulesState = {
  ...SALE_RULES_FALLBACK,
  minimumKnown: false,
};

export interface ParsedSaleRules {
  rules: StorefrontSaleRules;
  /** True when `rules.minimumBoxes` is the body's value, not the fallback. */
  minimumKnown: boolean;
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
    minimumKnown: minimumValid,
    issues,
  };
}

async function fetchSaleRules(): Promise<SaleRulesState> {
  const res = await fetch('/api/sale-rules');
  // A 429/500 body still parses as JSON — status must be checked first.
  if (!res.ok) throw new Error(`/api/sale-rules responded ${res.status}`);

  const { rules, minimumKnown, issues } = parseSaleRulesBody(await res.json());
  if (issues.length > 0) {
    console.error('[sale] /api/sale-rules returned unusable fields; using defaults:', issues.join('; '));
  }
  return { ...rules, minimumKnown };
}

// `HeaderClient` mounts two CartDrawers (desktop + mobile, one CSS-hidden), so
// every page view fired 2 requests and /checkout fired 3 — all against the
// PUBLIC_RATE_LIMITER budget that /api/payment-intent shares. Collapse them to
// one request per page load. Only successes are cached, so a transient 429
// is still retried by the next mount rather than being pinned for the session.
let cached: SaleRulesState | null = null;
let inFlight: Promise<SaleRulesState> | null = null;

export function readSaleRules(): Promise<SaleRulesState> {
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

export function useSaleRules(): SaleRulesState {
  const [rules, setRules] = useState<SaleRulesState>(SALE_RULES_FALLBACK_STATE);

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

/**
 * The minimum and whether it may be ENFORCED (not merely printed). Callers that
 * block on it must respect `minimumKnown` — see the module note.
 */
export function useMinimumBoxes(): { minimumBoxes: number; minimumKnown: boolean } {
  const { minimumBoxes, minimumKnown } = useSaleRules();
  return { minimumBoxes, minimumKnown };
}
