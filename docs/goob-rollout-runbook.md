# Going-Out-of-Business Sale — Owner's Rollout Runbook

This is the owner-only sequence for taking the going-out-of-business sale live
on production, `shop.beauteas.com`. All of the code and content behind it is
built, reviewed, and gated by the same CI suite as everything else in this
repo (`npm run lint`, `npx tsc --noEmit`, `npm test` — all green as of this
writing; see `task-14-report.md` for the exact output).

**Nothing here has touched dev or prod yet.** Every command below is
copy-pasteable and was checked against `package.json` and `wrangler.jsonc`
before being written down. Where a value could not be confirmed from the repo,
it says so explicitly instead of guessing.

Two things this project has already gotten wrong once — do not repeat them:

1. **Never pipe a deploy through `head` or `grep`.** A deploy was SIGPIPE-killed
   mid-run this way once already, leaving migrations applied but the Worker
   *not* uploaded. Always redirect deploy output to a log file and read the
   whole thing back.
2. **`wrangler d1 execute` needs an explicit `--env` flag in this repo.**
   `wrangler.jsonc` only defines `d1_databases` under `env.dev` and
   `env.production`, not at the top level — a command missing `--env` cannot
   resolve the binding and fails (sometimes silently, as a prior task's local
   check did). Every command below carries it.

Follow the phases in order. Do not skip ahead to the DNS switch — it is last,
on purpose, per `docs/cutover-status.md`.

---

## Phase 0 — Before deploying: see what's about to land

```bash
npm run db:migrate:status:production
```

This is read-only (`--dry-run`, no writes). As of this writing it will report
three pending migrations, in this order:

| Migration | What it does |
|---|---|
| `0025_seed_goob_sale_settings.sql` | Seeds `sale.minimum_boxes`, `sale.final_sale`, `sale.subscriptions_enabled`, `shipping.tiers` (empty — see Phase 2), `promotions.banner_link`; turns off free shipping (`shipping.free_methods`). |
| `0026_goob_closing_content.sql` | Adds the `/thank-you` page, rewrites `shipping-policy`, `contact`, `faq`, `refund-policy`, archives `/subscriptions` and the empty `clearly-calendula-sample-pack-on-sale` stub. |
| `0027_remove_em_dashes_from_content.sql` | Sweeps em dashes out of live `pages`, `categories`, and `blog_posts` rows (customer-facing content only). |

`npm run deploy:production` backs up and applies pending migrations
automatically, *before* the build (see `docs/database-migrations.md` §
Auto-apply on deploy) — you do not run these by hand. This step is only so you
know what's coming before you commit to the deploy.

---

## Phase 1 — Deploy

```bash
npm run deploy:production > /tmp/goob-deploy-production.log 2>&1
```

**Do not** add `| head` or `| grep` to that command, or run it any other way
that could truncate the pipe before wrangler finishes writing. Let it run to
completion, then read the log:

```bash
tail -n 40 /tmp/goob-deploy-production.log
```

Confirm **both** of these appear before considering the deploy done:

- A line reading `Uploaded beauteas ...` (the Worker upload itself)
- A line reading `Current Version ID: ...`

If either is missing, the deploy did not complete — do not proceed to Phase 2
until you have a clean `Uploaded` + `Current Version ID` pair in the log, even
if the command appeared to exit normally.

At this point the sale migrations are live on `beauteas-db`, but
`shipping.tiers` is still `[]` (empty) from the `0025` seed — see Phase 2
before telling anyone the sale is on.

---

## Phase 2 — Set the shipping tiers (nothing ships correctly until this is done)

Until you enter real tier costs, `shipping.tiers` stays empty, which means the
storefront quotes the **old flat per-method rates** (`$5.99` / `$9.99` /
`$19.99`) regardless of box count. That is safe (nothing overcharges or
undercharges silently) but it is *not* the tiered pricing this sale is built
around.

1. Weigh a representative box (or a few, if weight varies enough to matter)
   and work out real shipping costs per tier.
2. Go to `/admin/settings` → **Shipping** tab. Before you add anything, it
   should read "Not configured. The flat per-method rates below are in
   effect.", not a blank list — that confirms you're looking at the empty
   `0025` state, not stale data.
