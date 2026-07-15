/**
 * BMC-189 regression: the recommendations cron Worker must not silently swallow
 * failures. It surfaces (a) network errors, (b) non-2xx responses, (c) unparseable
 * bodies, (d) per-product errors, (e) zero-row runs, and (f) age-based staleness —
 * each as a console.error/warn — while only logging success on a clean run.
 *
 * Pure unit test: the handler depends only on global `fetch`, which we stub.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
// Relative import: the cron Worker lives outside the `@/` app root.
import worker from "../../../workers/recommendations-cron/src/index";

const ENV = { REBUILD_URL: "https://example.test/rebuild", ADMIN_TOKEN: "tok" };

/** Invoke scheduled() and await whatever it hands to ctx.waitUntil(). */
async function runScheduled(env: typeof ENV): Promise<void> {
  const tasks: Promise<unknown>[] = [];
  const ctx = {
    waitUntil: (p: Promise<unknown>) => {
      tasks.push(p);
    },
    passThroughOnException: () => {},
  };
  // Types on scheduled() are Cloudflare runtime globals; cast for the test.
  await (worker as any).scheduled({}, env, ctx);
  await Promise.all(tasks);
}

/** Build a Response-like object with the fields the handler reads. */
function response(status: number, body: string) {
  return { ok: status >= 200 && status < 300, status, text: () => Promise.resolve(body) };
}

let errorSpy: ReturnType<typeof vi.spyOn>;
let warnSpy: ReturnType<typeof vi.spyOn>;
let logSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("recommendations cron scheduled()", () => {
  it("logs an error when the request itself throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    await runScheduled(ENV);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(String(errorSpy.mock.calls[0][0])).toContain("request failed");
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("logs an error on a non-2xx response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(500, "boom")));
    await runScheduled(ENV);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(String(errorSpy.mock.calls[0][0])).toContain("HTTP 500");
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("logs an error on an unparseable 2xx body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(200, "not json")));
    await runScheduled(ENV);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(String(errorSpy.mock.calls[0][0])).toContain("unparseable");
  });

  it("logs an error when the summary reports per-product errors", async () => {
    const body = JSON.stringify({
      rowsWritten: 5,
      errors: [{ productId: "P1", error: "embed failed" }],
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(200, body)));
    await runScheduled(ENV);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(String(errorSpy.mock.calls[0][0])).toContain("1 product error");
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("warns when the rebuild wrote zero rows", async () => {
    const body = JSON.stringify({ rowsWritten: 0, productsProcessed: 0, productsSkipped: 3 });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(200, body)));
    await runScheduled(ENV);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0][0])).toContain("wrote 0 rows");
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("warns on age-based staleness even when fresh rows were written", async () => {
    const body = JSON.stringify({
      rowsWritten: 4,
      productsProcessed: 4,
      productsSkipped: 1,
      staleRowCount: 2,
      stalenessThresholdDays: 7,
      oldestGeneratedAt: "2020-01-01 00:00:00",
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(200, body)));
    await runScheduled(ENV);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0][0])).toContain("older than");
    // A stale-but-productive run still logs the success line.
    expect(logSpy).toHaveBeenCalledTimes(1);
  });

  it("logs success on a clean run with no warnings", async () => {
    const body = JSON.stringify({
      rowsWritten: 10,
      productsProcessed: 5,
      productsSkipped: 0,
      staleRowCount: 0,
      durationMs: 1234,
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(200, body)));
    await runScheduled(ENV);
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(String(logSpy.mock.calls[0][0])).toContain("ok");
  });
});
