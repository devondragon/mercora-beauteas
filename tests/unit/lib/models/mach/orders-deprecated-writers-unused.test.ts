/**
 * BMC-230 bypass-surface guard — `updateOrderStatus`/`updateOrderShipping` in
 * lib/models/mach/orders.ts are marked `@deprecated ... DO NOT WIRE THIS INTO
 * ANY ROUTE`: they write status/tracking fields with no CAS guard, no server-
 * owned timestamps, and no audit event, bypassing everything BMC-216F/BMC-230
 * built (the fulfillment state machine in lib/fulfillment/service.ts, and the
 * PUT /api/orders allowlist). They are kept only until the BMC-216 rollout
 * completes (out of scope to delete here — see BMC-230's ticket text), so
 * nothing stops a future route/tool from re-importing one and silently
 * reopening exactly the bypass this ticket closed. A source scan is cheap
 * insurance: it can't verify RUNTIME behavior, but it fails loudly the moment
 * either symbol gains a non-test import site.
 *
 * Modeled on the existing single-<main>-landmark static scan
 * (tests/unit/app/single-main-landmark.test.ts).
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

const REPO_ROOT = join(__dirname, "../../../../..");
const SCAN_DIRS = ["app", "lib"];
const DEFINING_FILE = join(REPO_ROOT, "lib/models/mach/orders.ts");
const SOURCE_EXTENSIONS = [".ts", ".tsx"];

function sourceFilesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFilesUnder(full);
    return SOURCE_EXTENSIONS.some((ext) => entry.name.endsWith(ext)) ? [full] : [];
  });
}

const files = SCAN_DIRS.flatMap((dir) => sourceFilesUnder(join(REPO_ROOT, dir))).filter(
  (file) => file !== DEFINING_FILE
);

describe("updateOrderStatus / updateOrderShipping stay unwired (BMC-230)", () => {
  it("finds app/ and lib/ source files to scan", () => {
    // Guards against the scan silently passing because it walked nothing.
    expect(files.length).toBeGreaterThan(50);
  });

  it.each(["updateOrderStatus", "updateOrderShipping"])(
    "%s has no reference outside its own definition and test files",
    (symbol) => {
      const pattern = new RegExp(`\\b${symbol}\\b`);
      const offenders = files
        .filter((file) => !/\.(test|spec)\.tsx?$/.test(file))
        .filter((file) => pattern.test(readFileSync(file, "utf8")))
        .map((file) => relative(REPO_ROOT, file));

      expect(offenders).toEqual([]);
    }
  );
});
