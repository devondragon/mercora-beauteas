# PDP "Recommended for You" Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the LLM-chatbot-driven PDP "Recommended for you" strip with a server-rendered provider seam (deterministic + AI-batch), live personalization, an admin config switch, and a precompute/rebuild job — fixing the slow load and the emergent 1–2-item count bug.

**Architecture:** A single server-side seam `getRecommendationsForProduct()` reads `admin_settings` to pick a base provider (`deterministic` default, or `ai_batch` reading a precomputed table), then a pure `blendRecommendations()` applies live per-user personalization, owned-product exclusion, and a **count top-up guarantee**. The PDP server component calls the seam and passes resolved products to a now-presentational `ProductRecommendations` component. A batch job (admin endpoint + standalone cron Worker) precomputes product→product similarity via Vectorize nearest-neighbor.

**Tech Stack:** Next.js 15 App Router (server components), Cloudflare Workers via OpenNext, D1 + Drizzle (runtime queries), Wrangler raw-SQL migrations, Cloudflare Vectorize + Workers AI (BGE embeddings), Vitest (unit tests), `Money` value object.

## Global Constraints

- **Product IDs are `TEXT`** (`id: text('id').primaryKey()` in `lib/db/schema/products.ts`). Vectorize `metadata.productId` is a string. All new columns referencing product ids are `TEXT`; compare ids with `String(...)` for safety.
- **Migrations are Wrangler-managed raw SQL**, not Drizzle-generated. Next free prefix is `0013` (`0011`, `0012` taken; two `0010`s exist — do not renumber). Hand-write `migrations/NNNN_*.sql`; add a matching Drizzle schema file for runtime queries.
- **D1 has no `db.transaction()`** — use `db.batch()` for atomic multi-statement writes.
- **Money:** never write raw `*100`/`/100`. Variant prices are stored Money; read via `Money.fromStored(variant.price ?? 0)`. See `docs/money.md`.
- **Tests that must gate CI go under `tests/unit/**`** (CI runs lint + tsc + `tests/unit/**` + build; `test:workers` and e2e are NOT in CI). Run with `npm test` (`vitest run`).
- **`@/*` path alias** maps to repo root.
- **Admin endpoints** guard with `checkAdminPermissions(request)` from `@/lib/auth/admin-middleware` and read bindings via `getCloudflareContext({ async: true })` from `@opennextjs/cloudflare`.
- **Run `npm run lint` before considering any task done.** No Prettier configured.
- **Copy/branding:** tea/skincare voice ("Chai"), never outdoor-gear terms.

---

## File Structure

**New files**
- `migrations/0013_add_product_recommendations.sql` — table + seed the 4 `recommendations.*` settings rows.
- `lib/db/schema/product-recommendations.ts` — Drizzle schema for the new table.
- `lib/recommendations/types.ts` — shared types (`RecsUserContext`, `ProviderContext`, `RecommendationProvider`, `RecommendationSettings`).
- `lib/recommendations/blend.ts` — pure `blendRecommendations()` (the top-up guarantee + personalization). Fully unit-tested.
- `lib/recommendations/providers/deterministic.ts` — deterministic provider.
- `lib/recommendations/providers/ai-batch.ts` — AI-batch provider + pure `hydrateBatchRecommendations()`.
- `lib/recommendations/providers/registry.ts` — maps strategy string → provider (default deterministic).
- `lib/recommendations/user-context.server.ts` — `buildServerUserContext(userId)`.
- `lib/recommendations/index.ts` — the seam `getRecommendationsForProduct()`.
- `lib/recommendations/batch/rebuild.ts` — `rebuildProductRecommendations()` batch job.
- `app/api/admin/recommendations/rebuild/route.ts` — admin POST endpoint.
- `workers/recommendations-cron/wrangler.jsonc` + `workers/recommendations-cron/src/index.ts` — standalone cron Worker (R1).
- `tests/unit/recommendations/blend.test.ts`
- `tests/unit/recommendations/deterministic.test.ts`
- `tests/unit/recommendations/ai-batch.test.ts`
- `tests/unit/recommendations/settings.test.ts`

**Modified files**
- `lib/db/schema/settings.ts` — add 4 `recommendations.*` defaults to `defaultSettings`.
- `lib/db/schema/index.ts` — re-export the new schema.
- `lib/utils/settings.ts` — add `getRecommendationSettings()`.
- `lib/utils/personalized-recommendations.ts` — accept minimal `RecsUserContext`; Money-safe price math.
- `app/product/[slug]/page.tsx` — fetch recs + server user context; pass down.
- `app/product/[slug]/ProductDisplay.tsx` — thread `recommendations` prop.
- `components/ProductRecommendations.tsx` — rewrite as presentational.
- `app/admin/settings/page.tsx` — expose strategy + toggles.

**Delivery milestone:** After **Task 8** the user-facing bug is fixed (server-rendered deterministic recs, always full). Tasks 9–11 add the AI-batch layer, admin toggle UI, and cron.

---

### Task 1: Database migration + Drizzle schema for `product_recommendations`

**Files:**
- Create: `migrations/0013_add_product_recommendations.sql`
- Create: `lib/db/schema/product-recommendations.ts`
- Modify: `lib/db/schema/index.ts`

**Interfaces:**
- Produces: table `product_recommendations(source_product_id TEXT, recommended_product_id TEXT, rank INTEGER, score REAL, reason TEXT, generated_at TEXT)`; Drizzle export `product_recommendations`.

- [ ] **Step 1: Write the migration SQL**

Create `migrations/0013_add_product_recommendations.sql`:

```sql
-- Migration: 0013_add_product_recommendations.sql
-- Description: Precomputed per-product recommendation lists (AI-batch provider)
--              + default admin settings for the recommendations feature.

CREATE TABLE IF NOT EXISTS product_recommendations (
  source_product_id TEXT NOT NULL,
  recommended_product_id TEXT NOT NULL,
  rank INTEGER NOT NULL,
  score REAL,
  reason TEXT,
  generated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (source_product_id, recommended_product_id)
);

CREATE INDEX IF NOT EXISTS idx_product_recommendations_source_rank
  ON product_recommendations (source_product_id, rank);

-- Seed recommendations.* settings into already-provisioned DBs
-- (fresh installs also get these via defaultSettings). INSERT OR IGNORE
-- keeps this safe to re-run and avoids clobbering an admin's later edits.
INSERT OR IGNORE INTO admin_settings (key, value, category, description, data_type) VALUES
  ('recommendations.strategy', '"deterministic"', 'recommendations', 'PDP recommendation source: deterministic or ai_batch', 'string'),
  ('recommendations.personalize', 'true', 'recommendations', 'Personalize one slot for logged-in customers with order history', 'boolean'),
  ('recommendations.limit', '3', 'recommendations', 'Number of products shown in the PDP recommendations strip', 'number'),
  ('recommendations.exclude_owned', 'true', 'recommendations', 'Hide products the customer already purchased', 'boolean');
```

- [ ] **Step 2: Write the Drizzle schema**

Create `lib/db/schema/product-recommendations.ts`:

```ts
// lib/db/schema/product-recommendations.ts - Precomputed recommendation lists

import { sqliteTable, text, integer, real, primaryKey } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const product_recommendations = sqliteTable(
  "product_recommendations",
  {
    source_product_id: text("source_product_id").notNull(),
    recommended_product_id: text("recommended_product_id").notNull(),
    rank: integer("rank").notNull(),
    score: real("score"),
    reason: text("reason"),
    generated_at: text("generated_at").default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.source_product_id, t.recommended_product_id] }),
  })
);
```

