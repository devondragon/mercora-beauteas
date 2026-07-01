# BeauTeas Theme Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-theme the BeauTeas storefront and admin off the inherited Mercora "Volt" dark skin onto the existing BeauTeas warm-cream brand by routing all components through semantic Tailwind tokens.

**Architecture:** `brand.config.ts` is the single source of truth; `tailwind.config.ts` exposes its values as semantic tokens. The body already renders cream (`bg-surface-dark text-text-primary`). We extend the palette with two missing token groups (`secondary` gold, `state` functional colors), then sweep every component replacing hardcoded Volt classes (`bg-neutral-900`, `text-white`, `text-green-400`, `text-orange-500`, `#c4a87c`) with tokens per the mapping table below. No layout or behavior changes.

**Tech Stack:** Next.js 15 (App Router), TypeScript, Tailwind CSS 3.4, shadcn/ui. No automated test framework exists (per CLAUDE.md — manual verification only), so each task's verification loop is **lint + scoped grep gate + visual screenshot**, not unit tests.

## Global Constraints

- **Source of truth:** All colors come from `lib/brand.config.ts` via Tailwind tokens. Never hardcode new hex values in components.
- **No layout/behavior changes:** colors, surfaces, borders, and fonts only. Do not touch JSX structure, props, data, or logic except where extracting the shared price/stock styles (Task 2).
- **Lint must pass:** run `npm run lint` after every task; it must be clean.
- **Run `npm run lint`** before considering any task done (project rule).
- **Mapping table (apply consistently everywhere):**

  | Volt class | BeauTeas replacement | Notes |
  |---|---|---|
  | `bg-neutral-900`, `bg-black` (page/section wrapper) | remove so cream body shows; or `bg-surface-dark` | Don't repaint pages dark |
  | `bg-neutral-800` (card) | `bg-white` + `border border-border-default` | Elevated surface |
  | `bg-neutral-700` (inner/media) | `bg-surface` or `bg-surface-light` | Subtle elevation |
  | `text-white` (on light bg) | `text-text-primary` | Charcoal |
  | `text-white` (over image/gradient overlay) | **keep** `text-white` | Legitimate — review per-instance |
  | `text-gray-300/400` | `text-text-secondary` | |
  | `text-gray-500/600` | `text-text-muted` | |
  | `text-green-400`/`emerald-*` (in-stock, savings) | `text-state-success` | |
  | `text-orange-500` (links, CTAs) | `text-primary-600` (hover `text-primary-700`) | Brand link color |
  | `text-orange-500` (sale price) | `text-state-sale` | |
  | `bg-orange-600`/`bg-orange-500` (buttons/active) | `bg-primary-500` (hover `bg-primary-600`) | |
  | `text-red-*`/`bg-red-*` (hard error) | `text-state-error` / `bg-state-error-bg` | |
  | `#c4a87c` (any) | `secondary-400` token | |
  | `#f97316` (focus outline) | brand `primary-500` | |
  | `hover:text-black` on accent button | `hover:text-text-inverse` | |
  | `border-neutral-700`/`border-gray-700` | `border-border-default` | |

- **Ambiguous cases** (white text over photos/gradients, decorative overlays, intentional dark hero imagery) are reviewed per-instance and left as `text-white`/dark only when genuinely over a dark image. Each such exception must be obvious from surrounding JSX.

---

### Task 1: Extend the palette (secondary + state tokens)

**Files:**
- Modify: `lib/brand.config.ts` (add `secondary` and `state` to `colors`)
- Modify: `tailwind.config.ts` (surface the new tokens)

**Interfaces:**
- Produces (Tailwind classes consumed by all later tasks): `bg-secondary-{50..700}`, `text-secondary-*`, `border-secondary-*`; `text-state-success`, `bg-state-success-bg`, `text-state-error`, `bg-state-error-bg`, `text-state-sale`, `text-state-warning`, `text-state-info`.

- [ ] **Step 1: Add the `secondary` and `state` color groups to brand.config.ts**

