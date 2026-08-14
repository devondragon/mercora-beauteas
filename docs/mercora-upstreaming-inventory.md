# Mercora Upstreaming Inventory

**Status:** Core `U00`-`U14`, `M01`, and `O01`-`O04` merged; `O05` in progress; `O06`-`O07` planned
**Research snapshot:** 2026-08-10
**BeauTeas baseline:** `6b10d27..1fa7c81`
**BeauTeas planning head:** `dcf2172`
**BeauTeas source of truth:** tag `v1.0.0` (`c9b135d`) — read source here, not `main`
**Mercora optional-pass research baseline:** `153cbe0`
**Mercora M01 branch baseline:** `45244fd`
**Related plan:** [mercora-upstreaming-plan.md](mercora-upstreaming-plan.md)

## Purpose

This inventory turns the BeauTeas development history into an executable,
dependency-ordered contribution program for Mercora. It identifies the final
behavior to port, the earlier commits that must not be replayed independently,
the tests that can be reused, and the BeauTeas material that must remain
downstream.

This is not a cherry-pick manifest. Mercora and BeauTeas have no shared commit
ancestry, and important upstream files have evolved through multiple BeauTeas
review/fix cycles. Every contribution must be reconstructed on a fresh branch
from the then-current Mercora `main`.

## Source of Truth: Tag `v1.0.0`, Not `main`

Read BeauTeas source at tag `v1.0.0` (`c9b135d`), from the read-only worktree
at `~/git/mercora-beauteas-v1.0.0`. Do not reconstruct from `main`.

Sale work happens on branch `goob` in `~/git/mercora-beauteas-goob` and is held
unmerged while upstreaming runs, so `main` should stay free of sale behavior on
its own. The tag pin is what keeps this safe once that stops being true —
either because the sale ships first, or because the branch merges early.

`v1.0.0` marks the launch-ready storefront as it stood on 2026-08-05, before
any going-out-of-business sale work. `main` now also carries sale-specific
behavior — changed copy, restricted purchase rules, disabled subscriptions.
Because this inventory reconstructs from the *final source state* of a file
rather than from diffs, reading `main` would silently pull wind-down logic into
Mercora as if it were generic commerce behavior.

Status tracking is the exception and stays on `main`. This file and
[mercora-upstreaming-plan.md](mercora-upstreaming-plan.md) are updated as each
unit lands; pinning them to the tag would freeze the ledger. **Read source at
the tag, write status on `main`.**

Most sale copy lives in CMS/D1 rows rather than code, and disposition `B`
already excludes brand, content, and store-specific compliance copy. The
contamination that matters is behavioral code in files that are themselves
upstream targets — checkout, cart and purchase rules, subscriptions.

### Post-Baseline Platform Fixes

Genuine platform bugs fixed after `v1.0.0` are not in the tag, and are more
valuable upstream than anything that is. Record each one here and reconstruct
it from `main` rather than the tag.

| BeauTeas commit | Area | Summary | Upstream status |
| --- | --- | --- | --- |
| _(none yet)_ | | | |

If this table grows beyond a handful of rows, the tag has stopped being a
usable source and the project should move to a maintained sale-free branch
instead.

## Research Basis

The inventory was produced from:

- All first-parent BeauTeas history after the last Russell-authored snapshot
- The individual commits behind traditional merge PRs `#1`–`#10`
- File and test changes associated with numbered PRs `#1`–`#122`
- Follow-up commits that corrected or superseded earlier implementations
- Current Mercora and BeauTeas source, migrations, configuration, and tests
- Import/dependency review of auth, catalog, Money, checkout, payments,
  refunds, inventory, MCP, CMS, recommendations, and fulfillment

History findings:

- 118 numbered BeauTeas PRs appear on the first-parent history.
- PR numbers `#2`, `#9`, `#13`, and `#14` do not appear in the merged history.
- 65 additional first-parent commits exist outside numbered PRs.
- BeauTeas contains 168 tracked test files and roughly 1,600 test cases.
- Mercora had no test framework or tracked tests at the original inventory
  snapshot; the completed core pass now has a Node 24 Vitest/Workers test base.
- Mercora migrations ended at `0006` at the original snapshot and now end at
  `0018`; BeauTeas continues through `0024` and
  contains two different `0010_*` migration files.

## Disposition Codes

| Code | Disposition | Meaning |
| --- | --- | --- |
| `F` | Foundation/dependency | Required by later groups or must be split into prerequisites |
| `D` | Directly upstreamable | Generic behavior, reconstructed from its final source state |
| `G` | Generalize first | Reusable mechanism with BeauTeas assumptions to remove |
| `B` | BeauTeas-only | Brand, content, assets, production state, or imported merchant data |
| `S` | Superseded/fold | Do not port independently; fold its final invariant into a later group |

`D` never means blindly cherry-pick. It means the behavior is suitable for
Mercora after reconciling the current upstream source and all later fixes.

## Executive Conclusions

1. **Land safety foundations before features.** Green CI, dependency triage,
   Vitest, and migration/deploy safety precede schema or money-path work.
2. **Port final invariants, not chronological patches.** Security PR `#47`,
   sanitizer follow-up `#59`, order guard follow-up `#116`, and fulfillment
   corrections `#112/#114/#117–#121` are mandatory final-state sources.
3. **Money and order trust boundaries are central dependencies.** Pricing,
   MCP, refunds, email, and fulfillment all depend on unambiguous Money and
   server-owned order state.
4. **Payment/webhook infrastructure must not depend on subscriptions.** The
   generic `processed_webhook_events` table currently lives inside the
   subscription migration and must become a standalone core migration.
5. **Optional features must expose capability seams.** Core checkout currently
   imports gift-card services directly. Mercora needs no-op capability hooks
   before optional gift cards or subscriptions can remain optional.
6. **Migrations must be recreated, never copied by number.** Mercora assigns
   the next available number when each schema-bearing PR is created.
7. **Playwright comes later.** Current E2E tests assume BeauTeas products,
   copy, storage keys, and URLs. Vitest can land immediately; browser tests
   require neutral seed fixtures and configurable namespaces.
8. **Inventory groups are not one-to-one with PRs.** The completed core pass
   consolidated 15 groups into 11 contribution units. The second-pass review
   similarly consolidates nine optional trains into seven extraction PRs,
   preceded by one bounded maintenance PR.

## Dependency Graph

```text
Project foundation (Mercora PR #8)
├── Dependency security remediation
├── Vitest foundation
└── Migration/deploy safety + runtime configuration
    ├── Shared security primitives
    │   ├── Admin/catalog trust boundaries
    │   ├── Order trust boundary
    │   ├── MCP identity/session hardening
    │   └── Signed guest status tokens
    │
    ├── Money value object
    │   ├── Pricing/tax/shipping/discount calculations
    │   ├── MCP catalog/payment integrity
    │   ├── Order/email/API wire serialization
    │   └── Fulfillment response projections
    │
    └── Order trust boundary
        └── Server-authoritative checkout + standalone webhook claims
            ├── Inventory CAS
            │   └── Refund restocking
            └── Refund ledger/lifecycle
                └── Fulfillment vertical slice
                    ├── Schema, domain, shipment CAS, and guarded APIs
                    └── Admin, customer, guest, MCP, and email surfaces
```