- [ ] **Step 3: Re-export from the schema barrel**

In `lib/db/schema/index.ts`, add alongside the other re-exports:

```ts
export * from "./product-recommendations";
```

- [ ] **Step 4: Apply the migration to local + remote dev**

Run:
```bash
npx wrangler d1 migrations apply beauteas-db-dev --local --env dev
npx wrangler d1 migrations apply beauteas-db-dev --remote --env dev
npx wrangler d1 migrations apply beauteas-db-dev --remote --env dev --preview
```
Expected: each reports `0013_add_product_recommendations.sql` applied. (Production is applied at cutover, not now.)

- [ ] **Step 5: Verify the table and seeded settings**

Run:
```bash
npx wrangler d1 execute beauteas-db-dev --remote --env dev --command "SELECT name FROM sqlite_master WHERE type='table' AND name='product_recommendations'"
npx wrangler d1 execute beauteas-db-dev --remote --env dev --command "SELECT key,value FROM admin_settings WHERE category='recommendations' ORDER BY key"
```
Expected: table listed; 4 rows (`recommendations.exclude_owned=true`, `recommendations.limit=3`, `recommendations.personalize=true`, `recommendations.strategy="deterministic"`).

- [ ] **Step 6: Commit**

```bash
git add migrations/0013_add_product_recommendations.sql lib/db/schema/product-recommendations.ts lib/db/schema/index.ts
git commit -m "feat(recommendations): add product_recommendations table + settings (0013)"
```

---

### Task 2: Recommendation settings — defaults + typed accessor

**Files:**
- Modify: `lib/db/schema/settings.ts` (append to `defaultSettings`)
- Modify: `lib/utils/settings.ts` (add `getRecommendationSettings`)
- Create: `lib/recommendations/types.ts`
- Test: `tests/unit/recommendations/settings.test.ts`

**Interfaces:**
- Produces: `RecommendationSettings { strategy: 'deterministic'|'ai_batch'; personalize: boolean; limit: number; excludeOwned: boolean }`; `getRecommendationSettings(): Promise<RecommendationSettings>`; `normalizeRecommendationSettings(raw: Record<string, any>): RecommendationSettings` (pure, for testing).

- [ ] **Step 1: Create the shared types file**

Create `lib/recommendations/types.ts`:

```ts
// lib/recommendations/types.ts - Shared recommendation types

import type { Product } from "@/lib/types";

export type RecommendationStrategy = "deterministic" | "ai_batch";

export interface RecommendationSettings {
  strategy: RecommendationStrategy;
  personalize: boolean;
  limit: number;
  excludeOwned: boolean;
}

/**
 * Minimal user context the scorer/blend actually reads. EnhancedUserContext
 * structurally satisfies this, so existing callers keep working.
 */
export interface RecsUserContext {
  orders: unknown[];
  isVipCustomer: boolean;
  preferredPriceRange: { min: number; max: number } | null;
  recentPurchases: string[]; // product ids
}

export interface ProviderContext {
  allProducts: Product[];
}

export interface RecommendationProvider {
  /** Ranked base recommendations for a product (may include the source; the seam filters it). */
  getBaseRecommendations(
    product: Product,
    count: number,
    ctx: ProviderContext
  ): Promise<Product[]>;
}
```

- [ ] **Step 2: Write the failing test for settings normalization**

Create `tests/unit/recommendations/settings.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { normalizeRecommendationSettings } from "@/lib/utils/settings";

describe("normalizeRecommendationSettings", () => {
  it("returns defaults when nothing is set", () => {
    expect(normalizeRecommendationSettings({})).toEqual({
      strategy: "deterministic",
      personalize: true,
      limit: 3,
      excludeOwned: true,
    });
  });

  it("reads stored values", () => {
    const raw = {
      "recommendations.strategy": "ai_batch",
      "recommendations.personalize": false,
      "recommendations.limit": 4,
      "recommendations.exclude_owned": false,
    };
    expect(normalizeRecommendationSettings(raw)).toEqual({
      strategy: "ai_batch",
      personalize: false,
      limit: 4,
      excludeOwned: false,
    });
  });

  it("falls back to deterministic for an unknown strategy", () => {
    expect(normalizeRecommendationSettings({ "recommendations.strategy": "bogus" }).strategy).toBe("deterministic");
  });

  it("clamps a non-positive or non-numeric limit to 3", () => {
    expect(normalizeRecommendationSettings({ "recommendations.limit": 0 }).limit).toBe(3);
    expect(normalizeRecommendationSettings({ "recommendations.limit": "x" }).limit).toBe(3);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- tests/unit/recommendations/settings.test.ts`
Expected: FAIL — `normalizeRecommendationSettings` is not exported.

- [ ] **Step 4: Implement accessor + normalizer**

In `lib/utils/settings.ts`, add the import at the top:

```ts
import type { RecommendationSettings, RecommendationStrategy } from "@/lib/recommendations/types";
```

Then append:

```ts
/**
 * Pure normalizer for recommendation settings — tolerates missing/invalid values.
 */
export function normalizeRecommendationSettings(raw: Record<string, any>): RecommendationSettings {
  const strategyRaw = raw["recommendations.strategy"];
  const strategy: RecommendationStrategy = strategyRaw === "ai_batch" ? "ai_batch" : "deterministic";

  const limitRaw = raw["recommendations.limit"];
  const limit = typeof limitRaw === "number" && limitRaw > 0 ? Math.floor(limitRaw) : 3;

  return {
    strategy,
    personalize: raw["recommendations.personalize"] !== false,
    limit,
    excludeOwned: raw["recommendations.exclude_owned"] !== false,
  };
}

/**
 * Get recommendation feature settings for the PDP recommendations strip.
 */
export async function getRecommendationSettings(): Promise<RecommendationSettings> {
  const settings = await getSettings("recommendations");
  return normalizeRecommendationSettings(settings);
}
```

- [ ] **Step 5: Add the defaults to the schema**

In `lib/db/schema/settings.ts`, append these objects to the `defaultSettings` array (before its closing `]`):