In `lib/brand.config.ts`, inside the `colors: { ... }` object (after the `border` group, before the closing `}` of `colors`), add:

```ts
    // Secondary accent (honey/gold) — formalizes the legacy #c4a87c accent
    secondary: {
      50: "#faf6ef",
      100: "#f3e9d6",
      200: "#e8d4ad",
      300: "#d8c08f",
      400: "#c4a87c",   // main — replaces all hardcoded #c4a87c
      500: "#b08d5e",
      600: "#94733f",
      700: "#7a5e34",
    },
    // Functional/state colors, muted to sit on warm cream
    state: {
      success: { DEFAULT: "#4f7a5b", bg: "#eef4ee" }, // sage — in-stock, savings, success
      error: { DEFAULT: "#b3534b", bg: "#f7e9e7" },   // dusty rose — validation + hard errors
      sale: "#99544a",       // terracotta (= primary-700) — sale price emphasis
      warning: "#b08d5e",    // honey (= secondary-500) — low stock / caution
      info: "#555555",       // neutral informational (= text-secondary)
    },
```

- [ ] **Step 2: Surface the new tokens in tailwind.config.ts**

In `tailwind.config.ts`, inside `theme.extend.colors`, after the `primary: brand.colors.primary,` line add:

```ts
        secondary: brand.colors.secondary,
        state: brand.colors.state,
```

- [ ] **Step 3: Verify tokens compile and resolve**

Run: `npm run lint`
Expected: clean (no errors).

Then sanity-check the tokens are picked up by Tailwind's content scan by grepping the config:

Run: `node -e "const {brand}=require('esbuild-register/dist/node');" 2>/dev/null; npx tsc --noEmit lib/brand.config.ts 2>&1 | head -5 || true`
Expected: no type errors from the brand config (object is `as const`, valid TS).

(If `tsc` flags unrelated project errors, ignore — only the brand.config additions matter here.)

- [ ] **Step 4: Commit**

```bash
git add lib/brand.config.ts tailwind.config.ts
git commit -m "feat(theme): add secondary gold + functional state color tokens"
```

---

### Task 2: Shared price/stock styles + storefront core sweep

**Files:**
- Create: `lib/ui/state-styles.ts`
- Modify: `app/page.tsx`, `app/category/[slug]/page.tsx`, `app/category/[slug]/CategoryDisplay.tsx`, `app/product/[slug]/page.tsx`, `app/product/[slug]/ProductDisplay.tsx`, `components/ProductCard.tsx`, `components/ProductRecommendations.tsx`, `components/Breadcrumbs.tsx`, `components/PromotionalBanner.tsx`

**Interfaces:**
- Consumes: tokens from Task 1.
- Produces: `stateStyles` (used again by `components/agent/ProductCard.tsx` in Task 5).

- [ ] **Step 1: Create the shared state-style helper**

Create `lib/ui/state-styles.ts`:

```ts
/**
 * Shared className strings for functional/state UI (price, stock).
 * Centralizes the BeauTeas state colors so sale/stock styling stays
 * consistent across ProductCard, agent ProductCard, and product/category displays.
 */
export const stateStyles = {
  priceSale: "text-state-sale font-bold",
  priceOriginal: "line-through text-text-muted",
  savings: "text-state-success",
  inStock: "text-state-success",
  outOfStock: "text-state-error",
} as const;
```

- [ ] **Step 2: Migrate `app/page.tsx`**

Replace the hero wrapper `className="bg-neutral-900 text-white ..."` → drop `bg-neutral-900 text-white` (cream body shows; charcoal text inherits). Replace `text-gray-400` → `text-text-secondary`. Replace the hero button's `border-[#c4a87c] text-[#c4a87c] hover:bg-[#c4a87c] hover:text-black` → `border-secondary-400 text-secondary-600 hover:bg-secondary-400 hover:text-text-inverse`.

- [ ] **Step 3: Migrate `components/ProductCard.tsx` using the helper**

