---
phase: 1
slug: seo-foundations
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-05
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | None — no test framework installed; curl-based smoke tests |
| **Config file** | none — no formal test config |
| **Quick run command** | `npm run lint` |
| **Full suite command** | `npm run lint` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm run lint` + manual curl check of affected page
- **After every plan wave:** Full lint + curl-based smoke tests for all 7 requirements
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 1-01-01 | 01 | 1 | SEO-01 | smoke | `curl -s localhost:3000/sitemap.xml \| head -5` | N/A | ⬜ pending |
| 1-01-02 | 01 | 1 | SEO-07 | smoke | `curl -sI localhost:3000/products/test \| grep -i location` | N/A | ⬜ pending |
| 1-02-01 | 02 | 1 | SEO-02 | smoke | `curl -s localhost:3000/product/[slug] \| grep 'og:title'` | N/A | ⬜ pending |
| 1-02-02 | 02 | 1 | SEO-03 | smoke | `curl -s localhost:3000/category/[slug] \| grep 'og:title'` | N/A | ⬜ pending |
| 1-03-01 | 03 | 2 | SEO-04 | smoke | `curl -s localhost:3000/product/[slug] \| grep 'application/ld+json'` | N/A | ⬜ pending |
| 1-03-02 | 03 | 2 | SEO-05 | smoke | `curl -s localhost:3000/ \| grep 'Organization'` | N/A | ⬜ pending |
| 1-03-03 | 03 | 2 | SEO-06 | smoke | `curl -s localhost:3000/product/[slug] \| grep 'BreadcrumbList'` | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

*Existing infrastructure covers all phase requirements — no test framework setup needed.*

This phase verifies server-rendered HTML output (metadata tags, JSON-LD, sitemap XML) via curl-based smoke tests and Google's Rich Results Test. The project's "no new npm dependencies" constraint and the nature of the verification (HTML inspection) make curl-based testing the appropriate approach.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Rich Results Test validates product structured data | SEO-04, SEO-06 | External Google tool, cannot automate | 1. Deploy or run dev server 2. Submit product URL to Google Rich Results Test 3. Verify no errors |
| OG tag social preview renders correctly | SEO-02, SEO-03 | Requires visual inspection of social card | 1. Use Facebook Sharing Debugger or Twitter Card Validator 2. Paste product/category URL 3. Verify image, title, description render |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
