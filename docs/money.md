# Money Convention (BMC-164)

How BeauTeas represents, moves, and displays monetary values across the
storefront, admin, MCP, and Stripe. This is the canonical reference — code
should match this doc; if it doesn't, fix the code or update this doc, not
the other way around.

## The core rule

**Internally, money is an integer count of minor units** (e.g. USD cents),
held by the immutable `Money` value object in `lib/money/money.ts`. Nothing
in application code should read or write a raw `amount: number` and reason
about it as dollars-or-cents by convention — the `Money` class is the only
thing allowed to know the conversion.

`Money` is backed by [big.js](https://www.npmjs.com/package/big.js) for any
math that involves a fraction (major↔minor conversion, tax/rate
application), so multiplications and divisions never accumulate IEEE-754
float error. Rounding is **half-up** to the nearest minor unit everywhere
(`Big.roundHalfUp`), including in `Money.fromMajor()` and `Money.applyRate()`.

`Money` instances are currency-aware: `add`, `subtract`, and the comparison
operators (`gte`, `gt`, `lte`, `lt`) all throw `Currency mismatch: X vs Y` if
the two operands don't share a currency (`#assertSameCurrency`), so a subtotal
in USD can never be silently summed with a tax line accidentally tagged EUR.
**Note:** `.equals()` does NOT throw on currency mismatch — it simply returns
`false` if currencies differ, comparing both currency and amount.

## The four boundaries

`Money` never leaves the process in its internal shape. At every edge, it is
converted through exactly one of four named exits:

| Boundary | Method | Shape out | Where |
|---|---|---|---|
| **Stripe** | `.toMinorUnits()` (build) / `Money.fromMinor()` (read) | integer minor units (what the Stripe API itself expects) | `lib/stripe.ts` (`formatAmountForStripe`/`formatAmountFromStripe`), `app/api/payment-intent/route.ts` |
| **Wire** (public API / MCP / JSON-LD) | `.toMach()` / `toWireMoney()` | MACH Alliance `{ amount, currency, precision }`, `amount` in **decimal major units** | `lib/models/mach/product-serializer.ts` (`toWireProduct`), `app/api/orders/route.ts` (`toWireOrder`) |
| **Persistence** | `.toJSON()` | `{ amount, currency }`, `amount` still **minor units** — this is the DB/session encoding, no conversion happens here | order/product create-update paths (`Money.fromStored(...).toJSON()`) |
| **Display** | `.format(locale?)` | localized currency string (`Intl.NumberFormat`), e.g. `"$12.99"` | any UI that renders a price to a human |

Reading money back in from any of these boundaries goes through the matching
constructor: `Money.fromMinor()` for Stripe/cents, `Money.fromMajor()` for a
decimal-dollars input, `Money.fromStored()` for anything already
persisted (D1 row, JSON string, legacy bare number — it's forgiving about
shape and always interprets the numeric value as minor units).

**There is no fifth boundary.** If you find yourself writing `* 100` or
`/ 100` on something that represents money, stop — either an existing
`Money` boundary method already does what you need, or a new one belongs in
`lib/money/`, not inline at the call site.

## `Money` API surface

```ts
// Construction
Money.fromMinor(minorUnits: number, currency = 'USD'): Money
Money.fromMajor(major: number | string, currency = 'USD'): Money
Money.fromStored(value: unknown, currency = 'USD'): Money   // object | JSON string | bare number/string, all read as MINOR units
Money.zero(currency = 'USD'): Money

// Arithmetic (same-currency only — throws on mismatch)
.add(other: Money): Money
.subtract(other: Money): Money
.negate(): Money
.times(qty: number): Money            // qty must be an integer (a count of items)
.applyRate(rate: number | string): Money  // exact big.js multiply, round half-up (tax %, discount %)
.allocate(ratios: number[]): Money[]  // split into shares by integer ratios; remainder distributed so shares sum back to the original

// Comparisons
.equals(other: Money): boolean
.gte/.gt/.lte/.lt(other: Money): boolean
.isZero(): boolean
.isNegative(): boolean

// Boundary exits
.toMinorUnits(): number               // → Stripe
.toMach(): MachMoney                  // → wire (API/MCP/JSON-LD): { amount, currency, precision }
.toJSON(): StoredMoney                // → persistence: { amount (minor), currency }
.format(locale = 'en-US'): string     // → display

.currency: string  // getter
```

`getPrecision(currency)` (`lib/money/currencies.ts`) supplies the minor-unit
exponent per ISO 4217 currency (2 for USD/EUR/GBP/…, 0 for JPY, 3 for
BHD/KWD, defaulting to 2) and drives both `fromMajor()`'s scaling and
`toMach()`'s `precision` field.

## Type-safety: `Money` (DB) vs `MachMoney` (wire) can't cross

**Note:** This section discusses the `Money` stored-shape **TYPE** in `lib/types/money.ts`, which is distinct from the `Money` value-object **CLASS** imported from `@/lib/money` (see [The core rule](#the-core-rule) above).

`lib/types/money.ts` declares the persisted/DB-facing shape:

```ts
export type Money = {
  amount: number;
  currency: string;
  precision?: never;
};
```

`precision?: never` (not `precision?: number`) is deliberate. If it were a
plain optional `number`, TypeScript's structural typing would let
`MachMoney` (`{ amount, currency, precision: number }`, required precision)
satisfy this type too — `precision: number` trivially satisfies
`precision?: number | undefined`. That would let a decimal-major wire value
flow, uncaught, into a cents-typed database write (or vice versa). Banning
the field outright means a `MachMoney` is never assignable where a
cents-shaped `Money` is expected, so `tsc` catches the mistake at compile
time instead of it becoming a 100x pricing bug in production.

This is why boundary-crossing serializers define their own explicit return
types instead of reusing the DB type with money fields swapped in place —
e.g. `WireVariant`/`WireProduct` in `lib/models/mach/product-serializer.ts`
and `WireOrder`/`WireOrderItem` in `app/api/orders/route.ts` — so the
compiler enforces "wire responses carry `MachMoney`, DB writes carry
(cents) `Money`" rather than relying on a convention nobody can verify from
the type checker.

## Rules

- **Never write raw `* 100` / `/ 100` on a value that represents money** in
  application code. Route the conversion through a `Money` boundary method.
  (`lib/stripe.ts`'s `formatAmountForStripe`/`formatAmountFromStripe` are
  the one place this conversion lives, and even they now delegate to
  `Money.fromMajor(...).toMinorUnits()` / `Money.fromMinor(...).toMach().amount`
  rather than doing the arithmetic by hand.)
  - **Accepted exception: plain-`node` scripts under `scripts/`.** They run
    with no build step, and `lib/money`'s extensionless internal imports don't
    resolve under bare `node`. `scripts/goob-reprice.mjs` imports `big.js`
    directly — the library `money.ts` itself uses — and replicates only
    `Money.fromMajor`'s USD path. Still decimal arithmetic, never raw float
    multiplication: `Math.round(1.005 * 100)` is `100`, not `101`. If you add
    a script that touches money, follow that pattern and say why in its header.
- **All display goes through `Money.format()`.** Don't hand-roll
  `$${(cents / 100).toFixed(2)}` or similar anywhere in components/emails.
- **`Order.total_amount` is the PRE-gift-card order value** — the sum of
  goods + shipping + tax, matching what's stored and what
  `toWireOrder`/`toWireMoney` return. The **Stripe charge is post-gift-card**:
  `verifyOrderChargeSufficient()` (`lib/services/order-pricing.ts`) computes
  `requiredCashCents = goodsCents - giftCardTenderCents` and verifies the
  captured PaymentIntent against *that*, not against `total_amount`. Don't
  assume `total_amount` equals what Stripe actually charged when a gift
  card was applied.

## Known accepted boundaries (not bugs — documented, not fixed)

A few request/response shapes still speak **decimal dollars** rather than
going through `Money`/MACH. These are intentional, scoped exceptions, not
overlooked spots:

- **`/api/tax`, `/api/shipping-options`, `/api/payment-intent`** — request
  and response bodies are plain dollar numbers (`amount`, `taxAmount`,
  `shippingCost`, …). `components/checkout/CheckoutClient.tsx` is the
  bridge: it converts cart-session cents to dollars via `Money` immediately
  before calling these endpoints, and converts the dollar responses back to
  cents via `Money` immediately after (see `toMajor`/`toMinor` helpers
  around line 53–61 of that file, and `formatAmountForStripe`/
  `formatAmountFromStripe` in `lib/stripe.ts`). The wire format of these
  three routes is dollars; the call sites never assume cents.
- **`/api/orders` GET/POST wire shape is intentionally mixed-unit**: `items[]`
  (`unit_price`, `total_price`) and `total_amount` are MACH-major via
  `toWireMoney`/`toMach()`, while `extensions.shipping_cost` /
  `extensions.tax_amount` (and everything `buildOrderEmailTotals` reads) stay
  **cents**, matching the persisted `Money.toJSON()` contract. Each consumer
  of `extensions` already knows it's reading cents (see the BMC-143 comment
  at `app/api/orders/route.ts` ~line 355). This is flagged as a candidate
  for future unification, not something to "fix" opportunistically — changing
  it touches the checkout write path, the email renderer, and any external
  consumer of `extensions` simultaneously.

## Worked examples

### 1. Build an order total (goods + shipping + tax)

```ts
import { Money } from '@/lib/money';
import { computeOrderTotals } from '@/lib/services/order-pricing';

const subtotal = Money.fromMinor(4998, 'USD'); // two $24.99 items, in cents
const { shipping, tax, total } = computeOrderTotals(subtotal, address);
// total: Money — shipping is a flat/threshold rule, tax = subtotal.applyRate(rate)
// total.toJSON() -> { amount: <cents>, currency: 'USD' }  — this is what gets persisted
```

### 2. Serialize a product for an MCP / public API response

```ts
import { toWireProduct } from '@/lib/models/mach/product-serializer';

// product.variants[].price is internal Money-shaped (cents) from the DB
const wireProduct = toWireProduct(product);
// wireProduct.variants[].price -> { amount: 24.99, currency: 'USD', precision: 2 }
// (toWireVariant calls toWireMoney(price) internally — decimal major units, MACH shape)
```

### 3. Send an amount to Stripe

```ts
import { Money } from '@/lib/money';
import { formatAmountForStripe } from '@/lib/stripe';

// CheckoutClient has already bridged cents -> dollars for the /api/payment-intent
// request body; formatAmountForStripe converts that dollars figure back to the
// integer minor units the Stripe API requires:
const stripeAmount = formatAmountForStripe(24.99); // -> 2499

// Equivalent, if you already hold a Money:
const amount = Money.fromMinor(2499, 'USD');
await stripe.paymentIntents.create({ amount: amount.toMinorUnits(), currency: 'usd' });
```

## Where to look

- `lib/money/money.ts` — the `Money` class, `MachMoney`/`StoredMoney` types
- `lib/money/currencies.ts` — ISO 4217 precision table
- `lib/money/wire.ts` — `toWireMoney()` (stored/legacy value → MACH wire shape)
- `lib/money/index.ts` — the public barrel (`import { Money, toWireMoney } from '@/lib/money'`)
- `lib/types/money.ts` — the DB-facing `Money` type and the `precision?: never` rationale
- `lib/services/order-pricing.ts` — shipping/tax/total math, gift-card charge verification
