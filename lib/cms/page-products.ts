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
    const url = (data as { url?: string })?.url;
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
        if (!product) return null;

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
      } catch {
        // A missing or malformed product must not take the page down — the
        // card simply renders without its column.
        return null;
      }
    }),
  );

  return new Map(results.filter((entry): entry is NonNullable<typeof entry> => entry !== null));
}
