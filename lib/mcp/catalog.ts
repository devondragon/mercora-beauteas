/**
 * Catalog-driven helpers for the BeauTeas MCP tools.
 *
 * The MCP recommendation/assessment tools previously hardcoded outdoor-gear
 * categories and product keywords (tents, backpacks, hiking). BeauTeas sells
 * organic skincare teas, and the live catalog is the source of truth, so these
 * helpers derive capabilities and suggestions from the actual categories and
 * products in D1 instead of any hardcoded product taxonomy.
 */

import { listCategories, getCategoryDisplayName } from '../models/mach/category';
import { listProducts } from '../models/mach/products';
import { CapabilitiesResponse } from './types';
import type { Product } from '../types';

/**
 * Merchandising/collection categories that describe how products are grouped
 * for promotion rather than what we actually specialise in.
 */
const MERCHANDISING_CATEGORIES = new Set([
  'featured',
  'sale',
  'on sale',
  'new',
  'new arrivals',
  'bestsellers',
  'best sellers',
]);

/** Shipping regions BeauTeas serves (not catalog-dependent). */
const SHIPPING_REGIONS = ['Continental US', 'Alaska & Hawaii', 'Canada'];

/** Brand-appropriate fallbacks used only when the catalog is empty. */
const FALLBACK_CATEGORIES = ['Skincare Teas', 'Black Tea', 'Green Tea', 'Herbal Tea'];
const FALLBACK_SPECIALTIES = ['Organic skincare teas', 'Calendula wellness blends'];

function variantPrice(product: Product): number[] {
  // Variant prices are stored in minor units (cents); capabilities are
  // reported in dollars to match the rest of the storefront.
  return (product.variants || [])
    .map((v) => {
      const minorUnits = typeof v.price === 'number' ? v.price : v.price?.amount ?? 0;
      return minorUnits / 100;
    })
    .filter((amount) => amount > 0);
}

function productCategoryIds(product: Product): string[] {
  return Array.isArray(product.categories) ? product.categories : [];
}

/**
 * Build the MCP capabilities response from the live catalog: categories,
 * per-category price ranges (from product variants), and specialties derived
 * from the non-merchandising categories we carry.
 */
export async function getCatalogCapabilities(): Promise<CapabilitiesResponse> {
  const [categories, products] = await Promise.all([
    listCategories(),
    listProducts({ status: ['active'] }),
  ]);

  const categoryNames = categories
    .map((cat) => getCategoryDisplayName(cat))
    .filter((name): name is string => Boolean(name));

  if (categoryNames.length === 0) {
    return {
      categories: FALLBACK_CATEGORIES,
      price_ranges: {},
      shipping_regions: SHIPPING_REGIONS,
      specialties: FALLBACK_SPECIALTIES,
    };
  }

  // Compute price ranges per category from the products assigned to each.
  const priceRanges: Record<string, { min: number; max: number }> = {};
  for (const cat of categories) {
    const name = getCategoryDisplayName(cat);
    if (!name) continue;

    const prices = products
      .filter((p) => productCategoryIds(p).includes(cat.id))
      .flatMap(variantPrice);

    if (prices.length > 0) {
      priceRanges[name] = {
        min: Math.round(Math.min(...prices) * 100) / 100,
        max: Math.round(Math.max(...prices) * 100) / 100,
      };
    }
  }

  const specialties = categoryNames.filter(
    (name) => !MERCHANDISING_CATEGORIES.has(name.toLowerCase())
  );

  return {
    categories: categoryNames,
    price_ranges: priceRanges,
    shipping_regions: SHIPPING_REGIONS,
    specialties: specialties.length > 0 ? specialties : FALLBACK_SPECIALTIES,
  };
}

/**
 * Count how many distinct catalog categories a set of products spans. Used to
 * decide whether a "build your ritual" bundle suggestion is worthwhile.
 */
export function distinctCategoryCount(products: Product[]): number {
  const ids = new Set<string>();
  for (const product of products) {
    for (const id of productCategoryIds(product)) ids.add(id);
  }
  return ids.size;
}

/**
 * Brand-appropriate bundle suggestions for the BeauTeas "Clearly Calendula"
 * daily ritual. `variety` is the number of distinct products (or categories)
 * already in the selection — a single blend prompts building the full routine,
 * while a varied selection prompts completing the ritual set as a bundle.
 */
export function ritualBundleSuggestions(variety: number): string[] {
  if (variety <= 0) return [];
  if (variety === 1) {
    return [
      'Build your daily ritual: pair your blend with our Morning, Afternoon, and Evening teas for full-day skin support.',
    ];
  }
  return [
    'Complete the Clearly Calendula ritual set — Morning, Afternoon & Evening blends bundle together at a saving.',
  ];
}