```ts
  // Recommendations (PDP "Recommended for you")
  {
    key: 'recommendations.strategy',
    value: JSON.stringify('deterministic'),
    category: 'recommendations',
    description: 'PDP recommendation source: deterministic or ai_batch',
    data_type: 'string'
  },
  {
    key: 'recommendations.personalize',
    value: JSON.stringify(true),
    category: 'recommendations',
    description: 'Personalize one slot for logged-in customers with order history',
    data_type: 'boolean'
  },
  {
    key: 'recommendations.limit',
    value: JSON.stringify(3),
    category: 'recommendations',
    description: 'Number of products shown in the PDP recommendations strip',
    data_type: 'number'
  },
  {
    key: 'recommendations.exclude_owned',
    value: JSON.stringify(true),
    category: 'recommendations',
    description: 'Hide products the customer already purchased',
    data_type: 'boolean'
  }
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm test -- tests/unit/recommendations/settings.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 7: Commit**

```bash
git add lib/recommendations/types.ts lib/utils/settings.ts lib/db/schema/settings.ts tests/unit/recommendations/settings.test.ts
git commit -m "feat(recommendations): settings accessor + defaults + shared types"
```

---

### Task 3: Deterministic provider (+ Money-safe, minimal-context scorer)

**Files:**
- Modify: `lib/utils/personalized-recommendations.ts` (loosen context type; Money-safe price math)
- Create: `lib/recommendations/providers/deterministic.ts`
- Create: `lib/recommendations/providers/registry.ts`
- Test: `tests/unit/recommendations/deterministic.test.ts`

**Interfaces:**
- Consumes: `getPersonalizedRecommendations(context, allProducts, max)` from `lib/utils/personalized-recommendations`; `RecommendationProvider`, `ProviderContext`, `RecsUserContext` from `lib/recommendations/types`.
- Produces: `deterministicProvider: RecommendationProvider`; `getProvider(strategy): RecommendationProvider` (registry, deterministic-only for now).

- [ ] **Step 1: Loosen the scorer's context type and make price math Money-safe**

In `lib/utils/personalized-recommendations.ts`:

Change the imports at the top from:
```ts
import type { Product, Order } from "@/lib/types";
import type { EnhancedUserContext } from "@/lib/hooks/useEnhancedUserContext";
```
to:
```ts
import type { Product, Order } from "@/lib/types";
import type { RecsUserContext } from "@/lib/recommendations/types";
import { Money } from "@/lib/money";
```

Change `RecommendationContext.userContext` and the two function signatures that reference `EnhancedUserContext` to use `RecsUserContext`:
```ts
export interface RecommendationContext {
  userContext: RecsUserContext;
  currentProducts: Product[];
  viewingProduct?: Product;
  category?: string;
}
```
and in `calculatePersonalizationScore(product, userContext, ...)` change the `userContext: EnhancedUserContext` param type to `userContext: RecsUserContext`, and in `explainRecommendation(...)` change `userContext: EnhancedUserContext` to `userContext: RecsUserContext`.

Replace the price reads inside `calculatePersonalizationScore` (the `preferredPriceRange` and VIP blocks) so prices route through `Money`:
```ts
  // Price range matching (Money-safe: variant price is stored Money in minor units)
  if (userContext.preferredPriceRange) {
    let productPrice: number | undefined;
    if (product.variants && product.variants.length > 0) {
      productPrice = Money.fromStored(product.variants[0].price ?? 0).toMinorUnits();
    } else if (product.extensions?.price) {
      productPrice = Money.fromStored(product.extensions.price as any).toMinorUnits();
    }
    const { min, max } = userContext.preferredPriceRange;
    if (typeof productPrice === "number") {
      if (productPrice >= min && productPrice <= max) {
        score += 2;
      } else if (productPrice > max) {
        score -= 1;
      }
    }
  }

  // VIP customer boost — recommend premium products ($50+ = 5000 minor units)
  if (userContext.isVipCustomer) {
    let price: number | undefined;
    if (product.variants && product.variants.length > 0) {
      price = Money.fromStored(product.variants[0].price ?? 0).toMinorUnits();
    } else if (product.extensions?.price) {
      price = Money.fromStored(product.extensions.price as any).toMinorUnits();
    }
    if (typeof price === "number" && price > 5000) {
      score += 1;
    }
  }
```
Also update the identical price read inside `explainRecommendation`:
```ts
  let price: number | undefined;
  if (product.variants && product.variants.length > 0) {
    price = Money.fromStored(product.variants[0].price ?? 0).toMinorUnits();
  } else if (product.extensions?.price) {
    price = Money.fromStored(product.extensions.price as any).toMinorUnits();
  }
```
(Leave `formatOrderHistoryForAI` and all other logic unchanged. Note: `Order` import stays — it's used by `formatOrderHistoryForAI`.)

- [ ] **Step 2: Write the failing test for the deterministic provider**

Create `tests/unit/recommendations/deterministic.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { deterministicProvider } from "@/lib/recommendations/providers/deterministic";
import type { Product } from "@/lib/types";

function makeProduct(id: string, tags: string[]): Product {
  return {
    id,
    name: `Product ${id}`,
    tags,
    variants: [],
  } as unknown as Product;
}

