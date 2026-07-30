/**
 * Resolves `figure.blend` product references on a CMS page into display data
 * for the shoppable column. Reading from D1 (rather than freezing name and
 * price into page HTML) keeps the guide in sync with the catalog.
 *
 * NOT unit-testable — depends on Cloudflare bindings via the model layer.
 */
import { getProductBySlug } from "@/lib/models/mach/products";
import { Money } from "@/lib/money";
import type { PageSection } from "./page-sections";

export interface BlendCardData {
  slug: string;
  name: string;
  /** Formatted for display, e.g. "$18.00". Null when the product has no price. */
  price: string | null;
  /** Bare R2 object key — the Next image loader turns it into a CDN or /media URL. */
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
    if (!primaryImage) return "/placeholder.svg";
    const data =
      typeof primaryImage === "string" && primaryImage.startsWith("{")
        ? JSON.parse(primaryImage)
        : primaryImage;
    // Mirrors lib/seo/metadata.ts:resolveImageUrl's shape handling (plain
    // `.url` vs. the spec-standard MACHMedia `.file.url`), but returns a bare
    // R2 object key rather than an absolute CDN URL — the Next image loader
    // (image-loader.ts) expects a bare key here, not a prefixed URL. Not
    // reused directly because resolveImageUrl's absolute-URL output would
    // have to be re-stripped back to a key, which breaks in plain `next dev`
    // (the loader short-circuits there and returns its input unmodified).
    const obj = data as { url?: string; file?: { url?: string } };
    const url = obj?.url ?? obj?.file?.url;
    return url ? url.replace(/^\//, "") : "/placeholder.svg";
  } catch {
    return "/placeholder.svg";
  }
}

export async function resolveSectionBlends(
  sections: PageSection[],
): Promise<Map<string, BlendCardData>> {
  const withProducts = sections.filter((section) => section.productSlug);
  const results = await Promise.all(
    withProducts.map(async (section) => {
      try {
        const product = await getProductBySlug(section.productSlug!);
        if (!product) {
          // These slugs are admin-authored in the page HTML, so a typo is the
          // likeliest failure. Without this the column just vanishes and the
          // bad reference stays invisible forever.
          console.warn(
            `[page-blends] no product for slug "${section.productSlug}" referenced by section "${section.id}"`,
          );
          return null;
        }

        const variants = product.variants ?? [];
        const variant =
          variants.find((v) => v.id === product.default_variant_id) ?? variants[0];
        const amount = variant?.price?.amount;
        const currency = variant?.price?.currency ?? "USD";

        return [
          section.id,
          {
            slug: section.productSlug!,
            name: firstValue(product.name),
            price:
              typeof amount === "number" ? Money.fromMinor(amount, currency).format() : null,
            imageKey: imageKeyFor(product.primary_image),
          },
        ] as const;
      } catch (error) {
        // A missing or malformed product must not take the page down — the
        // card simply renders without its column. Logged so the failure is
        // discoverable rather than a silently missing column.
        console.warn(
          `[page-blends] failed to resolve "${section.productSlug}" for section "${section.id}":`,
          error,
        );
        return null;
      }
    }),
  );

  return new Map(results.filter((entry): entry is NonNullable<typeof entry> => entry !== null));
}