Apply the mapping table: `bg-neutral-800` → `bg-white border border-border-default`; `bg-neutral-700` (media) → `bg-surface-light`; `text-white` → `text-text-primary`; `text-gray-400` → `text-text-secondary`; `text-gray-500` → `text-text-muted`. For the price/stock block, import `{ stateStyles }` from `@/lib/ui/state-styles` and replace: `text-green-400` (savings/price drop) → `stateStyles.savings`; `line-through text-gray-400` → `stateStyles.priceOriginal`; `text-orange-500` (sale %) → `stateStyles.priceSale`; the in-stock/out-of-stock ternary `"text-green-400" : "text-orange-500"` → `stateStyles.inStock : stateStyles.outOfStock`; the "view details" link `text-orange-500 hover:underline` → `text-primary-600 hover:text-primary-700 hover:underline`.

- [ ] **Step 4: Migrate the remaining B1 files**

Apply the mapping table to: `app/category/[slug]/page.tsx`, `app/category/[slug]/CategoryDisplay.tsx`, `app/product/[slug]/page.tsx`, `app/product/[slug]/ProductDisplay.tsx`, `components/ProductRecommendations.tsx`, `components/Breadcrumbs.tsx`, `components/PromotionalBanner.tsx`. Use `stateStyles` for any price/stock display in the product/category displays. Leave `text-white` only where it sits over a dark product image/gradient.

- [ ] **Step 5: Lint**

Run: `npm run lint`
Expected: clean.

- [ ] **Step 6: Scoped grep gate**

Run:
```bash
grep -rnE "(bg|text|border)-(neutral|zinc|slate|gray)-(3|4|5|6|7|8|9)00|bg-black|text-orange-|text-green-4|#c4a87c" app/page.tsx app/category app/product components/ProductCard.tsx components/ProductRecommendations.tsx components/Breadcrumbs.tsx components/PromotionalBanner.tsx
```
Expected: no output, OR only lines that are `text-white`/dark over a dark image (none of the listed patterns should remain — `text-white` is allowed and not matched here).

- [ ] **Step 7: Visual check**

Run `npm run dev`, open `/` and `/category/clearly-calendula` and a product page. Confirm: cream backgrounds, no black boxes, links/CTAs in blush/terracotta, gold hero button, sale/stock in muted sage/rose. Screenshot each for the review.

- [ ] **Step 8: Commit**

```bash
git add lib/ui/state-styles.ts app/page.tsx app/category app/product components/ProductCard.tsx components/ProductRecommendations.tsx components/Breadcrumbs.tsx components/PromotionalBanner.tsx
git commit -m "feat(theme): retheme storefront core to BeauTeas palette"
```

---

### Task 3: Cart & checkout sweep

**Files:**
- Modify: `components/cart/CartItemCard.tsx`, `components/cart/CartDrawer.tsx`, `app/checkout/page.tsx`, `components/checkout/StripeProvider.tsx`, `components/checkout/ProgressBar.tsx`, `components/checkout/GiftCardInput.tsx`, `components/checkout/ShippingForm.tsx`, `components/checkout/OrderConfirmationModal.tsx`, `components/checkout/OrderSummary.tsx`, `components/checkout/ShippingOptions.tsx`, `components/checkout/PaymentForm.tsx`, `components/checkout/OrderItemCard.tsx`, `components/checkout/DiscountCodeInput.tsx`, `components/checkout/CheckoutClient.tsx`, `app/subscribe/confirmation/page.tsx`, `app/subscribe/checkout/SubscribeCheckoutClient.tsx`, `app/subscribe/checkout/page.tsx`

**Interfaces:**
- Consumes: tokens from Task 1; `stateStyles` from Task 2 for any price/stock display.

- [ ] **Step 1: Apply the mapping table to all files above**

