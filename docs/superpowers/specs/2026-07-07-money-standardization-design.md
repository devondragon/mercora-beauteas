# Money Standardization — Design Spec

**Date:** 2026-07-07
**Ticket:** [BMC-164](https://linear.app/blackmagicconsulting/issue/BMC-164) — Normalize money units (cents vs dollars) across pricing/MCP/order paths
**Status:** Approved design → ready for implementation plan
**Delivery:** Single PR, ordered atomic commits (P0→P5 below)

---

## Problem

The codebase has **two parallel, contradictory money pipelines** and no type-level guardrail:

- **Catalog / DB / orders / gift-cards** treat `Money.amount` as integer **minor units (cents)**.
- **Storefront cart / checkout / order-confirmation email** run in **decimal dollars**, converting at add-to-cart (`/100`) and re-converting at order POST (`*100`).

Because the two units meet through bare `number` parameters, unit mismatches are invisible to the type system. This has already produced real bugs:

- **BMC-161 (fixed, PR #55):** `place_order` persisted `total_amount` in dollars where the field is cents → 100× underpricing.
- **BMC-161 follow-up (fixed, PR #60):** a cents subtotal passed into dollars-expecting `calculateShipping`/`calculateTax` → free shipping for nearly every cart + 100× tax.

And it is still producing latent/live bugs the reconnaissance found (see §Live Bugs).

## Goal

Make money units unambiguous and impossible to mix accidentally, and align the external representation with the **MACH Alliance Open Data Model** `Money` object — **without** a risky backfill of existing financial data.

### Non-goals
- Multi-currency storefront (currency stays effectively USD; the value object is currency-aware but we do not add locale/currency switching).
- Reformatting at-rest storage to MACH decimal-major units (explicitly deferred — see Decisions).
- Any unrelated refactoring of the order/pricing domain beyond what these changes touch.

---

## Key facts (from reconnaissance)

### MACH Alliance `Money` object (authoritative)
Source: `machalliance/standards` → `models/entities/utilities/money.md`.

| Field | Definition |
|---|---|
| `amount` | Numeric value in **major** currency units — a **decimal** (e.g. `34.95`, `-15.50`). "Store amounts as numbers, not strings." |
| `currency` | ISO 4217 code |
| `precision` | *(optional)* decimal places for display — `2` USD, `0` JPY, `3` BHD |

Best practice: "Consider using a **decimal library** for financial calculations." Discounts should use separate discount tracking, not negative Money.

⇒ MACH is **decimal major units**, which is a **wire/interchange** representation. At-rest storage is an implementation detail MACH does not govern.

### Current storage conventions (stay as-is under this design)
- `orders.total_amount` — JSON `{amount: <cents>, currency}` (integer minor units)
- `product_variants.price` / `compare_at_price` / `cost` — JSON `Money`, integer minor units (with legacy string/bare-number encodings that `Money.fromStored` must absorb)
- `gift_cards.*` / `gift_card_transactions.*` — integer minor-unit columns (append-only reconciling ledger)
- `pricing.list_price` / `sale_price` — JSON `Money`, **unit uncertain** (helper code treats as dollars) → must be verified empirically
- `orders.currency_code` — redundant with `total_amount.currency` (note; reconcile opportunistically)

---

## Decisions (locked)

1. **Internal canonical unit = integer minor units**, mediated by a `Money` value object. MACH decimal-major is emitted **only at serialization boundaries** (public API, MCP, JSON-LD).
2. **Fix the live/latent bugs** uncovered by recon as part of this sweep (each its own atomic commit + regression test).
3. **Value object = an owned thin `Money` class + big.js** for exact fractional math. We own the API and the MACH/Stripe serialization contract. big.js `7.0.1` (current, stable).
   - Note: dinero.js v2 reached stable (`2.0.2`, Mar 2026) and was the considered alternative; we chose the owned object for full control of the serialization contract.
4. **Single PR**, delivered as an ordered sequence of atomic commits (P0→P5).
5. **No backfill** of minor-unit columns (orders, variants, gift-card ledger). Only targeted normalization of the few dollars-storing spots (`pricing` table if it's dollars; `extensions.shipping_cost`), which is low-risk pre-launch.
6. Changing API/MCP/JSON-LD response shapes to MACH is an **accepted pre-launch breaking change** — all consumers are in-repo and updated in the same PR.

---

## Architecture

### The `Money` value object — `lib/money/`

```
lib/money/
  money.ts        # the Money class (immutable)
  currencies.ts   # ISO 4217 minor-unit exponents (precision) table
  index.ts        # barrel
```

`Money` — immutable, currency-aware, holds `#minorUnits: number` (integer) + `#currency: string`.

**Constructors**
- `Money.fromMinor(minorUnits: number, currency = 'USD'): Money` — validates integer.
- `Money.fromMajor(major: number | string, currency = 'USD'): Money` — big.js parse × 10^precision, round half-up to integer minor.
- `Money.zero(currency = 'USD'): Money`
- `Money.fromStored(value: unknown, currency?: string): Money` — parses legacy at-rest encodings (Money object with cents `amount`, JSON string, bare numeric string) → all interpreted as **minor units**. Replaces the scattered `parseMoneyField`/`priceToCents`/inline `JSON.parse` logic.

**Operations** (return new `Money`; throw on currency mismatch)
- `.add(m)`, `.subtract(m)`, `.negate()`
- `.times(qty: number)` — integer multiply by a quantity (count).
- `.applyRate(rate: number | string)` — big.js: `minor × rate`, round half-up to integer minor. For tax rates and percentage discounts.
- `.allocate(ratios: number[]): Money[]` — split without losing minor units (largest-remainder).

**Comparisons**
- `.equals(m)`, `.gte(m)`, `.gt(m)`, `.lte(m)`, `.lt(m)`, `.isZero()`, `.isNegative()`

**Serialization — the three boundaries + display**
- `.toMinorUnits(): number` → **Stripe** (integer minor units).
- `.toMach(): { amount: number; currency: string; precision: number }` → **wire** (public API / MCP / JSON-LD). `amount` = big.js(`minor`) / 10^precision as a Number with `precision` places.
- `.toJSON(): { amount: number; currency: string }` → **persistence**; `amount` stays **minor units** (no backfill). Documented as distinct from `.toMach()`.
- `.format(locale?: string): string` → **display**; delegates to the MACH-aware `formatCurrency` in `lib/models/mach/language.ts` with the major-unit value + precision. The single formatting entry point.

`currencies.ts` — minor-unit exponent table (subset of ISO 4217): `USD/EUR/GBP/CAD/AUD/CHF/CNY/INR/BRL = 2`, `JPY = 0`, `BHD/KWD = 3`; `getPrecision(currency): number` defaults to `2`.

### Boundary map (where each serializer is used)

| Boundary | Method | Sites |
|---|---|---|
| Stripe | `.fromMinor` / `.toMinorUnits` | `lib/stripe.ts` (replaces `formatAmountForStripe`/`parseAmountFromStripe`), payment-intent, subscriptions, invoices, refunds |
| Wire (MACH) | `.toMach` | `/api/products`, `/api/orders`, `/api/promotions`, MCP tool responses (`lib/mcp/**`), `lib/seo/json-ld.tsx` |
| Persistence | `.fromStored` / `.toJSON` | Drizzle read/write of `total_amount`, variant prices, pricing, gift-card ledger |
| Display | `.format` | all storefront/admin/email formatting (replaces the 6+ duplicated formatters) |

---

## Component changes

### 1. Collapse the storefront "dollars" pipeline (→ minor units via `Money`)
Cart store, checkout components, and email all carry `Money`/minor units end-to-end.
- Remove `/100` at add-to-cart: `app/product/[slug]/ProductDisplay.tsx` (and `ProductCard`s).
- Remove `Math.round(*100)` at order POST: `components/checkout/CheckoutClient.tsx`, `DiscountCodeInput.tsx`.
- `OrderSummary`, `CartItemCard`, `CartDrawer`, `OrderItemCard`, `ShippingOptions`, `GiftCardInput` consume `Money` and display via `.format()`.
- Gift-card denominations: `components/gift-card/GiftCardPurchaseForm.tsx` uses `Money.fromMajor(25,'USD')`.
- `lib/stores/cart-store.ts` holds minor units / `Money`.

### 2. Pricing / tax / shipping math typed to `Money`
- `computeOrderTotals`, `calculateShipping`, `calculateTax` (`lib/mcp/tools/order.ts`, `lib/services/order-pricing.ts`) take and return `Money`. Free-shipping threshold: `subtotal.gte(Money.fromMajor(threshold,'USD'))`. Tax: `subtotal.applyRate(rate)`. Subsumes the BMC-161 fixes into the type system.
- Reconcile the duplicate `orders` table definition (`lib/db/schema/order.ts` vs `lib/models/order.ts`) — one canonical schema.

### 3. Serialization → MACH at the wire
- API/MCP/JSON-LD responses emit `.toMach()`. Removes MCP cart-vs-order unit inconsistency, the budget-vs-price mismatches in `recommend`/`assess`/`search`, and the `cart.ts:452` cents-as-`$` string.

### 4. Stripe boundary
- All Stripe amount conversions go through `Money.toMinorUnits()` / `Money.fromMinor()`. No ad-hoc `*100`/`/100`.

### 5. Formatter consolidation → `Money.format()`
Delete/replace: `formatPrice` (`lib/utils.ts`), `formatMoney` (`lib/utils/account.ts`, also fixing its `currency_code` shape), the two admin `formatCurrency`, both `formatDiscountedPrice`, and the dead `formatPriceDisplay`/`convertPrice` (`lib/db/schema/pricing.ts`).

### 6. Targeted data normalization (not a backfill)
- Verify `pricing.list_price`/`sale_price` unit empirically; normalize writer + one-time migration only if real rows exist.
- Normalize `extensions.shipping_cost` writer to minor units (match `subtotal`/`tax_amount`); migrate existing rows if any.
- Orders/variants/gift-card ledger unchanged.

### 7. Live bug fixes (folded in)
- **Order-confirmation email 100× inflation** + `shippingCost`/`taxAmount` key mismatch: `app/api/orders/route.ts:348-374` builds `OrderData` from cents but `lib/utils/email.ts` / `emails/OrderConfirmation.tsx` render `.toFixed(2)` as dollars. Route email data through `Money.format()` / a MACH-shaped payload.
- **`extensions` mixed units** (shipping_cost dollars vs subtotal/tax cents).
- **MCP agent-facing unit inconsistency** across cart/order/payment/catalog tools + budget comparisons.

### 8. Validation / guardrails
- Strengthen `isValidMoney` (finite number; integer in stored/minor contexts).
- Eliminate bare-`number` money params (types enforce `Money`); document the convention so new code follows it.

---

## Live Bugs (must be fixed + regression-tested)

| # | Severity | Bug | Location |
|---|---|---|---|
| 1 | 🔴 user-facing | Order-confirmation email renders cents as dollars → 100× (a $25 order emails "$2500.00"); shipping/tax show $0.00 due to key mismatch | `app/api/orders/route.ts:348-374` → `lib/utils/email.ts`, `emails/OrderConfirmation.tsx` |
| 2 | 🟠 | `extensions` object mixes units: `shipping_cost` dollars vs `subtotal`/`tax_amount` cents | `app/admin/orders/[id]/page.tsx:519,525,531`; writer at checkout |
| 3 | 🟠 | MCP tools emit inconsistent units to agents (cart=cents, order/payment/catalog=dollars); budget-vs-price mismatch in recommend/assess/search; `cart.ts:452` prints cents with `$` | `lib/mcp/tools/*` |
| 4 | 🟡 | `formatPriceDisplay`/`convertPrice` assume dollars on a cents `Money` type (dead but dangerous) | `lib/db/schema/pricing.ts:301-318` |

---

## Testing

- **`Money` unit tests** (`tests/unit/lib/money/`): constructors, integer validation, rounding (half-up), currency-mismatch guard, `.times`/`.applyRate`/`.allocate` correctness, JPY 0-precision, negative/refund amounts, round-trip through `fromStored`/`toJSON`, `fromMinor`/`toMinorUnits`, and `toMach` (precision-correct).
- **Regression tests** (unit-style so CI gates them): free-shipping threshold, per-line pricing canonicalization, order-confirmation email totals (the 100× bug), checkout totals, MCP unit consistency.
- Vitest, existing infra. CI gates `tests/unit/**` (per project CI config).

---

## Docs

- **New `docs/money.md`** — the canonical rule: *internal = integer minor units via `Money`; MACH decimal-major only at serialization; Stripe minor units; never raw `*100`/`/100`; all display via `Money.format()`.* Include the boundary map and examples.
- **CLAUDE.md** — add a **Money & Pricing** convention subsection linking to `docs/money.md`.
- **`lib/types/money.ts`** — correct the doc comment; clarify the stored shape (minor units) vs the MACH wire shape.
- **BMC-164** — record the chosen approach.

---

## Delivery plan (single PR, ordered atomic commits)

| Commit | Scope | Behavior change? |
|---|---|---|
| **P0** | `Money` value object + `currencies` + full unit tests | No (additive) |
| **P1** | Stripe boundary + pricing/tax/shipping typed to `Money` (subsumes BMC-161) | Server correctness |
| **P2** | Serialization → MACH at API/MCP/JSON-LD + formatter consolidation | Wire shape (accepted break) |
| **P3** | Collapse storefront pipeline (cart/checkout/email); fix email 100× + extensions bugs | Storefront + email |
| **P4** | Targeted data normalization (pricing/extensions) + validation guardrails | Data (empty-table pre-launch) |
| **P5** | Docs + CLAUDE.md + BMC-164 update | Docs |

Each commit: `npm run lint` + `npx tsc --noEmit` + `npx vitest run` green before the next. Final: one PR against `main`.

---

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Hidden consumer of current API/MCP money shape breaks | Pre-launch; all consumers in-repo and updated same PR; grep for response-shape consumers before P2. |
| `pricing` table already in a different unit than assumed | Empirical data check in P4 before any migration; if unused at runtime, code-convention fix only. |
| Rounding drift in tax/discount vs Stripe's own rounding | big.js round-half-up consistently; assert order total == Stripe PaymentIntent amount in a regression test. |
| Large diff in one PR | Ordered atomic commits + green gate per commit keep it reviewable; the diff is mechanical after P0/P1. |
| gift-card ledger reconciliation | Untouched (stays minor units) — no migration risk. |
