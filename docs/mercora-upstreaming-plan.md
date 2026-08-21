# Mercora Upstreaming Plan

**Status:** Core `U00`-`U14`, `M01`, and `O01`-`O04` merged; all remaining optional-pass implementation is complete and awaiting serial review in Mercora PRs `#75` (`O05`), `#76` (`O06`), and `#79` (`O07`)
**Created:** 2026-08-03\
**Status refreshed:** 2026-08-21\
**Owners:** Russell K. Moore and Devon Hillard

See [mercora-upstreaming-inventory.md](mercora-upstreaming-inventory.md) for
the complete PR/commit ledger, dependency research, test assets, supersession
chains, and execution tracker.

## Objective

Move the reusable fixes, security improvements, extensibility work, and general e-commerce features developed for BeauTeas back into Mercora without upstreaming BeauTeas-specific branding, content, customer data, infrastructure identifiers, or production operations.

BeauTeas will remain a public downstream/reference implementation of Mercora. Mercora will be developed in its own clean clone, and accepted upstream commits will be selectively brought back into BeauTeas.

## Repository Layout

| Repository | Local path | Purpose |
| --- | --- | --- |
| Mercora | `~/git/mercora` | Clean upstream framework development and pull requests |
| BeauTeas | `~/git/mercora-beauteas` | Production storefront, brand, content, catalog, and operations; upstreaming status is tracked here on `main` |
| BeauTeas baseline | `~/git/mercora-beauteas-v1.0.0` | Read-only worktree detached at tag `v1.0.0`. **Read BeauTeas source here.** No install needed |
| BeauTeas sale | `~/git/mercora-beauteas-goob` | Going-out-of-business sale work on branch `goob`. Never a source for upstreaming |

Original repository state when this plan was written:

- Mercora `main`: `ed04264` (`russellkmoore/mercora`)
- BeauTeas `main`: `1fa7c81` (`devondragon/mercora-beauteas`)
- Both working trees were clean and synchronized with their respective `origin/main` branches.
- The repositories have related source history but no shared Git commit ancestry because the upstream history was rewritten. Do not directly merge or rebase their `main` branches.

The optional-pass research was refreshed on 2026-08-10 against Mercora
`153cbe0` and BeauTeas tag `v1.0.0` (`c9b135d`).

### BeauTeas Source Is Read at Tag `v1.0.0`

As of 2026-08-05, BeauTeas `main` is diverging into going-out-of-business sale
behavior — changed copy, restricted purchase rules, disabled subscriptions —
and the store winds down permanently afterward. Tag `v1.0.0` (`c9b135d`)
preserves the launch-ready state as it stood before that work began.

Read BeauTeas source at `v1.0.0`. Track upstreaming status on `main` — this
plan and the inventory are updated as each unit lands, so pinning them to the
tag would freeze the ledger. Platform fixes made after the tag are recorded in
the inventory's post-baseline table and reconstructed from `main`.

Rationale and the full decision: [`docs/superpowers/specs/2026-08-05-goob-baseline-preservation-design.md`](superpowers/specs/2026-08-05-goob-baseline-preservation-design.md).

## Guiding Principles

1. Create all upstream contribution branches from the current Mercora `main`.
2. Treat BeauTeas commits as source material, not automatically as clean cherry-pick candidates. Read BeauTeas source at tag `v1.0.0`, not `main`.
3. Keep every upstream pull request focused on one coherent capability or invariant.
4. Include focused tests, migrations, and generic documentation with the change they support.
5. Keep Mercora's default store neutral or retain the existing Volt/Mercora demo defaults.
6. Never merge or rebase `upstream/main` directly into BeauTeas `main` while the histories remain unrelated.
7. Prefer implementing new generic improvements upstream first, then adopting them in BeauTeas.
8. Keep secrets, customer data, and production credentials out of both repositories.

## Phase 1: Project Foundation

### 1.1 Create the foundation branch

