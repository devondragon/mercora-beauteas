# BMC-216G: QA, Migration, and Rollout Implementation Plan

> **For agentic workers:** This is an operational runbook, not a code plan.
> Most steps touch remote environments and REQUIRE explicit human
> confirmation before execution. An agent may drive the commands but must
> stop at every step marked **[HUMAN GATE]**. Steps use checkbox (`- [ ]`)
> syntax for tracking.

**Goal:** Take BMC-216 (A–F, merged) safely through dev verification into production, with backups, smoke tests, and a forced-failure drill.

**Architecture:** No new code. Applies migrations `0022`/`0023` to remote dev, dev preview, and production; provisions `ORDER_STATUS_SECRET`; deploys; and validates the full operator → customer flow including an induced email failure.

**Tech Stack:** wrangler (D1 migrations, secrets, tail), OpenNext deploys, Stripe test mode, Resend.

**Depends on:** BMC-216A–F merged to `main`. **Suggested agent:** sonnet (command driving + verification), with a human at every gate.

**Interface contract:** docs/superpowers/plans/2026-07-30-bmc-216-interfaces.md

## Global Constraints

- Deploys go through OpenNext (`npm run deploy:dev` / `deploy:production`), never bare `wrangler deploy`.
- Never renumber or re-run applied migrations; Wrangler tracks by filename.
- Secrets via `wrangler secret put … --env <env>` — never CLI args, never committed.
- Take a `d1 export` backup before applying any production migration.
- The Workers runtime reads `.dev.vars` + `wrangler secret`, NOT `.env.local`.

---

### Task 1: Local gates

- [ ] **Step 1:** `npm run lint` — expect clean.
- [ ] **Step 2:** `npx tsc --noEmit` — expect clean.
- [ ] **Step 3:** Full unit suite (the CI gate): `npx vitest run tests/unit` — expect all green.
- [ ] **Step 4:** `npm run build` — expect success.
- [ ] **Step 5:** Confirm migration state locally:

```bash
npx wrangler d1 migrations list beauteas-db-dev --local --env dev
```

Expected: `0022_add_shipping_carrier.sql` and `0023_add_order_events.sql` applied (they were applied locally during BMC-216A).

### Task 2: Remote dev migrations + secret

- [ ] **Step 1 [HUMAN GATE]:** Backup remote dev before migrating:

```bash
npx wrangler d1 export beauteas-db-dev --remote --env dev --output=backup-dev-pre-0022-$(date +%Y%m%d).sql
```

- [ ] **Step 2:** Apply to remote dev and the preview DB:

```bash
npx wrangler d1 migrations apply beauteas-db-dev --remote --env dev
npx wrangler d1 migrations apply beauteas-db-dev --remote --env dev --preview
```

- [ ] **Step 3:** Verify effects (not just applied-state). ⚠️ Remember remote dev has drifted from seeds before (see CLAUDE.md) — verify counts, don't assume:

```bash
# Column exists + backfill result distribution
npx wrangler d1 execute beauteas-db-dev --remote --env dev --command \
  "SELECT shipping_carrier, COUNT(*) FROM orders GROUP BY shipping_carrier"
# Legacy carrier rows were normalized (compare against extensions)
npx wrangler d1 execute beauteas-db-dev --remote --env dev --command \
  "SELECT id, shipping_carrier, json_extract(extensions,'$.carrier') AS legacy FROM orders WHERE json_extract(extensions,'$.carrier') IS NOT NULL LIMIT 10"
# order_events table + indexes exist
npx wrangler d1 execute beauteas-db-dev --remote --env dev --command \
  "SELECT name FROM sqlite_master WHERE name LIKE 'order_events%' OR (type='index' AND tbl_name='order_events')"
```

Expected: every row with a legacy `extensions.carrier` has a non-null normalized `shipping_carrier`; `shipping_method`-only values like `standard` did NOT populate it.

- [ ] **Step 4 [HUMAN GATE]:** Provision the dev secret (generate a strong value; do not echo it into shell history — paste at the prompt):

```bash
openssl rand -base64 32 | pbcopy   # then paste when prompted
npx wrangler secret put ORDER_STATUS_SECRET --env dev
```

Also confirm `.dev.vars` has a (different) local value from BMC-216A, and that `cloudflare-env.d.ts` handling matches how `EMAIL_UNSUBSCRIBE_SECRET` is declared (hand-add only; never regenerate the file).

- [ ] **Step 5:** `npx wrangler secret list --env dev` — expect `ORDER_STATUS_SECRET` present.

### Task 3: Dev deploy + operator smoke test