Sweep each file per the Global Constraints mapping table. Notes specific to this batch: checkout progress/step indicators using `bg-orange-*`/`text-orange-*` → `bg-primary-500`/`text-primary-600`; success confirmations (`text-green-*`, green checkmarks) → `text-state-success` on `bg-state-success-bg`; validation errors (`text-red-*`) → `text-state-error` on `bg-state-error-bg`; discount/savings amounts → `text-state-success`. Stripe `<PaymentForm>` Element theming: if it passes an `appearance`/color option, set base text to `#222222` and accent to `#cf8577` (primary-500) — keep it inline since Stripe Elements can't read Tailwind tokens.

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: clean.

- [ ] **Step 3: Scoped grep gate**

Run:
```bash
grep -rnE "(bg|text|border)-(neutral|zinc|slate|gray)-(3|4|5|6|7|8|9)00|bg-black|text-orange-|text-green-4|#c4a87c" components/cart app/checkout components/checkout app/subscribe
```
Expected: no output (Stripe inline hex in PaymentForm is the only allowed exception and is not matched by this pattern).

- [ ] **Step 4: Visual check**

With `npm run dev`, add an item, open the cart drawer, walk the checkout steps, and view a subscribe checkout. Confirm cream surfaces, terracotta CTAs, muted success/error states. Screenshot.

- [ ] **Step 5: Commit**

```bash
git add components/cart app/checkout components/checkout app/subscribe
git commit -m "feat(theme): retheme cart, checkout, and subscribe flows"
```

---

### Task 4: Account & subscriptions sweep

**Files:**
- Modify: `app/account/settings/page.tsx`, `app/account/subscriptions/SubscriptionsClient.tsx`, `app/account/layout.tsx`, `app/account/error.tsx`, `app/account/loading.tsx`, `app/account/orders/[id]/page.tsx`, `app/account/orders/page.tsx`, `app/account/page.tsx`, `components/account/AddressManager.tsx`, `components/account/AccountSettings.tsx`, `components/account/DashboardCards.tsx`, `components/account/AccountSidebar.tsx`, `components/subscription/SubscriptionToggle.tsx`, `components/OrderCard.tsx`, `components/login/ClerkLogin.tsx`

**Interfaces:**
- Consumes: tokens from Task 1.

- [ ] **Step 1: Apply the mapping table to all files above**

Sweep each per the mapping table. Batch notes: dashboard cards/sidebars using `bg-neutral-800/900` → `bg-white border border-border-default`; active nav (`bg-orange-*`) → `bg-primary-500 text-text-inverse`; order/subscription status pills — map success/active → `text-state-success`/`bg-state-success-bg`, cancelled/error → `text-state-error`/`bg-state-error-bg`, paused/pending → `text-state-warning`. `components/login/ClerkLogin.tsx`: if it passes a Clerk `appearance` with dark colors, set base text `#222222`, primary `#cf8577`, background `#fdf8f6` (Clerk theming is inline, not Tailwind).

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: clean.

- [ ] **Step 3: Scoped grep gate**

Run:
```bash
grep -rnE "(bg|text|border)-(neutral|zinc|slate|gray)-(3|4|5|6|7|8|9)00|bg-black|text-orange-|text-green-4|#c4a87c" app/account components/account components/subscription components/OrderCard.tsx components/login
```
Expected: no output (Clerk inline hex is the only allowed exception, not matched here).

- [ ] **Step 4: Visual check**

With `npm run dev`, view the account dashboard, orders list, an order detail, subscriptions, settings, and the login screen. Confirm cream surfaces and on-brand status pills. Screenshot.

- [ ] **Step 5: Commit**

```bash
git add app/account components/account components/subscription components/OrderCard.tsx components/login
git commit -m "feat(theme): retheme account and subscription pages"
```

---

### Task 5: Blog, CMS, agent, reviews, shared UI, gift cards sweep

