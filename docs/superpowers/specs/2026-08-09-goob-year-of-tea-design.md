# A Year of Tea: year-supply CTA and live boxes-remaining counts

**Date:** 2026-08-09
**Status:** approved, not yet planned
**Branch:** `goob`

## Problem

The closing sale clears roughly 1,232 boxes at a 10-box minimum. If the average
order lands at the minimum, that needs about 123 separate buyers, which is a lot
for a niche brand that is shutting down. The lever that empties the warehouse is
**average order size**, not per-box price: someone choosing between 10 boxes and
36 is thinking about how much tea they will actually drink, not about $2 versus
$3.

Two things are missing today:

1. Nothing on the storefront translates boxes into time. A box is 10 tea bags,
   so 36 boxes is a year at a cup a day. **That fact is stored nowhere in the
   system** (not in product descriptions, not in the CMS pages, not on the
   variant records), so neither a customer nor Chai can derive it.
2. Nothing conveys scarcity. Stock is uneven and genuinely low on one blend, and
   a customer cannot see that.

## Grounding numbers

Per-box: **10 tea bags = 10 cups**. Historic subscriptions ran 3 boxes/month of a
single blend, i.e. one cup a day, which is where 36 comes from.

| Boxes | Cups | At $3/box | What it is |
|---|---|---|---|
| 10 | 100 | $30 | the enforced minimum, about 3 months |
| 36 | 360 | $108 | a year, one cup a day |
| 108 | 1,080 | $324 | a year of all three blends |

Stock at time of writing (dev, a curated copy of production; Phase 4's recount is
authoritative):

| SKU | Blend | Boxes |
|---|---|---|
| BTCCM1 | Morning | 373 |
| BTCCA1 | Afternoon | 609 |
| BTCCE1 | Evening | 250 |

1,232 total, about **34 year-supplies**. Evening supports only ~7.

The bundles (`BTCCFP`, `BTCCSP`) draw from this same physical stock and are
archived in runbook Phase 3, so they add nothing to the total.

## Decisions

- The year-supply CTA is **per blend** (36 of the blend being viewed), not a
  fixed 12/12/12 bundle. It matches how subscribers actually bought, and it lets
  uneven stock drain naturally instead of stranding Afternoon behind Evening.
- Counts are **live and exact**: per blend on the PDP and catalog cards, plus a
  shop-wide total in the homepage hero.
- The ladder is **framing only**. No quantity-break pricing. Product price stays
  one flat per-box rate written by `scripts/goob-reprice.mjs`.

## Architecture

### `lib/sale/year-supply.ts` (new, pure)

Sibling to `lib/sale/rules.ts` and bound by the same contract: **no runtime
imports**. The cart drawer, PDP, and catalog cards import it into client
bundles, and a `lib/db` import would pull `getCloudflareContext` and the whole
Drizzle schema barrel in with it. This is the same split that already keeps
`rules.ts` separate from `settings.ts`.

```ts
export const CUPS_PER_BOX = 10;
export const YEAR_SUPPLY_BOXES = 36; // 3 boxes/month, the subscription cadence

export function boxesLeft(variant): number | null;

export type YearSupplyOffer =
  | { boxes: number; kind: 'year' }   // a full 36 available
  | { boxes: number; kind: 'rest' };  // 1..35 left, offer the remainder

export function yearSupplyOffer(
  boxesLeft: number | null,
  alreadyInCart: number
): YearSupplyOffer | null;
```

`boxesLeft` returns **`null`** — meaning "no count to show" — when inventory is
absent, `track_inventory === false`, or `allow_backorder` is true. This mirrors
`isVariantAvailable` (`lib/db/schema/products.ts:218`) and `hasAvailableStock`
(`lib/recommendations/blend.ts`), both of which treat untracked inventory as
unlimited. A reader that ignored those flags would print "0 boxes left" on an
untracked variant, which is worse than printing nothing. It returns a clamped
non-negative integer otherwise.

`yearSupplyOffer` is the button's entire decision, kept pure so it is testable
without React:

| `boxesLeft - alreadyInCart` | Result | Button label (example, at $3/box) |
|---|---|---|
| >= 36 | `{ boxes: 36, kind: 'year' }` | "Make it a year - 36 boxes, $108" |
| 1..35 | `{ boxes: n, kind: 'rest' }` | "Take the last 24 - $72" |
| <= 0, or `boxesLeft` is `null` | `null` | not rendered |

Labels above are illustrative at a $3 rate. The component formats both figures
from the live variant price; no dollar amount is stored in this module.

Subtracting what is already in the cart is what stops a second click queueing 72
boxes against 40 in stock. `/api/payment-intent`'s availability gate would catch
that, but at checkout, which is a bad place to discover it.

**Prices are never constants.** Every dollar figure derives from the variant's
`price` at render time. A hardcoded $108 would silently lie the moment the
reprice runs at a different rate, and `scripts/goob-reprice.mjs` exists to be run
more than once (`data/goob/price-baseline.json` makes a second markdown safe).

### Components

**`components/sale/BoxesLeft.tsx`** — presentational, takes `number | null`,
renders nothing on `null`.

**`components/sale/YearSupplyButton.tsx`** — client. Reads the current quantity
of this variant from the cart store, calls `yearSupplyOffer`, and on click issues
one `addItem` with the computed quantity. `addItem` already merges by
`variantId` (`lib/stores/cart-store.ts:189`), so it composes with a normal Add to
Cart rather than creating a second line.

### Surfaces

| Surface | Change |
|---|---|
| `app/page.tsx` | total across the three blends, in the hero |
| `components/ProductCard.tsx` | `BoxesLeft` (new display). **No button** |
| `app/product/[slug]/ProductDisplay.tsx` | `BoxesLeft` **replaces** the existing stock line; `YearSupplyButton` added |

