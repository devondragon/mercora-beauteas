# PDP "Recommended for You" Redesign — Design Spec

- **Date:** 2026-07-09
- **Status:** Approved for planning (pending user review of this doc)
- **Author:** Devon Hillard (with Claude)
- **Related:** `components/ProductRecommendations.tsx`, `app/product/[slug]/page.tsx`, `app/api/agent-chat/route.ts`, `lib/utils/personalized-recommendations.ts`, `lib/mcp/tools/recommend.ts`

---

## 1. Problem

The PDP "Recommended for you" strip is **slow (several seconds)** and **frequently renders only 1–2 items instead of the 3 placeholders shown**. Both symptoms trace to a single architectural mismatch: the widget is powered by the conversational **Chai LLM chatbot** (`/api/agent-chat`), not a recommendations query.

Current flow (`components/ProductRecommendations.tsx`, client component):
1. Wait for Clerk user → fetch `/api/orders` (blocks; `useEnhancedUserContext`).
2. **500 ms artificial debounce.**
3. `POST /api/agent-chat` with a natural-language prompt ("recommend 3 similar…").
4. That endpoint runs the full chatbot pipeline **on the request's critical path**: BGE embedding → Vectorize query (`topK:7`, up to a 10 s timeout) → 20B-param LLM generation (`@cf/openai/gpt-oss-20b`) → **regex-parse `**bold names**` out of the prose** → string-match them back to vector snippets → D1 hydrate.

**Why slow:** the entire embed → vectorize → 20B-LLM → D1 chain runs client-side, serially, after hydration, with no server prefetch and no caching.

**Why 1–2 items:** the count is *emergent*, not enforced. The `agent-chat` system prompt instructs the model to "BE HIGHLY SELECTIVE… recommend only 1–4… better to recommend 1 perfect product." The returned set is only the bolded names that substring-match one of the top-7 vector snippets, deduped — and if none map, it returns empty. The client's `.slice(0, 3)` only caps the maximum; **nothing tops it up to 3.** Caching would not fix this — it would cache a broken result faster.

Two deterministic recommendation paths already exist in the repo but are **unused by the PDP**:
- `lib/utils/personalized-recommendations.ts` → `getPersonalizedRecommendations()` (scores by shared tags/category/price/purchase history). Imported into the PDP component but never called.
- `lib/mcp/tools/recommend.ts` → `getRelatedProductRecommendations()` (same-category products), used only by the external MCP agent path.

## 2. Goals / Non-Goals

**Goals**
- Recommendations render **with the page** (server-side) — no spinner, no debounce, no client fetch on the critical path.
- **Always return exactly `limit` products** when the catalog allows (kills the "1–2 items" bug by enforcing count, not hoping for it).
- A **provider seam** so the recommendation strategy is swappable via config without touching the PDP.
- Ship a **deterministic** provider (default) and an **AI-batch** provider (precomputed, never a live LLM at request time).
- **Per-user personalization** for logged-in users, computed live and cheaply (no per-user precompute).
- An **admin config switch** (`admin_settings`) selecting the active strategy, plus admin-triggered + scheduled (cron) rebuild of the AI-batch data.

**Non-Goals**
- No live LLM calls on the PDP request path — ever.
- No per-user batch precompute (users×products matrix). Personalization is live.
- Not changing the conversational Chai drawer (`AgentDrawer.tsx` / `/api/agent-chat`) — that keeps its LLM approach, which is correct for chat.
- No new recommendation surfaces beyond the PDP in this pass (cart/home cross-sell is out of scope).

## 3. Architecture — the seam

One server-side entry point the PDP calls, ignorant of *how* recs are computed:

```ts
// lib/recommendations/index.ts
export async function getRecommendationsForProduct(
  product: Product,
  opts: { userContext?: RecsUserContext; limit?: number } = {}
): Promise<Product[]>
```

