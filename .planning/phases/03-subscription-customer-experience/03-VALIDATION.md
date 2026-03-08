---
phase: 3
slug: subscription-customer-experience
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-06
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | None (TypeScript type checking + manual verification, consistent with Phase 2) |
| **Config file** | tsconfig.json |
| **Quick run command** | `npx tsc --noEmit` |
| **Full suite command** | `npx tsc --noEmit && npx next build` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx tsc --noEmit`
- **After every plan wave:** Run `npx tsc --noEmit && npx next build`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 03-01-01 | 01 | 1 | SUBX-08 | tsc | `npx tsc --noEmit` | N/A W0 | ⬜ pending |
| 03-01-02 | 01 | 1 | SUBX-02 | tsc | `npx tsc --noEmit` | N/A W0 | ⬜ pending |
| 03-01-03 | 01 | 1 | SUBX-03 | tsc | `npx tsc --noEmit` | N/A W0 | ⬜ pending |
| 03-02-01 | 02 | 1 | SUBX-01 | tsc + manual | `npx tsc --noEmit` | N/A W0 | ⬜ pending |
| 03-02-02 | 02 | 1 | SUBX-02, SUBX-03 | tsc + manual | `npx tsc --noEmit` | N/A W0 | ⬜ pending |
| 03-03-01 | 03 | 2 | SUBX-04, SUBX-05, SUBX-06, SUBX-07 | tsc + manual | `npx tsc --noEmit` | N/A W0 | ⬜ pending |
| 03-03-02 | 03 | 2 | SUBX-08 | tsc | `npx tsc --noEmit` | N/A W0 | ⬜ pending |
| 03-03-03 | 03 | 2 | SUBX-09 | existing | Already verified in Phase 2 | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements:
- TypeScript compiler is configured (`tsconfig.json`)
- `npx next build` validates pages and API routes
- No additional test framework needed (consistent with Phase 2 precedent)
- SUBX-09 email functionality already implemented and verified in Phase 2

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Subscription toggle UI on product page | SUBX-01 | Visual component rendering | Navigate to product page, verify toggle between One-time/Subscribe, check frequency picker appears, verify discount display |
| SetupIntent checkout flow | SUBX-02 | Requires Stripe test mode interaction | Navigate to /subscribe/checkout, enter test card 4242..., confirm setup completes |
| Subscription creation after SetupIntent | SUBX-03 | Requires Stripe webhook delivery | After checkout, verify subscription appears in Stripe Dashboard and D1 |
| Pause subscription | SUBX-04 | Requires Stripe API interaction | On /subscriptions, click Pause, verify status changes in UI and Stripe Dashboard |
| Resume subscription | SUBX-05 | Requires Stripe API interaction | On /subscriptions, click Resume on paused sub, verify status changes |
| Skip next renewal | SUBX-06 | Requires Stripe API interaction | Click Skip Next, verify pause_collection with resumes_at in Stripe Dashboard |
| Cancel subscription | SUBX-07 | Requires Stripe API interaction | Click Cancel, confirm dialog, verify cancel_at_period_end in Stripe |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