Separate feature dependency:

```text
Admin authorization + HTML sanitization
└── Generic CMS template system
    ├── Blog
    └── Merchant legal/content templates
```

## Core Contribution Groups

These are inventory groups, not a promise that each group is exactly one PR.
The delivery guidance records the consolidated PR boundary selected after the
dependency and test review.

| ID | Contribution group | Primary source | Prerequisites | Risk | Delivery guidance |
| --- | --- | --- | --- | --- | --- |
| `U00` | Project foundation | BeauTeas `#20`; final CI concepts from `#122` | None | Low | Already opened as Mercora PR `#8` |
| `U01` | Dependency security remediation | Current Mercora audit; `bb6d01e` only as history | `U00` | High | Separate safe upgrades from breaking modernization |
| `U02` | Vitest foundation | `#26`, current test config, neutral pure-unit tests | `U00`, preferably `U01` | Low | Playwright explicitly deferred |
| `U03` | Runtime extensibility, environments, and deploy safety | `#3`, `#8`, `#18`, `#19`, `#111`, `33b0333`, `951c5be`, `eaa1245` | `U00`, `U02` | High | One PR; ordered runtime/config then deploy/migration commits |
| `U04` | Shared web/admin security primitives | `#32`, `#34`, `#38`, `#43–#47`, `#53–#59`, `#80`, `#90` | `U02`, config seam from `U03` | High | Combine with `U05`; defer CMS-only controls if needed |
| `U05` | Catalog authorization and public projection | `#30`, `#31`, `#33`, `#40`, corrections in `#47/#122` | `U02`, `U04` | Medium | Combine with `U04` as the first complete security consumer |
| `U06` | Order authorization and server-owned state | `a691e4d`, `0b92a20`, `#41`, `#48`, `#65`, `#89`, `#115/#116` | `U02`, `U04` | Critical | Combine with `U08`; keep inventory/refunds out |
| `U07` | MACH Money foundation and wire boundaries | `#61` plus later wire-shape corrections | `U02` | High | Standalone PR because adoption has a broad blast radius |
| `U08` | Server-authoritative checkout and pricing | `#49`, `#62`, `#73`, `#79`, `#85–#88`, `#95`, `#101`, applicable `#122` | `U06`, `U07` | Critical | Combine with `U06` as one order/checkout trust boundary |
| `U09` | Webhook, refund, and inventory correctness | `#37`, `#42`, final `#66`, `#78`, `#93`, `#102`, `#121` | `U06`, `U08` | Critical | One consolidated webhook/inventory/refund correctness PR |
| `U10` | MCP identity, keys, ownership, and scopes | `#35`, `#36`, `#45`, `#47`, `#50`, `#52`, `#92` | `U02`, `U04` | High | Combine with `U11`; use expand/rotate/contract credentials |
| `U11` | MCP commerce and payment integrity | `#51`, `#55`, `#56`, `#60`, `#81` | `U07`, `U08`, `U10`; fulfillment for final tracking | High | Combine with `U10`; tracking remains with fulfillment |
| `U12` | Recommendation pipeline resilience | `#63`, `#91` | `U02`, config seam from `U03` | High | Standalone PR or defer without blocking the core flow |
| `U13` | Fulfillment domain, schema, and guarded APIs | `#104`, `#105`, `#112`, `#117`, `#119`, refund hold from `#121` | `U06`, `U07`, `U09` | Critical | Combine with `U14` in one ordered vertical-slice PR |
| `U14` | Fulfillment admin/customer/email surfaces | `#107`, `#109`, `#110`, `#114–#116`, `#118` | `U13` layers in the combined PR; timestamp normalization first | High | Combine with `U13`; use schema-first review order |

### Consolidated Core PR Sequence

| Sequence | PR / scope | Inventory units | State |
| ---: | --- | --- | --- |
| 1 | Project foundation, Mercora PR `#8` | `U00` | Merged |
| 2 | Dependency security, Mercora PR `#9` | `U01` | Merged |
| 3 | Vitest foundation, Mercora PRs `#10` and recovery `#21` | `U02` | Merged via recovery PR `#21` |
| 4 | Runtime configuration and deployment safety, Mercora PRs `#23` and `#32` | `U03` | Merged |
| 5 | Shared security and catalog trust boundary, Mercora PR `#35` | `U04 + U05` | Merged |
| 6 | MACH Money boundary, Mercora PR `#24` | `U07` | Merged |
| 7 | Order trust and server-authoritative checkout, Mercora PR `#39` | `U06 + U08` | Merged |
| 8 | Webhook, inventory, and refund correctness, Mercora PR `#40` | `U09` | Merged |
| 9 | MCP trust and commerce integrity, Mercora PR `#41` | `U10 + U11` | Merged |
| 10 | Recommendations, Mercora PR `#43` | `U12` | Merged as `8f688fb` |
| 11 | Fulfillment vertical slice, Mercora PR `#42` | `U13 + U14` | Merged to Mercora `main` as `339e54d` |

## Group Dossiers

### U00 — Project foundation

**Status:** Merged via Mercora PR `#8` as `ac4bd57`.

Includes working lint/typecheck/build CI, the MIT license, contribution and
security policies, package metadata, and a development-only guard around the
OpenNext Cloudflare initializer.

Do not add nonexistent Vitest/Playwright jobs until `U02` supplies the actual
dependencies, configuration, and tests.

### U01 — Dependency security remediation

`npm ci` currently reports 62 findings across the complete dependency tree: 2
low, 35 moderate, 21 high, and 4 critical. First separate production runtime
findings from development/build findings with `npm audit --omit=dev`.

Requirements:

- Upgrade compatible direct dependencies first.
- Trace high/critical transitive findings to their introducing dependency.
- Do not use `npm audit fix --force` without reviewing breaking changes.
- Record time-bounded exceptions with exposure analysis and an owner.
- Enable Dependabot.
- Add `npm audit --omit=dev --audit-level=high` to CI once the baseline is
  clean or enforceably documented.

### U02 — Vitest foundation

Port the current Vitest configuration and only neutral representative tests.
Suitable first tests include pure utilities such as `cn`, debounce behavior,
and later the security helpers introduced by `U04`.

Do not initially port:

- `homepage.spec.ts`, which asserts BeauTeas copy
- `checkout-launch-gate.spec.ts`, which hardcodes Clearly Calendula products,
  BeauTeas routes, addresses, and `beauteas.pendingOrder.*`
- Browser authentication shortcuts without a configurable test boundary

Add coverage thresholds only after a meaningful upstream baseline exists.

### U03 — Runtime extensibility, environments, and deploy safety

