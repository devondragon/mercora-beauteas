# Going-Out-of-Business Sale

**Date:** 2026-08-05
**Status:** Approved design, not yet implemented
**Related:** [`2026-08-05-goob-baseline-preservation-design.md`](2026-08-05-goob-baseline-preservation-design.md) · [`cutover-status.md`](../../cutover-status.md) · `PRODUCTION-CUTOVER-RUNBOOK.md`

## Problem

BeauTeas is winding down. Before the DNS switch to `www` (runbook Phase 10),
the storefront must become a terminal clearance sale: reduced prices, a
minimum order, quantity-tiered shipping, no subscriptions, and no returns —
with content that explains the closure honestly and thanks the people who
bought.

The sale must be in place *before* cutover, so the first thing customers see on
the new platform is the sale, not the old storefront followed by an abrupt
change.

## Constraints Discovered

Read from the codebase, not assumed:

- **Reduced pricing needs no code.** `compare_at_price` already renders as a
  strikethrough on the PDP (`ProductDisplay.tsx:175`), catalog cards
  (`ProductCard.tsx:84`), and Chai's product cards. Lowering variant prices and
  setting compare-at is a data change that flows correctly through Stripe
  amounts, Stripe Tax, the charge floor, and refunds.
- **Shipping is already settings-driven and single-sourced.**
  `lib/services/shipping-options.ts` is the one seam feeding the checkout quote,
  the server-side charge floor (`computeShippingFloorCents`), and Chai's
  shipping answer. It was extracted precisely to stop these three from drifting
  (BMC-242).
- **Archiving a product does not withdraw it.** `getProductBySlug` does not
  filter on status, and `computeCatalogLineCents`
  (`lib/services/order-pricing.ts:139`) validates the variant→product binding
  and price presence but never checks status. An archived product still renders
  a working PDP and is still purchasable server-side.
- **`isPubliclyPurchasableProduct`** (`lib/config/commerce.ts`) is the existing
  withdrawal seam — it is how launch-disabled gift cards are kept off the PDP
  (`app/product/[slug]/page.tsx:122`) and out of the sitemap
  (`app/sitemap.ts:56`).
- **Out-of-stock renders "Coming Soon"** at `ProductCard.tsx:206` and
  `ProductDisplay.tsx:506`. During a closing sale that statement is false.
- **Chai will contradict the sale.** `refundWindowAnswer()` in
  `lib/ai/deterministic-answers.ts` tells customers "You've got 30 days from
  delivery to start a return," read live from `refund.return_window_days`.
- **`/subscribe/*` is already fail-closed in production.** `POST
  /api/subscriptions` rejects any plan lacking a `stripe_price_id`, and
  `docs/cutover-status.md` records that live Stripe subscription prices were
  deliberately never configured.
- **A site-wide banner exists** (`components/PromotionalBanner.tsx`,
  settings-driven) but renders its text as a plain `<p>` with no link support.
- **The admin Shipping tab** (`app/admin/settings/page.tsx`) renders a typed
  form hardcoded to the current `{id, label, cost, estimatedDays, enabled}`
  method shape.
- **`store.free_shipping_threshold` cannot be disabled by setting it to `0`.**
  `resolveShippingOptions` reads it as `settings[key] || 75`, so `0`, `null`,
  and absent all fall back to 75.

## Decisions

| Question | Decision |
| --- | --- |
| Discount mechanism | Edit variant prices directly, set compare-at. Flat $2/box. |
| Minimum order | 10 boxes, cart-wide, mix-and-match |
| Minimum enforcement | Add freely; block at checkout with a specific prompt; server rejects |
| Shipping | Single Standard method, quantity-tiered: ≤20, ≤40, 41+ |
| Free shipping | Removed entirely |
| Sale end | Until stock runs out. No date, no countdown |
| Sold out | Product stays visible, marked sold out |
| Bundle SKUs | Sample packs and full package discontinued |
| Returns | All sales final; damaged or lost shipments still made right |
| Stock age | Disclosed softly on the closing page and at checkout, not on PDPs |
| Checkout consent | Visible notice, no checkbox |
| Subscriptions | Storefront entry points hidden; routes left intact |
| Closing page | `/thank-you` |
| Chai | Contradictions fixed, closing answers added, knowledge base reindexed |
| Emails | Order confirmation gets a final-sale line |
| Announcement | Copy drafted; no send path built |

