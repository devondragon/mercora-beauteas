# BeauTeas Theme Migration — Design

**Date:** 2026-06-30
**Status:** Approved (design); pending implementation plan
**Scope:** Storefront + admin re-theme to the BeauTeas light/warm brand

---

## Problem

`lib/brand.config.ts` already defines a complete BeauTeas light theme — warm cream
surfaces (`#fdf8f6`), blush/peach primary (`#ebc3bb`), charcoal text (`#222`), and
serif fonts (Lora/Alegreya). `tailwind.config.ts` exposes these as semantic tokens
(`surface`, `primary`, `text-primary`, etc.), and `app/layout.tsx` already applies
`bg-surface-dark text-text-primary` to `<body>`, so the cream theme is live globally.

However, the storefront and admin components were never migrated off the inherited
**Mercora "Volt" demo** skin. They paint dark Volt colors *on top of* the cream body
using hardcoded Tailwind classes — `bg-neutral-900`, `bg-neutral-800`, `text-white`,
`text-gray-400`, `text-green-400`, `text-orange-500` — plus a hardcoded gold `#c4a87c`.
The result is black background boxes with green/orange text that clash with the brand.

**Affected surface area:** ~59 storefront `.tsx` files + ~32 admin `.tsx` files, plus the
`.admin-*` component classes in `app/globals.css`.

## Goal

Make every customer-facing and admin surface render in the BeauTeas palette by routing
components through the existing semantic tokens (extended where needed), without changing
layouts or behavior. Leave the codebase token-driven so future palette tweaks are
config-only.

## Non-goals

- No layout/UX redesign — colors, fonts, and surfaces only.
- No new component library / primitive system beyond the one small price/badge helper noted below.
- No changes to data, routing, or business logic.

---

## Decisions (locked)

| Decision | Choice |
|---|---|
| Scope | Storefront **and** admin |
| Source of truth | `brand.config.ts` as canonical (extended with the two token groups below) |
| Functional/state colors | Keep functional semantics but **mute to the warm palette** (sage success, dusty-rose error, terracotta sale) |
| Hardcoded gold `#c4a87c` | Formalize as a brand **`secondary`** (honey/gold) token |
| Approach | **Token-driven migration** (mapping table + batch sweep), with a tiny price/badge helper where that pattern repeats |

---

## Palette extension

Add two token groups to `lib/brand.config.ts` and surface them in `tailwind.config.ts`.

### `secondary` (honey/gold) — anchored on the existing `#c4a87c`
```
50:  #faf6ef
100: #f3e9d6
200: #e8d4ad
300: #d8c08f
400: #c4a87c   // main — replaces all hardcoded #c4a87c
500: #b08d5e
600: #94733f
700: #7a5e34
```

### `state` (functional, muted for cream)
```
success:    #4f7a5b   on  successBg: #eef4ee   // sage — in-stock, price drop, success toasts
error:      #b3534b   on  errorBg:   #f7e9e7   // dusty rose / brick — validation + hard errors
sale:       #99544a   (= primary-700 terracotta)  // sale price, discount accents
warning:    #b08d5e   (= secondary-500)           // low-stock / caution
info:       #555555   (= text-secondary)          // neutral informational
```

Exact hex values are tunable during implementation if contrast checks (WCAG AA on cream)
require it, but the families above are fixed.

### Tailwind token names (new)
- `secondary` (full scale) → `bg-secondary-400`, `text-secondary-600`, etc.
- `state-success`, `state-success-bg`, `state-error`, `state-error-bg`, `state-sale`,
  `state-warning`, `state-info`.

---

## Volt → BeauTeas mapping table

Applied consistently across all files. "(page)" = top-level page/section wrapper;
"(card)" = elevated content box.