Start from the generic theme engine commit `ef82ac9`, not the BeauTeas values
in `e4f7c6b`, PR `#1`, or PR `#29`.

The generic configuration contract should cover:

- Store and assistant identity
- Contact email, sender identity, postal address, and support hours
- Site URL, image/CDN URL, Clerk host, and legal URLs
- Storage namespace and browser persistence keys
- Theme colors, fonts, assets, and social links
- MCP capabilities and description
- Commerce thresholds and feature capabilities

Deployment work should include dynamic robots, placeholder validation,
environment-aware public build variables, local D1 preparation, image fallback,
and safe D1 migration status/apply behavior. Use neutral demo resource names and
placeholders; never copy BeauTeas Cloudflare IDs or domains.

### U04 — Shared web/admin security primitives

Reconstruct the final security behavior after PR `#47`, not the original
`#30–#46` snapshots alone.

Include:

- Authorization-header service tokens
- Constant-time secret comparison
- Service-token identity restrictions
- Safe production error helpers and user-safe message allowlists
- Filename validation
- MIME and magic-byte image validation
- Stored-HTML sanitization with the corrected safe-formatting allowlist
- Config-derived CSP/HSTS/`nosniff`/frame protections
- Public API and agent-chat rate limiting/input limits
- Optional CMS custom-JavaScript kill switch and super-admin gate

The current CSP and sanitizer contain BeauTeas CDN/Clerk hosts. They must read
from the configuration contract introduced in `U03`.

### U05 — Catalog authorization and public projection

Use PRs `#30/#31/#33/#40` plus all relevant `#47` corrections. Preserve public
GET behavior while requiring admin authorization before any product, category,
or promotion write reaches its model.

The public product serializer must:

- Return only active public products
- Remove cost, barcode, internal inventory, and other server-only fields
- Validate status and pagination inputs
- Preserve a separate authenticated/admin representation

Do not include the launch-only gift-card purchase suppression added in `#122`;
that belongs to the optional gift-card capability.

### U06 — Order authorization and server-owned state

**Status:** Merged with `U08` via Mercora PR `#39` as `7a020d3`.

Establish one order trust boundary before adding later commerce systems:

- Owner-or-admin order reads
- Server-verified paid transitions
- Guarded refunded/cancelled transitions
- Canonical JSON column parsing/writing
- A client metadata allowlist
- Protection for every server-read extension key, using final PR `#116`, not
  the incomplete six-key protection from `#115`

Refund and fulfillment both use `orders.extensions` as a concurrency and
idempotency domain. This group must land before either system.

### U07 — MACH Money foundation and wire boundaries

BeauTeas Money stores integer minor units while exposing decimal MACH wire
values. It has more than 50 production call sites across orders, checkout, MCP,
CMS, fulfillment, email, Stripe, and UI.

Port as an explicit boundary migration:

- Stored integer/minor-unit representation
- Currency precision rules
- Arithmetic and comparison behavior
- MACH/wire decimal serialization
- Stripe minor-unit conversion
- Display/email formatting

Do not leave old ambiguous helpers alongside Money without an ownership and
deprecation plan. Exclude the accidental swap file and BeauTeas planning docs
that were present in the original PR history.

### U08 — Server-authoritative checkout and pricing

**Status:** Merged with `U06` via Mercora PR `#39` as `7a020d3`.

Reconstruct the final pipeline rather than replaying `#49`, `#73`, and later
patches individually:

- Resolve product identity and price from the server catalog
- Apply discounts, taxable bases, shipping, and fallback policy server-side
- Enforce the server-computed charge floor
- Create a pending order before payment completion
- Support redirect payment return flows
- Promote only verified PaymentIntents
- Derive the final pending-order total from the amount actually charged
- Make finalization idempotent and recoverable after capture

Core pricing/finalization currently imports gift-card services. Introduce a
no-op capability interface so core payment integrity does not require the
optional gift-card feature.

### U09 — Webhook, refund, and inventory correctness

**Status:** Merged via Mercora PR `#40` as `26ff9c1`.

Create `processed_webhook_events` in a standalone core migration; it currently
lives inside BeauTeas' subscription migration even though the Stripe webhook
route uses it generically.

Final behavior includes:

- Claim/release webhook deduplication without TOCTOU
- Explicit inventory source of truth and race-safe decrement
- Cumulative over-refund validation
- Deterministic idempotency keys
- Atomic refund ledger ordering and concurrency control
- Refund-specific restock attribution
- Stripe Dashboard refund reconciliation
- Pending/succeeded refund lifecycle effects
- Shipment holds while refund outcome is unsettled

Mercora must decide whether `product_variants.inventory` JSON or the separate
MACH inventory table is authoritative before porting the current inventory
implementation.

### U10 — MCP identity, keys, ownership, and scopes

Include CSPRNG identifiers, session ownership, anti-spoofing, hourly/batch rate
limits, agent-management authorization, header-only auth, commerce scopes, and
order line-item limits.

The BeauTeas API-key migration destructively renames the plaintext column and
invalidates non-test agents. Mercora must instead use an expand/rotate/contract
plan:

1. Add a hash column or versioned credential representation.
2. Support controlled rotation/backfill where possible.
3. Remove or contract plaintext support only after migration.
4. Keep test credentials in development-only seed data.

### U11 — MCP commerce and payment integrity

After Money and checkout integrity land, port:

- Server-canonical product names, prices, line totals, and order totals
- Correct cents/decimal threshold handling
- MACH address normalization
- Verified PaymentIntent requirement for agent order placement
- Agent-scoped status and tracking projections

The final order-tracking wire shape depends on fulfillment domain data and may
remain in the combined `U13 + U14` fulfillment PR rather than forcing an early
coupling.

### U12 — Recommendation pipeline resilience

Port server-rendered recommendations, deterministic scoring/fallbacks,
out-of-stock filtering, settings, batch behavior, rebuild staleness/empty-wipe
guards, and cron error propagation.

Replace tea product names/tags with neutral fixtures and configure worker names,
URLs, datasets, and observability bindings.

### U13 + U14 — Fulfillment vertical slice

Port fulfillment as one feature PR after `U03`, `U07`, `U06 + U08`, and `U09`
are available. Build the final behavior from domain/schema foundation `#104`,
service/API `#105`, customer status `#107`, email `#109`, admin queue `#110`,
and mandatory corrections `#112`, `#114–#119`, and `#121`.

Keep the PR reviewable through this ordered commit stack:

1. Carrier, order-event, and timestamp migrations.
2. Domain types and a configuration-driven carrier registry.
3. Shipment service, compare-and-swap transitions, and unsettled-refund holds.
4. Guarded fulfillment APIs and shared shipment projections.
5. Account and signed guest order-status views, plus final MCP tracking shape.
6. SQL-backed admin fulfillment queue with ISO pagination and stale-response
   protection.
7. Shipping confirmation, retry/resend, and hardened idempotency.
8. Real D1 queue/concurrency tests, signed-guest browser coverage, and operator
   documentation.