## Architecture

Sale rules live in a small `lib/sale/` module that answers three questions: how
many boxes is this cart, does it clear the minimum, and what shipping tier
applies. Every consumer — cart UI, checkout, `/api/shipping-options`, the
payment-intent charge floor, Chai — resolves through it, mirroring the way
every shipping consumer already resolves through `resolveShippingOptions`.

The alternative considered was writing the minimum-order check inline at each
of its five call sites. That is the exact drift BMC-242 exists to prevent. A
`saleMode` feature flag was considered and rejected in the baseline
preservation design: substantial machinery for a toggle that never gets turned
off.

Settings, all admin-editable:

| Key | Category | Value |
| --- | --- | --- |
| `sale.minimum_boxes` | `sale` | `10` |
| `sale.final_sale` | `sale` | `true` |
| `sale.subscriptions_enabled` | `sale` | `false` |
| `shipping.tiers` | `shipping` | Seeded **empty** (`[]`). Tiers are entries shaped `{max_boxes, cost}`, the last with `max_boxes: null`, entered in admin after box weighing (see Operational Items). Empty means "not configured" and leaves the flat per-method rates in force — seeding three bands at `cost: 0` would have shipped every order free from the moment the migration applied until an admin typed real prices. |
| `shipping.free_methods` | `shipping` | `[]` |
| `promotions.banner_link` | `promotions` | `/thank-you` |

Tier `cost` is in **major units (dollars)**, matching the existing
`shipping.methods[].cost` convention documented in `lib/types/shipping.ts`.

Free shipping is disabled by emptying `shipping.free_methods`, **not** by
zeroing `store.free_shipping_threshold` — that value's `|| 75` fallback means
`0` silently restores the $75 threshold.

## 1. Catalog simplification

Only single-box SKUs remain sellable, which makes box count identical to cart
quantity. No table or column changes are required.

Migration `0025` is still needed, as a data migration: it inserts the `sale.*`,
`shipping.tiers`, and `promotions.banner_link` rows into `admin_settings`.
`defaultSettings` in `lib/db/schema/settings.ts` only seeds fresh installs, so
existing databases need the rows written explicitly. Use `INSERT OR IGNORE` —
an `UPDATE`-guarded data migration silently no-ops where the target rows don't
exist, which has already bitten this project on the `pages` table. The
migration is expand-only and safe under the deploy auto-apply hook.

**Withdraw the bundles.** Extend `isPubliclyPurchasableProduct` to treat
non-`active` product status and non-`active` variant status as not publicly
purchasable, then call it from `computeCatalogLineCents`. Because the PDP and
the sitemap already call that function, the single change makes archiving work
end-to-end: PDP 404s, catalog and sitemap hide it, and the server refuses to
price it. Archive the sample packs and the full package in admin.

This is a platform bug, not a sale behavior — a merchant who archives a product
reasonably expects it to stop selling. Record it on the post-baseline platform
fixes list in `mercora-upstreaming-plan.md`; it is more valuable upstream than
anything in the `v1.0.0` tag.

**Redirects.** Add `redirect_map` 301s from the withdrawn product URLs to
`/thank-you` rather than letting them 404. Those products came through the
Shopify migration and may carry inbound links.

