/**
 * The PDP quantity picker's bounds (lib/sale/year-supply.ts).
 *
 * The picker itself is a controlled input this repo cannot drive (no DOM
 * testing library - see product-display-boxes-left.test.tsx), so the rules it
 * obeys are pure functions and are pinned here instead:
 *
 *   - a blend opens at the cart minimum, because that is what the order needs
 *     to check out anyway (sale.minimum_boxes = 10, migration 0025);
 *   - a mug or a gift card opens at 1 - `isSoldByTheBox` is false for those,
 *     and ten of them is not a default anyone asked for;
 *   - neither ever opens above what is on hand, so a blend with 4 boxes left
 *     opens at 4 rather than offering 10 that cannot ship;
 *   - a cleared field resolves to 1 rather than NaN reaching addItem.
 */
import { describe, it, expect } from "vitest";
import {
  clampQuantity,
  maxPurchaseQuantity,
  startingQuantity,
} from "@/lib/sale/year-supply";

describe("clampQuantity", () => {
  it("keeps a legal quantity untouched", () => {
    expect(clampQuantity(7, 100)).toBe(7);
  });

  it("floors to whole units and never goes below 1", () => {
    expect(clampQuantity(3.9, 100)).toBe(3);
    expect(clampQuantity(0, 100)).toBe(1);
    expect(clampQuantity(-5, 100)).toBe(1);
  });

  it("caps at the stock ceiling", () => {
    expect(clampQuantity(50, 12)).toBe(12);
  });

  it("is unbounded above when there is no count (untracked / backorder)", () => {
    expect(clampQuantity(9999, null)).toBe(9999);
  });

  it("resolves a cleared or unparseable field to 1 rather than NaN", () => {
    expect(clampQuantity(NaN, 100)).toBe(1);
    expect(clampQuantity("", 100)).toBe(1);
    expect(clampQuantity(undefined, 100)).toBe(1);
  });

  it("accepts the input element's string value", () => {
    expect(clampQuantity("14", 100)).toBe(14);
  });

  it("still returns an addable quantity when stock is zero", () => {
    // No picker renders at zero stock (the CTA is gone), but the clamp must
    // not return 0 and hand addItem an empty line if one ever did.
    expect(clampQuantity(5, 0)).toBe(1);
  });
});

describe("maxPurchaseQuantity", () => {
  it("is the count on hand when stock is tracked", () => {
    expect(maxPurchaseQuantity(40)).toBe(40);
  });

  it("is unbounded when boxesLeft had no count to give", () => {
    expect(maxPurchaseQuantity(null)).toBeNull();
  });
});

describe("startingQuantity", () => {
  it("opens a box-stocked blend at the cart minimum", () => {
    expect(startingQuantity({ soldByTheBox: true, minimumBoxes: 10, left: 400 })).toBe(10);
  });

  it("opens a mug, gift card or bundle at 1, not the box minimum", () => {
    expect(startingQuantity({ soldByTheBox: false, minimumBoxes: 10, left: 400 })).toBe(1);
    expect(startingQuantity({ soldByTheBox: false, minimumBoxes: 10, left: null })).toBe(1);
  });

  it("never opens above what is left", () => {
    expect(startingQuantity({ soldByTheBox: true, minimumBoxes: 10, left: 4 })).toBe(4);
  });

  it("opens at the minimum when stock is untracked", () => {
    expect(startingQuantity({ soldByTheBox: true, minimumBoxes: 10, left: null })).toBe(10);
  });

  it("floors at 1 if the minimum setting is missing or zero", () => {
    expect(startingQuantity({ soldByTheBox: true, minimumBoxes: 0, left: 400 })).toBe(1);
  });
});