```bash
cd ~/git/mercora
git switch main
git pull --ff-only
git switch -c agent/project-foundation
```

### 1.2 Repair upstream CI

The current Mercora CI invokes a missing `lint:boundaries` script and invokes Vitest and Playwright without the corresponding dependencies, configuration, or tests.

Replace it with a valid initial gate that runs:

1. `npm ci`
2. Lint
3. Type checking
4. Production build

Add a `typecheck` script to `package.json` so CI and local development use the same command.

The earlier BeauTeas commit `0a46b93` is useful source material for the initial working CI implementation, including its guard around `initOpenNextCloudflareForDev`.

### 1.3 Establish licensing and contribution policies

Use the MIT License because Mercora's README already declares MIT, it is simple and permissive, and it fits the JavaScript/Next.js ecosystem.

Add:

- A root `LICENSE` file using the exact [canonical MIT text](https://opensource.org/license/mit)
- `"license": "MIT"` in `package.json`
- A working README link to `LICENSE`
- `CONTRIBUTING.md`
- `SECURITY.md`

Recommended copyright line:

```text
Copyright (c) 2025-present Russell K. Moore and Mercora contributors
```

`CONTRIBUTING.md` should state that submitted contributions are licensed under the project's MIT License. A contributor license agreement is not currently necessary.

### 1.4 Repository governance

Russell should:

- Give Devon collaborator/write access to Mercora.
- Protect `main` from direct pushes.
- Require pull requests and passing CI.
- Prefer review by the other maintainer before merging.
- Enable private vulnerability reporting or document a private reporting channel in `SECURITY.md`.

### 1.5 Dependency security follow-up

During validation of the project-foundation pull request, `npm ci` reported 62
known vulnerabilities across the full dependency tree: 2 low, 35 moderate, 21
high, and 4 critical. These findings predate the foundation work and must be
handled in a dedicated follow-up rather than mixed into the CI and governance
change.

After the foundation pull request merges:

1. Create an `agent/dependency-security` branch from the latest Mercora `main`.
2. Capture both the complete audit and the production-only audit:

   ```bash
   npm audit
   npm audit --omit=dev
   ```

3. Classify every high or critical finding as:
   - Production runtime or development/build-only
   - Direct or transitive dependency
   - Fixable without a breaking upgrade
   - Requiring a breaking upgrade or application change
   - Not applicable to Mercora's actual execution path
4. Apply compatible upgrades first and verify lint, type checking, build, and
   relevant application behavior after each coherent upgrade group.
5. Do not run `npm audit fix --force` blindly. Review every major-version or
   dependency-tree change before accepting it.
6. Document any temporarily accepted finding with its package path, exposure
   analysis, compensating control, owner, and review date.
7. Enable Dependabot security updates and a reasonable scheduled dependency
   update cadence.
8. Once the production audit is clean or documented exceptions are enforced,
   add this CI gate:

   ```bash
   npm audit --omit=dev --audit-level=high
   ```

Keep broad dependency modernization separate from security remediation so the
security pull request remains reviewable and does not introduce unrelated
framework changes.

## Phase 2: Connect the Downstream Repository

Add Mercora as a fetch-only remote in BeauTeas:

```bash
cd ~/git/mercora-beauteas
git remote add upstream git@github.com:russellkmoore/mercora.git
git remote set-url --push upstream DISABLED
git fetch upstream
```

This remote is for inspecting upstream and fetching accepted commits. Do not set BeauTeas `main` to track `upstream/main`.

To adopt an accepted Mercora commit in BeauTeas:

```bash
cd ~/git/mercora-beauteas
git fetch upstream
git switch main
git pull --ff-only
git switch -c sync/mercora-<topic>
git cherry-pick <accepted-upstream-sha>
```

Resolve store-specific differences, run the appropriate BeauTeas verification suite, and merge through the normal BeauTeas pull-request process.

## Phase 3: Build the Contribution Inventory

Create a tracking inventory for the BeauTeas changes. Classify each merged BeauTeas pull request or coherent commit series as one of:

| Classification | Meaning |
| --- | --- |
| Directly upstreamable | Generic and can be ported with minimal adaptation |
| Generalize first | Valuable to Mercora but currently contains BeauTeas assumptions |
| BeauTeas-only | Brand, catalog, content, legal, deployment, or operational work |
| Superseded | Replaced by a later implementation and should not be ported independently |
| Dependency | Must land before one or more later contributions |

For every upstream candidate, record:

- BeauTeas PR and commit references
- Purpose and user-visible effect
- Affected modules
- Dependencies
- Required migrations
- Tests already available in BeauTeas
- BeauTeas-specific material that must be removed
- Proposed Mercora PR title and order
- Porting status

Use one Mercora tracking issue for the overall initiative and separate issues or checklist entries for accepted contribution groups.

## Phase 4: Contribution Sequence

Do not submit one giant pull request or replay all 122 BeauTeas pull requests
individually. Research identified 15 coherent core contribution groups, but
the consolidation review found that several form stronger, end-to-end review
units when combined. The core `U00`-`U14` pass is now complete: recommendations
landed through Mercora PR `#43`, fulfillment landed through PR `#42`, and PR
`#44` completed automatic migration deployment. The remaining candidates are
a second, optional platform pass rather than unfinished core work.

Before beginning the optional feature sequence, complete `M01`: refresh the
production dependency audit, remediate its findings or renew explicit owned
exceptions, and close the remaining global runtime/repository-hygiene defects.

| Remaining sequence | Consolidated scope | Inventory units | Prerequisites |
| ---: | --- | --- | --- |
| 1 | Runtime configuration and deployment safety (merged via `#23` and `#32`) | `U03` | Vitest recovery PR `#21` |
| 2 | Shared security and catalog trust boundary (merged via `#35`) | `U04 + U05` | `U03` |
| 3 | MACH Money boundary (merged via `#24`) | `U07` | PR `#10`; prepared in parallel with sequence 2 |
| 4 | Order trust and server-authoritative checkout (merged via `#39`) | `U06 + U08` | `U04 + U05`, `U07` |
| 5 | Webhook, inventory, and refund correctness (merged via `#40`) | `U09` | `U06 + U08` |
| 6 | MCP trust and commerce integrity (merged via `#41`) | `U10 + U11` | `U04 + U05`, `U07`, `U06 + U08` |
| 7 | Recommendations (merged PR `#43`) | `U12` | `U03`; independently deferrable |
| 8 | Fulfillment vertical slice (merged PR `#42`) | `U13 + U14` | `U03`, `U07`, `U06 + U08`, `U09`, merged `#41` |

### 4.1 Testing foundation

PR `#10` reviewed the Vitest configuration and representative test set but was
merged into a branch that had already landed. Recovery PR `#21` replays that
commit on current `main`. Introduce Playwright only when the first meaningful
browser workflow is ready.

Do not transfer all BeauTeas tests in one pull request. Tests should normally travel with the behavior they cover.

### 4.2 Runtime configuration and deployment safety (`U03`)

Deliver one PR with two reviewable commit groups:

1. Runtime-safe store configuration, theme primitives, and replacement of
   import-time environment assumptions.
2. Deployment and migration safety, including preview-safe behavior that
   cannot apply production migrations accidentally.

This establishes the configuration and schema-delivery boundary used by later
feature PRs. Mercora should retain neutral or Volt demo defaults; BeauTeas
values remain downstream.

### 4.3 Shared security and catalog trust boundary (`U04 + U05`)

Combine reusable security primitives with the first complete consumer of them:

- Shared admin and service-token authentication.
- Timing-safe comparisons and normalized production errors.
- Upload validation, randomized object keys, and rich-content sanitization.
- Security headers, CSRF/same-origin protection, and rate limiting.
- Catalog mutation authorization and validation.
- A public product serializer that excludes internal and admin-only fields.

Include focused route tests. Keep CMS-only JavaScript controls out if they
materially broaden review; those can travel with the optional CMS feature
train.

### 4.4 MACH Money boundary (`U07`)

Keep Money standalone because it changes a broad set of call sites and creates
an invariant shared by checkout, refunds, MCP, and fulfillment:

- Canonical currency-aware Money values.
- Explicit rounding and serialization rules.
- Mixed-currency rejection.
- Focused compatibility tests at storage and API boundaries.

### 4.5 Order trust and server-authoritative checkout (`U06 + U08`)

Present order authorization and checkout finalization as one end-to-end trust
boundary:

- Explicit order write allowlists and customer-to-order linkage.
- Owner-only order history and receipt access.
- Server-owned product, variant, discount, tax, and shipping calculations.
- Durable pending-order creation.
- Verified paid-order transitions and idempotent finalization.
- No-op framework defaults for optional commerce capabilities.

Inventory consumption, refund execution, and fulfillment remain out of this PR
so its transaction boundary stays reviewable.

### 4.6 Webhook, inventory, and refund correctness (`U09`)

Deliver the correctness mechanisms that follow checkout:

- Provider-neutral, persistent webhook deduplication.
- Independent subscribers instead of one monolithic webhook handler.
- One documented source of truth for inventory.
- Actual D1-compatible compare-and-swap inventory mutations.
- Idempotent refund state transitions with real D1 integration coverage.

### 4.7 MCP trust and commerce integrity (`U10 + U11`)

Combine MCP identity with the commerce tools that consume it:

- An expand/dual-read credential migration before plaintext contraction.
- Scoped, expiring API keys and secure verification.
- Middleware identity propagation, per-tool scopes, and ownership checks.
- Public serialization of MCP resources.
- Canonical Money, variant-aware pricing, server-authoritative totals, and
  verified payment state.
- HTTP-first authentication, authorization, and commerce integration tests.

Fulfillment tracking tools remain in the fulfillment vertical slice so this PR
does not invent a second shipment model.

### 4.8 Recommendations (`U12`)

Keep recommendations as a standalone PR because the capability is useful but
not required for the order-to-fulfillment path. It may be deferred without
blocking the remainder of the contribution train.

### 4.9 Fulfillment vertical slice (`U13 + U14`)

Submit fulfillment as one large but coherent feature PR, covering schema
through customer and admin surfaces. Review it in this dependency order:

1. Carrier, order-event, and timestamp migrations.
2. Domain types and the configurable carrier registry.
3. Shipment service, compare-and-swap transitions, and refund holds.
4. Guarded fulfillment APIs.
5. Authenticated customer and signed guest tracking.
6. The admin fulfillment queue.
7. Shipping email, retry, and idempotency behavior.
8. Owned MCP order status/tracking backed by configured shipment data and a
   bounded, customer-safe fulfillment event projection.
9. Real D1 integration tests, focused browser coverage, and operator docs.

Migration commits must precede code that uses their schema, timestamp writers
must ship with a repair path, and guest tracking must use signed access rather
than order identifiers alone. Keep unrelated email compliance work and general
UI polish outside this PR.

### 4.10 Optional platform pass

The nine optional inventory trains can be compressed into seven extraction
PRs, preceded by one maintenance PR. This is the minimum effective set: going
below seven would mix unrelated privacy, behavioral-security,
operator-tooling, or money-state-machine review surfaces. The two largest
commerce capabilities remain one PR each, following the same ordered,
vertical-slice approach used successfully for fulfillment.

| ID | Pull-request scope | Inventory coverage | Prerequisites | Schema |
| --- | --- | --- | --- | --- |
| `M01` | Dependency, runtime, and repository-hygiene closeout | Cross-cutting prerequisite | Core `U00`-`U14` | None expected |
| `O01` | Customer account and communications platform | Customer accounts; merchant email/compliance | `M01` | Email preferences/unsubscribes |
| `O02` | Content publishing and storefront correctness | Blog/CMS; feature-adjacent UI/runtime polish | `M01` | Blog tables; neutral CMS template registration |
| `O03` | Privacy-safe observability | Observability | `M01` | None expected; optional bindings only |
| `O04` | Canonical AI facts and guarded responses | AI canonical facts/response guard | `O03` | None expected |
| `O05` | Shopify migration toolkit | Redirect/media runtime and complete ETL/operator tooling, including Blog import | `O02` | Redirect map |
| `O06` | Subscriptions vertical slice | Subscriptions | `O01`, `O03`, core checkout/webhooks/fulfillment | Subscription tables and shipping address |
| `O07` | Gift cards and generic digital commerce | Gift cards | `O01`, `O03`, core checkout/webhooks/refunds | Gift-card account, ledger, reservation, and delivery state |

#### `M01`: dependency, runtime, and repository hygiene

Use three ordered commit groups so security/toolchain review remains distinct
from runtime and accessibility review:

1. Capture a fresh `npm audit --omit=dev` snapshot at branch cut. Enumerate
   every high/critical production path and either remediate it safely or record
   an owner, compensating control, and next-review date. Preserve the safe
   image-loader control if Next-bundled Sharp remains excepted; do not force a
   Next major without a deliberate compatibility decision.
2. Remove the custom `splitChunks` override that can serve CSS as JavaScript
   and verify the production chunk graph; add neutral route/root error
   boundaries; guarantee one `<main>`; remove the nested anchor from
   `ProductCard`; fix mobile-header overflow at 320/360/375 pixels; normalize
   CMS timestamps; and replace timer-driven persisted hydration with an
   event-driven contract.
3. Verify that no database dump/export is tracked and add neutral ignore rules
   preventing future dumps from entering Git.

#### `O01`: customer account and communications platform

Deliver the neutral account shell, lazy customer provisioning, owner-only
order history/detail, addresses, and customer settings before the email work
so account delivery never depends on an email provider. Then add configured
postal footers and policy links, signed unsubscribe preferences and
suppression, order-line image hydration, and an independently retryable durable
merchant-notification effect.

Address writes require ownership, same-origin enforcement, bounded validation,
and atomic default selection. Unsubscribe tokens require bounded expiry, a key
rotation policy, idempotent/replay-safe POST behavior, and suppression across
every eligible non-transactional sender; transactional mail remains explicitly
policy-defined. Account deletion/data export is deferred unless Russell adds it
to this PR's acceptance criteria.

#### `O02`: content publishing and storefront correctness

Combine the Blog and CMS trains because they share routing, sanitization,
uploads, templates, metadata, and sitemap behavior. Fix CMS control-flow and
soft-404 behavior first, then add generic structured page templates, Blog
schema/models, guarded admin editor/upload APIs, public listing/detail pages,
RSS, and a dynamic sitemap. Finish with only the responsive footer, cart,
admin-identity, and readability work that consumes these content/configuration
owners. No BeauTeas content, imagery, templates, or seeded posts travel with
the feature.

#### `O03`: privacy-safe observability

Add a stable non-PII event envelope, optional Analytics Engine metrics,
instrumentation over the current payment/webhook/refund/effect/fulfillment and
email paths, and a generic Tail Worker. Exact marker validation, redaction,
sampling/cardinality limits, bounded payload/CPU, cross-invocation cooldown,
operator authentication, secret/config validation, and fail-open behavior are
required. Tail or analytics outages must never break commerce. Redaction covers
headers, cookies, auth/payment data, customer/order identifiers, query strings,
and raw exceptions.

#### `O04`: canonical AI facts and guarded responses

Compute canonical facts from request-time configuration and answer deterministic
support, order-history, address, refund, and shipping questions before model
work. Use the current Money and shipping models, exact configured host/email
allowlists, and one customer-response builder for deterministic, ordinary model,
streaming, tool, fallback, and error paths. Test partial/malformed configuration,
locale/currency behavior, adversarial hosts/categories, and prompt injection.
`O03` is a deliberate release prerequisite so guard failures and replacements
are measurable without recording the rejected content.

#### `O05`: Shopify migration toolkit

Present redirects/media runtime and the ETL/operator tooling as one migration
feature. Include exact safe redirects, same-origin media, real Shopify Link
pagination, historical orders, schema-aligned catalog/customer/order/page/
review/Blog transforms, dry-run-by-default execution, explicit writes,
fail-fast dependency ordering, rerun/FK safety, importer-owned validation,
HTTPS/host allowlists, and neutral operator documentation. `O02` is a hard
dependency because this PR includes Blog import. Never track imported data,
ID maps, reports, logs, or environment-specific promotion state.

#### `O06`: subscriptions vertical slice

Ship subscriptions disabled by default in ordered schema, domain/service,
webhook/effect, guarded API, customer/admin, email, and test commits. Cover
cadence/variant/currency/Stripe price identity, SetupIntent ownership,
idempotent creation, pause/resume/cancel/change flows, cancellation timing,
payment failure/recovery, shipping, consent, fulfillment, and retry behavior.
Deduplicate and order-guard both `customer.subscription.*` and `invoice.*`,
enforce one renewal order per invoice, and never stage fulfillment before a
paid invoice is verified.

#### `O07`: gift cards and generic digital commerce

Ship gift cards disabled by default as one ordered vertical feature. Generate
high-entropy codes with a CSPRNG, normalize then keyed-hash them, and never log
or re-return plaintext outside issuance/delivery. Use an atomic conserved
ledger and server-owned reserve/release/consume transitions with expiry cleanup;
support digital-only and mixed carts, stable line identifiers, partial/mixed
refund restoration, durable issuance, and retryable delivery. Test currency
rules, authorization, enumeration resistance, balance/history ownership, and
guarded admin issuance. Do not seed a merchant gift-card product.

#### Optional-pass waves and merge rules

1. Land `M01` alone.
2. Develop `O01`, `O02`, and `O03` in parallel from updated `main`.
3. Develop `O04` after `O03`, and `O05` after `O02`.
4. Develop `O06` and `O07` after `O01` and `O03`.

`O06` and `O07` may be developed concurrently in separate worktrees, but they
overlap checkout, paid-order effects, refunds, and webhooks. Merge them
serially. Rebase the second onto the first and rerun the complete commerce
suite before review.

#### Current optional-pass review queue

As of 2026-08-21, implementation of every planned optional-pass extraction is
complete. The remaining work is review and serial integration, not another
feature phase:

1. Mercora PR `#75` (`O05`) targets `main`, is ready for review, and has green
   GitHub CI and Workers Builds.
2. Mercora PR `#76` (`O06`) is a draft stacked on `agent/o05-shopify-migration-toolkit`.
   After `#75` merges, retarget or rebase it onto current `main`, rerun its full
   validation matrix, and make it ready for final review.
3. Mercora PR `#79` (`O07`) is a draft stacked on `agent/o06-subscriptions`.
   After `#76` merges, retarget or rebase it onto the resulting `main`, rerun
   the complete commerce suite, and make it ready for final review.

All three PRs are currently merge-state clean and assigned to Russell. There
is no planned `O08`; define any further Mercora feature work as a new milestone
after this review queue closes.

Every large PR uses schema-first, independently reviewable commits. Migrations
are additive and forward-only, use numbers reserved from then-current Mercora
`main`, and are tested against a populated baseline. Old code must tolerate the
new tables; new code must tolerate capability-off and empty tables. Deploy
schema before code and roll back money features by disabling their capability,
never by down-migrating a ledger.

Every PR runs under Node 24 and must pass lockfile/install integrity, lint,
typecheck, unit tests, applicable Workers/D1 tests, production build, migration
safety for schema changes, and a scan for BeauTeas/Chai identifiers, content,
data, domains, and resource IDs.

## Upstream Pull-Request Workflow

Create every contribution from a fresh upstream branch:

```bash
cd ~/git/mercora
git switch main
git pull --ff-only
git switch -c devon/<topic>
```

For each contribution:

1. Inspect the relevant BeauTeas commits and their follow-up fixes.
2. Identify the final intended behavior rather than blindly replaying every intermediate change.
3. Apply or reconstruct the smallest coherent implementation in Mercora.
4. Remove BeauTeas domains, copy, assets, resource IDs, and assumptions.
5. Add focused tests and migrations.
6. Run lint, type checking, tests, and a production build.
7. Open a Mercora PR explaining the invariant, migration impact, and BeauTeas provenance.
8. Have the other maintainer review it.

After merge:

```bash
cd ~/git/mercora
git switch main
git pull --ff-only
git branch -d devon/<topic>
```

## Upstream/Downstream Decision Rule

Use this decision rule for future development:

| Change | Primary implementation location |
| --- | --- |
| Generic bug fix or security fix | Mercora first |
| Reusable commerce capability | Mercora first |
| Extension/configuration mechanism | Mercora first |
| BeauTeas brand value or visual asset | BeauTeas only |
| BeauTeas catalog or editorial content | BeauTeas only |
| BeauTeas deployment and cutover operation | BeauTeas only |
| Unclear or exploratory capability | Prototype in BeauTeas, then reconstruct generically in Mercora |

## Material That Must Stay in BeauTeas

Do not upstream:

- BeauTeas catalog and enrichment data
- Chai name, persona, knowledge, and artwork
- BeauTeas logos, photography, colors, fonts, and icons
- Tea-specific featured-product ordering
- Health claims, FDA language, and store-specific compliance copy
- BeauTeas legal-policy contents and business details
- Shopify-imported posts and redirect records
- Live domains, Cloudflare resource IDs, and environment identifiers
- Merchant email addresses and postal address
- Production cutover history and status
- BeauTeas `.planning` artifacts
- Secrets, customer records, database exports, or production logs

The reusable systems supporting these concerns may be upstreamed after configuration boundaries are introduced.

## Post-Baseline Platform Fixes

Genuine platform bugs fixed after tag `v1.0.0` (see "BeauTeas Source Is Read
at Tag `v1.0.0`" above). These are not in the tag and must be reconstructed
from `main`; see the inventory's own Post-Baseline Platform Fixes table
([mercora-upstreaming-inventory.md](mercora-upstreaming-inventory.md)) for
per-fix upstream tracking.

- `ba7557b` — `lib/config/commerce.ts`, `lib/services/order-pricing.ts`:
  archiving a product did not stop it selling. Status was never checked by
  the PDP or the server pricing path, so an archived product still rendered
  and was still purchasable by direct request.

## Future Convergence

Do not rewrite BeauTeas history during the initial upstreaming work.

After the major reusable work has landed in Mercora:

1. Preserve the current BeauTeas history using a permanent tag or `legacy-main` branch.
2. Create a new `beauteas-v2` branch from the improved Mercora `main`.
3. Reapply only BeauTeas configuration, content, assets, catalog, and deployment settings.
4. Run full local, development, and production verification.
5. Switch production only after the new branch is proven equivalent.
6. Consider making the converged branch the new BeauTeas `main`.

This optional convergence would restore shared Git ancestry and make future upstream merges substantially easier.

## Definition of Success

The initiative is successful when:

- Mercora has a valid license, contribution policy, security policy, and green CI.
- Mercora has no unaddressed high or critical production dependency findings;
  any temporary exception is documented, owned, and time-bounded.
- High-risk security and commerce-integrity fixes have landed upstream with tests.
- Mercora can be configured for a store without editing Volt-specific application logic.
- BeauTeas-specific content and infrastructure remain isolated downstream.
- New generic work is normally developed upstream first.
- Accepted Mercora changes can be adopted into BeauTeas through small, intentional sync branches.
- A future BeauTeas convergence onto Mercora becomes practical rather than requiring another large rewrite.
