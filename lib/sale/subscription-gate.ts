/**
 * The server-side gate on starting or restarting recurring billing.
 *
 * `sale.subscriptions_enabled` used to be read in three places, none of which
 * enforced anything: the PDP hid the subscribe toggle, the PDP page passed the
 * flag to it, and an MCP tool changed the wording of a marketing blurb.
 * `POST /api/subscriptions` checked only Clerk auth and `plan.is_active`, so a
 * bookmarked subscribe page, a replayed request, or a direct POST could still
 * start a live Stripe subscription during the closing sale. UI-only gating is
 * the anti-pattern docs/auth-model.md warns about; this is the real boundary.
 *
 * Applied to every surface that STARTS billing — create, setup-intent, resume,
 * and skip (which pauses with a `resumes_at`, i.e. schedules its own restart).
 * Deliberately NOT applied to pause or cancel: a customer must never be blocked
 * from stopping a charge, least of all during a going-out-of-business sale.
 * Also not applied to the Stripe webhooks, which only record what already
 * happened in Stripe — gating those would desync D1 and drop cancellations.
 *
 * FAILS CLOSED, and it does so by NOT catching. A `getSaleRules()` throw
 * propagates to the calling route's own try/catch, which returns 500 without
 * ever reaching Stripe. Do not wrap this in a local try that defaults to
 * enabled, and do not copy the swallow-and-default pattern from
 * `app/api/sale-rules/route.ts` — that route serves display copy, and it still
 * falls back to the sale posture. An empty settings read is covered too:
 * `getSaleRules` uses `=== true`, so a missing row also reads false.
 */

import { NextResponse } from 'next/server';
import { getSaleRules } from '@/lib/sale/settings';
import { SUBSCRIPTIONS_DISABLED_MESSAGE } from '@/lib/sale/rules';

/**
 * @returns a 403 to return to the caller, or `null` when subscriptions are on
 * and the route should proceed.
 */
export async function rejectIfSubscriptionsDisabled(): Promise<NextResponse | null> {
  const { subscriptionsEnabled } = await getSaleRules();
  if (subscriptionsEnabled) return null;

  // 403, not 400: the caller cannot fix this by changing its request the way it
  // can for the box minimum. Not 409 either — there is no resource-state
  // conflict to resolve. This matches the SetupIntent ownership denial that
  // POST /api/subscriptions already returns as a 403.
  return NextResponse.json({ error: SUBSCRIPTIONS_DISABLED_MESSAGE }, { status: 403 });
}