**Files:**
- Modify: `app/blog/page.tsx`, `app/blog/[slug]/page.tsx`, `app/[slug]/PageRenderer.tsx`, `components/agent/ProductCard.tsx`, `components/agent/AgentDrawer.tsx`, `components/reviews/ReviewForm.tsx`, `components/reviews/ProductReviewsSection.tsx`, `components/reviews/StarRating.tsx`, `components/ui/alert-dialog.tsx`, `components/ui/sheet.tsx`, `components/ui/dialog.tsx`, `components/ui/badge.tsx`, `components/ui/loading.tsx`, `components/ui/button.tsx`, `app/gift-cards/page.tsx`

**Interfaces:**
- Consumes: tokens from Task 1; `stateStyles` from Task 2 (for `components/agent/ProductCard.tsx`).

- [ ] **Step 1: Apply the mapping table to all files above**

Sweep each per the mapping table. Batch notes:
- `components/agent/ProductCard.tsx`: import and use `stateStyles` for price/stock exactly as `components/ProductCard.tsx` does.
- `components/agent/AgentDrawer.tsx` (Chai): this is a prominent surface — map dark drawer bg → `bg-white`/`bg-surface`, user/assistant bubbles to cream/blush tints (`bg-surface-light` / `bg-primary-100`), accent send button → `bg-primary-500`. Keep `text-white` only inside a filled primary button.
- shared `components/ui/*` (shadcn primitives): these define default surfaces for dialogs/sheets/badges/buttons used app-wide. Replace dark defaults (`bg-neutral-*`, `text-white`) with `bg-white`/`bg-surface` + `text-text-primary`; `button.tsx` default/primary variant → `bg-primary-500 text-text-inverse hover:bg-primary-600`; `badge.tsx` variants map to `secondary`/`state` tokens. Verify these don't regress already-migrated pages.
- `components/reviews/StarRating.tsx`: stars currently `text-orange-*`/`text-yellow-*` → `text-secondary-400` (gold), empty `text-border-default`.

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: clean.

- [ ] **Step 3: Scoped grep gate**

Run:
```bash
grep -rnE "(bg|text|border)-(neutral|zinc|slate|gray)-(3|4|5|6|7|8|9)00|bg-black|text-orange-|text-green-4|#c4a87c" app/blog "app/[slug]" components/agent components/reviews components/ui app/gift-cards
```
Expected: no output, or only justified `text-white`-over-image lines (not matched by this pattern).

- [ ] **Step 4: Visual check**

With `npm run dev`, view the blog list + a post, a CMS page, the Chai agent drawer (open it and send a message), a product's reviews + the review form, and the gift-cards page. Also re-check `/` and a product page to confirm the shared `ui/*` changes didn't regress earlier batches. Screenshot.

- [ ] **Step 5: Commit**

```bash
git add app/blog "app/[slug]" components/agent components/reviews components/ui app/gift-cards
git commit -m "feat(theme): retheme blog, CMS, Chai agent, reviews, shared UI, gift cards"
```

---

### Task 6: Admin globals.css rewrite (dark → light)

**Files:**
- Modify: `app/globals.css` (the `@layer components { .admin-* }` block + the mobile focus-outline rule)

**Interfaces:**
- Produces: light `.admin-*` classes consumed by the admin components in Task 7.

- [ ] **Step 1: Rewrite the `.admin-*` component classes**

In `app/globals.css`, replace the dark values in the `@layer components` block with light equivalents (keep class names and structure identical):