3. Add three tiers with your real costs. Mark **exactly one** tier "No upper
   bound" — it must be the top tier. If you check "No upper bound" on a
   second row, the editor automatically clears it from whichever row had it
   first (rather than letting two tiers be open-ended at once) — that's the
   intended behavior, not a bug.
4. If you save a tier without entering a cost, you'll see a $0 warning. That
   tier still goes live at $0 — the warning is there so a $0 tier is a
   deliberate choice, not a silent mistake. Fix it if it wasn't intentional.
5. Save, then **reload the page** and confirm the tiers you entered are still
   there.
6. Spot-check: add 10 boxes to a cart and confirm checkout quotes your new
   tier price, not $5.99/$9.99/$19.99.

---

## Phase 3 — Withdraw the bundle SKUs (redirect lands, and goes live, before the archive)

Two bundle products need to come off sale: `clearly-calendula-sample-pack`
and `clearly-calendula-full-package`.

### Why the redirect has to go live first, not "in the same change"

- `middleware.ts` only consults the `redirect_map` table for paths starting
  `/products/`, `/collections/`, `/pages/`, `/blogs/`, or `/policies/`. It
  **never** looks at the singular `/product/<slug>` path the live PDP
  actually uses.
- `app/product/[slug]/page.tsx` calls `notFound()` the moment a product fails
  `isPubliclyPurchasableProduct` — which an archived product does
  immediately, and the page has `export const revalidate = 0`, so that
  failure is live the instant the admin write commits, with no caching delay
  to hide behind.

Archiving is a D1 write that takes effect the moment you click it in
`/admin/products`. The `next.config.ts` redirect only exists once a deploy
finishes building and shipping it. **Bundling them as "one change, then
deploy" still leaves a real gap**: from the moment you archive to the moment
that deploy's "Uploaded" + "Current Version ID" lines appear, the redirect
doesn't exist yet and the product already returns `notFound()` — a genuine
404 on a real URL, which is exactly the failure this phase exists to prevent.
So the order below puts the redirect live *before* the archive, not merely
committed alongside it.

### The change, in order

1. In `next.config.ts`, add two entries to the `redirects()` array, following
   the exact pattern already used for `/subscriptions` and
   `/clearly-calendula-sample-pack-on-sale` in commit `7cb7c04`:

   ```ts
   {
     source: "/product/clearly-calendula-sample-pack",
     destination: "/thank-you",
     permanent: true,
   },
   {
     source: "/product/clearly-calendula-full-package",
     destination: "/thank-you",
     permanent: true,
   },
   ```

   Commit that change on its own.