Schema must deploy before code queries it. Timestamp writers and their repair
path must land together before SQL queue ordering. Guest tracking requires a
signed access token, not a guessable order identifier. Carrier support, sender
identity, copy, URLs, and branding must be merchant configuration rather than
BeauTeas assumptions. Keep unrelated email compliance and general UI polish out
of this PR.

## Optional Feature Trains

These remain valuable upstream targets. The core trust, configuration, Money,
migration, test, recommendation, and fulfillment foundations are now present.

| Feature train | Source | Required generalization / blocker |
| --- | --- | --- |
| Customer accounts | `#12`, `85675f1` | Keep subscriptions out; neutralize routes/copy |
| Subscriptions | split from `#11`; `#67`, `#69`, `#74`, `#77`, part of `#87` | Standalone schema, consent policy configuration, fulfillment hooks |
| Gift cards | `#22`, `#28`, part of `#87`, launch control in `#122` | Split schema from BeauTeas seeded product; finish digital-only tax/shipping semantics before enabling purchase |
| Blog/CMS | `#21`, `#23–#25`, `#27`, sanitizer chain, generic `#98` | Renumber migration; neutral templates/content; retain security chain |
| Shopify migration toolkit | toolkit inside `#11`; direct ETL series | Exclude imported catalog/blog/redirect data; neutral environment/config names |
| Merchant email/compliance | `#72`, `#84`, part of `#87`, `6dc60e6`, `a4376e5` | Configured sender, postal address, domains, policy URLs, and copy |
| Observability | `#94` | Neutral worker names, datasets, alert subjects, and service bindings |
| AI canonical facts/response guard | `#106`, `#108`, `#120` | Configured assistant identity/facts; Chai/tea knowledge remains downstream |
| UI/runtime polish | `#64`, `#99`, `#113`, selected direct commits | Neutral styles/copy; preserve focused regression tests |

## Consolidated Optional Pass

The source audits initially suggested roughly 15 separately reviewable units.
The final consolidation uses seven extraction PRs plus one maintenance PR. This
is the fewest defensible set without mixing privacy infrastructure,
customer-visible AI truth controls, destructive operator tooling, or distinct
money-state machines.

| ID | Scope | Optional trains covered | Dependencies | Planned migration |
| --- | --- | --- | --- | --- |
| `M01` | Dependency, runtime, and repository-hygiene closeout | Cross-cutting prerequisite and generic dump hygiene from `#76` | Core complete | None expected |
| `O01` | Customer account and communications platform | Customer accounts; merchant email/compliance | `M01` | Email preferences/unsubscribes |
| `O02` | Content publishing and storefront correctness | Blog/CMS; UI/runtime polish tied to content/configuration | `M01` | Blog tables; neutral CMS template registration |
| `O03` | Privacy-safe observability | Observability | `M01` | None expected |
| `O04` | Canonical AI facts and guarded responses | AI canonical facts/response guard | `O03` | None expected |
| `O05` | Shopify migration toolkit | Redirect/media runtime and full ETL/operator tooling, including Blog import | `O02` | Redirect map |
| `O06` | Subscriptions vertical slice | Subscriptions | `O01`, `O03` | Subscription tables and shipping address |
| `O07` | Gift cards and generic digital commerce | Gift cards | `O01`, `O03` | Gift-card account/ledger/reservation/delivery state |

### Consolidation coverage

| Original train | Destination |
| --- | --- |
| Customer accounts | `O01` |
| Merchant email/compliance | `O01` |
| Blog/CMS | `O02` |
| UI/runtime polish | Global correctness in `M01`; content/storefront consumers in `O02` |
| Observability | `O03` |
| AI canonical facts/response guard | `O04` |
| Shopify migration toolkit | `O05` |
| Subscriptions | `O06` |
| Gift cards | `O07` |

### Delivery waves

1. Land `M01` alone with a fresh production audit snapshot, enumerated
   remediations/exceptions, CSS-as-script/runtime regression coverage, and a
   verified no-dump repository boundary.
2. Develop `O01`, `O02`, and `O03` in parallel from updated `main`.
3. Develop `O04` after `O03`, and `O05` after `O02` because Blog import is part
   of the complete Shopify train.
4. Develop `O06` and `O07` after `O01` and `O03`. They may use parallel
   worktrees, but merge serially; rebase and fully revalidate the second because
   both touch checkout, paid effects, webhooks, and refunds.

### Cross-pass acceptance rules

- All optional capabilities default off and leave core checkout operational.
- Schema PRs use additive, forward-only migrations assigned from then-current
  Mercora `main`; never reuse BeauTeas migration numbers.
- Money-ledger features are rolled back by disabling their capability, never by
  down-migrating. Test migrations on a populated baseline, old code with the
  added schema, and new code with capability-off/empty tables.
- Each large PR is one vertical feature with ordered schema, domain/service,
  guarded API, UI/email/operator, test, and documentation commits.
- Node 24, install/lockfile integrity, lint, typecheck, unit tests, applicable
  Workers/D1 tests, production build, and migration safety are required.
- Scan every extraction for BeauTeas/Chai names, content, assets, domains,
  resource IDs, merchant values, imported data, exports, logs, and cutover state.
- `O03` must fail open and redact headers, cookies, auth/payment data,
  customer/order identifiers, query strings, and raw exceptions.
- `O06` must prove webhook disorder/duplication safety, one renewal order per
  invoice, and paid-invoice verification before fulfillment.
- `O07` must prove CSPRNG/keyed-hash code safety, server-owned reservation
  transitions, expiry cleanup, ledger conservation, currency rules,
  authorization, and enumeration resistance.

## Migration Reconciliation

### Existing baseline

Mercora and BeauTeas migrations compare as follows:

| Migration | Relationship | Action |
| --- | --- | --- |
| `0001` | Identical | Preserve |
| `0002` | Identical | Preserve |
| `0003` | Same schema, different seed content | Preserve Mercora; never upstream BeauTeas legal/brand content |
| `0004` | Identical | Preserve |
| `0005` | Identical | Preserve |
| `0006` | Identical | Preserve |

### Rules

1. Assign the next available Mercora number when a schema PR is created.
2. Maintain a migration reservation ledger while multiple PRs are open.
3. Never modify an already-applied upstream migration to carry downstream data.
4. Separate reusable schema from merchant seed content.
5. Deploy physical schema before code that queries it.
6. Add migration status/dry-run verification and bounded backups before the
   first schema-bearing feature.
7. Extract generic webhook claims from subscriptions into a core migration.
8. Use expand/migrate/contract for MCP credentials rather than destructive
   renames.

### Downstream migration disposition

