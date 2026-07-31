/**
 * BMC-220 regression: nothing in next.config may attach a CSS chunk to the
 * client entrypoint.
 *
 * next.config.ts used to add `vendor` / `common` cacheGroups with
 * `{ test: /node_modules/, chunks: "all" }`. `chunks: "all"` sweeps up CSS
 * modules from dependencies as well as JS, so mini-css-extract emitted a
 * stylesheet belonging to the `main-app` entrypoint. Next then put it in
 * `rootMainFiles` (build-manifest-plugin `getEntrypointFiles` deliberately
 * keeps BOTH `.js` and `.css`), and app-render fed that list unfiltered to
 * `ReactDOM.preinit(src, { as: "script" })` (server/app-render/required-scripts).
 * The result was `<script src="/_next/static/css/*.css" async>` on every route
 * and `Uncaught SyntaxError: Invalid or unexpected token` in every console —
 * the browser parsing CSS as JavaScript.
 *
 * Next never filters the extension, so this is only prevented upstream, here.
 * The override also disabled scope hoisting, which is pinned for the same
 * reason it was removed.
 */
import { describe, it, expect } from "vitest";
import nextConfig from "@/next.config";

/** Minimal stand-in for the client-side webpack config Next hands to the hook. */
function baseConfig() {
  return {
    optimization: {
      concatenateModules: true,
      splitChunks: {
        cacheGroups: {
          // A representative stock Next group, so we can tell what was ADDED.
          framework: { chunks: "all", name: "framework", test: /react/ },
        },
      },
    },
  };
}

type BaseConfig = ReturnType<typeof baseConfig>;
type WebpackHook = (config: BaseConfig, context: unknown) => BaseConfig;

/** Runs next.config's webpack hook for the client build, if one is defined. */
function applyClientWebpackConfig(): BaseConfig {
  const hook = nextConfig.webpack as unknown as WebpackHook | undefined;
  if (!hook) return baseConfig();
  return hook(baseConfig(), { isServer: false, dev: false, buildId: "test" });
}

describe("next.config client chunking (BMC-220)", () => {
  it("adds no cacheGroups that could pull CSS into the main-app entrypoint", () => {
    const stock = Object.keys(baseConfig().optimization.splitChunks.cacheGroups);
    const applied = applyClientWebpackConfig();

    const added = Object.keys(applied.optimization.splitChunks.cacheGroups).filter(
      (name) => !stock.includes(name),
    );

    // Any added group is suspect: a `chunks: "all"` node_modules group is what
    // put a stylesheet into rootMainFiles and emitted it as a <script>.
    expect(added).toEqual([]);
  });

  it("leaves scope hoisting enabled", () => {
    const applied = applyClientWebpackConfig();

    expect(applied.optimization.concatenateModules).toBe(true);
  });
});