2. Deploy (Phase 1's deploy command). **Read this before you run it:** the
   redirect is unconditional and has nothing to do with product status, so
   the moment this deploy finishes, both URLs stop showing the product page
   and start sending every visitor straight to `/thank-you` — even though
   both products are still `active` and still purchasable everywhere else
   (category page, search, cart, direct add-to-cart) until step 4. In
   practice, this step *is* the withdrawal going live for anyone who reaches
   these products by their PDP URL; the database status change a few minutes
   later is bookkeeping that catches up to it. Only proceed if you are fine
   with that: it converts "still for sale, PDP reachable" into "still for
   sale everywhere except its own product page" for the few minutes until you
   archive.
3. Confirm the redirect responded before touching product status:

   ```bash
   curl -sI https://shop.beauteas.com/product/clearly-calendula-sample-pack | head -1
   curl -sI https://shop.beauteas.com/product/clearly-calendula-full-package | head -1
   ```

   Both should return `HTTP/2 308` (Next.js serves `permanent: true` redirects
   as 308, not 301 — the browser-visible destination is still `/thank-you`
   either way). If either is not a redirect, stop — do not archive until it
   is.
4. Only now, in `/admin/products`, archive both `clearly-calendula-sample-pack`
   and `clearly-calendula-full-package`. From this point the redirect and the
   product status agree, and the property that matters — no customer ever
   hits a 404 on these two URLs — held throughout.

**Do not start this phase today if the bundles are still meant to be actively
for sale** — step 2 alone starts pulling their PDP out of reach the moment it
deploys, regardless of whether you've archived anything yet. Sequence the
whole phase for whenever you decide to pull them from the sale.

---

## Phase 4 — Recount inventory and reprice

1. Recount physical stock per blend (Morning / Afternoon / Evening) and enter
   the real numbers wherever inventory is tracked in `/admin/products`.
2. Decide your sale rate in dollars per box, then dry-run the reprice script
   first:

   ```bash
   D1_REMOTE=true node scripts/goob-reprice.mjs --rate 2.00 --dry-run
   ```

   `--dry-run` writes nothing — no D1 updates, no baseline file. Read the
   printed plan carefully: it lists every variant, its current price, and
   what it would become. Confirm the count of affected variants looks right
   (it should be every active, physical, tea variant — not the gift card).

3. Once the dry-run output looks correct, run it for real, same rate:

   ```bash
   D1_REMOTE=true node scripts/goob-reprice.mjs --rate 2.00
   ```

   This writes the new sale price to every qualifying variant, sets
   `compare_at_price` to the real pre-sale price (so the storefront strikethrough
   is accurate), and writes `data/goob/price-baseline.json`.

4. **Commit `data/goob/price-baseline.json` and back it up somewhere outside
   git** (a second copy, not just the commit).

   Why this matters: the baseline file is the only record of each variant's
   *true* pre-sale price. Every later run of this script reads it first, so
   re-running at a different rate always reprices from the original price,
   not from the already-discounted one. If that file is lost, the script
   falls back to reading whatever is currently in `compare_at_price` in the
   database as the "original" price. If `compare_at_price` has *also* drifted
   out of band by then (cleared, overwritten, or set by some other process),
   a later run could silently set a lower "was" price than the real original
   — understating the discount shown to customers. Losing the file is
   recoverable only as long as `compare_at_price` in the DB is still correct;
   don't let both go missing at once.

---

## Phase 5 — Rebuild Chai's knowledge base (it does not update itself)

`app/api/admin/vectorize` (`GET`) rebuilds the Vectorize index from **the R2
bucket bound as `MEDIA`**, not from the repo checkout. The corrected
`data/r2/knowledge_md/returns.md` (Task 13's refund-policy fix) has **no
effect on Chai's answers** until it is uploaded to R2 and the index is
rebuilt — in both dev and production, independently. Skipping this means
Chai's semantic search can still surface the old, wrong 30-day-return text for
any question that doesn't hit the deterministic pattern-matched answers.

### 1. Upload the corrected file to R2

Dev bucket is `beauteas-images-dev`, production bucket is `beauteas-images`
(confirmed in `wrangler.jsonc`). Repeat for each environment you need to fix
— production is the one that matters for customers, but keep dev in sync too:

```bash
npx wrangler r2 object put "beauteas-images-dev/knowledge_md/returns.md" \
  --file="data/r2/knowledge_md/returns.md" --content-type="text/markdown" --remote

npx wrangler r2 object put "beauteas-images/knowledge_md/returns.md" \
  --file="data/r2/knowledge_md/returns.md" --content-type="text/markdown" --remote
```

If other knowledge files changed too, repeat the same command for each one
under `data/r2/knowledge_md/`.

### 2. Rebuild the index

Requires the `ADMIN_VECTORIZE_TOKEN` secret as a Bearer token. **Production**
is documented as re-verified present (`docs/cutover-status.md`, via `wrangler
secret list --env production` on 2026-08-01). **Dev's is not separately
documented as re-verified** — check it exists before relying on it, so a
missing secret shows up as "not set" rather than a confusing 401 partway
through this step:

```bash
npx wrangler secret list --env dev
```

(`wrangler secret list` only confirms a secret *name* is set, never its
value — that's expected, not a partial check.) Then call each environment:

```bash
curl -H "Authorization: Bearer $ADMIN_VECTORIZE_TOKEN" \
  https://beauteas-dev.justblackmagic.workers.dev/api/admin/vectorize

curl -H "Authorization: Bearer $ADMIN_VECTORIZE_TOKEN" \
  https://shop.beauteas.com/api/admin/vectorize
```

Each call clears the existing index and re-embeds from D1 (products) + R2
(knowledge) fresh — expect it to take on the order of a minute or two. A
successful response is JSON with counts, not an error.

---

## Phase 6 — Turn on the banner

1. `/admin/settings` → **Promotions** tab.
2. Enable the promotional banner, set its text, and confirm the link field is
   `/thank-you`.
3. Load the homepage and confirm the banner is visible, underlined, and
   clicking through lands on `/thank-you`.
4. Optional, but worth doing once: the `0025` seed already sets
   `promotions.banner_link` to `/thank-you`, so production may never actually
   exercise the *blank*-link fallback on its own. To confirm that path still
   works rather than assume it, temporarily clear the link field, save, and
   confirm the banner renders as plain, non-clickable text instead of a
   broken link — then restore the `/thank-you` link before moving on.

---

## Phase 7 — Verify on production, then only then the DNS switch

Run the full checklist below against **production** (`shop.beauteas.com`)
before touching DNS. Once everything checks out, proceed to
`PRODUCTION-CUTOVER-RUNBOOK.md` Phase 10 (the `www` DNS switch) and Phase 11
(post-cutover verification) — in that order, and not before.

---

## Human verification checklist (run this against production)

These are the runtime checks that could not be exercised in earlier tasks
because `preview:dev` is a long-running local server. Go through all of them
in order.

**Purchase minimum and shipping**
1. Add 6 boxes to the cart. The drawer should show "Add 4 more boxes to check
   out. 10 box minimum." and checkout should be unreachable (no working link
   to `/checkout`, or a blocking panel if you navigate there directly).
2. With the cart still under the minimum, go directly to `/checkout`. You
   should see a blocking panel (e.g. "Just a few more boxes"), and its "Back
   to the teas" link should resolve to `/category/clearly-calendula`, not a
   dead link.
3. Add 4 more boxes (10 total). Checkout should now proceed normally through
   every step.
4. Confirm the shipping quote at checkout matches your Phase 2 tier price for
   that box count, not the old flat rate.
5. At the payment step with 10+ boxes, remove items via the cart drawer to
   drop back under the minimum. Checkout should re-render the blocking panel
   rather than let you continue.

**Final-sale notice and thank-you page**
6. At the payment step, confirm the final-sale notice appears above the
   Stripe form with the exact copy, and that its link ("More about all of
   this here" or similar) goes to `/thank-you`. Advance to the confirmation
   step and confirm the notice is gone there.
7. Load `/thank-you` directly and confirm it renders. Confirm the promo
   banner, the homepage, and the checkout notice all link to it correctly.

**A real order, end to end**
8. Place one real order for at least the 10-box minimum. Confirm: the order
   completes, inventory decrements, and the confirmation email arrives with
   the final-sale line in its intro paragraph, rendering cleanly (no broken
   apostrophes) in your mail client.

**Chai**
9. Ask Chai each of the following and confirm every answer agrees with the
   live site: the return policy, the shipping cost, the minimum order size,
   how old/fresh the tea is, and why the store is closing.

**Sold-out and admin surfaces**
10. If any variant is sold out (check after Phase 4's recount), confirm both
    the product card badge and the PDP read "Sold out".
11. In `/admin/settings` → Shipping, confirm the tiers you entered in Phase 2
    persisted correctly after a reload, a tier saved at $0 shows the warning
    rather than going live silently unnoticed, and checking "No upper bound"
    on a second row clears it from whichever row had it first.

**Blog em-dash sweep (post-deploy only — local D1 has no blog rows to check
this against)**

Production database name is `beauteas-db` (confirmed in `wrangler.jsonc`,
**not** `beauteas-db-prod`):

```bash
npx wrangler d1 execute beauteas-db --env production --remote \
  --command "SELECT id,title,(html LIKE '%—%') h,(excerpt LIKE '%—%') e FROM blog_posts WHERE id IN (1,13);"
```

Expect `h` and `e` both `0` for both rows. Then eyeball
`/blog/the-magical-calendula-flower` and `/blog/10-steps-for-better-sleep` in
a browser to confirm the rendered post reads cleanly with no stray em dashes
or leftover formatting artifacts from the migration.

---

## What "done" looks like

- Phases 0–6 complete, in order.
- Every item in the verification checklist passed against production.
- Only then: `PRODUCTION-CUTOVER-RUNBOOK.md` Phase 10 (DNS) and Phase 11
  (post-cutover verification).