| BeauTeas migration | Upstream disposition |
| --- | --- |
| `0007_add_subscription_tables.sql` | Optional subscription schema; extract generic webhook claims first |
| `0008_add_redirect_map.sql` | Generic Shopify/SEO feature train |
| `0009_rebrand_cms_pages.sql` | BeauTeas-only |
| `0010_add_blog_tables.sql` | Optional blog feature; renumber |
| `0010_add_gift_cards.sql` | Optional gift-card schema; remove BeauTeas seeded product; renumber |
| `0011_hash_mcp_api_keys.sql` | Replace with safe expand/rotate/contract migration |
| `0012_remove_seeded_test_agent.sql` | Development-seed policy; do not depend on production cleanup data |
| `0013_add_product_recommendations.sql` | `U12`; renumber |
| `0014_add_policy_pages.sql` | Mechanism optional; content downstream-only |
| `0015_add_subscription_shipping_address.sql` | Optional subscriptions; follows subscription schema |
| `0016_rewrite_legal_pages.sql` | BeauTeas-only |
| `0017_backfill_legal_pages.sql` | BeauTeas-only |
| `0018_add_email_unsubscribes.sql` | Generic email/compliance train |
| `0019_restructure_footer_pages.sql` | Mostly BeauTeas content; port only generic CMS structures |
| `0020_seed_page_templates.sql` | Neutralize and include with generic CMS templates |
| `0021_add_external_refund_restock_setting.sql` | `U09`; prefer generic refund capability settings |
| `0022_add_shipping_carrier.sql` | `U13 + U14` fulfillment PR; align with generic carrier registry |
| `0023_add_order_events.sql` | `U13 + U14` fulfillment PR; deploy before shipment service |
| `0024_normalize_order_timestamps.sql` | `U13 + U14` fulfillment PR; port writer and repair before queue code |
| `migrations/data/*` | BeauTeas-only imported content/data |

## Test Assets and Gaps

### Strong reusable coverage

| Area | Approximate reusable coverage | Notes |
| --- | --- | --- |
| Catalog auth/projection | 30 cases | Strong route and serializer coverage; remove gift-card launch assertion |
| Security primitives | 74 cases | Timing, errors, uploads, filename, sanitizer, headers, rate limits |
| MCP hardening | 91 cases | Includes one real Miniflare/D1 rate-limit integration test |
| Money/pricing | 92 cases | Strong unit boundary coverage |
| Checkout/order finalization | 77 cases | Catalog spoofing, verified payments, pending orders, charge floors |
| Refund/inventory | 116 cases | Strong behavior tests; concurrency mostly mocked |
| Recommendations | 44 cases | Neutralize tea fixtures |
| Fulfillment/OMS | 199 cases | Best-tested optional area, but heavily coupled |

### Coverage gaps to close upstream

- Add real-D1 tests for webhook deduplication, inventory CAS, refund-ledger
  concurrency, fulfillment CAS, and critical DB constraints.
- Add full route/R2 coverage for upload and media responses.
- Add at least one integration test for bearer/service-token auth and one for
  Clerk owner/admin boundaries.
- Add a brand/config contract test and eventually visual regression coverage.
- Add E2E coverage for signed guest order status and later admin fulfillment.
- Correct the testing documentation mismatch between `preview:dev` and the
  actual `preview:e2e` Playwright command if those docs are upstreamed.

## Generalization and Exclusion Boundaries

Always exclude from Mercora PRs:

- `.planning/**`
- BeauTeas cutover, production-status, and migration-applied records
- `data/enrichment/**`, merchant seed/catalog data, and product/category assets
- `data/r2/**` BeauTeas content and knowledge
- `migrations/data/blog-content.sql` and `migrations/data/redirects.sql`
- BeauTeas legal/CMS content migrations
- Chai names, facts, medical/tea claims, artwork, and logos
- Live Apple merchant association data
- BeauTeas domains, Cloudflare IDs, resource names, datasets, and service names
- Merchant email identities, postal address, and operational URLs
- Customer records, database exports, logs, or production verification state

Known generalization hotspots:

- CSP and sanitizer CDN/Clerk allowlists
- `wrangler.jsonc` and auxiliary Worker configurations
- Email sender, footer, colors, postal address, and merchant deep links
- Browser storage keys such as `beauteas.pendingOrder.*`
- MCP payment descriptions and assistant identity
- AI deterministic facts and response allowlists
- Carrier assumptions and shipment labels
- Observability worker names, subjects, and bindings

## Numbered PR Ledger

The following ledger assigns every numbered PR present in the first-parent
history one primary disposition. Missing numbers are documented after the
tables.

### PRs 1–29

| PR | Commit | Code | Owning group | Inventory decision |
| --- | --- | --- | --- | --- |
| `#1` | `7702f6a` | `S` | `U03` | Direct rebrand superseded by the configurable theme engine in `#3` |
| `#3` | `97e4584` | `F` | `U03` | Port generic commit `ef82ac9`; exclude BeauTeas values from `e4f7c6b` |
| `#4` | `38ce3cf` | `B` | — | BeauTeas README |
| `#5` | `8d65685` | `B` | — | BeauTeas catalog seed and product images |
| `#6` | `0ca834a` | `B` | — | BeauTeas CMS/content seed |
| `#7` | `4728838` | `B` | `U03` | Rebrand/domain changes; static robots work superseded by `#18` |
| `#8` | `18a6676` | `F` | `U03` | Generalize multi-environment structure; replace all resource IDs/domains |
| `#10` | `2c0fba7` | `B` | — | Claude-specific repository automation; add only by maintainer choice |
| `#11` | `f4f858d` | `F` | Feature trains | Decompose subscriptions, redirect schema, Shopify ETL, SEO, and planning |
| `#12` | `7f8d978` | `G` | Accounts | Separate customer accounts from subscriptions and BeauTeas copy |
| `#15` | `a14e357` | `G` | `U04/U06` | Port fail-closed auth/token/permission behavior; exclude cutover and lockfile churn |
| `#16` | `bb400c7` | `B` | — | BeauTeas cutover preparation; inspect isolated fixes only if later needed |
| `#17` | `20dd260` | `G` | `U11` | Rebrand/content stays downstream; catalog-driven MCP boundary is reusable |
| `#18` | `b6e9b9d` | `D` | `U03` | Dynamic robots implementation |
| `#19` | `659208c` | `D` | `U03` | Production placeholder guard, with neutral configuration |
| `#20` | `0a46b93` | `S` | `U00` | Superseded by Mercora project-foundation PR `#8` |
| `#21` | `873d6ec` | `G` | Blog/CMS | Blog foundation; retain full sanitizer/fix chain and renumber migration |
| `#22` | `30a70f5` | `G` | Gift cards | Split generic schema from BeauTeas seeded product; purchase remains gated |
| `#23` | `f8ef598` | `D` | Blog/CMS | Blog tag-filter accessibility |
| `#24` | `9f04d34` | `D` | Blog/CMS | Editor rerender fix |
| `#25` | `632b62a` | `D` | Blog/CMS | Write-time/server-render sanitization; final allowlist comes from `#59` |
| `#26` | `bb7e093` | `F` | `U02` | Vitest foundation; defer BeauTeas-coupled Playwright tests |
| `#27` | `52b134d` | `D` | Blog/CMS | UTC date and tag serialization fixes |
| `#28` | `a965cfe` | `F` | Gift cards | Reusable Workers/D1 concurrency tests after neutralizing fixtures |
| `#29` | `31d0311` | `B` | `U03` | BeauTeas theme values/assets; selectively reuse neutral UI primitives only |