Responsibilities of the seam (in order):
1. Read `admin_settings` (`recommendations` category) → active **strategy**, `personalize` flag, `limit` (default 3).
2. Ask the selected **base provider** for a ranked base list (fetch a buffer > `limit`), excluding the current product.
3. Apply the **personalization blend** (live) when `personalize` is on and the user has order history.
4. Apply **owned-product exclusion** (configurable, default on).
5. **Top-up guarantee**: if the list is short, backfill from the base list / active catalog until it reaches `limit` (or the catalog is exhausted).
6. Dedupe by product id; slice to `limit`.

**Provider interface** (both implement it):
```ts
// lib/recommendations/providers/types.ts
export interface RecommendationProvider {
  getBaseRecommendations(product: Product, count: number): Promise<Product[]>;
}
```

| Strategy (`recommendations.strategy`) | Provider | Compute | Latency at request time |
|---|---|---|---|
| `deterministic` (default) | `DeterministicProvider` | `getPersonalizedRecommendations()` over the active catalog, scored by shared tags/category/price | in-memory scoring, ~O(catalog) |
| `ai_batch` | `AiBatchProvider` | reads precomputed `product_recommendations` rows; hydrates products from D1 | one indexed D1 read |

If `ai_batch` is selected but a source product has no precomputed rows (e.g. new product not yet rebuilt), the provider returns what it has and the seam's top-up backfills from the deterministic path. **The strip is never empty when the catalog has ≥1 other product.**

## 4. Components

### 4a. Deterministic provider — `lib/recommendations/providers/deterministic.ts`
Wraps the existing `getPersonalizedRecommendations(context, allProducts, count)`. Loads the active catalog via the products model (`listProducts({ status: ['active'] })`, which hydrates variants). Returns the top `count` by score, excluding the source product. Price comparisons must route through the `Money` value object (`Money.fromStored(...)`) per `docs/money.md` — the existing util reads `variants[0].price?.amount` directly and should be aligned while we're in it.

### 4b. AI-batch provider — `lib/recommendations/providers/ai-batch.ts`
Reads `product_recommendations` for the source product id (ordered), hydrates the referenced products from D1, returns top `count`. No AI, no Vectorize call at request time — pure indexed lookup.

### 4c. Batch precompute job + rebuild endpoint
- **Method:** for each active product, embed its text with the current BGE model and query `env.VECTORIZE` for nearest neighbors (mirroring `app/api/agent-chat/route.ts` query usage), drop self, take top N (e.g. 10) product ids with scores. **Optional offline LLM curation pass** may reorder/annotate — but it runs *in the batch job*, never at request time. Results are written to `product_recommendations` (replace-per-source-product, transactionally via `db.batch()` — D1 has no `db.transaction()`).
- **Endpoint:** `POST /api/admin/recommendations/rebuild`, mirroring `app/api/admin/vectorize/route.ts` — `checkAdminPermissions(request)` guard, `getCloudflareContext`, returns a summary (products processed, rows written, duration). Admin UI gets a "Rebuild recommendations" button next to the existing vectorize rebuild.
- **Schedule (cron):** a Cloudflare Cron Trigger refreshes the data automatically (cadence TBD in planning, e.g. daily). **See Risk R1** — OpenNext does not expose a `scheduled()` handler for the Next worker; the recommended approach is a **small standalone cron Worker** (its own `wrangler` config) whose `scheduled()` handler authenticates with `ADMIN_VECTORIZE_TOKEN` and calls `POST /api/admin/recommendations/rebuild`. This keeps all heavy logic in the Next app and the cron trivial and OpenNext-agnostic.

### 4d. Personalization blend (live) — inside the seam
For `limit = 3`, a logged-in user with order history:
- Reserve **1 slot** for a "personalized pick": the top result of `getPersonalizedRecommendations(userContext, allProducts)` that is not owned, not the current product, and not already the base #1.
- Fill the remaining **2 slots** from the base provider's ranked list.
- Dedupe, exclude owned, top-up from base/catalog if short, slice to 3.
Logged-out users (or `personalize` off) get `limit` base recs. This is microseconds of in-memory scoring — no AI, no extra network beyond one orders read (4e).

