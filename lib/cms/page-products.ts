/**
 * Resolves `figure.blend` product references on a CMS page into display data
 * for the shoppable column. Reading from D1 (rather than freezing name and
 * price into page HTML) keeps the guide in sync with the catalog.
 *
 * Reaches the database through the model layer, so unit tests must mock
 * `@/lib/models/mach/products` (see tests/unit/lib/cms/page-products.test.ts).
 */
import { getProductsBySlugs } from "@/lib/models/mach/products";
import { Money } from "@/lib/money";
import type { Product } from "@/lib/types/";
import type { PageSection } from "./page-sections";

/**
 * Served straight from /public — image-loader.ts short-circuits on this exact
 * prefix before it does any R2 key handling, so the leading slash is load-bearing.
 */
const PLACEHOLDER_IMAGE = "/placeholder.svg";

export interface BlendCardData {
  slug: string;
  name: string;
  /** Formatted for display, e.g. "$18.00". Null when the product has no price. */
  price: string | null;
  /**
   * Bare R2 object key (e.g. "products/x.jpg") which the Next image loader turns
   * into a CDN or /media URL — or the literal PLACEHOLDER_IMAGE when the product
   * has no usable image, which the loader serves from /public untouched.
   */
  imageKey: string;
}

/** Product fields are localizable objects in MACH; take the first value. */
function firstValue(field: unknown): string {
  if (typeof field === "string") return field;
  const values = Object.values((field as Record<string, unknown>) ?? {});
  return typeof values[0] === "string" ? values[0] : "";
}

function imageKeyFor(primaryImage: unknown): string {
  try {
    if (!primaryImage) return PLACEHOLDER_IMAGE;
    const data =
      typeof primaryImage === "string" && primaryImage.startsWith("{")
        ? JSON.parse(primaryImage)
        : primaryImage;

    // Mirrors lib/seo/metadata.ts:resolveImageUrl's shape handling — a bare
    // string (parseMaybeJson passes non-JSON strings through untouched), a plain
    // `.url`, or the spec-standard MACHMedia `.file.url` — but returns a bare R2
    // object key rather than an absolute CDN URL, because the Next image loader
    // (image-loader.ts) expects a key here. Not reused directly because
    // resolveImageUrl's absolute output would have to be re-stripped back to a
    // key, which breaks in plain `next dev` (the loader short-circuits there and
    // returns its input unmodified).
    if (typeof data === "string") {
      return data ? data.replace(/^\//, "") : PLACEHOLDER_IMAGE;
    }
    const obj = data as { url?: string; file?: { url?: string } };
    const url = obj?.url ?? obj?.file?.url;
    return url ? url.replace(/^\//, "") : PLACEHOLDER_IMAGE;
  } catch {
    return PLACEHOLDER_IMAGE;
  }
}

/**
 * Format a stored variant price for display, or null when there is no price.
 *
 * Deliberately isolated: a price that fails to format must not take the whole
 * card down with it. `Money.fromStored` tolerates the object / JSON-string /
 * legacy-number shapes the column actually holds (unlike `fromMinor`, which
 * throws on anything non-integer), but `format()` can still throw a RangeError
 * on a currency code that is not valid ISO 4217.
 */
function formatVariantPrice(price: unknown, slug: string): string | null {
  if (price === null || price === undefined) return null;
  try {
    const currency =
      (price as { currency?: string })?.currency ?? "USD";
    return Money.fromStored(price, currency).format();
  } catch (error) {
    console.warn(`[page-blends] unformattable price for "${slug}":`, error);
    return null;
  }
}

export async function resolveSectionBlends(
  sections: PageSection[],
): Promise<Map<string, BlendCardData>> {
  const withProducts = sections.filter(
    (section): section is PageSection & { productSlug: string } => Boolean(section.productSlug),
  );
  if (withProducts.length === 0) return new Map();

  let products: Map<string, Product>;
  try {
    products = await getProductsBySlugs(withProducts.map((section) => section.productSlug));
  } catch (error) {
    // One failed lookup must not take the page down, but every column will be
    // missing — that is worth an error, not a warning.
    console.error("[page-blends] product lookup failed; blend columns omitted:", error);
    return new Map();
  }

  const resolved = new Map<string, BlendCardData>();
  for (const section of withProducts) {
    const product = products.get(section.productSlug);
    if (!product) {
      // These slugs are admin-authored in the page HTML, so a typo is the
      // likeliest failure. Without this the column just vanishes and the
      // bad reference stays invisible forever.
      console.warn(
        `[page-blends] no product for slug "${section.productSlug}" referenced by section "${section.id}"`,
      );
      continue;
    }

    const variants = product.variants ?? [];
    const variant = variants.find((v) => v.id === product.default_variant_id) ?? variants[0];

    resolved.set(section.id, {
      slug: section.productSlug,
      name: firstValue(product.name) || section.productSlug,
      price: formatVariantPrice(variant?.price, section.productSlug),
      imageKey: imageKeyFor(product.primary_image),
    });
  }

  return resolved;
}