**Repricing.** `scripts/goob-reprice.mjs --rate 2.00` sets each active
variant's price to the per-box rate — every remaining SKU is one box — and its
`compare_at_price` to the pre-sale price. On first run it writes a
snapshot of pre-sale prices to `data/goob/price-baseline.json` and reads from
it on every subsequent run, so re-running with a different rate cannot ratchet
the "original" price downward. Supports `--dry-run` and honors `D1_REMOTE` like
the Shopify ETL.

Verify before running: `clearly-calendula-sample-pack-on-sale` may already
carry a `compare_at_price` from a prior promotion.

## 2. Purchase rules

**`lib/sale/rules.ts`** reads the `sale.*` settings and exposes:

- `countCartBoxes(items)` — resolves quantity against the catalog, never from
  client values, using the same discipline as `computeCatalogSubtotalCents`.
- `checkMinimumOrder(boxes)` — returns whether the cart clears
  `sale.minimum_boxes` and how many boxes are short.
- `resolveShippingTier(boxes)` — returns the matching `shipping.tiers` entry.

**Shipping** becomes `resolveShippingOptions(goodsCents, { boxes,
subtotalPriceable })`. A single Standard method is priced from the matching
tier. The free-shipping branch is left in place (gate, don't delete) and
disabled by the empty `free_methods` list.

Boxes are derived from the same validated line items that produce the goods
total, so the quote and the floor can't disagree. Quantity is inherently
client-supplied, but under-reporting it to reach a cheaper tier also reduces the
goods subtotal, and `/api/payment-intent` recomputes both from one items list —
so the two stay self-consistent. When a cart is unpriceable,
`computeExpectedChargeExtras` already returns early, so no tier needs
resolving.

**Enforcement.** The checkout button is disabled below the minimum with a
specific prompt ("Add 4 more boxes to check out — 10 box minimum"), and the
cart accepts any quantity so people can build up a mix-and-match order.
Server-side, `/api/payment-intent` and `/api/orders` both reject an
under-minimum cart with a 400. Client copy is advisory; the server is
authoritative — the same split the charge floor already uses.

A small rate-limited `GET /api/sale-rules` returns `{ minimumBoxes, finalSale
}` so the cart drawer and checkout page can render the prompt without
hardcoding the number.

**Admin.** The Shipping tab gains a tier editor: rows of max-boxes and cost,
replacing the per-method cost field for the Standard method. This is what makes
the tier prices editable after box weighing, without a deploy.

## 3. Subscriptions off

`SubscriptionToggle` on the PDP (`ProductDisplay.tsx:401`) renders only when
`sale.subscriptions_enabled` is true. Routes, API handlers, schema, and account
pages are left intact — subscriptions are a named upstreaming target and the
hardest-to-reconstruct part of the preserved baseline, so gating costs nothing
and deleting would destroy source material.

Verify that Chai's deterministic answers and the MCP tools do not offer or
describe subscriptions.

## 4. Content and disclosure

**`/thank-you`** — a CMS page carrying the whole story: why the store is
closing (advertising costs up, shipping costs up, a soft economy for a luxury
purchase), the thank-you, and what it means for customers — final sale, the
10-box minimum, shipping tiers, and the note about stock age. Everything else
links here, and it gives Chai a real source to cite.

Stock age is disclosed as "several years in sealed, airtight storage." There is
no printed best-by date on the packaging, so a soft framing is honest; "several
years" is preferred over "a few years" because it does not understate five.

Voice is warm and a little girlie, matching Chai, but sincere. The thank-you is
the emotional center, not the discount.

Remaining content work:

- **Banner** — enable, with short text linking to `/thank-you`.
  `PromotionalBanner.tsx` needs link support plus the `promotions.banner_link`
  setting.
- **Homepage hero** (`app/page.tsx`) leads with the closing story.
- **Checkout notice** near payment: final sale and stock age, clearly styled,
  no checkbox.
- **Order confirmation email** (`lib/utils/email.ts`) gains a final-sale line.
- **"Coming Soon" → "Sold out"** at `ProductCard.tsx:206` and
  `ProductDisplay.tsx:506`.
- **Returns policy page** rewritten to final-sale with the damaged-or-lost
  exception stated plainly, so it reads as fair rather than harsh.
- **Announcement email copy** drafted as a markdown deliverable in
  `docs/goob-announcement-email.md`. No send path is built; the real customer
  list lives in Shopify, not in the fresh production database.

## 5. Chai

- `refundWindowAnswer()` gains a final-sale branch driven by `sale.final_sale`,
  so the assistant and the policy page cannot drift.
- `shippingRatesAnswer()` renders the tier table and drops the free-shipping
  sentence.
- Three new deterministic categories: minimum order, why we're closing, and tea
  freshness.
- The knowledge base is reindexed into Vectorize with `/thank-you`, the FAQ, and
  the updated policy page.

Pattern design needs care. `lib/ai/deterministic-answers.ts` carries scars from
over-broad matching — the `free[-\s]shipping` lookbehind that stopped
"plastic-free shipping" hitting the rate card, and the narrowed business-address
patterns that stopped "Where are you from?" returning a postal address. A
freshness rule in particular must not swallow ordinary product questions.

## 6. Testing and rollout

Unit tests, since `ci.yml` gates the unit suite:

- Tier resolution at boundaries: 10, 20, 21, 40, 41.
- `checkMinimumOrder` at and either side of the minimum.
- `computeCatalogLineCents` refuses an archived product and an inactive variant.
- `refundWindowAnswer()` returns final-sale copy when `sale.final_sale` is true.
- Reprice idempotence: two runs at different rates leave `compare_at_price`
  equal to the original pre-sale price.

Rollout order:

1. Code and migration `0025` to dev; verify under `npm run preview:dev`.
2. `npm run db:migrate:status:production`, then deploy to production — the
   deploy hook applies `0025` with a pre-flight backup.
3. Set the three tier prices in the admin Shipping tab.
4. Data: archive the three bundle SKUs, recount inventory, run the reprice.
5. Content: `/thank-you`, banner, homepage, policy page.
6. Chai knowledge base reindex.
7. DNS switch (runbook Phase 10).

Commits are scoped `goob:` so the upstreaming program can filter them
mechanically, per the baseline preservation design.

`docs/cutover-status.md` and `CLAUDE.md` are updated to describe the store's
sale state.

## Out of Scope

- Any end-of-sale shutdown mechanism. The sale runs until stock is gone; there
  is no date, countdown, or automated close.
- Building a send path for the announcement email.
- Removing subscription code, routes, or schema.
- A general feature-flag system.
- Changes to `ci.yml` triggers or the production deploy guard.

## Operational Items for the Owner

Not implementation work, but the sale cannot launch without them:

- Recount inventory per blend before cutover.
- Weigh boxes at representative quantities to set the three tier prices.
- Break down any physically pre-assembled sample packs and full packages into
  singles — discontinuing those SKUs strands that stock otherwise.

## Success Criteria

- Every remaining sellable SKU is a single box priced from the configured
  per-box rate, with its pre-sale price shown struck through.
- The three bundle SKUs are withdrawn: PDP 404s, hidden from catalog and
  sitemap, refused by the server pricing path, and 301'd to `/thank-you`.
- A cart below 10 boxes cannot check out, and `/api/payment-intent` and
  `/api/orders` reject one with a 400.
- Shipping quotes a single Standard method priced from the box-count tier, with
  no free-shipping path, and the charge floor agrees with the quote.
- Tier prices and the minimum are editable in admin without a deploy.
- No subscription entry point is reachable from the storefront.
- Chai's returns, shipping, minimum-order, closing, and freshness answers agree
  with the site.
- The closing story, final-sale terms, and stock-age note appear on
  `/thank-you`, in the banner, on the homepage, at checkout, and in the order
  confirmation email.
- Nothing on the storefront says "Coming Soon" about a sold-out product.
