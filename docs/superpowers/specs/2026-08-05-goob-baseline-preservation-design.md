# Baseline Preservation Before the Going-Out-of-Business Sale

**Date:** 2026-08-05
**Status:** Approved design, not yet implemented
**Related:** [`mercora-upstreaming-plan.md`](../../mercora-upstreaming-plan.md) · [`mercora-upstreaming-inventory.md`](../../mercora-upstreaming-inventory.md) · [`cutover-status.md`](../../cutover-status.md)

## Problem

BeauTeas is launch-ready: prod is deployed on `shop.beauteas.com`, taking live
orders, with subscriptions, Stripe payments, fulfillment, and Chai all working.
This is the most complete working state of the platform that exists.

The store is about to run a going-out-of-business sale. That will change
storefront copy and purchase rules, and subscriptions get disabled before
cutover. No subscriptions have ever been sold on this platform, so there is
nothing to wind down. The sale is
terminal — the store winds down for good afterward. So today's state matters as
a clean, working ecommerce baseline for Mercora upstreaming and for any future
brand, not as a state this site will ever return to.

Meanwhile the Mercora upstreaming program is active and continues in parallel.
That program reads BeauTeas *source files*, which is where the conflict lies.

## Constraints Discovered

- No git tags exist in this repository. `package.json` is still `0.1.0` while
  production takes live orders.
- `ci.yml` (the `Launch readiness gate`) triggers only on push/PR to `main`.
  `production-deploy-guard.yml` refuses any SHA lacking a successful gate run.
  Production is therefore effectively deployable only from `main`.
- No feature-flag system exists anywhere in the codebase.
- Everything on `main` after `c170e54` is docs-only, so `main` HEAD (`c9b135d`)
  and the functional production state are the same code.
- `mercora-upstreaming-inventory.md` states explicitly that it "is not a
  cherry-pick manifest" — each contribution is *reconstructed* from the final
  source state of BeauTeas files against then-current Mercora `main`.

## Approaches Considered

**A — Tag and release today, keep working on `main`.** No change to CI, the
deploy guard, or the day-to-day workflow. The tag is the preservation
mechanism. Cost: `main` stops being a pristine platform line.

**B — Long-lived `sale/goob` branch; `main` stays clean.** Best separation for
upstreaming, but requires rewiring `ci.yml` triggers and the deploy guard to
make production deployable from a non-`main` branch, then merging `main`
forward into the sale branch indefinitely. Permanent overhead for a sale that
ends.

**C — Config-gated `saleMode` in `main`.** Every sale behavior behind a toggle.
Substantial complexity for a flag that will never be turned off.

**Chosen: A, plus one element of C.** A tag is immutable, so a preservation
branch would add nothing but drift risk. The element of C retained is a rule
rather than a mechanism: disable or gate rather than delete, in the specific
places where a sale change would destroy working behavior.

## Design

### 1. Preservation

- Annotated tag `v1.0.0` on `c9b135d`.
- GitHub Release cut from that tag. Notes state what the state is: launch-ready
  storefront on Cloudflare Workers, subscriptions live via Stripe, Clerk auth,
  fulfillment and refunds wired, Chai operational, migrations applied through
  `0024`, pre-wind-down.
- Follow-up commit on `main` bumping `package.json` from `0.1.0` to `1.0.0`.

### 2. Upstreaming Rewiring

The upstreaming program keeps running in parallel, so its read point must move
off `main` before any sale work lands. Three edits across the two docs:

- **Pin the read point.** Add a source-of-truth line recording `v1.0.0`
  (`c9b135d`) and change the reconstruction instruction from "current BeauTeas
  source" to "BeauTeas source at `v1.0.0`." Without this, once sale behavior
  reaches `lib/checkout`, cart rules, or the subscription paths, reconstructing
  "the final source state" hands wind-down logic to Mercora.
- **Keep status tracking on `main`.** Both docs are updated as each unit lands.
  Read source at the tag; write status on `main`. Freezing the docs at the tag
  would freeze the ledger.
- **Add a post-baseline platform fixes section.** Genuine platform bugs found
  while doing sale work (in fulfillment, Money, checkout) are more valuable
  upstream than anything already in the tag, and the tag does not contain them.
  Track them as an explicit short list of SHAs alongside the tag pin.

Escalation rule: if that list grows past a handful of entries, approach B was
the right call and the project should switch to a maintained clean branch then.

Two factors reduce the contamination risk independently. Most sale copy lives
in CMS/DB rows rather than code, and the inventory's existing `B` disposition
(brand, content, store-specific compliance copy) already excludes that class.
The contamination that matters is behavioral code in files that are themselves
upstream targets.

While `main` remains free of sale commits, the pin can keep moving forward —
tag `v1.0.1`, `v1.1.0` on platform-only commits. That option closes the moment
the first sale commit merges to `main`.

This executes step 1 of the plan's own "Future Convergence" section
(*"Preserve the current BeauTeas history using a permanent tag or `legacy-main`
branch"*) early, for a different reason than it was written for.

### 3. Sale Work

- Normal feature branches → PR → `main`. CI and the deploy guard are untouched.
- Consistent commit scope (`goob:`) so extraction can filter mechanically
  rather than by re-reading diffs.
- **Disable or gate, do not delete** — specifically for subscriptions and any
  purchase-rule paths. Subscriptions are the most valuable and
  hardest-to-reconstruct part of the preserved baseline, and they are a named
  upstreaming target in the inventory (capability seams, and the
  `processed_webhook_events` table that must be extracted from the
  subscription migration). Deleting the code would destroy source material the
  upstreaming program still needs; turning it off costs nothing.

### 4. Subscriptions

No subscriptions have been sold on this platform and none will be — they are
disabled before cutover. There is no customer wind-down, no billing
cancellation sequence, and no refund policy to set. This is purely a
storefront/checkout change made under the gate-don't-delete rule above.

## Out of Scope

- Rewriting BeauTeas history (the upstreaming plan forbids it during this work).
- Changing `ci.yml` triggers or the production deploy guard.
- Building a general feature-flag system.
- The content of the sale itself: discount structure, messaging, timing.

## Success Criteria

- `v1.0.0` exists as an annotated tag on `c9b135d`, pushed, with a GitHub
  Release.
- `package.json` reads `1.0.0` on `main`.
- Both upstreaming docs name `v1.0.0` as the reconstruction read point, keep
  status tracking on `main`, and carry a post-baseline platform fixes section.
- Sale work can begin on `main` without the upstreaming program silently
  sourcing sale behavior.
