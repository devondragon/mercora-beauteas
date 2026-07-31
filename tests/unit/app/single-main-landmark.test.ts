/**
 * BMC-220: exactly one <main> landmark, and it lives in the root layout.
 *
 * `app/layout.tsx` wraps every route in <main className="flex-1">. Eleven
 * routes rendered their own <main> inside it — `app/admin/reviews/page.tsx`
 * was nested three deep (page → admin layout → root layout). The HTML spec
 * forbids `main` as a descendant of `main`, and duplicate landmarks give
 * assistive tech two competing "main content" targets.
 *
 * This is a source scan rather than a render test because the offenders are
 * spread across server components that need Cloudflare bindings to render —
 * they can't be mounted in the unit suite, but the invariant is still cheap
 * to enforce statically, which is the only thing standing between this and a
 * silent reintroduction.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

const APP_DIR = join(__dirname, "../../../app");
const ROOT_LAYOUT = "layout.tsx";

function tsxFilesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return tsxFilesUnder(full);
    return entry.isFile() && entry.name.endsWith(".tsx") ? [full] : [];
  });
}

describe("single <main> landmark (BMC-220)", () => {
  const files = tsxFilesUnder(APP_DIR);

  it("finds app/ files to scan", () => {
    // Guards against the scan silently passing because it walked nothing.
    expect(files.length).toBeGreaterThan(10);
  });

  it("declares <main> only in the root layout", () => {
    const offenders = files
      .filter((file) => /<main\b/.test(readFileSync(file, "utf8")))
      .map((file) => relative(APP_DIR, file));

    expect(offenders).toEqual([ROOT_LAYOUT]);
  });
});
