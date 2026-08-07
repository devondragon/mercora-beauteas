-- 0029_deactivate_subscription_plans_for_goob.sql
--
-- Defense in depth for the going-out-of-business sale. Data-only and additive
-- (no DROP/RENAME/DELETE), so it is safe to auto-apply on deploy.
--
-- === Why ===
--
-- `POST /api/subscriptions` already refuses an inactive plan (`if
-- (!plan.is_active)`), but that gate has never been able to fire: all 5 plan
-- rows are is_active=1 with live Stripe prices (verified read-only against
-- beauteas-db, 2026-08-06). This supplies the data the gate was written for.
--
-- It sits BEHIND the `sale.subscriptions_enabled` policy check added to the
-- same routes in this change (lib/sale/subscription-gate.ts). Either one alone
-- stops a subscription from being created; both are cheap, and they fail in
-- different ways — the flag is a settings read that could be misconfigured,
-- this is data.
--
-- === Why this breaks nothing else ===
--
-- `is_active` is read in exactly three places:
--   * `listSubscriptionPlans` (lib/models/mach/subscriptions.ts) filters on it
--     and feeds only the PDP, which must hide the subscribe toggle anyway. Its
--     `subscriptionPlans` prop becomes [], so ProductDisplay hides the toggle on
--     the array condition as well as on the sale flag.
--   * `POST /api/subscriptions` — the gate this migration arms.
--   * The admin plan editor, which lists via `getPlansWithSubscriberCount`.
--     That query does NOT filter on is_active, so all 5 plans stay visible in
--     /admin/subscriptions with their toggles.
--
-- The webhook path resolves plans by `getSubscriptionPlanByStripePriceId`,
-- which also does not filter on is_active — so recording events for anything
-- that already exists in Stripe is unaffected. There are 0 customer_subscriptions
-- rows, so no live billing relationship is touched.
--
-- === Reversing ===
--
-- Flip the toggles in /admin/subscriptions, or:
--   UPDATE subscription_plans SET is_active = 1;
-- No migration needed to undo. The plan rows, their Stripe price ids, and all
-- subscription code are untouched, so the feature survives intact as Mercora
-- upstreaming source material.
--
-- Idempotent: the WHERE clause makes a re-run a no-op.

UPDATE subscription_plans
SET is_active = 0,
    updated_at = CURRENT_TIMESTAMP
WHERE is_active != 0;
