# Troubleshooting

| Issue | Check |
|---|---|
| Binding `undefined` in Worker | Binding name matches `wrangler.jsonc`; rerun `npm run cf-typegen` (but see the optional-binding caveat in [`cloudflare-environments.md`](cloudflare-environments.md)) |
| Build/deploy issues | Use the OpenNext path (`npm run deploy:dev` / `:production`), not bare `wrangler deploy` |
| Migration "table already exists" | DB schema applied outside Wrangler tracking — reconcile `d1_migrations`, don't re-run SQL |
| `no such column: shipping_carrier` on any order route | The env is missing migration `0022`. See the deploy-ordering blocker in [`database-migrations.md`](database-migrations.md) |
| `POST …/ship` or `PATCH …/tracking` failing outright | The env is missing migration `0023` (`order_events`) — the whole `db.batch()` fails |
| AI/vector errors | Vectorize index dims (768) match the BGE model; index populated via `/api/admin/vectorize` |
| Vectorize CLI `list` auth error | The current API token can `create`/`get` indexes but not `list` (code 10000) — not a deploy blocker |
| D1 routes 500 under `npm run dev` | Plain `next dev` has no Workers bindings — use `npm run preview:dev` |
| Secret set but not visible at runtime | The Workers runtime reads `.dev.vars` + `wrangler secret`, **not** `.env.local` |
| Migration silently rolled back | A `LIKE` guard over ~50 chars — D1 caps pattern length. See [`database-migrations.md`](database-migrations.md) |

## Handy commands

```bash
# List tables in a database
npx wrangler d1 execute beauteas-db-dev --remote --env dev \
  --command "SELECT name FROM sqlite_master WHERE type='table'"

# Live logs
npx wrangler tail --env dev

# Show pending migrations
npx wrangler d1 migrations list beauteas-db-dev --remote --env dev
```
