# Observability & Alerting (BMC-168)

Production error tracking + alerting for BeauTeas, built **Cloudflare-native** (no
Sentry/Datadog). The goal: a failure on a money path (order creation, payment,
webhook, refund, gift-card fulfillment) pings a human within seconds instead of
sitting silently in logs until a customer complains.

## Architecture

```
┌────────────────────────┐        traces          ┌──────────────────────────────┐
│  beauteas (main app)   │  ───────────────────▶  │  beauteas-observability-tail │
│  .open-next/worker.js  │   exceptions + logs    │  (Tail Worker)               │
│                        │                        │  • matches uncaught throws   │
│  beauteas-recs-cron    │  ───────────────────▶  │  • matches [critical] logs   │
└────────────────────────┘   tail_consumers       │  • emails alert via Resend   │
         │                                         └──────────────────────────────┘
         │ writeDataPoint (ANALYTICS binding)
         ▼
   Workers Analytics Engine  ──▶  dashboards / SQL API  (money-path metrics)
```

Three moving parts:

1. **`workers/observability-tail/`** — a **Tail Worker**. Registered as a
   `tail_consumers` of the main app Worker and the cron Worker, so it receives
   every invocation's trace (`{ outcome, logs[], exceptions[] }`) **without any
   change to the OpenNext-generated `.open-next/worker.js`**. It alerts on:
   - `outcome: "exception"` — an uncaught throw / script error, and
   - any log line containing `[critical]` — the marker emitted by `logCritical()`.

   Matches are deduped within the batch and capped at 5 emails per invocation
   (retry-storm guard), then sent via the Resend API.

2. **`lib/utils/observe.ts` → `logCritical(area, event, detail?, error?)`** — the
   structured-logging helper. Emits one stable `[critical] <area>.<event>` line
   (parsed by the Tail Worker) **and** a best-effort Analytics Engine data point.
   It never throws — telemetry can't break a money path. Called at the outer
   catch of the five money paths, alongside (not replacing) existing
   `console.error` domain logging.

3. **Workers Analytics Engine** (`ANALYTICS` binding) — money-path failure
   counters for dashboards / the SQL API. Distinct dataset per env
   (`beauteas_money_events` / `beauteas_money_events_dev`). Auto-created on first
   write.

## Instrumented money paths

| Area (`CriticalArea`) | Where | Alertable events |
|---|---|---|
| `order_create` | `app/api/orders/route.ts` | `order_create_failed` (unexpected 500; client 400s intentionally not paged) |
| `payment_intent` | `app/api/payment-intent/route.ts` | `create_failed` |
| `webhook` | `app/api/webhooks/stripe/route.ts` | `processing_failed`, `order_paid_update_failed` |
| `refund` | `app/api/orders/refund/route.ts` | `settled_but_order_missing`, `settled_but_ledger_flip_failed`, `processing_failed` |
| `giftcard` | `lib/services/order-finalization.ts` | `fulfillment_errors`, `fulfillment_threw`, `tender_not_redeemed_revert_failed` |

Uncaught exceptions anywhere in the app are caught by the Tail Worker regardless
of instrumentation.

## Deploy & configure

The Tail Worker deploys **separately and BEFORE** the producers that reference it
(a `tail_consumers` service must already exist). From `workers/observability-tail/`:

```bash
# 1. Deploy the Tail Worker per environment
npx wrangler deploy --env dev          # -> beauteas-observability-tail-dev
npx wrangler deploy --env production   # -> beauteas-observability-tail

# 2. Set its secrets per environment (recipient kept out of git)
npx wrangler secret put RESEND_API_KEY --env dev
npx wrangler secret put ALERT_EMAIL_TO --env dev          # comma-separated ok
npx wrangler secret put RESEND_API_KEY --env production
npx wrangler secret put ALERT_EMAIL_TO --env production

# 3. THEN deploy the main app (npm run deploy:dev / deploy:production) and the
#    cron Worker (npx wrangler deploy in workers/recommendations-cron/), which
#    now reference the Tail Worker via tail_consumers.
```

`ALERT_EMAIL_FROM` is a plain var in each `wrangler.jsonc` (`alerts@beauteas.com`)
and **must be on a Resend-verified domain**, or sends 4xx.

## Verifying acceptance

> **Acceptance:** a forced failure in order creation or webhook handling produces
> an alert to a channel someone watches, within minutes.

On dev, force a throw on a money path (e.g. a temporary `throw new Error('canary')`
in the `POST /api/orders` 500 path, or send a malformed Stripe webhook) and
confirm an email lands at `ALERT_EMAIL_TO`. `npx wrangler tail beauteas-observability-tail-dev`
shows the Tail Worker receiving the trace and the Resend send result.

## Notes / not covered

- **Cross-invocation throttling** is not implemented — a fault that recurs across
  many separate invocations (e.g. a webhook 500-looping every few minutes) sends
  one email per invocation. In-batch dedupe + the per-invocation cap bound a
  single burst; a KV-backed per-signature cooldown is a future enhancement
  (see BMC-199-style follow-ups).
- The `mcp_usage` audit table (noted dead in BMC-168) is **not** wired here; MCP
  audit logging is separate from money-path alerting.