### 4e. Server-side user context — `lib/recommendations/user-context.server.ts`
`useEnhancedUserContext` is a client hook that fetches `/api/orders`. For server rendering we need the equivalent server-side: given `userId` (already available in `page.tsx` via `auth()`), fetch the user's orders through the orders model directly (one D1 query) and derive the minimal fields the scorer uses: `orders`, `isVipCustomer`, `preferredPriceRange`, `recentPurchases`, owned product ids. Logged-out → no context (skip personalization).

### 4f. PDP wiring + component rewrite
- `app/product/[slug]/page.tsx`: add `getRecommendationsForProduct(product, { userContext, limit })` to the existing `Promise.all` block (build `userContext` server-side from `userId`). Pass the resolved `Product[]` down through `ProductDisplay` → `ProductRecommendations` as a prop.
- `components/ProductRecommendations.tsx`: **rewrite as presentational.** Remove `"use client"` fetch logic, `useEnhancedUserContext`, the 500 ms debounce, the `fetchAIRecommendations` call to `/api/agent-chat`, the loading skeleton (data is ready at render), and the stray `console.log`. It receives `recommendations: Product[]` + a title and renders the grid. The now-unused `getPersonalizedRecommendations` import is removed from the component (the util moves behind the provider). The Chai speech-bubble ("agentAnswer") is dropped from this strip — it was a side effect of the chat endpoint; the conversational voice stays in the Chai drawer.

### 4g. Config — `admin_settings` (category `recommendations`)
New default settings (seeded via migration, following `defaultSettings` shape in `lib/db/schema/settings.ts`):
- `recommendations.strategy` — `"deterministic"` | `"ai_batch"` (default `"deterministic"`).
- `recommendations.personalize` — boolean (default `true`).
- `recommendations.limit` — number (default `3`).
- `recommendations.exclude_owned` — boolean (default `true`).
Accessor: `getRecommendationSettings()` in `lib/utils/settings.ts` (mirrors `getAISettings()` etc.). Admin settings UI (`app/admin/settings/page.tsx` + `app/api/admin/settings/route.ts`) exposes strategy + toggles.

## 5. Data model — migration `0013_add_product_recommendations.sql`

New table (next free prefix is `0013`; `0011`/`0012` are taken — see CLAUDE.md migration notes). Hand-written SQL per the Wrangler-managed migration convention; add the matching Drizzle schema in `lib/db/schema/`.

```
product_recommendations
  source_product_id   INTEGER NOT NULL   -- the PDP product
  recommended_product_id INTEGER NOT NULL
  rank                INTEGER NOT NULL   -- 0-based order within source
  score               REAL               -- similarity/curation score (nullable)
  reason              TEXT               -- optional label (e.g. "similar")
  generated_at        TEXT DEFAULT CURRENT_TIMESTAMP
  PRIMARY KEY (source_product_id, recommended_product_id)
  INDEX (source_product_id, rank)
```
Rebuild replaces all rows for a given `source_product_id` atomically (`db.batch()`). Also insert the four `recommendations.*` default settings rows in this migration (or a paired data migration).

## 6. Data flow

**Logged-out PDP:** `page.tsx` → seam → base provider (deterministic or ai_batch) → top-up → 3 products → SSR. No client fetch.

**Logged-in PDP:** `page.tsx` (has `userId`) → build server user context (1 orders read) → seam → base provider + live personalized slot → exclude owned → 3 products → SSR.

**Batch:** cron Worker (or admin click) → `POST /api/admin/recommendations/rebuild` → for each product: Vectorize NN (+ optional LLM curate) → write `product_recommendations` via `db.batch()`.

## 7. Error handling & guarantees

