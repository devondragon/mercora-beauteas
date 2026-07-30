/**
 * Pure unit test: @/lib/models/mach/products is mocked so the blend resolver
 * runs with no Cloudflare runtime.
 *
 * The behaviour worth pinning here is failure handling — a shoppable column is
 * the guide page's only path to purchase, so a bad price or a typo'd slug must
 * degrade narrowly and audibly rather than silently deleting the card.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/models/mach/products", () => ({ getProductsBySlugs: vi.fn() }));

import { resolveSectionBlends } from "@/lib/cms/page-products";
import { getProductsBySlugs } from "@/lib/models/mach/products";
import type { PageSection } from "@/lib/cms/page-sections";

const mockedLookup = vi.mocked(getProductsBySlugs);

function section(id: string, productSlug: string | null): PageSection {
  return { id, heading: id, html: "", specs: [], productSlug, callouts: [] };
}

function product(overrides: Record<string, unknown> = {}) {
  return {
    id: "p1",
    name: "Clearly Calendula Morning",
    default_variant_id: "v1",
    primary_image: { url: "/products/morning.jpg" },
    variants: [{ id: "v1", price: { amount: 1800, currency: "USD" } }],
    ...overrides,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("resolveSectionBlends", () => {
  it("resolves name, formatted price and a bare image key", async () => {
    mockedLookup.mockResolvedValue(new Map([["morning", product()]]));

    const blends = await resolveSectionBlends([section("black-teas", "morning")]);

    expect(blends.get("black-teas")).toEqual({
      slug: "morning",
      name: "Clearly Calendula Morning",
      price: "$18.00",
      // Bare key, no leading slash: image-loader.ts prefixes it with the CDN.
      imageKey: "products/morning.jpg",
    });
  });

  it("queries every slug in a single batched lookup", async () => {
    mockedLookup.mockResolvedValue(new Map([["a", product()], ["b", product()]]));

    await resolveSectionBlends([
      section("one", "a"),
      section("two", "b"),
      section("three", null),
    ]);

    // One call, not one per blend — getProductBySlug scans the whole products
    // table, so a per-section loop is N full scans on every request.
    expect(mockedLookup).toHaveBeenCalledTimes(1);
    expect(mockedLookup).toHaveBeenCalledWith(["a", "b"]);
  });

  it("skips the lookup entirely when no section references a product", async () => {
    const blends = await resolveSectionBlends([section("one", null)]);

    expect(blends.size).toBe(0);
    expect(mockedLookup).not.toHaveBeenCalled();
  });

  it("warns and omits the card when a slug matches no product", async () => {
    mockedLookup.mockResolvedValue(new Map());

    const blends = await resolveSectionBlends([section("black-teas", "typo-slug")]);

    expect(blends.size).toBe(0);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("typo-slug"));
  });

  it("keeps the card when the price is unusable, dropping only the price", async () => {
    // A price problem must not remove the product image, name and shop link.
    mockedLookup.mockResolvedValue(
      new Map([["morning", product({ variants: [{ id: "v1", price: { amount: 1800, currency: "NOT-A-CURRENCY" } }] })]]),
    );

    const blend = (await resolveSectionBlends([section("black-teas", "morning")])).get("black-teas");

    expect(blend?.price).toBeNull();
    expect(blend?.name).toBe("Clearly Calendula Morning");
    expect(blend?.slug).toBe("morning");
  });

  it("tolerates the stored price shapes the column actually holds", async () => {
    // parseMoneyField in the model layer emits objects, but legacy rows carry
    // JSON strings and plain numbers; Money.fromMinor would throw on some.
    for (const price of [{ amount: 1800, currency: "USD" }, '{"amount":1800,"currency":"USD"}', 1800]) {
      mockedLookup.mockResolvedValue(new Map([["morning", product({ variants: [{ id: "v1", price }] })]]));
      const blend = (await resolveSectionBlends([section("s", "morning")])).get("s");
      expect(blend?.price).toBe("$18.00");
    }
  });

  it("returns null price when the variant has none, without dropping the card", async () => {
    mockedLookup.mockResolvedValue(new Map([["morning", product({ variants: [] })]]));

    const blend = (await resolveSectionBlends([section("s", "morning")])).get("s");

    expect(blend?.price).toBeNull();
    expect(blend?.name).toBe("Clearly Calendula Morning");
  });

  it("falls back to the placeholder, with its leading slash, when there is no image", async () => {
    mockedLookup.mockResolvedValue(new Map([["morning", product({ primary_image: null })]]));

    const blend = (await resolveSectionBlends([section("s", "morning")])).get("s");

    // The leading slash is load-bearing: image-loader.ts short-circuits on
    // "/placeholder" before any R2 key handling. A bare key would 404 in prod
    // while still working under `next dev`.
    expect(blend?.imageKey).toBe("/placeholder.svg");
  });

  it("reads the MACHMedia file.url shape and a bare string image", async () => {
    mockedLookup.mockResolvedValue(
      new Map([["a", product({ primary_image: { file: { url: "/products/a.jpg" } } })]]),
    );
    expect((await resolveSectionBlends([section("s", "a")])).get("s")?.imageKey).toBe("products/a.jpg");

    mockedLookup.mockResolvedValue(new Map([["b", product({ primary_image: "products/b.jpg" })]]));
    expect((await resolveSectionBlends([section("s", "b")])).get("s")?.imageKey).toBe("products/b.jpg");
  });

  it("logs an error and renders no columns when the lookup itself fails", async () => {
    mockedLookup.mockRejectedValue(new Error("D1_ERROR: no such table"));

    const blends = await resolveSectionBlends([section("black-teas", "morning")]);

    // The page must still render; the operator must still find out.
    expect(blends.size).toBe(0);
    expect(console.error).toHaveBeenCalled();
  });

  it("falls back to the slug when the product name is an unexpected shape", async () => {
    mockedLookup.mockResolvedValue(new Map([["morning", product({ name: {} })]]));

    // Better a visible slug than a blank title and an empty alt attribute.
    expect((await resolveSectionBlends([section("s", "morning")])).get("s")?.name).toBe("morning");
  });
});