```css
  .admin-layout      { min-height: 100vh; background-color: #fdf8f6; }            /* surface-dark (cream) */
  .admin-sidebar     { background-color: #ffffff; border-color: #e8d5cf; }         /* white + border-default */
  .admin-header      { background-color: #ffffff; border-color: #e8d5cf; }
  .admin-content     { background-color: #fdf8f6; min-height: calc(100vh - 80px); }
  .admin-nav-active  { background-color: #cf8577; color: #ffffff; }                /* primary-500 */
  .admin-nav-inactive       { color: #555555; }                                    /* text-secondary */
  .admin-nav-inactive:hover { background-color: #f5ebe6; color: #222222; }         /* surface + text-primary */
  .admin-card        { background-color: #ffffff; border-color: #e8d5cf; }
  .admin-button-primary       { background-color: #cf8577; color: #ffffff; }       /* primary-500 */
  .admin-button-primary:hover { background-color: #b86a5d; }                       /* primary-600 */
  .admin-button-secondary       { background-color: #f5ebe6; color: #222222; border-color: #e8d5cf; }
  .admin-button-secondary:hover { background-color: #e8d5cf; }
  .admin-input        { background-color: #ffffff; border-color: #e8d5cf; color: #222222; }
  .admin-input:focus  { border-color: #cf8577; box-shadow: 0 0 0 1px #cf8577; }    /* primary-500 */
  .admin-scrollbar::-webkit-scrollbar { width: 6px; }
  .admin-scrollbar::-webkit-scrollbar-track { background: #f5ebe6; }
  .admin-scrollbar::-webkit-scrollbar-thumb { background: #d4b8ad; border-radius: 3px; }
  .admin-scrollbar::-webkit-scrollbar-thumb:hover { background: #cf8577; }
```

- [ ] **Step 2: Fix the mobile focus-outline orange**

In the `@layer base` `@media (hover: none)` block, change `outline: 2px solid #f97316;` → `outline: 2px solid #cf8577;` (primary-500).

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: clean.

- [ ] **Step 4: Visual check**