- **Top-up guarantee** in the seam is the single enforcement point for count — every path funnels through it.
- Provider failure (e.g. `ai_batch` table empty, Vectorize error) degrades to the deterministic path via the same top-up backfill; the strip renders whatever the catalog supports, never a spinner-forever or a broken 1-item result.
- If the catalog genuinely has fewer than `limit` other products (today: ~2), the strip renders that many and the grid layout already adapts (1/2/3-up). This is correct, not a bug.
- Rebuild endpoint returns a structured summary and never partially corrupts state (per-product replace is atomic).

## 8. Testing

Per project CI (`ci.yml` gates lint + tsc + unit tests under `tests/unit/**` + build; `test:workers` and e2e are **not** in CI), make the gating tests **unit-style** so they actually block merges:
- **Seam logic** (`tests/unit/recommendations/seam.test.ts`): top-up guarantee always yields `limit` when catalog allows; owned-product exclusion; personalization reserves exactly one slot and only when order history exists; dedupe.
- **Deterministic provider**: scoring order for shared-tag / same-category / price-range cases; Money-typed price comparison.
- **AI-batch provider**: reads ordered rows; empty-table → seam backfills.
- **Settings accessor**: defaults when unset; strategy switch selects the right provider.
Provider/DB and endpoint integration tests can live under the workers pool (not CI-gating) for real-binding coverage. Manual verification: load a PDP logged-out and logged-in, confirm 3 items render server-side (view-source) with no `/api/agent-chat` request in the network tab.

## 9. Rollout

- Ship with `recommendations.strategy = deterministic` (safe default; fixes both bugs immediately, needs no batch data).
- Run the rebuild endpoint once, verify `product_recommendations` populated, then flip `strategy = ai_batch` in admin to A/B by eyeball.
- Cron enabled from launch (per decision), cadence set in planning.

## 10. Risks & open questions

- **R1 (infra, must validate in planning):** OpenNext-on-Cloudflare does not expose a Worker `scheduled()` handler for the Next app. Recommended mitigation: a **standalone cron Worker** in-repo that calls the admin rebuild endpoint with `ADMIN_VECTORIZE_TOKEN`. Confirm this vs. an OpenNext custom-worker override during planning. The admin endpoint itself is unaffected and ships regardless.
- **R2:** Server-side orders fetch adds one D1 query to logged-in PDP renders. Cheap (indexed by user), and `revalidate = 0` means the PDP is already dynamic — no caching regression. Acceptable.
- **R3:** Optional offline LLM curation in the batch job is gravy; if it complicates the first cut, ship Vectorize-NN only and add curation later behind the same table.
- **R4:** Catalog is tiny today (~3 products), so `ai_batch` and personalization have little to select from now. The seam makes them zero-cost to keep; value grows with the catalog post-cutover.

## 11. Files touched

**New**
- `lib/recommendations/index.ts` (seam)
- `lib/recommendations/providers/types.ts`
- `lib/recommendations/providers/deterministic.ts`
- `lib/recommendations/providers/ai-batch.ts`
- `lib/recommendations/user-context.server.ts`
- `lib/recommendations/batch/rebuild.ts` (shared job used by the endpoint)
- `app/api/admin/recommendations/rebuild/route.ts`
- `migrations/0013_add_product_recommendations.sql` + Drizzle schema file in `lib/db/schema/`
- Standalone cron Worker (dir + wrangler config) — pending R1
- `tests/unit/recommendations/*.test.ts`

**Modified**
- `app/product/[slug]/page.tsx` (fetch recs + server user context, pass down)
- `app/product/[slug]/ProductDisplay.tsx` (thread `recommendations` prop)
- `components/ProductRecommendations.tsx` (rewrite as presentational)
- `lib/utils/settings.ts` (`getRecommendationSettings()`)
- `lib/db/schema/settings.ts` (`defaultSettings` additions)
- `app/admin/settings/page.tsx` + `app/api/admin/settings/route.ts` (expose toggles)
- `lib/utils/personalized-recommendations.ts` (align price math to `Money`)

## 12. Out of scope
- Conversational Chai drawer changes.
- Cross-sell on cart/home/checkout.
- Per-user batch precompute.
- Renaming the `volt.svg` mascot asset (tracked separately).
