# Redirects & Environment Data

How Shopify URLs resolve onto Mercora routes, and how the seed data behind them is loaded.

---

## Environment data files

> **`migrations/data/*.sql` is environment data, NOT schema.** These files are deliberately **not** numbered `NNNN_*.sql` — Wrangler tracks migrations by filename, and re-running seed data on a fresh DB should be a deliberate act, not an automatic one. Apply them by hand with `d1 execute --file`. Every file uses `INSERT OR REPLACE` / `INSERT OR IGNORE` so it is re-runnable.

| File | Contents |
|---|---|
| `migrations/data/redirects.sql` | 51 Shopify→Mercora 301s in `redirect_map` |
| `migrations/data/blog-content.sql` | 21 blog posts + the `learn` blog category |

```bash
npx wrangler d1 execute beauteas-db     --env production --remote --file=migrations/data/redirects.sql
npx wrangler d1 execute beauteas-db-dev --env dev        --remote --file=migrations/data/redirects.sql
```

Loaded 2026-07-27: the `redirect_map` table was empty in both envs (the ETL never populated it). It now holds **51 rows** in prod *and* dev, and the Shopify `/blogs/learn` blog (**21 posts**, 44 images) has been migrated.

---

## How redirects resolve (`middleware.ts`)

1. For a path under `/products/`, `/collections/`, `/pages/`, `/blogs/`, or `/policies/`, look up an exact `source_path` in `redirect_map` → 301 to `target_path`.
2. No row → **structural fallback**, which exists only for the first three prefixes:
   `/products/:slug`→`/product/:slug` · `/collections/:slug`→`/category/:slug` · `/pages/:slug`→`/:slug`
3. `/blogs/` and `/policies/` are **exact-match only** — the fallback chain has no branch for them, so an unmatched path 404s honestly instead of being mangled (Shopify nests blogs as `/blogs/:blog/:slug`, and `/policies/*` slugs don't map positionally).

**Static redirects in `next.config.ts` run BEFORE middleware** (Next's order is headers → redirects → middleware → rewrites). `/about` → `/about-us` lives there because a bare `/about` matches none of the five `redirect_map` prefixes, so a row would never fire. A `/pages/about` request therefore chains: middleware structural fallback → `/about` → static redirect → `/about-us`.

## Adding rows

**Only add rows where the slug or shape actually CHANGED.** A row whose target equals what the fallback already produces is dead weight. At cutover every `/products/*` and `/collections/*` handle survived the ETL intact, so the 51 rows cover only: 21 nested `/collections/:c/products/:p` (the fallback would mangle these), 22 blog URLs, 5 `/policies/*`, and 3 legal pages deleted by migration `0016`.

## Blog images

Rehosted from Shopify's CDN into R2 under `blog/` in **both** buckets and referenced as absolute `https://img.beauteas.com/blog/<file>` URLs — the raw (non-`/cdn-cgi/image/`) path, so they survive Image Transformations being off. Because the URLs are absolute, the dev Worker also serves blog images from the **prod** bucket; the `beauteas-images-dev` copy is insurance, not what dev actually reads.

## Status codes

✅ **Soft-404s are fixed (PR #98).** `/nope`, `/product/nope`, `/category/nope` and `/blog/nope` return a real **404**, so status codes are trustworthy for redirect verification.

The root-`loading.tsx` trap that caused them is a standing prohibition — see `CLAUDE.md` and the note in code at `app/layout.tsx`.