| Volt class | BeauTeas replacement | Notes |
|---|---|---|
| `bg-neutral-900`, `bg-black` (page) | remove → cream body shows; or `bg-surface-dark` | Don't repaint the page dark |
| `bg-neutral-800` (card) | `bg-white` + `border border-border-default` | Elevated surface on cream |
| `bg-neutral-700` (inner/media) | `bg-surface` or `bg-surface-light` | Subtle elevation |
| `text-white` (on light bg) | `text-text-primary` | Charcoal |
| `text-white` (on dark image overlay) | **keep** `text-white` | Legit over photos/gradients |
| `text-gray-400` | `text-text-secondary` | |
| `text-gray-500` | `text-text-muted` | |
| `text-green-400` / `text-emerald-*` | `text-state-success` | In-stock, savings |
| `text-orange-500` (links/CTAs) | `text-primary-600` (hover `primary-700`) | Brand link/CTA color |
| `text-orange-500` (sale price) | `text-state-sale` | Discount emphasis |
| `bg-orange-600` (buttons/active) | `bg-primary-500` (hover `primary-600`) | Storefront CTAs |
| `#c4a87c` (any usage) | `secondary-400` | Hero buttons, accents |
| `hover:text-black` on gold btn | `hover:text-text-inverse` / appropriate | |
| `border-neutral-700` | `border-border-default` | |

Ambiguous cases (white text over imagery, gradients, decorative overlays) are reviewed
per-file rather than blindly swapped.

### Admin specifics
- Rewrite `.admin-*` classes in `app/globals.css` from dark → light:
  - `admin-layout` / `admin-content`: `bg-surface-dark` (cream)
  - `admin-sidebar` / `admin-header` / `admin-card`: `bg-white` + `border-border-default`
  - `admin-nav-active` / `admin-button-primary`: `bg-primary-500` accent (was `orange-600`)
  - `admin-input` focus ring: `primary-500` (was `orange-600`)
  - scrollbar / inputs: light surfaces, charcoal text
- The mobile focus-outline `#f97316` (orange) in `globals.css` → brand `primary`/`secondary`.
- Sweep the 32 admin component files for the same hardcoded classes per the table above.

---

## Migration order

Batches are independent and can be done by parallel subagents; verify after each batch.

1. **Storefront core** — `app/page.tsx`, `app/category/**`, `app/product/**`, `components/ProductCard.tsx`, `components/ProductRecommendations.tsx`, `components/Breadcrumbs.tsx`, `components/PromotionalBanner.tsx`.
2. **Cart & checkout** — `components/cart/**`, `app/checkout/**`, `components/checkout/**`, subscribe checkout.
3. **Account & subscriptions** — `app/account/**`, `components/account/**`, `components/subscription/**`, `components/OrderCard.tsx`, `components/login/ClerkLogin.tsx`.
4. **Blog / CMS / agent / reviews / shared UI** — `app/blog/**`, `app/[slug]/PageRenderer.tsx`, `components/agent/**`, `components/reviews/**`, `components/ui/**`, `app/gift-cards/**`.
5. **Admin** — `app/globals.css` `.admin-*` rewrite first, then `app/admin/**` + `components/admin/**` (32 files).

### Small helper (the one bit of approach B)
The product price/badge block (original price, sale price, savings %, in/out-of-stock) repeats
across `ProductCard`, `agent/ProductCard`, and product/category displays. Extract a small
presentational helper (or shared classNames) for it so the sale/stock state colors are applied
once and stay consistent. Keep it minimal — no broader primitive system.

---

## Verification

- `npm run lint` clean.
- Run the dev server and screenshot key pages — home, category, product, cart drawer,
  checkout, account dashboard, blog, agent (Chai) drawer, and the admin dashboard — to confirm:
  - no remaining dark/black boxes on customer-facing or admin surfaces,
  - links/CTAs use blush/terracotta, accents use gold, sale/stock use the muted state colors,
  - text contrast is comfortable on cream (spot-check AA).
- Grep gate: `grep -rE "(bg|text|border)-(neutral|zinc|slate|gray)-(7|8|9)|bg-black|text-orange-|text-green-4|#c4a87c"` over `app/` + `components/` returns only intentional exceptions (e.g. white-on-image overlays), each justified.

## Risks

- **White-on-image overlays**: must not be blanket-replaced; handled per-file.
- **Contrast**: muted state colors on cream need an AA spot-check; values are tunable.
- **Admin density**: dark→light on data-heavy admin tables may surface spacing/border issues;
  in scope to fix borders/surfaces, not to redesign layouts.