### PRs 30–60 — Security and trust-boundary audit

| PR | Commit | Code | Owning group | Inventory decision |
| --- | --- | --- | --- | --- |
| `#30` | `7e30f60` | `D` | `U05` | Product mutation authorization; include `#47` corrections |
| `#31` | `9ffaa06` | `D` | `U05` | Category mutation authorization; include `#47` corrections |
| `#32` | `8b8e11d` | `D` | `U04` | Move admin token from query string to Authorization header |
| `#33` | `636b9d6` | `D` | `U05` | Promotion mutation authorization; include `#47` corrections |
| `#34` | `c0c5c93` | `D` | `U04` | Constant-time service-token comparison |
| `#35` | `4b3e410` | `D` | `U10` | Hourly MCP rate-limit accounting; include batch fixes from `#47` |
| `#36` | `e9ccf90` | `D` | `U10` | MCP session ownership; include anti-spoof fixes from `#47` |
| `#37` | `8946372` | `D` | `U09` | Cumulative refund validation; final behavior includes `#47/#93/#121` |
| `#38` | `d9647ed` | `D` | `U04` | MIME/magic-byte validation and media `nosniff` behavior |
| `#39` | `b31fdb4` | `D` | Shopify/tooling | Shared SQL escaping; reuse where scripts are ported |
| `#40` | `0c0438d` | `D` | `U05` | Public active-only product projection and internal-field stripping |
| `#41` | `2cb4fdd` | `D` | `U06` | Server verification before paid transition |
| `#42` | `32ddc0e` | `D` | `U09` | Webhook claim-before-work deduplication; extract standalone schema |
| `#43` | `a1b932e` | `D` | `U04` | Block service identity from admin-user mutations/reads per final policy |
| `#44` | `23cd9fa` | `D` | `U04` | Safe knowledge filenames and paths |
| `#45` | `578ebcd` | `D` | `U10` | CSPRNG API keys and session IDs |
| `#46` | `b5586a0` | `S` | `U04` | Superseded by the cross-route policy in `#47/#57/#58` |
| `#47` | `2cb6bb9` | `F` | `U04/U05/U09/U10` | Mandatory correction bundle; fold each fix into its owning group |
| `#48` | `f55d1d6` | `D` | `U06` | Owner-or-admin order reads |
| `#49` | `ca7143c` | `D` | `U08` | Server catalog pricing and verified charge foundation |
| `#50` | `50c6007` | `F` | `U10` | API-key hashing; replace destructive migration design |
| `#51` | `953baea` | `D` | `U11` | Verified PaymentIntent for MCP order placement |
| `#52` | `6e0e91c` | `F` | `U10` | Move test credentials to development seed; avoid production data dependency |
| `#53` | `aee1803` | `D` | `U04` | Security headers; take final CSP corrections from `#98` |
| `#54` | `d4f430f` | `D` | `U04` | Stored-HTML sanitization; must include formatting correction `#59` |
| `#55` | `9b57bb3` | `D` | `U11` | Catalog-canonical MCP order display/total fields |
| `#56` | `4e12e0b` | `D` | `U11` | MACH address normalization |
| `#57` | `a3347e5` | `D` | `U04` | Cross-route production error policy |
| `#58` | `64a30fe` | `D` | `U04` | Regression coverage for user-safe error whitelist |
| `#59` | `13809b7` | `D` | `U04` | Restore controlled safe formatting after sanitizer hardening |
| `#60` | `48c74c1` | `D` | `U11` | Canonical per-line pricing and corrected cents threshold |

### PRs 61–95 — Commerce and platform integrity

| PR | Commit | Code | Owning group | Inventory decision |
| --- | --- | --- | --- | --- |
| `#61` | `9f7d1e5` | `F` | `U07` | Money boundary foundation; remove accidental/planning artifacts |
| `#62` | `831437d` | `D` | `U08` | Redirect payment methods; integrate with final pending-order flow |
| `#63` | `bbcd18d` | `G` | `U12` | Recommendation pipeline; neutralize products/settings/resources |
| `#64` | `93797fa` | `D` | UI/runtime | Root error boundary |
| `#65` | `b5c3280` | `D` | `U06` | Canonical order-detail JSON hydration |
| `#66` | `c2798bc` | `S` | `U09` | Refund/email implementation superseded by `#93/#100/#102/#121` |
| `#67` | `20e0abb` | `D` | Subscriptions | Idempotent subscription-created webhook handling |
| `#68` | `d1702da` | `B` | — | BeauTeas product/catalog copy |
| `#69` | `03f84ce` | `G` | Subscriptions | Configurable recurring-billing consent/disclosure |
| `#70` | `198a1ef` | `S` | — | Chai asset work replaced by `#97`; neither asset belongs upstream |
| `#71` | `f1d2748` | `B` | AI/config | BeauTeas health claims and Chai medical guardrail contents |
| `#72` | `1b75bff` | `G` | Email/CMS | General policy routing/link mechanisms; content remains downstream |
| `#73` | `affd1a3` | `D` | `U08` | Pending order before capture; final total correction from `#101` |
| `#74` | `1b49ed8` | `D` | Subscriptions | SetupIntent customer ownership |
| `#75` | `6acd5c2` | `B` | — | Chai/FDA copy placement |
| `#76` | `8bde182` | `D` | Repository hygiene | Remove committed DB dump and ignore future dumps |
| `#77` | `07692fd` | `G` | Subscriptions | Fulfillable subscription orders and shipping address schema |
| `#78` | `0ae4753` | `G` | `U09` | Race-safe inventory after upstream selects authoritative model |
| `#79` | `de24db5` | `S` | `U08` | Fold into final `#85–#88/#95/#101/#122` pricing pipeline |
| `#80` | `fe15622` | `D` | `U04` | Public API rate limiting and agent-chat hardening |
| `#81` | `eabfe33` | `D` | `U11/U14` | Agent-scoped tracking; final shape depends on fulfillment |
| `#82` | `ad6768d` | `B` | — | BeauTeas legal text and decisions |
| `#83` | `c98021e` | `B` | — | BeauTeas legal backfill |
| `#84` | `4070fcf` | `G` | Email/compliance | Unsubscribe mechanism; configure merchant identity/postal address |
| `#85` | `b1183ee` | `D` | `U08` | Server-side free-shipping threshold and tax fallback |
| `#86` | `c546734` | `D` | `U08` | Server-catalog taxable base |
| `#87` | `7371ed5` | `G` | Feature trains | Split gift-card retry, subscription terms, and merchant email behavior |
| `#88` | `910d38b` | `D` | `U08` | Server tax/shipping charge floor; include `#122` corrections |
| `#89` | `c46a36d` | `D` | `U06` | Guard terminal order transitions and payment extension metadata |
| `#90` | `38563b7` | `D` | `U04` | CMS custom-JavaScript kill switch, audit, and super-admin gate |
| `#91` | `64adbc5` | `D` | `U12` | Recommendation OOS, empty-rebuild, cron, and observability guards |
| `#92` | `061e841` | `D` | `U10` | MCP header auth, commerce scopes, and line-item limits |
| `#93` | `1597a48` | `D` | `U09` | Atomic refund ledger, concurrency, and idempotency helpers |
| `#94` | `59f9620` | `G` | Observability | Port worker/metric logic; configure names, bindings, senders |
| `#95` | `bf71709` | `D` | `U08` | Catalog discount categories and coupon redemption tracking |

