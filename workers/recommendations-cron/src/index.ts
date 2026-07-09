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