describe("deterministicProvider", () => {
  it("ranks products sharing tags with the source above unrelated ones", async () => {
    const source = makeProduct("A", ["calendula", "morning"]);
    const shared = makeProduct("B", ["calendula"]);
    const unrelated = makeProduct("C", ["unrelated"]);
    const ctx = { allProducts: [source, shared, unrelated] };

    const result = await deterministicProvider.getBaseRecommendations(source, 5, ctx);
    const ids = result.map((p) => p.id);

    expect(ids).not.toContain("A"); // scorer excludes the source
    expect(ids.indexOf("B")).toBeLessThan(ids.indexOf("C"));
  });

  it("returns at most `count` products", async () => {
    const source = makeProduct("A", ["x"]);
    const ctx = {
      allProducts: [source, makeProduct("B", ["x"]), makeProduct("C", ["x"]), makeProduct("D", ["x"])],
    };
    const result = await deterministicProvider.getBaseRecommendations(source, 2, ctx);
    expect(result.length).toBe(2);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- tests/unit/recommendations/deterministic.test.ts`
Expected: FAIL — module `deterministic` not found.

- [ ] **Step 4: Implement the deterministic provider**

Create `lib/recommendations/providers/deterministic.ts`:

```ts
// lib/recommendations/providers/deterministic.ts
// Base recommendations from tag/category/price scoring over the active catalog.

import type { Product } from "@/lib/types";
import type { ProviderContext, RecommendationProvider, RecsUserContext } from "@/lib/recommendations/types";
import { getPersonalizedRecommendations } from "@/lib/utils/personalized-recommendations";

// Neutral guest context: no orders → scoring reduces to tag/category/onSale.
const GUEST_CONTEXT: RecsUserContext = {
  orders: [],
  isVipCustomer: false,
  preferredPriceRange: null,
  recentPurchases: [],
};

export const deterministicProvider: RecommendationProvider = {
  async getBaseRecommendations(product: Product, count: number, ctx: ProviderContext): Promise<Product[]> {
    return getPersonalizedRecommendations(
      { userContext: GUEST_CONTEXT, currentProducts: [], viewingProduct: product },
      ctx.allProducts,
      count
    );
  },
};
```

- [ ] **Step 5: Implement the provider registry**

Create `lib/recommendations/providers/registry.ts`:

```ts
// lib/recommendations/providers/registry.ts

import type { RecommendationProvider, RecommendationStrategy } from "@/lib/recommendations/types";
import { deterministicProvider } from "./deterministic";

/**
 * Resolve a strategy to a provider. Unknown strategies fall back to
 * deterministic so the strip never breaks on a bad config value.
 * (ai_batch is registered in Task 9.)
 */
export function getProvider(strategy: RecommendationStrategy): RecommendationProvider {
  switch (strategy) {
    case "deterministic":
    default:
      return deterministicProvider;
  }
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test -- tests/unit/recommendations/deterministic.test.ts`
Expected: PASS (2 tests). Then `npm run lint` — expect no new errors.

- [ ] **Step 7: Commit**

```bash
git add lib/utils/personalized-recommendations.ts lib/recommendations/providers/deterministic.ts lib/recommendations/providers/registry.ts tests/unit/recommendations/deterministic.test.ts
git commit -m "feat(recommendations): deterministic provider + registry, Money-safe scorer"
```

---

### Task 4: Server-side user context builder

**Files:**
- Create: `lib/recommendations/user-context.server.ts`

**Interfaces:**
- Consumes: `getOrdersByUserId(userId)` from `@/lib/models/mach/orders`; `Order` from `@/lib/types`.
- Produces: `buildServerUserContext(userId: string | null | undefined): Promise<RecsUserContext | null>` — returns `null` for guests or on error.

*(No unit test: this is a thin DB adapter mirroring the derivations already unit-covered via the scorer. Verified manually in Task 8.)*

- [ ] **Step 1: Implement the builder**

Create `lib/recommendations/user-context.server.ts`:

```ts
// lib/recommendations/user-context.server.ts
// Server-side equivalent of the fields useEnhancedUserContext derives client-side,
// scoped to what the recommendation scorer/blend actually reads.

import type { Order } from "@/lib/types";
import type { RecsUserContext } from "@/lib/recommendations/types";
import { getOrdersByUserId } from "@/lib/models/mach/orders";

export async function buildServerUserContext(
  userId: string | null | undefined
): Promise<RecsUserContext | null> {
  if (!userId) return null;

  let orders: Order[] = [];
  try {
    orders = await getOrdersByUserId(userId);
  } catch (err) {
    console.error("buildServerUserContext: failed to load orders", err);
    return null;
  }
  if (!orders.length) {
    return { orders: [], isVipCustomer: false, preferredPriceRange: null, recentPurchases: [] };
  }

  const totalOrderValue = orders.reduce((sum, o) => sum + (o.total_amount?.amount || 0), 0);

  const threeMonthsAgo = new Date();
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
  const recentPurchases = orders
    .filter((o) => o.created_at && new Date(o.created_at) >= threeMonthsAgo)
    .flatMap((o) => (o.items || []).map((item) => String(item.product_id || item.id)))
    .slice(0, 10);

  const orderValues = orders.map((o) => o.total_amount?.amount || 0).filter((v) => v > 0);
  const preferredPriceRange =
    orderValues.length > 0 ? { min: Math.min(...orderValues), max: Math.max(...orderValues) } : null;

  return {
    orders,
    isVipCustomer: totalOrderValue > 1000, // matches useEnhancedUserContext ($1000+ minor-unit sum)
    preferredPriceRange,
    recentPurchases,
  };
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors from this file. (If `item.product_id`/`item.id` typing complains, they are already accessed this way in `lib/hooks/useEnhancedUserContext.ts` lines 133-135 — mirror that access.)

- [ ] **Step 3: Commit**

```bash
git add lib/recommendations/user-context.server.ts
git commit -m "feat(recommendations): server-side user context builder"
```

---

### Task 5: The blend — pure `blendRecommendations()` (top-up guarantee + personalization)

**Files:**
- Create: `lib/recommendations/blend.ts`
- Test: `tests/unit/recommendations/blend.test.ts`

**Interfaces:**
- Consumes: `getPersonalizedRecommendations` from `@/lib/utils/personalized-recommendations`; `Product` from `@/lib/types`; `RecsUserContext` from `@/lib/recommendations/types`.
- Produces:
  ```ts
  blendRecommendations(input: {
    product: Product;
    base: Product[];          // provider output (may contain source)
    allProducts: Product[];   // active catalog, for top-up + personalized pick
    userContext: RecsUserContext | null;
    limit: number;
    personalize: boolean;
    excludeOwned: boolean;
  }): Product[]
  ```

- [ ] **Step 1: Write the failing tests (the count guarantee is the headline)**

Create `tests/unit/recommendations/blend.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { blendRecommendations } from "@/lib/recommendations/blend";
import type { Product } from "@/lib/types";
import type { RecsUserContext } from "@/lib/recommendations/types";

function p(id: string, tags: string[] = []): Product {
  return { id, name: `P${id}`, tags, variants: [] } as unknown as Product;
}

const source = p("SRC", ["calendula"]);
const catalog = [source, p("A", ["calendula"]), p("B", ["calendula"]), p("C"), p("D"), p("E")];

describe("blendRecommendations", () => {
  it("always returns exactly `limit` when the catalog allows (top-up guarantee)", () => {
    // base is deliberately short (only one item) — must be topped up to 3
    const result = blendRecommendations({
      product: source,
      base: [p("A")],
      allProducts: catalog,
      userContext: null,
      limit: 3,
      personalize: false,
      excludeOwned: false,
    });
    expect(result.length).toBe(3);
    expect(result.map((x) => x.id)).not.toContain("SRC"); // never the source product
  });

  it("never exceeds `limit` and de-dupes", () => {
    const result = blendRecommendations({
      product: source,
      base: [p("A"), p("A"), p("B"), p("C")],
      allProducts: catalog,
      userContext: null,
      limit: 3,
      personalize: false,
      excludeOwned: false,
    });
    expect(result.length).toBe(3);
    expect(new Set(result.map((x) => x.id)).size).toBe(3);
  });

  it("returns fewer than `limit` only when the catalog is exhausted", () => {
    const tiny = [source, p("A")];
    const result = blendRecommendations({
      product: source,
      base: [p("A")],
      allProducts: tiny,
      userContext: null,
      limit: 3,
      personalize: false,
      excludeOwned: false,
    });
    expect(result.map((x) => x.id)).toEqual(["A"]);
  });

  it("excludes owned products when excludeOwned is on", () => {
    const ctx: RecsUserContext = {
      orders: [{}],
      isVipCustomer: false,
      preferredPriceRange: null,
      recentPurchases: ["A"],
    };
    const result = blendRecommendations({
      product: source,
      base: [p("A"), p("B"), p("C")],
      allProducts: catalog,
      userContext: ctx,
      limit: 3,
      personalize: false,
      excludeOwned: true,
    });
    expect(result.map((x) => x.id)).not.toContain("A");
    expect(result.length).toBe(3);
  });

  it("reserves exactly one personalized slot for a user with order history", () => {
    // User owns nothing; personalized scorer will favor tag matches ("calendula").
    const ctx: RecsUserContext = {
      orders: [{}],
      isVipCustomer: false,
      preferredPriceRange: null,
      recentPurchases: [],
    };
    const result = blendRecommendations({
      product: source,
      base: [p("C"), p("D"), p("E")], // base has NO tag matches
      allProducts: catalog,
      userContext: ctx,
      limit: 3,
      personalize: true,
      excludeOwned: false,
    });
    expect(result.length).toBe(3);
    // 2 base slots preserved + 1 personalized pick appended
    expect(result.slice(0, 2).map((x) => x.id)).toEqual(["C", "D"]);
    // personalized pick is a tag-match (A or B), not the 3rd base item (E)
    expect(["A", "B"]).toContain(result[2].id);
  });

  it("does not personalize a guest (no user context)", () => {
    const result = blendRecommendations({
      product: source,
      base: [p("C"), p("D"), p("E")],
      allProducts: catalog,
      userContext: null,
      limit: 3,
      personalize: true,
      excludeOwned: false,
    });
    expect(result.map((x) => x.id)).toEqual(["C", "D", "E"]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/unit/recommendations/blend.test.ts`
Expected: FAIL — module `blend` not found.

- [ ] **Step 3: Implement the pure blend**

Create `lib/recommendations/blend.ts`:

```ts
// lib/recommendations/blend.ts
// Pure blend: personalization slot + owned exclusion + count top-up guarantee.

import type { Product } from "@/lib/types";
import type { RecsUserContext } from "@/lib/recommendations/types";
import { getPersonalizedRecommendations } from "@/lib/utils/personalized-recommendations";

export interface BlendInput {
  product: Product;
  base: Product[];
  allProducts: Product[];
  userContext: RecsUserContext | null;
  limit: number;
  personalize: boolean;
  excludeOwned: boolean;
}

export function blendRecommendations(input: BlendInput): Product[] {
  const { product, base, allProducts, userContext, limit, personalize, excludeOwned } = input;

  const sourceId = String(product.id);
  const ownedIds = new Set(
    excludeOwned && userContext ? userContext.recentPurchases.map(String) : []
  );

  const isEligible = (pr: Product) => String(pr.id) !== sourceId && !ownedIds.has(String(pr.id));

  // De-dupe the base list, preserving order, dropping source + owned.
  const seen = new Set<string>();
  const cleanBase: Product[] = [];
  for (const pr of base) {
    const id = String(pr.id);
    if (!isEligible(pr) || seen.has(id)) continue;
    seen.add(id);
    cleanBase.push(pr);
  }

  let result: Product[];

  if (personalize && userContext && userContext.orders.length > 0) {
    // Reserve one slot for a purchase-history-aware pick.
    const personalized = getPersonalizedRecommendations(
      { userContext, currentProducts: [], viewingProduct: product },
      allProducts,
      limit + 5
    ).filter(isEligible);

    const baseTop = cleanBase.slice(0, Math.max(0, limit - 1));
    const baseTopIds = new Set(baseTop.map((pr) => String(pr.id)));
    const pick = personalized.find((pr) => !baseTopIds.has(String(pr.id)));

    result = pick ? [...baseTop, pick] : cleanBase.slice(0, limit);
  } else {
    result = cleanBase.slice(0, limit);
  }

  // Top-up guarantee: fill remaining slots from cleanBase, then the catalog.
  const have = new Set(result.map((pr) => String(pr.id)));
  const topUp = (candidates: Product[]) => {
    for (const pr of candidates) {
      if (result.length >= limit) break;
      const id = String(pr.id);
      if (!isEligible(pr) || have.has(id)) continue;
      have.add(id);
      result.push(pr);
    }
  };
  topUp(cleanBase);
  topUp(allProducts);

  return result.slice(0, limit);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/unit/recommendations/blend.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/recommendations/blend.ts tests/unit/recommendations/blend.test.ts
git commit -m "feat(recommendations): pure blend with count top-up guarantee + personalization slot"
```

---

### Task 6: The seam — `getRecommendationsForProduct()`

**Files:**
- Create: `lib/recommendations/index.ts`

**Interfaces:**
- Consumes: `getRecommendationSettings` (`@/lib/utils/settings`), `getProvider` (`./providers/registry`), `blendRecommendations` (`./blend`), `listProducts` (`@/lib/models/mach/products`), `RecsUserContext` (`./types`), `Product` (`@/lib/types`).
- Produces: `getRecommendationsForProduct(product: Product, opts?: { userContext?: RecsUserContext | null; limit?: number }): Promise<Product[]>`.

*(No new unit test file: the pure logic is covered by Task 5. This is the IO orchestration layer, verified end-to-end in Task 8.)*

- [ ] **Step 1: Implement the seam**

Create `lib/recommendations/index.ts`:

```ts
// lib/recommendations/index.ts - Public entry point for PDP recommendations.

import type { Product } from "@/lib/types";
import type { RecsUserContext } from "./types";
import { getRecommendationSettings } from "@/lib/utils/settings";
import { listProducts } from "@/lib/models/mach/products";
import { getProvider } from "./providers/registry";
import { blendRecommendations } from "./blend";

export async function getRecommendationsForProduct(
  product: Product,
  opts: { userContext?: RecsUserContext | null; limit?: number } = {}
): Promise<Product[]> {
  try {
    const settings = await getRecommendationSettings();
    const limit = opts.limit ?? settings.limit;
    const allProducts = await listProducts({ status: ["active"] });
    const provider = getProvider(settings.strategy);

    let base: Product[] = [];
    try {
      base = await provider.getBaseRecommendations(product, limit + 5, { allProducts });
    } catch (err) {
      console.error("getRecommendationsForProduct: provider failed, using catalog top-up", err);
      base = [];
    }

    return blendRecommendations({
      product,
      base,
      allProducts,
      userContext: opts.userContext ?? null,
      limit,
      personalize: settings.personalize,
      excludeOwned: settings.excludeOwned,
    });
  } catch (err) {
    console.error("getRecommendationsForProduct: failed", err);
    return [];
  }
}

export type { RecsUserContext } from "./types";
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add lib/recommendations/index.ts
git commit -m "feat(recommendations): seam getRecommendationsForProduct with provider + blend"
```

---

### Task 7: PDP wiring + presentational `ProductRecommendations` (delivers the fix)

**Files:**
- Modify: `app/product/[slug]/page.tsx`
- Modify: `app/product/[slug]/ProductDisplay.tsx`
- Modify: `components/ProductRecommendations.tsx` (full rewrite)

**Interfaces:**
- Consumes: `getRecommendationsForProduct` (`@/lib/recommendations`), `buildServerUserContext` (`@/lib/recommendations/user-context.server`).
- Produces: `ProductRecommendations` now takes `{ recommendations: Product[]; firstName?: string }`.

- [ ] **Step 1: Fetch recommendations server-side in the PDP**

In `app/product/[slug]/page.tsx`, add imports:
```ts
import { getRecommendationsForProduct } from "@/lib/recommendations";
import { buildServerUserContext } from "@/lib/recommendations/user-context.server";
```

Replace the existing `Promise.all` block (lines ~121-132) with one that also resolves recommendations. Because recommendations need the user context, build it first:
```ts
  const userContext = await buildServerUserContext(userId);

  const [reviews, reviewEligibility, subscriptionPlans, recommendations] = await Promise.all([
    getProductReviews({
      productId: product.id,
      status: ["published"],
      limit: 50,
    }),
    getProductReviewEligibility({
      productId: product.id,
      customerId: userId,
    }),
    listSubscriptionPlans(product.id),
    getRecommendationsForProduct(product, { userContext }),
  ]);
```

Then pass the resolved products into `ProductDisplay` (update the JSX near line 148):
```tsx
        <ProductDisplay
          product={product}
          reviews={reviews}
          reviewEligibility={reviewEligibility}
          subscriptionPlans={subscriptionPlans}
          recommendations={recommendations}
        />
```

- [ ] **Step 2: Thread the prop through `ProductDisplay`**

In `app/product/[slug]/ProductDisplay.tsx`:

Add `Product` is already imported. Extend `ProductDisplayProps` (starts line 58) with:
```ts
  recommendations: Product[];
```
Add `recommendations` to the destructured props of the component function (wherever `product, reviews, reviewEligibility, subscriptionPlans` are destructured).

Change the render site (line ~501) from:
```tsx
<ProductRecommendations product={product} />
```
to:
```tsx
<ProductRecommendations recommendations={recommendations} />
```

- [ ] **Step 3: Rewrite `ProductRecommendations` as presentational**

Replace the entire contents of `components/ProductRecommendations.tsx` with:

```tsx
/**
 * === Product Recommendations (presentational) ===
 *
 * Renders the server-resolved "Recommended for you" strip on the PDP.
 * Recommendations are computed server-side by lib/recommendations and passed
 * in as a prop — no client fetch, no loading state, no debounce.
 */

import ProductCard from "@/components/ProductCard";
import type { Product } from "@/lib/types";

export default function ProductRecommendations({
  recommendations,
  firstName,
}: {
  recommendations: Product[];
  firstName?: string;
}) {
  if (!recommendations || recommendations.length === 0) {
    return null;
  }

  const sectionTitle = `Recommended for ${firstName || "you"}`;
  const count = recommendations.length;
  const gridClass =
    count === 1
      ? "grid-cols-1 max-w-sm mx-auto"
      : count === 2
        ? "grid-cols-1 sm:grid-cols-2 max-w-2xl mx-auto"
        : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3";

  return (
    <div className="mt-20 text-center relative">
      <div className="border-t border-border-default w-full relative mb-10">
        <span className="text-primary-600 text-xl font-semibold bg-surface-dark px-4 absolute -top-4 left-1/2 transform -translate-x-1/2 font-serif">
          {sectionTitle}
        </span>
      </div>

      <div className={`grid gap-10 ${gridClass}`}>
        {recommendations.map((prod) => (
          <ProductCard key={prod.id} product={prod} />
        ))}
      </div>
    </div>
  );
}
```

*(This deletes the `"use client"` fetch, `useEnhancedUserContext`, the 500ms debounce, the `/api/agent-chat` call, the loading skeleton, the Chai speech-bubble, and the stray `console.log`.)*

- [ ] **Step 4: Optionally pass the first name**

`firstName` is optional and defaults to "you". To personalize the heading for signed-in users, in `page.tsx` you may read it from Clerk and pass it through `ProductDisplay` → `ProductRecommendations`. If skipping for now, the heading reads "Recommended for you". (Leave as default unless you also thread `firstName`; do not add a client hook.)

- [ ] **Step 5: Typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors. (If any other file imported `getPersonalizedRecommendations` from the component, it won't — the only consumer was this component.)

- [ ] **Step 6: Manual verification (the actual bug fix)**

Run: `npm run preview:dev` (Workers runtime — plain `npm run dev` 500s on D1 routes). Load a product page. Confirm:
- The "Recommended for you" strip renders **in the initial server HTML** (View Source shows product cards, not skeletons).
- Network tab shows **no `POST /api/agent-chat`** request from the PDP.
- The strip shows `min(3, catalog-1)` products — 3 when the catalog has ≥4 products; for today's ~3-product catalog it shows the other 2 (correct, not a bug).
- Logged in with order history: still fills the slots; owned products are excluded.

- [ ] **Step 7: Commit**

```bash
git add app/product/[slug]/page.tsx app/product/[slug]/ProductDisplay.tsx components/ProductRecommendations.tsx
git commit -m "feat(recommendations): server-render PDP strip; drop LLM-chatbot client fetch"
```

---

### Task 8: AI-batch provider (reads the precomputed table)

**Files:**
- Create: `lib/recommendations/providers/ai-batch.ts`
- Modify: `lib/recommendations/providers/registry.ts` (register `ai_batch`)
- Test: `tests/unit/recommendations/ai-batch.test.ts`

**Interfaces:**
- Consumes: `product_recommendations` (`@/lib/db/schema/product-recommendations`), `getDbAsync` (`@/lib/db`), `ProviderContext`, `RecommendationProvider`, `Product`.
- Produces: `aiBatchProvider: RecommendationProvider`; pure `hydrateBatchRecommendations(rows, allProducts, count)`.

- [ ] **Step 1: Write the failing test for the pure hydrator**

Create `tests/unit/recommendations/ai-batch.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { hydrateBatchRecommendations } from "@/lib/recommendations/providers/ai-batch";
import type { Product } from "@/lib/types";

function p(id: string): Product {
  return { id, name: `P${id}`, variants: [] } as unknown as Product;
}

describe("hydrateBatchRecommendations", () => {
  it("returns products in stored rank order, hydrated from the catalog", () => {
    const rows = [
      { recommended_product_id: "C", rank: 0 },
      { recommended_product_id: "A", rank: 1 },
      { recommended_product_id: "B", rank: 2 },
    ];
    const catalog = [p("A"), p("B"), p("C")];
    const result = hydrateBatchRecommendations(rows, catalog, 5);
    expect(result.map((x) => x.id)).toEqual(["C", "A", "B"]);
  });

  it("skips ids missing from the catalog and respects count", () => {
    const rows = [
      { recommended_product_id: "GONE", rank: 0 },
      { recommended_product_id: "A", rank: 1 },
      { recommended_product_id: "B", rank: 2 },
    ];
    const catalog = [p("A"), p("B")];
    const result = hydrateBatchRecommendations(rows, catalog, 1);
    expect(result.map((x) => x.id)).toEqual(["A"]);
  });

  it("returns empty when there are no rows", () => {
    expect(hydrateBatchRecommendations([], [p("A")], 3)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/recommendations/ai-batch.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the provider + pure hydrator**

Create `lib/recommendations/providers/ai-batch.ts`:

```ts
// lib/recommendations/providers/ai-batch.ts
// Reads precomputed product->product recommendations; hydrates from the catalog.

import type { Product } from "@/lib/types";
import type { ProviderContext, RecommendationProvider } from "@/lib/recommendations/types";
import { getDbAsync } from "@/lib/db";
import { product_recommendations } from "@/lib/db/schema/product-recommendations";
import { eq } from "drizzle-orm";

interface BatchRow {
  recommended_product_id: string;
  rank: number;
}

/** Pure: order rows by rank and hydrate from the in-memory catalog. */
export function hydrateBatchRecommendations(
  rows: BatchRow[],
  allProducts: Product[],
  count: number
): Product[] {
  const byId = new Map(allProducts.map((pr) => [String(pr.id), pr]));
  return [...rows]
    .sort((a, b) => a.rank - b.rank)
    .map((r) => byId.get(String(r.recommended_product_id)))
    .filter((pr): pr is Product => pr !== undefined)
    .slice(0, count);
}

export const aiBatchProvider: RecommendationProvider = {
  async getBaseRecommendations(product: Product, count: number, ctx: ProviderContext): Promise<Product[]> {
    const db = await getDbAsync();
    const rows = await db
      .select({
        recommended_product_id: product_recommendations.recommended_product_id,
        rank: product_recommendations.rank,
      })
      .from(product_recommendations)
      .where(eq(product_recommendations.source_product_id, String(product.id)));
    return hydrateBatchRecommendations(rows as BatchRow[], ctx.allProducts, count);
  },
};
```

- [ ] **Step 4: Register `ai_batch` in the registry**

In `lib/recommendations/providers/registry.ts`, add the import and case:
```ts
import { aiBatchProvider } from "./ai-batch";
```
```ts
    case "ai_batch":
      return aiBatchProvider;
```
(Place the `case "ai_batch"` above the `case "deterministic": default:` line.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- tests/unit/recommendations/ai-batch.test.ts`
Expected: PASS (3 tests). Then `npx tsc --noEmit`.

- [ ] **Step 6: Commit**

```bash
git add lib/recommendations/providers/ai-batch.ts lib/recommendations/providers/registry.ts tests/unit/recommendations/ai-batch.test.ts
git commit -m "feat(recommendations): ai_batch provider reads precomputed table"
```

---

### Task 9: Batch precompute job + admin rebuild endpoint

**Files:**
- Create: `lib/recommendations/batch/rebuild.ts`
- Create: `app/api/admin/recommendations/rebuild/route.ts`

**Interfaces:**
- Consumes: `listProducts` (`@/lib/models/mach/products`), `getDbAsync` (`@/lib/db`), `product_recommendations` schema, `getCurrentEmbeddingModel` (`@/lib/ai/config`), `resolveLocalizedField` (`@/lib/seo/metadata`), `checkAdminPermissions` (`@/lib/auth/admin-middleware`), `getCloudflareContext`.
- Produces: `rebuildProductRecommendations(env, opts?): Promise<{ productsProcessed: number; rowsWritten: number }>`.

*(Integration-tested against real bindings via `preview:dev`; the pure hydrator that consumes its output is unit-covered in Task 8. Vectorize/AI cannot be meaningfully unit-mocked in `tests/unit`.)*

- [ ] **Step 1: Implement the batch job**

Create `lib/recommendations/batch/rebuild.ts`:

```ts
// lib/recommendations/batch/rebuild.ts
// Precompute per-product recommendations via Vectorize nearest-neighbor.

import { listProducts } from "@/lib/models/mach/products";
import { getDbAsync } from "@/lib/db";
import { product_recommendations } from "@/lib/db/schema/product-recommendations";
import { getCurrentEmbeddingModel } from "@/lib/ai/config";
import { resolveLocalizedField } from "@/lib/seo/metadata";
import { eq } from "drizzle-orm";

const NEIGHBORS_PER_PRODUCT = 10;

/** Build the text we embed to find similar products. */
function productText(product: any): string {
  const name = resolveLocalizedField(product.name) || "";
  const description = resolveLocalizedField(product.description) || "";
  const tags = Array.isArray(product.tags) ? product.tags.join(", ") : "";
  return [name, description, tags].filter(Boolean).join(". ");
}

export async function rebuildProductRecommendations(
  env: any,
  opts: { neighbors?: number } = {}
): Promise<{ productsProcessed: number; rowsWritten: number }> {
  const ai = env.AI;
  const vectorize = env.VECTORIZE;
  if (!ai || !vectorize) {
    throw new Error("Missing AI or VECTORIZE binding");
  }

  const neighbors = opts.neighbors ?? NEIGHBORS_PER_PRODUCT;
  const products = await listProducts({ status: ["active"] });
  const db = await getDbAsync();

  let productsProcessed = 0;
  let rowsWritten = 0;

  for (const product of products) {
    const sourceId = String(product.id);

    // Embed the product's own text, then query nearest neighbors.
    const embedding = await ai.run(getCurrentEmbeddingModel(), { text: productText(product) });
    const results = await vectorize.query(embedding.data[0], {
      topK: neighbors + 5, // over-fetch; self + non-product snippets get filtered
      returnMetadata: true,
    });

    const seen = new Set<string>();
    const ranked: { id: string; score: number }[] = [];
    for (const match of results?.matches ?? []) {
      const pid = match.metadata?.productId;
      if (!pid || String(pid) === sourceId || seen.has(String(pid))) continue;
      seen.add(String(pid));
      ranked.push({ id: String(pid), score: typeof match.score === "number" ? match.score : 0 });
      if (ranked.length >= neighbors) break;
    }

    // Replace this source product's rows atomically (D1 has no transaction()).
    const statements: any[] = [
      db.delete(product_recommendations).where(eq(product_recommendations.source_product_id, sourceId)),
    ];
    ranked.forEach((r, rank) => {
      statements.push(
        db.insert(product_recommendations).values({
          source_product_id: sourceId,
          recommended_product_id: r.id,
          rank,
          score: r.score,
          reason: "vector_similarity",
        })
      );
    });
    if (statements.length > 0) {
      // db.batch requires a non-empty tuple.
      await db.batch(statements as [any, ...any[]]);
    }

    productsProcessed += 1;
    rowsWritten += ranked.length;
  }

  return { productsProcessed, rowsWritten };
}
```

- [ ] **Step 2: Implement the admin endpoint (mirrors `/api/admin/vectorize`)**

Create `app/api/admin/recommendations/rebuild/route.ts`:

```ts
/**
 * === Recommendations Rebuild API ===
 * Precomputes per-product recommendation lists (AI-batch provider) from the
 * Vectorize index. Admin-authenticated. Mirrors /api/admin/vectorize.
 *
 * POST /api/admin/recommendations/rebuild
 *   Auth: Authorization: Bearer <token> | X-API-Key: <token> | Clerk admin session
 */

import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { checkAdminPermissions } from "@/lib/auth/admin-middleware";
import { rebuildProductRecommendations } from "@/lib/recommendations/batch/rebuild";

export async function POST(request: NextRequest) {
  try {
    const authResult = await checkAdminPermissions(request);
    if (!authResult.success) {
      return NextResponse.json(
        { error: authResult.error || "Admin access required" },
        { status: 401 }
      );
    }

    const { env } = await getCloudflareContext({ async: true });
    const startTime = Date.now();
    const summary = await rebuildProductRecommendations(env);

    return NextResponse.json({
      success: true,
      ...summary,
      durationMs: Date.now() - startTime,
    });
  } catch (error) {
    console.error("Recommendations rebuild error:", error);
    return NextResponse.json(
      { error: "Failed to rebuild recommendations", detail: String(error) },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 3: Typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 4: Manual verification against remote dev**

With `npm run preview:dev` running (or against deployed dev), call the endpoint with an admin token:
```bash
curl -X POST -H "X-API-Key: $ADMIN_VECTORIZE_TOKEN" http://localhost:8788/api/admin/recommendations/rebuild
```
Expected: JSON `{ success: true, productsProcessed: N, rowsWritten: M, durationMs: ... }`. Then confirm rows landed:
```bash
npx wrangler d1 execute beauteas-db-dev --remote --env dev --command "SELECT source_product_id, recommended_product_id, rank FROM product_recommendations ORDER BY source_product_id, rank LIMIT 20"
```
Expected: ranked rows per source product. Flip `recommendations.strategy` to `ai_batch` (Task 10 UI, or a direct SQL update) and reload a PDP — strip still fills via top-up.

- [ ] **Step 5: Commit**

```bash
git add lib/recommendations/batch/rebuild.ts app/api/admin/recommendations/rebuild/route.ts
git commit -m "feat(recommendations): batch precompute job + admin rebuild endpoint"
```

---

### Task 10: Admin settings UI — strategy + toggles

**Files:**
- Modify: `app/admin/settings/page.tsx`

**Interfaces:**
- Consumes: existing settings load/save flow (`GET`/`POST /api/admin/settings`, body `{ updates: [{ key, value, category, data_type }] }`).

*(No unit test: admin UI wiring. Verified manually. Follow the existing patterns in this file for a new "Recommendations" settings card — a `<select>` for strategy and toggles for `personalize`/`exclude_owned`, plus a number input for `limit`. Read the file first and mirror how an existing category, e.g. `refund` or `store`, is rendered and saved.)*

- [ ] **Step 1: Read the existing settings page to learn its pattern**

Run: open `app/admin/settings/page.tsx`. Identify (a) how settings are loaded into state, (b) how a category section renders inputs, (c) how `handleSave`/the POST payload is shaped. Match it exactly.

- [ ] **Step 2: Add a "Recommendations" section**

Add a settings card that binds to keys `recommendations.strategy` (select: `deterministic` | `ai_batch`), `recommendations.personalize` (toggle), `recommendations.exclude_owned` (toggle), `recommendations.limit` (number). On save, include them in the `updates` array with `category: "recommendations"` and the correct `data_type` (`string`/`boolean`/`number`), exactly as sibling sections do. Add a "Rebuild recommendations" button that `POST`s to `/api/admin/recommendations/rebuild` and surfaces the returned summary (mirror any existing "rebuild"/action button, e.g. the vectorize trigger if present in the admin UI).

- [ ] **Step 3: Typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 4: Manual verification**

With `npm run preview:dev`, open `/admin/settings`, change strategy to `ai_batch`, save, confirm it persists (reload), and confirm a PDP reflects the change. Switch back to `deterministic`.

- [ ] **Step 5: Commit**

```bash
git add app/admin/settings/page.tsx
git commit -m "feat(recommendations): admin settings UI for strategy, toggles, rebuild"
```

---

### Task 11: Scheduled rebuild — standalone cron Worker (Risk R1)

**Files:**
- Create: `workers/recommendations-cron/wrangler.jsonc`
- Create: `workers/recommendations-cron/src/index.ts`

**Interfaces:**
- Consumes: the deployed `POST /api/admin/recommendations/rebuild` endpoint + `ADMIN_VECTORIZE_TOKEN`.

**Context / R1:** OpenNext-on-Cloudflare does not expose a Worker `scheduled()` handler for the Next app. This standalone Worker owns the cron trigger and calls the admin endpoint over HTTP. **Validate this approach at task start** — if the team prefers an OpenNext custom-worker override instead, adjust here; the admin endpoint (Task 9) is unaffected either way.

- [ ] **Step 1: Write the cron Worker config**

Create `workers/recommendations-cron/wrangler.jsonc`:

```jsonc
{
  "name": "beauteas-recommendations-cron",
  "main": "src/index.ts",
  "compatibility_date": "2026-06-25",
  "compatibility_flags": ["nodejs_compat"],
  "triggers": {
    // Daily at 08:00 UTC. Adjust cadence as the catalog's change rate warrants.
    "crons": ["0 8 * * *"]
  },
  "vars": {
    // Set REBUILD_URL per environment at deploy time.
    "REBUILD_URL": "https://beauteas.com/api/admin/recommendations/rebuild"
  }
  // ADMIN_TOKEN is a secret: `wrangler secret put ADMIN_TOKEN` in this dir.
}
```

- [ ] **Step 2: Write the scheduled handler**

Create `workers/recommendations-cron/src/index.ts`:

```ts
// Standalone cron Worker: triggers the recommendations rebuild on a schedule.
// Deployed separately from the OpenNext app: `wrangler deploy` in this directory.

export interface Env {
  REBUILD_URL: string;
  ADMIN_TOKEN: string;
}

export default {
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      (async () => {
        try {
          const res = await fetch(env.REBUILD_URL, {
            method: "POST",
            headers: { "X-API-Key": env.ADMIN_TOKEN },
          });
          const body = await res.text();
          console.log(`recommendations rebuild: ${res.status} ${body}`);
        } catch (err) {
          console.error("recommendations cron failed", err);
        }
      })()
    );
  },
};
```

- [ ] **Step 3: Deploy the cron Worker to dev and set its secret**

Run (from `workers/recommendations-cron/`):
```bash
npx wrangler secret put ADMIN_TOKEN
npx wrangler deploy
```
Expected: deploy succeeds and reports the cron trigger `0 8 * * *` registered. (Set `REBUILD_URL` to the dev host for the dev deploy.)

- [ ] **Step 4: Manually trigger to verify wiring**

Run:
```bash
npx wrangler dev --test-scheduled
# in another shell:
curl "http://localhost:8787/__scheduled?cron=0+8+*+*+*"
```
Expected: the Worker logs a `recommendations rebuild: 200 ...` line and rows update in D1.

- [ ] **Step 5: Commit**

```bash
git add workers/recommendations-cron/wrangler.jsonc workers/recommendations-cron/src/index.ts
git commit -m "feat(recommendations): standalone cron Worker for scheduled rebuild (R1)"
```

---

### Task 12: Full-suite verification + CLAUDE.md note

**Files:**
- Modify: `CLAUDE.md` (migrations table + a recommendations line)

- [ ] **Step 1: Run the full unit suite + lint + typecheck + build**

Run:
```bash
npm test
npm run lint
npx tsc --noEmit
npm run build
```
Expected: all pass. Unit tests include the 4 new `tests/unit/recommendations/*` files.

- [ ] **Step 2: Update CLAUDE.md**

Add `0013_add_product_recommendations.sql` to the migrations table (row: "product_recommendations (precomputed AI-batch recs) + recommendations.* admin settings") and update the "next new migration should be `0014_*`" note. Add a short line under the AI System / project structure noting `lib/recommendations/` is the PDP recommendation seam (deterministic + ai_batch providers) and that the PDP strip is server-rendered (no longer `/api/agent-chat`).

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: note recommendations seam + 0013 migration in CLAUDE.md"
```

---

## Self-Review

**Spec coverage:**
- §3 seam → Task 6. §4a deterministic → Task 3. §4b ai_batch → Task 8. §4c batch job + endpoint + cron → Tasks 9, 11. §4d personalization blend → Task 5. §4e server user context → Task 4. §4f PDP wiring + component rewrite → Task 7. §4g config → Task 2 (accessor/defaults) + Task 10 (UI). §5 data model → Task 1. §7 top-up guarantee/fallback → Task 5 (+ seam error handling Task 6). §8 unit tests under `tests/unit/**` → Tasks 2, 3, 5, 8. §10 R1 → Task 11. All spec sections map to a task.
- **Money (Global Constraint):** Task 3 routes scorer price math through `Money`.
- **Delivery milestone** (bug fixed after Task 7) is explicit.

**Placeholder scan:** No "TBD/TODO/handle edge cases" left. The pre-existing `// TODO` inside `useEnhancedUserContext` is not touched by this plan. Cron cadence is a concrete value (`0 8 * * *`) with a note to tune. Admin UI (Task 10) intentionally instructs mirroring the existing pattern rather than pasting a guessed JSX tree — that file wasn't read in full; the step is explicit about reading it first.

**Type consistency:** `RecsUserContext` defined in Task 2, consumed identically in Tasks 3/4/5/6. `RecommendationProvider.getBaseRecommendations(product, count, ctx)` signature consistent across deterministic (Task 3) and ai_batch (Task 8) and called with the same arity in the seam (Task 6). `blendRecommendations` input shape matches its test (Task 5) and the seam call (Task 6). `getProvider(strategy)` defined Task 3, extended Task 8. Product ids treated as `TEXT`/string throughout.

**Known follow-ups (not blockers):** (a) `firstName` personalization of the heading is left optional in Task 7 to avoid reintroducing a client hook; (b) the price-range personalization compares a product price to order-total ranges — pre-existing semantics preserved, not "fixed", to stay in scope.
