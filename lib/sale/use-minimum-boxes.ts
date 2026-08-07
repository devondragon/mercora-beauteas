/**
 * === The storefront's read of the box minimum (client) ===
 *
 * Both surfaces that render the minimum-order prompt — the cart drawer and the
 * checkout page — need the same number from `/api/sale-rules`, and previously
 * each had its own copy of the fetch. The copies drifted into the same bug, so
 * the fetch lives here once.
 *
 * The validation is the point. `/api/sale-rules` is rate limited through
 * `PUBLIC_RATE_LIMITER`, and a tripped limiter returns HTTP 429 with a JSON
 * body (`{ error: ... }`) — which means `res.json()` RESOLVES. A `.catch()` on
 * the promise chain never fires, so an unchecked `setMinimumBoxes(r.minimumBoxes)`
 * would store `undefined` and every downstream comparison would go NaN. Check
 * `res.ok` and the value's type before trusting either.
 *
 * On any failure we keep `DEFAULT_MINIMUM_BOXES` rather than blocking: this
 * value drives COPY only. The gates that actually enforce the minimum are
 * `/api/payment-intent`, `/api/orders`, and the two MCP order tools, all of
 * which read settings server-side.
 */
'use client';

import { useEffect, useState } from 'react';
import { DEFAULT_MINIMUM_BOXES } from '@/lib/sale/rules';

export function useMinimumBoxes(): number {
  const [minimumBoxes, setMinimumBoxes] = useState(DEFAULT_MINIMUM_BOXES);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch('/api/sale-rules');
        // A 429/500 body still parses as JSON — status must be checked first.
        if (!res.ok) throw new Error(`/api/sale-rules responded ${res.status}`);

        const body = (await res.json()) as { minimumBoxes?: unknown };
        const value = body.minimumBoxes;
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
          throw new Error(`/api/sale-rules returned an unusable minimumBoxes: ${String(value)}`);
        }

        if (!cancelled) setMinimumBoxes(value);
      } catch (error) {
        // Keep the default and say so — a store-wide failure of this endpoint
        // is otherwise invisible, since the fallback renders as normal copy.
        console.error('[sale] minimum-boxes read failed; using default', error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return minimumBoxes;
}