- [ ] **Step 1 [HUMAN GATE]:** `npm run deploy:dev`
- [ ] **Step 2:** Place and pay a test order on the dev site (Stripe test card `4242 4242 4242 4242`). Expect: it appears in `/admin/orders` **Awaiting shipment** (oldest first), and the merchant notification email's "Manage this order" link opens that specific order.
- [ ] **Step 3:** Mark it shipped with **no tracking**. Expect: confirmation modal states the customer will be emailed; on success the row leaves Awaiting; the shipping email arrives with no empty tracking block; the admin timeline shows `shipment_created` + `shipping_email_sent` with your admin identity.
- [ ] **Step 4:** Place a second paid test order; mark shipped with carrier **UPS** and a tracking number. Expect: the modal previews the derived link; the email's tracking button opens `https://www.ups.com/track?...` with the number URL-encoded.
- [ ] **Step 5:** Edit tracking on the shipped order (switch to FedEx + new number). Expect: no email is sent; timeline shows `tracking_updated` with previous/new values.
- [ ] **Step 6:** Resend the shipping email. Expect: a `shipping_email_resent` event distinct from the original send.

### Task 4: Forced email-failure drill (dev)

- [ ] **Step 1 [HUMAN GATE]:** Break Resend on dev deliberately:

```bash
npx wrangler secret put RESEND_API_KEY --env dev   # enter: re_invalid_drill
```

- [ ] **Step 2:** Place, pay, and mark shipped a third test order. Expect: the order IS shipped (row leaves Awaiting), the UI shows an email-failure warning with **Retry email** (not a false overall failure), and the timeline records `shipping_email_failed`.
- [ ] **Step 3 [HUMAN GATE]:** Restore the real dev `RESEND_API_KEY`, then hit **Retry email**. Expect: success, `shipping_email_sent` recorded, and the retry visibly distinct from a resend in the timeline.

### Task 5: Customer-status smoke tests (dev)

- [ ] **Step 1:** As the registered test customer, open `/account/orders/<id>`. Expect: shipment card with status, shipped date, carrier, tracking number + link. A second signed-in user gets a 404 for the same URL.
- [ ] **Step 2:** Place a **guest** checkout order, pay, mark shipped. Expect: the shipping email contains an `/order-status/<id>?token=…` link; the page shows ONLY order number, placed date, status, shipped date, carrier/tracking, item names + quantities — no address, no payment data.
- [ ] **Step 3:** Tamper the token (flip one character), drop it, and use another order's id with this token. Expect: 404 in all three cases. View source: `noindex` robots meta and no-referrer policy present.

### Task 6: Regression sweep (dev)

- [ ] **Step 1:** Refund the first test order via the admin refund flow. Expect: order → `cancelled`/`refunded`, refund email sent, inventory restocked — identical to pre-BMC-216 behavior.
- [ ] **Step 2:** Attempt the legacy attack directly (with an admin session or API token):

```bash
curl -s -X PUT https://<dev-host>/api/orders \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"orderId":"<id>","status":"shipped","shipped_at":"2020-01-01T00:00:00Z"}'
```

Expect: `400` naming the ship endpoint; the order is unchanged; no email is sent.

- [ ] **Step 3:** Confirm a new paid order still lands in `processing` (payment promotion untouched) and appears in Awaiting.

### Task 7: Production rollout

- [ ] **Step 1 [HUMAN GATE]:** Backup production:

```bash
npx wrangler d1 export beauteas-db --remote --env production --output=backup-prod-pre-0022-$(date +%Y%m%d).sql
```

- [ ] **Step 2 [HUMAN GATE]:** Apply migrations + verify with the same SELECTs as Task 2 Step 3 (against `beauteas-db --env production`):

```bash
npx wrangler d1 migrations apply beauteas-db --remote --env production
npx wrangler d1 migrations list beauteas-db --remote --env production
```

- [ ] **Step 3 [HUMAN GATE]:** `npx wrangler secret put ORDER_STATUS_SECRET --env production` (fresh value, not the dev one), then `npx wrangler secret list --env production` shows all seven secrets.
- [ ] **Step 4 [HUMAN GATE]:** `npm run deploy:production`
- [ ] **Step 5 [HUMAN GATE]:** One controlled production smoke test: place a real low-value order (or operator test SKU), verify Awaiting → Mark shipped → email → customer status page → timeline, then refund it through the normal refund flow.
- [ ] **Step 6:** Existing pre-BMC-216 production orders render correctly in admin and customer views (spot-check the oldest and any order with legacy `extensions.carrier`).

### Task 8: Post-deploy monitoring (first week)

- [ ] **Step 1:** Keep the merchant new-order notification enabled (it remains the arrival alert).
- [ ] **Step 2:** Daily check for email failures:

```bash
npx wrangler d1 execute beauteas-db --remote --env production --command \
  "SELECT order_id, created_at, details FROM order_events WHERE event_type='shipping_email_failed' ORDER BY created_at DESC LIMIT 20"
```

- [ ] **Step 3:** `npx wrangler tail --env production` during the first real fulfillments; watch for 409s from double-clicks (expected, harmless) and any 5xx on the ship endpoint (not expected).

## Definition of Done

Matches the spec's Definition of Done: queue → ship → email → customer status verified in production; forced failure visible and retryable; no refund/inventory/payment/checkout regression; rollback assets (two `d1 export` backups) retained.

## Rollback notes

- `0022`/`0023` are additive (one nullable column, one new table) — a bad deploy is rolled back by redeploying the previous build; the schema can stay.
- If the backfill normalized something wrongly, the raw value is still in `extensions.carrier`; fix with a targeted `UPDATE`, never by re-running the migration.
