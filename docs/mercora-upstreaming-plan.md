# Mercora Upstreaming Plan

**Status:** Active; dependency-security and Vitest PRs in review
**Created:** 2026-08-03  
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
| BeauTeas | `~/git/mercora-beauteas` | Production storefront, brand, content, catalog, and operations |

Current repository state when this plan was written:

- Mercora `main`: `ed04264` (`russellkmoore/mercora`)
- BeauTeas `main`: `1fa7c81` (`devondragon/mercora-beauteas`)
- Both working trees were clean and synchronized with their respective `origin/main` branches.
- The repositories have related source history but no shared Git commit ancestry because the upstream history was rewritten. Do not directly merge or rebase their `main` branches.

## Guiding Principles

1. Create all upstream contribution branches from the current Mercora `main`.
2. Treat BeauTeas commits as source material, not automatically as clean cherry-pick candidates.
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
individually. Research identified 15 coherent core contribution groups, several
of which must split for review, migration, or deployment safety. Plan on
approximately 18–24 actual core Mercora pull requests, followed by separately
approved optional feature trains.

Before beginning the feature sequence below, complete the dependency-security
follow-up from Phase 1 or explicitly document why any remaining production
finding does not block further upstream work.

### 4.1 Testing foundation

Add Vitest configuration and a small representative test set. Introduce Playwright only when the first meaningful browser workflow is ready.

Do not transfer all BeauTeas tests in one pull request. Tests should normally travel with the behavior they cover.

### 4.2 Admin mutation authorization

Protect product, category, and promotion mutations using these BeauTeas commits as source material:

- `7e30f60` — product mutation authorization
- `9ffaa06` — category mutation authorization
- `636b9d6` — promotion mutation authorization

Include focused regression tests for each route group.

### 4.3 Public product serialization

Use `0c0438d` as source material to:

- Return only active products from public endpoints.
- Remove internal cost, barcode, and inventory fields from public payloads.
- Establish a reusable public product serializer.

### 4.4 Order authorization and payment-state protection

Begin with `f55d1d6` and related BeauTeas work to:

- Require the customer owner or an administrator to read an order.
- Prevent clients from asserting server-owned payment state.
- Require server-side verification before marking orders paid.
- Protect server-owned order extension fields.

### 4.5 Web and content security

Port the reusable portions of:

- Safe production error responses
- Constant-time secret comparison
- Authorization-header token transport
- Upload MIME and magic-byte validation
- Stored-HTML sanitization
- CSP, HSTS, `nosniff`, and frame protections
- Public API rate limiting

Avoid publishing detailed exploit instructions before the corresponding fixes are ready to merge.

### 4.6 MCP hardening

Port and generalize:

- Session ownership enforcement
- Cryptographically secure identifiers
- Hashed API keys
- Permission scopes
- Header-only authentication
- Rate limiting
- Server-canonical product names, prices, and totals
- Order line-item limits

### 4.7 Commerce integrity

Port in dependency order:

- MACH-aligned Money value object
- Server-authoritative pricing, discounts, tax, and shipping
- Pending-order creation before payment completion
- Stripe payment verification
- Idempotent payment and webhook handling
- Refund ledger correctness and concurrency controls
- Race-safe inventory decrement and refund restocking

### 4.8 Framework extensibility

Generalize:

- Brand and theme configuration
- Merchant contact and sender configuration
- Environment-aware Cloudflare configuration
- Dynamic robots and metadata
- Image/CDN abstraction
- Database migration tooling
- Local development bootstrap
- Deployment safeguards

Mercora should retain neutral or Volt demo defaults. BeauTeas values should remain downstream.

### 4.9 Optional platform features

Port these only after their foundations have landed and Russell confirms the intended Mercora scope:

1. Customer accounts
2. Gift cards
3. Subscriptions
4. Blog and CMS enhancements
5. Shopify migration tooling
6. Observability
7. Fulfillment, order management, and shipping notifications

Each large feature may require its own multi-PR series.

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
