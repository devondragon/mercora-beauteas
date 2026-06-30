/**
 * Shared className strings for functional/state UI (price, stock).
 * Centralizes the BeauTeas state colors so sale/stock styling stays
 * consistent across ProductCard, agent ProductCard, and product/category displays.
 */
export const stateStyles = {
  priceSale: "text-state-sale font-bold",
  priceOriginal: "line-through text-text-muted",
  savings: "text-state-success",
  inStock: "text-state-success",
  outOfStock: "text-state-error",
} as const;
