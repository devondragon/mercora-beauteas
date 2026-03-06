---
phase: 2
slug: subscription-infrastructure
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-05
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (to be installed in Wave 0) |
| **Config file** | none — Wave 0 installs |
| **Quick run command** | `npx tsc --noEmit` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx tsc --noEmit`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 02-01-01 | 01 | 0 | N/A | setup | `npx vitest --version` | No | pending |
| 02-02-01 | 02 | 1 | SUBI-01 | unit | `npx vitest run tests/schema/subscription.test.ts` | No — W0 | pending |
| 02-02-02 | 02 | 1 | SUBI-02 | type-check | `npx tsc --noEmit` | N/A | pending |
| 02-02-03 | 02 | 1 | SUBI-03 | integration | `npx vitest run tests/models/subscriptions.test.ts` | No — W0 | pending |
| 02-03-01 | 03 | 1 | SUBI-04 | integration | `npx vitest run tests/stripe/subscription-methods.test.ts` | No — W0 | pending |
| 02-03-02 | 03 | 1 | SUBI-05 | unit | `npx vitest run tests/webhooks/signature-verification.test.ts` | No — W0 | pending |
| 02-04-01 | 04 | 2 | SUBI-06 | integration | `npx vitest run tests/webhooks/subscription-handlers.test.ts` | No — W0 | pending |
| 02-04-02 | 04 | 2 | SUBI-07 | integration | `npx vitest run tests/webhooks/invoice-handlers.test.ts` | No — W0 | pending |
| 02-04-03 | 04 | 2 | SUBI-08 | integration | `npx vitest run tests/webhooks/lifecycle-integration.test.ts` | No — W0 | pending |

*Status: pending · green · red · flaky*

---

## Wave 0 Requirements

- [ ] `npm install -D vitest` — install test framework
- [ ] `vitest.config.ts` — configure with path aliases matching tsconfig
- [ ] `tests/` directory structure matching test map above
- [ ] Test utilities for D1 mock/in-memory SQLite
- [ ] Stripe mock/stub utilities for testing without live API calls

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Stripe test-mode webhook delivery | SUBI-06, SUBI-07 | Requires Stripe CLI `stripe listen` with real event delivery | Run `stripe listen --forward-to localhost:3000/api/webhooks/stripe` and trigger events via Stripe Dashboard or CLI |
| Email delivery renders correctly | SUBI-08 | Visual verification of email layout | Trigger subscription lifecycle events and inspect Resend dashboard for rendered emails |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