### PRs 96–122 — Cutover, fulfillment, and launch hardening

| PR | Commit | Code | Owning group | Inventory decision |
| --- | --- | --- | --- | --- |
| `#96` | `8a857ed` | `B` | Shopify/tooling | Imported BeauTeas redirects/blog data; toolkit comes from earlier ETL source |
| `#97` | `e43cf98` | `B` | `U03` | Chai assets stay downstream; generic image-loader bypass fix may be extracted |
| `#98` | `c6a6e6e` | `G` | Blog/CMS, `U04` | Generic page templates and final CSP/SEO fixes; remove BeauTeas content |
| `#99` | `ee25630` | `D` | UI/runtime | Footer alignment and mobile header overflow |
| `#100` | `51a23b4` | `F` | `U08/U09` | Stripe SDK money-path refactor; include prerequisite `60318ee` |
| `#101` | `d7077f8` | `D` | `U08` | Pending-order total from actual charged amount |
| `#102` | `176f236` | `G` | `U09` | External refund reconciliation and generic capability setting |
| `#103` | `bcf0e08` | `B` | — | BeauTeas migration-applied operational record |
| `#104` | `bb14313` | `F` | `U13` | Fulfillment schema/domain foundation; renumber and generalize carriers |
| `#105` | `e2474ff` | `D` | `U13` | Shipment CAS service and guarded APIs; include later corrections |
| `#106` | `f2a03b8` | `G` | AI/config | Configurable canonical facts and contact response guard |
| `#107` | `a0ff432` | `D` | `U14` | Account and signed guest order status; configure copy/identity |
| `#108` | `1fd3b41` | `G` | AI/config | Configured deterministic refund-window fact |
| `#109` | `bf633d7` | `G` | `U14` | Shipping email/retry/deep link; config-drive merchant identity |
| `#110` | `ae5b7b1` | `D` | `U14` | SQL-backed fulfillment queue; include timestamp/stale fixes |
| `#111` | `3000730` | `F` | `U03` | Safe D1 migration plan/apply before deploy, including review fixes |
| `#112` | `6811007` | `D` | `U13` | Replace tracking-number denylist with allowlist |
| `#113` | `fb40bf2` | `D` | UI/runtime | CSS-as-script, hydration, and landmark regressions |
| `#114` | `0e40625` | `D` | `U14` | ISO timestamp repair plus queue pagination/stale/dead-page fixes |
| `#115` | `08d6879` | `S` | `U06/U14` | Initial metadata allowlist; incomplete without `#116` |
| `#116` | `a5a4e26` | `D` | `U06/U14` | Protect every server-read extension key and CAS-guard metadata merge |
| `#117` | `9ffb917` | `D` | `U13` | Shared shipment-view projection |
| `#118` | `6beb201` | `D` | `U14` | Shipping-email idempotency/event-read hardening |
| `#119` | `5bed0eb` | `D` | `U13 + U14` | Fulfillment Money wire conversion |
| `#120` | `8306a06` | `G` | AI/config | Configured deterministic shipping facts |
| `#121` | `9fd0959` | `D` | `U09/U13` | Final refund lifecycle and unsettled-refund fulfillment hold |
| `#122` | `1fa7c81` | `S` | Multiple | Mixed launch bundle; distribute CI, pricing, address, product, date, hydration, and gift-card hunks to owners |

No merged first-parent entries exist for PR numbers `#2`, `#9`, `#13`, or
`#14`.

## Non-PR First-Parent Commit Ledger

The direct commits are grouped by coherent disposition. A commit may contain
both reusable mechanism and downstream data; those rows are marked `G`.

| Commits | Code | Owning group | Decision |
| --- | --- | --- | --- |
| `bb6d01e` | `S` | `U01` | Historical dependency update; current audit and supported versions are authoritative |
| `eb84d77` | `B` | — | BeauTeas migration planning document |
| `f486bf2` | `G` | `U03` | Generic required-AI-binding validation with neutral environment config |
| `df252b5`, `84945ae`, `03f3d46`, `7304196` | `B` | — | BeauTeas migration-applied records |
| `2cbf6db`, `954e731`, `b684f97`, `23499ad`, `d6c811d`, `7e71a5a`, `e8de458` | `G` | Shopify/tooling | Port loaders, linking, HTML flattening, enrichment/sync/promotion mechanisms; exclude generated data |
| `8bf4646` | `B` | — | BeauTeas production image CDN |
| `a5c4b85`, `d798b42`, `cf1f39d`, `d0e14bc` | `D` | UI/runtime | Product/CMS visibility, category rendering, signed-in admin, cart CTA |
| `f0cc0bf`, `81c33e0`, `e48673d` | `B` | — | Chai knowledge/content and cutover documentation |
| `33b0333` | `D` | `U03` | Local D1 preparation before development |
| `85675f1` | `D` | Accounts | Provision customer on first account write |
| `186c661`, `ff1f1b6` | `B` | — | BeauTeas admin attribution/link presentation |
| `6043bb9`, `58a402d`, `1cff6ab`, `6deb067`, `d14e78f` | `B` | — | BeauTeas product ordering, brand assets, category photos, launch catalog choices |
| `8fc856c` | `G` | Product/UI | Split reusable product details/local R2 seeding from BeauTeas assets and fields |
| `a8046a9` | `D` | `U08` | Distinct missing-Stripe-configuration failures |
| `6e1aae4` | `B` | — | BeauTeas development Stripe key selection |
| `a691e4d`, `0b92a20` | `S/D` | `U06/U08` | Initial verified paid transition and JSON encoding fix; take final order/payment chain |
| `da2c6f6`, `b27e383`, `d9c0bbf`, `7a38c5e`, `9a94b8f`, `f5f1a06`, `f9ec0b3`, `c627235`, `bc67de5`, `e921889`, `8c51f60`, `65118af` | `B` | — | BeauTeas cutover and production-verification records |
| `951c5be` | `G` | `U03` | Build-time public env injection and environment-driven base URL |
| `60318ee` | `F` | `U08/U09` | Stripe SDK/API-version upgrade prerequisite for `#100` |
| `4cba326`, `6943525` | `B` | — | BeauTeas production migration/resource operations |
| `595be0d` | `B/G` | Observability | Actual BeauTeas deployment stays downstream; generic Tail Worker logic comes from `#94` |
| `eaa1245` | `D` | `U03` | Image fallback when Cloudflare transformations are disabled |
| `6dc60e6`, `a4376e5` | `G` | Email/compliance | Product-image resolution and merchant notification with configured identity/links |
| `63c35b9` | `G` | `U03` | Durable Object configuration only if required by generic deployment |
| `d9ceeda`, `348bca2`, `a4e339b` | `B` | — | BeauTeas OMS planning/rollout records |
| `9d7248c`, `846eed5` | `B` | — | BeauTeas operational documentation organization/fix |
| `f14fb9c` | `B` | — | BeauTeas development hostname correction |
| `5287809` | `B` | — | Live BeauTeas Apple merchant-domain association data |
| `dcf2172` | `B` | Planning | This upstreaming plan; not an upstream implementation candidate |