With `npm run dev`, open `/admin`. The shell (sidebar, header, content, nav active state) should now be light/cream with blush accents. (Inner page content still dark until Task 7 — that's expected.) Screenshot.

- [ ] **Step 5: Commit**

```bash
git add app/globals.css
git commit -m "feat(theme): convert admin shell styles from dark to BeauTeas light"
```

---

### Task 7: Admin component sweep (32 files)

**Files:**
- Modify: `app/admin/settings/page.tsx`, `app/admin/products/page.tsx`, `app/admin/products/ProductManagement.tsx`, `app/admin/blog/BlogManagement.tsx`, `app/admin/subscriptions/[id]/page.tsx`, `app/admin/subscriptions/page.tsx`, `app/admin/promotions/PromotionManagement.tsx`, `app/admin/promotions/page.tsx`, `app/admin/knowledge/page.tsx`, `app/admin/knowledge/KnowledgeManagement.tsx`, `app/admin/layout.tsx`, `app/admin/orders/[id]/page.tsx`, `app/admin/orders/page.tsx`, `app/admin/page.tsx`, `app/admin/pages/PageManagement.tsx`, `app/admin/categories/CategoryManagement.tsx`, `app/admin/categories/[id]/page.tsx`, `app/admin/categories/[id]/CategoryDetail.tsx`, `app/admin/categories/page.tsx`, `components/admin/ProductEditor.tsx`, `components/admin/AdminGuard.tsx`, `components/admin/AdminSidebar.tsx`, `components/admin/blog/MetadataSidebar.tsx`, `components/admin/blog/EditorFooter.tsx`, `components/admin/blog/TagInput.tsx`, `components/admin/blog/EditorFormatToolbar.tsx`, `components/admin/blog/BlogImageUpload.tsx`, `components/admin/blog/BlogEditor.tsx`, `components/admin/AdminHeader.tsx`, `components/admin/CategoryPicker.tsx`, `components/admin/AdminLayoutProvider.tsx`, `components/admin/reviews/ReviewModerationDashboard.tsx`

**Interfaces:**
- Consumes: tokens from Task 1; light `.admin-*` classes from Task 6.

- [ ] **Step 1: Apply the mapping table to all admin files**

Sweep each file per the Global Constraints mapping table. Admin-specific notes:
- Many tables/panels hardcode `bg-neutral-800/900`, `text-white`, `text-gray-400`, `border-neutral-700` — these often duplicate what `.admin-card`/`.admin-input` now provide. Prefer the existing `.admin-*` classes where a component is clearly a card/input/button; otherwise use tokens (`bg-white`, `text-text-primary`, `text-text-secondary`, `border-border-default`).
- Admin accent `bg-orange-600`/`text-orange-500` → `bg-primary-500`/`text-primary-600`.
- Status/badge colors (orders, subscriptions, reviews, promotions): success/active → `state-success`, error/rejected → `state-error`, pending/paused → `state-warning`.
- Because there are 32 files, dispatch them as parallel sub-sweeps grouped by directory (`app/admin/*` pages, `components/admin/blog/*`, other `components/admin/*`) — they share no state.

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: clean.

- [ ] **Step 3: Scoped grep gate**

Run:
```bash
grep -rnE "(bg|text|border)-(neutral|zinc|slate|gray)-(3|4|5|6|7|8|9)00|bg-black|text-orange-|text-green-4|#c4a87c|#f97316" app/admin components/admin
```
Expected: no output.

- [ ] **Step 4: Visual check**

With `npm run dev`, walk the admin: dashboard, products + product editor, orders + order detail, categories, promotions, subscriptions, blog editor, knowledge, pages, reviews moderation, settings. Confirm light surfaces, readable charcoal text, blush accents, on-brand status badges, no dark remnants. Screenshot the main ones.

- [ ] **Step 5: Commit**

```bash
git add app/admin components/admin
git commit -m "feat(theme): retheme admin dashboard components to BeauTeas light"
```

---

### Task 8: Final full-repo verification

**Files:** none (verification only)

- [ ] **Step 1: Full-repo grep gate**

Run:
```bash
grep -rnE "(bg|text|border)-(neutral|zinc|slate|gray)-(3|4|5|6|7|8|9)00|bg-black|text-orange-|text-green-4|#c4a87c|#f97316" --include="*.tsx" --include="*.css" app components
```
Expected: only intentional exceptions remain. Review each hit: it must be either (a) `text-white` over a genuinely dark image/gradient, or (b) an inline hex inside a Stripe/Clerk `appearance` object. Anything else is a miss — fix it.

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: clean.

- [ ] **Step 3: Cross-surface visual pass + contrast spot-check**

With `npm run dev`, screenshot home, category, product, cart drawer, checkout, account dashboard, blog post, Chai agent drawer, and admin dashboard side by side. Confirm: no dark boxes anywhere; links/CTAs blush/terracotta; accents gold; sale/stock/success/error in muted state colors; text comfortably readable on cream (spot-check AA — if any muted state color is too light on its cream bg, darken the hex in `brand.config.ts` and re-verify).

- [ ] **Step 4: Commit any contrast fixes**

```bash
git add lib/brand.config.ts
git commit -m "fix(theme): tune state color contrast on cream"
```
(Skip if no fixes were needed.)

---

## Self-Review

**Spec coverage:**
- Palette extension (secondary + state) → Task 1. ✓
- Mapping table applied across storefront → Tasks 2–5. ✓
- Shared price/badge helper → Task 2 (`lib/ui/state-styles.ts`), consumed in Tasks 2 & 5. ✓
- Admin `.admin-*` rewrite + `#f97316` outline → Task 6. ✓
- Admin component sweep (32 files) → Task 7. ✓
- Verification (lint + grep gate + screenshots + contrast) → per-task + Task 8. ✓
- Stripe/Clerk inline theming (can't read Tailwind) → called out in Tasks 3 & 4. ✓
- Migration order matches spec batches B1–B5. ✓

**Placeholder scan:** No TBD/TODO; each task lists exact files, exact mapping, exact grep/lint commands, and the token code is shown verbatim in Task 1 and Task 6.

**Type/name consistency:** `stateStyles` export name and keys (`priceSale`, `priceOriginal`, `savings`, `inStock`, `outOfStock`) defined in Task 2 and reused by name in Task 5. Token class names (`state-success`, `state-success-bg`, `secondary-400`, etc.) consistent with the nested `state.success.{DEFAULT,bg}` structure defined in Task 1.

No gaps found.
