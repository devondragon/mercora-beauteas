/**
 * Shared className strings for functional/state UI (price, stock).
 * Centralizes the BeauTeas state colors so sale/stock styling stays
 * consistent across ProductCard, agent ProductCard, and product/category displays.
 *
 * THIS FILE ONLY WORKS BECAUSE `lib/**` IS IN tailwind.config.ts's `content`
 * globs. Tailwind emits utilities by scanning source text, so a class named
 * only here is purged from the stylesheet while the markup still ships the
 * className: silently unstyled, and invisible in review because the HTML looks
 * correct. `line-through` below was dead for exactly that reason until the glob
 * was added. If you move this file, or add a new className-holding module
 * outside the scanned paths, check the built CSS actually contains the class.
 */
export const stateStyles = {
  priceSale: "text-state-sale font-bold",
  priceOriginal: "line-through text-text-muted",
  savings: "text-state-success",
  inStock: "text-state-success",
  outOfStock: "text-state-error",
  errorBox: "text-sm text-state-error bg-state-error-bg border border-state-error rounded-md px-3 py-2",
} as const;