## Critical Supersession Chains

| Earlier source | Required final source | Final invariant |
| --- | --- | --- |
| Theme `#1` | Generic `#3`; BeauTeas-only `#29` excluded | Configuration mechanism, not BeauTeas theme |
| Static domain/robots `#7` | `#18` plus generic `951c5be` config | Dynamic environment-aware robots/metadata |
| Test foundation `#26` | Current configs plus applicable `#122` hardening | Real configured jobs only; Playwright hermetic and neutral |
| Blog `#21` | `#23–#25`, `#27`, `#54/#59` | Accessible, UTC-safe, write-time sanitized final implementation |
| Gift cards `#22` | `#28`, gift part of `#87`, launch control in `#122` | Safe concurrency/retry; purchase disabled until digital flow is complete |
| Security `#30–#46` | Mandatory `#47` corrections | Final audited authorization, validation, rate-limit, and error behavior |
| Error details `#46` | `#47`, `#57`, `#58` | One production error whitelist/gating policy across routes |
| Sanitizer `#54` | `#59` | XSS prevention without stripping approved formatting |
| Security headers `#53` | CSP corrections within `#98` | Final CSP with configured hosts |
| MCP totals `#55` | `#60`, then Money `#61` | Canonical per-line prices and total using explicit Money boundaries |
| Paid-state work `a691e4d/#41` | `#49`, `#73`, `#89`, `#115/#116` | Clients cannot assert money state or overwrite server-owned metadata |
| Pending orders `#73` | `#101` | Pending total equals the amount actually charged |
| Pricing `#79/#85–#88/#95` | Applicable `#122` corrections | Consistent server discounts, tax, shipping, and charge floor |
| Refunds `#37/#66` | `#93`, `#100`, `#102`, `#121` | Atomic/idempotent ledger with external and pending lifecycle handling |
| MCP tracking `#81` | `#104–#119`, `#115/#116` | Shipment/event-backed, authorized, Money-correct tracking projection |
| Tracking validation in `#104` | `#112` | Allowlist, not denylist |
| Shipping email `#109` | `#118` | Hardened idempotency keys and bounded event reads |
| Order metadata guard `#115` | `#116` | All server-read extension keys protected |
| Fulfillment `#105/#110` | `#114`, `#117`, `#119`, `#121` | ISO ordering, shared projection, Money wire shape, refund hold |

## Execution Tracker

Update this table as Mercora issues and PRs are created.

| ID | Status | Mercora issue | Mercora PR(s) | Notes |
| --- | --- | --- | --- | --- |
| `U00` | Merged | — | `#8` | Merged to Mercora `main` as `ac4bd57` |
| `U01` | Merged | — | `#9` | Merged to Mercora `main` as `afa3723` |
| `U02` | Merged | — | `#10`, `#21` | `#10` missed `main`; recovery `#21` landed the reviewed commit on `main` as `7fa82a4` |
| `U03` | Merged | — | `#23`, `#32` | Runtime/config and deploy/migration safety landed via `#23`; `#32` completed review fixes |
| `U04 + U05` | Merged | — | `#35` | Security/catalog trust boundary merged to Mercora `main` as `f6a2cca` |
| `U07` | Merged | — | `#24` | Canonical Money migration landed on `main` as `243ebfd` after independent completion review |
| `U06 + U08` | Merged | — | `#39` | Merged to Mercora `main` as `7a020d3`; order authorization, authoritative pricing, durable pending orders, verified/idempotent payment finalization, and optional commerce capability seams |
| `U09` | Merged | — | `#40` | Merged to Mercora `main` as `26ff9c1`; durable webhook claims/effects, authoritative inventory, and refund reconciliation landed together |
| `U10 + U11` | Merged | — | `#41` | Merged to Mercora `main` as `0afa14a`; trusted credentials, scoped ownership, catalog-neutral MCP boundaries, and authoritative PaymentIntent checkout |
| `U12` | Merged | — | `#43` | Merged as `8f688fb`; server-rendered deterministic/AI-batch seam, public projection, bounded rebuild, safety guards, admin controls, and cron failure propagation |
| `U13 + U14` | Merged | — | `#42` | Merged to Mercora `main` as `339e54d`; core fulfillment and owned MCP shipment/history projection complete |
| `M01` | Merged | — | `#55` | Merged to Mercora `main` as `6dd990d`; dependency/runtime/repository-hygiene closeout complete |
| `O01` | Merged | — | `#66` | Merged to Mercora `main` as `438a1cd`; customer accounts, provider-neutral communications, compliance/unsubscribe, and durable merchant notifications complete |
| `O02` | Merged | — | `#73` | Merged to Mercora `main` as `8894d1b`; secure CMS, neutral templates, Blog/admin publishing, R2 integration, RSS, dynamic sitemap/robots, and additive migration `0019` complete |
| `O03` | Merged | — | `#72` | Merged to Mercora `main` as `02b1bd2`; privacy-safe producer telemetry, provider-neutral Tail alerts, and sharded SQLite cooldown complete |
| `O04` | Merged | — | `#74` | Merged to Mercora `main` as `ff163b0`; request-scoped canonical facts, deterministic policy answers, guarded customer responses, typed Workers AI, and privacy-safe telemetry complete |
| `O05` | In progress | — | — | Branch `agent/o05-shopify-migration-toolkit` from `ff163b0`; redirect/media runtime and complete ETL/operator tooling, including Blog import |
| `O06` | Planned | — | — | Disabled-by-default subscriptions vertical slice |
| `O07` | Planned | — | — | Disabled-by-default gift cards and generic digital commerce |

## Immediate Next Planning Actions

1. Build `O05` from current Mercora `main`; keep all sub-agent work behind local
   parent review before pushing or opening a PR.
2. Keep `U12` on its safe deterministic default; its AI-batch strategy remains
   optional and falls back to the active catalog when precomputed rows are absent.
3. `O06` and `O07` are dependency-ready, but should proceed as separate
   worktrees and serialize their merges because both touch checkout, payments,
   webhooks, and refunds.