`YearSupplyButton` renders on the PDP only. Catalog cards get the count alone —
a card has no variant selection, and a one-click 36-box commitment belongs on
the page where someone has actually chosen a blend.

The homepage total sums `boxesLeft` over the same three blends the hero already
features, from `getProductsByCategory("cat_clearly_calendula")` filtered by
`isPubliclyPurchasableProduct` — the existing call at `app/page.tsx:57`, which
already loads variants with parsed inventory. Arithmetic on data in hand, not a
new query. Blends whose `boxesLeft` is `null` contribute nothing and, if every
blend returns `null`, the hero line is omitted rather than showing zero.

`ProductDisplay` currently renders `{quantityInStock} in stock` / `"Backordered"`
at lines 454 and 472, both gated on `selectedVariant?.inventory`. `BoxesLeft`
replaces both, or the PDP would show "250 in stock" next to "Only 250 boxes
left". **"Backordered" is also wrong during a closing sale** — nothing is coming
— so the zero state becomes the sold-out treatment.

`ProductCard` computes `quantityInStock` at line 91 and uses it only for an
`availability` flag; both call sites move onto `boxesLeft` so the
untracked/backorder semantics stop being duplicated with `?? 0`.

### Why no endpoint

`app/layout.tsx` sets `dynamic = "force-dynamic"`, which overrides the
homepage's `revalidate = 3600`. Verified against deployed dev: `/` returns
`cache-control: private, no-cache, no-store, max-age=0, must-revalidate`. Every
surface already renders per request, so server-rendered counts are live.

A `/api/stock` endpoint was considered and rejected: it would add a public route
on the shared `PUBLIC_RATE_LIMITER` — the same budget `/api/payment-intent`
draws on, which is precisely what caused the checkout-lockout bug fixed in
`1bb0e8f` — plus loading states and layout shift on every card, to solve a
staleness problem that does not exist.

## Content: migration `0030_goob_box_math_content.sql`

Hand-written raw SQL; `0030` is the next number per CLAUDE.md. Writes the
10-bags fact into:

- the **FAQ page**, as a "How many cups is a box?" entry
- the **three blend descriptions**, one sentence each, so the fact reaches the
  PDP and Chai's vector index together

Three constraints inherited from the migrations already on this branch:

1. **Guards match current state.** `0026` and `0027` are applied on dev, so
   `WHERE ... LIKE` guards must match the *post-`0027`* text. Guards written
   against pre-sale wording would silently no-op everywhere.
2. **No em dashes.** `0027` deliberately swept U+2014 from customer-facing
   content and has already run, so it will not clean up after this file. Grep
   the migration for the character before committing, the same check `0026`
   documents in its header.
3. **Idempotent.** Every `UPDATE` guarded on a fragment unique to the old text,
   so a second application is a no-op. Re-run against a migrated dev DB to
   confirm.

Content changes need no code deploy, but migrations apply from the `predeploy`
hook, so a deploy is what lands them.

## Chai

New classifier pattern and fixed answer in `lib/ai/deterministic-answers.ts`,
covering "how long does a box last" and "how much should I buy".

That file has a documented history of pattern hijacks (`bcf5f1c` fixes a
`minimum_order` regression and a cross-category hijack; `2be87d9` narrows
`minimum_order` and `store_closing`). The pattern therefore goes in narrow, and
its tests carry negative cases — questions that must *not* match — alongside the
positive ones, following the discipline already in that test file.

**The answer does not hardcode a price.** It resolves the current per-box price
from the catalog at answer time (the three blends share one flat rate by
construction, so a single indexed read gives it) and formats the year figure
from that. If the read fails it returns the box math with no dollar figure
rather than guessing. Quoting a stale price from the anti-hallucination surface
is the specific failure this avoids, and it becomes reachable the moment a
second markdown runs.

## Error handling

Every path degrades to showing *less*, never something wrong.

| Condition | Behaviour |
|---|---|
| inventory absent, untracked, or backorder-allowed | no count rendered (never "0 boxes left") |
| price missing or unparseable | button hidden rather than rendering `$NaN` |
| Chai's price read fails | box math returned without a dollar figure |
| stock below 36 | button offers the remainder |
| stock zero | button absent, sold-out treatment shown |

## Testing

Unit tests only; that is what CI gates.

- `year-supply.ts`: `boxesLeft` across tracked, untracked, `allow_backorder`,
  zero, negative, and absent-inventory variants; `yearSupplyOffer` at the 36,
  35, 1, and 0 boundaries and with a cart already holding some of the variant.
- Deterministic answers: the new pattern matches its own questions and does not
  match neighbouring ones; the price-read failure path returns box math without
  a figure.
- Migration `0030` re-run against a migrated dev DB confirms the no-op.

## Corrections folded in

**Runbook Phase 4 step 6** claims the homepage can show stale prices for up to an
hour after the reprice and offers a redeploy as the workaround. That is false —
`force-dynamic` makes `revalidate = 3600` inert, confirmed by the `no-store`
response header above. Left alone it sends the owner redeploying production for
no reason.

**CLAUDE.md** gains a row for `lib/sale/year-supply.ts` in the
where-non-obvious-logic-lives table.

## Out of scope

- The 10-box minimum, the shipping tiers, and the reprice rate are unchanged.
- No quantity-break pricing. The ladder is framing, not a discount mechanic;
  product price remains one flat rate across all variants.
- Drinkware and mugs (~50 units at full price) are not repriced here. Flagged
  separately as a business decision.
- The `"Limited-time offer"` string at `ProductDisplay.tsx:466` reads oddly for a
  permanent closing sale, but it is pre-existing copy on a line this work does
  not otherwise touch.
