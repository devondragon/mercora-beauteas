---
phase: 6
slug: pre-launch-polish
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-03-06
---

# Phase 6 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | None configured (no test runner in devDependencies) |
| **Config file** | None |
| **Quick run command** | `npx tsc --noEmit` |
| **Full suite command** | `npx tsc --noEmit && npx next lint` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx tsc --noEmit`
- **After every plan wave:** Run `npx tsc --noEmit && npx next lint`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 06-01-01 | 01 | 1 | SUBI-08, SUBX-09 | type-check + manual | `npx tsc --noEmit` | N/A | pending |
| 06-01-02 | 01 | 1 | SUBI-08, SUBX-09 | type-check + manual | `npx tsc --noEmit` | N/A | pending |
| 06-02-01 | 02 | 1 | SEO-07 | type-check + manual | `npx tsc --noEmit` | N/A | pending |

*Status: pending · green · red · flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements. No test framework installation needed — TypeScript compilation validates type correctness of all changes.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Email manageUrl points to /subscriptions | SUBI-08 | No test framework; behavioral verification requires running server | Inspect handler code: all `manageUrl` values use `${BASE_URL}/subscriptions` |
| Email productName shows human-readable names | SUBX-09 | No test framework; requires DB lookup validation | Inspect handler code: productName resolved via DB lookup + resolveLocalizedField |
| Redirects return 301 status code | SEO-07 | Requires running server to verify HTTP status | `curl -I localhost:3000/products/test-slug` shows 301 |

---

## Validation Sign-Off

- [x] All tasks have automated verify (tsc --noEmit) or manual verification instructions
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (none needed)
- [x] No watch-mode flags
- [x] Feedback latency < 30s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
