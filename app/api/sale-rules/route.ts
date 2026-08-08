/**
 * Public read of the two sale numbers the storefront UI needs: the box minimum
 * and whether the store is in final-sale mode.
 *
 * Exists so the cart drawer and checkout page render the prompt from settings
 * instead of hardcoding 10 in two client bundles. Deliberately narrow — the
 * `sale` settings category also carries operational flags, and the full object
 * has no business on the public internet.
 *
 * The gates that actually enforce the minimum are `/api/payment-intent` and
 * `/api/orders`; this endpoint is for copy only.
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getSaleRules } from '@/lib/sale/settings';
import { DEFAULT_MINIMUM_BOXES } from '@/lib/sale/rules';
import { enforceRateLimit, getClientIp } from '@/lib/rate-limit';

export async function GET(req: NextRequest) {
  const limited = await enforceRateLimit('PUBLIC_RATE_LIMITER', `sale-rules:${getClientIp(req)}`);
  if (limited) return limited;

  try {
    const { minimumBoxes, finalSale } = await getSaleRules();
    return NextResponse.json({ minimumBoxes, finalSale });
  } catch (error) {
    // Fail to the SALE posture, never the pre-sale one: a settings outage must
    // not render a storefront that implies returns are accepted or that any
    // cart size can check out. The minimum comes from `DEFAULT_MINIMUM_BOXES`
    // rather than a literal so this path can't drift from `getSaleRules()`'s
    // own default — the "a number stated in five places drifts" problem
    // `lib/sale/rules.ts` exists to prevent.
    console.error('[sale-rules] settings read failed:', error);
    return NextResponse.json({ minimumBoxes: DEFAULT_MINIMUM_BOXES, finalSale: true });
  }
}
