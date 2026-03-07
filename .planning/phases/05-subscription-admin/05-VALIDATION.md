---
phase: 5
slug: subscription-admin
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-03-06
---

# Phase 5 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | None — project convention is tsc + next build |
| **Config file** | tsconfig.json (existing) |
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
| 05-01-XX | 01 | 1 | SUBA-01 | type-check | `npx tsc --noEmit` | N/A | ⬜ pending |
| 05-01-XX | 01 | 1 | SUBA-02 | type-check | `npx tsc --noEmit` | N/A | ⬜ pending |
| 05-01-XX | 01 | 1 | SUBA-03 | type-check | `npx tsc --noEmit` | N/A | ⬜ pending |
| 05-01-XX | 01 | 1 | SUBA-05 | type-check | `npx tsc --noEmit` | N/A | ⬜ pending |
| 05-02-XX | 02 | 1 | SUBA-04 | type-check | `npx tsc --noEmit` | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

*Existing infrastructure covers all phase requirements. No test framework to install — project uses `tsc --noEmit` + `next build` per Phase 2 convention.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Dashboard displays active count, MRR, churn rate | SUBA-01 | UI rendering, no test framework | Visit /admin/subscriptions, verify 6 stat cards show correct data |
| Filterable table with status, customer, product, frequency | SUBA-02 | UI interaction, no test framework | Filter by each status, search by customer name, verify pagination |
| Detail view with event timeline | SUBA-03 | UI rendering + navigation, no test framework | Click subscription row, verify summary card + color-coded timeline |
| Plan management in product editor | SUBA-04 | UI form interaction, no test framework | Edit product, toggle subscription, set frequencies/discount, save |
| Subscriptions link in admin sidebar | SUBA-05 | UI rendering | Verify "Subscriptions" link appears and navigates correctly |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 30s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
