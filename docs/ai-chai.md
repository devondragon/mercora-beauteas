# Chai — AI Shopping Assistant

Current configuration and request path. ([`ai-pipeline.md`](ai-pipeline.md) is an older deep-dive on the anti-hallucination design; model names there predate the current config.)

```
User query → BGE embeddings → Vectorize search → context → text model → response + products
```

---

## Config (`lib/ai/config.ts`)

- **Text generation:** `@cf/openai/gpt-oss-20b` — temp 0.3, ~512 max tokens
- **Embeddings:** `@cf/baai/bge-base-en-v1.5` — **768 dimensions**

⚠️ The embedding dimension **must** match the Vectorize index dims (both indexes are 768-dim, cosine). A mismatch surfaces as opaque vector errors, not a clear failure.

## Chat route (`app/api/agent-chat/route.ts`)

**Public** — the storefront chat widget serves anonymous visitors. A Clerk `userId`, when present, is used only for personalization and as the rate-limit key.

Abuse containment: `AI_RATE_LIMITER` (20/60s), input-length caps, prompt-injection sanitization, and an admin gate on the content-generation mode (BMC-180 / BMC-139).

Context-aware inputs: user name, order history, geolocation, recent chat history.

## Indexing

`app/api/admin/vectorize` rebuilds the index from the `products` table plus knowledge markdown in R2, embedding both with BGE. Content source files live under `data/r2/products_md/` and `data/r2/knowledge_md/`.

⚠️ `data/r2/products_md/*.md` still carries placeholder outdoor-gear names — it is seed data the Shopify ETL replaces at cutover. See [`cutover-status.md`](cutover-status.md).

## PDP recommendations — a separate seam

"Recommended for you" does **not** go through Chai. `lib/recommendations/` (`getRecommendationsForProduct`) picks a `deterministic` or `ai_batch` provider via the `recommendations.strategy` admin setting, blends in live personalization from order history, and is called **server-side** on the product page.

`ai_batch` reads precomputed rows from the `product_recommendations` table (migration `0013`), rebuilt via an admin endpoint or the `workers/recommendations-cron/` scheduled Worker.

## Branding

The assistant's prompt and comments are rebranded to **Chai** (skincare-tea voice). Outdoor-gear copy lingering elsewhere is tracked in [`cutover-status.md`](cutover-status.md).
