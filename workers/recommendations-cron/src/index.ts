// Standalone cron Worker: triggers the recommendations rebuild on a schedule.
// Deployed separately from the OpenNext app: `wrangler deploy` in this directory.

export interface Env {
  REBUILD_URL: string;
  ADMIN_TOKEN: string;
}

interface RebuildSummary {
  success?: boolean;
  productsProcessed?: number;
  productsSkipped?: number;
  rowsWritten?: number;
  errors?: { productId: string; error: string }[];
  durationMs?: number;
  error?: string;
}

export default {
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      (async () => {
        let res: Response;
        try {
          res = await fetch(env.REBUILD_URL, {
            method: "POST",
            headers: { "X-API-Key": env.ADMIN_TOKEN },
          });
        } catch (err) {
          console.error("recommendations cron: request failed", err);
          return;
        }

        const body = await res.text();

        // A non-2xx response is a hard failure (auth, 500s, route down). Without
        // this check a rebuild could fail for weeks and still look like success.
        if (!res.ok) {
          console.error(`recommendations cron: rebuild failed HTTP ${res.status}: ${body}`);
          return;
        }

        let summary: RebuildSummary = {};
        try {
          summary = JSON.parse(body) as RebuildSummary;
        } catch {
          console.error(`recommendations cron: unparseable response (HTTP ${res.status}): ${body}`);
          return;
        }

        // Per-product failures are surfaced in `errors[]` even on a 200 — treat a
        // non-empty list as a failure so partial breakage is not silently ignored.
        const errorCount = summary.errors?.length ?? 0;
        if (errorCount > 0) {
          console.error(
            `recommendations cron: rebuild completed with ${errorCount} product error(s)`,
            summary.errors
          );
          return;
        }

        // Staleness guard: a run that writes nothing (all products skipped or an
        // empty catalog) means stored recs went un-refreshed this cycle — warn so
        // a persistently empty rebuild is visible before the data rots.
        if ((summary.rowsWritten ?? 0) === 0) {
          console.warn(
            `recommendations cron: rebuild wrote 0 rows (processed=${summary.productsProcessed ?? 0}, ` +
              `skipped=${summary.productsSkipped ?? 0}) — existing recommendations were preserved but not refreshed`
          );
          return;
        }

        console.log(
          `recommendations cron: ok — processed=${summary.productsProcessed ?? 0}, ` +
            `skipped=${summary.productsSkipped ?? 0}, rows=${summary.rowsWritten ?? 0}, ` +
            `durationMs=${summary.durationMs ?? "?"}`
        );
      })()
    );
  },
};
