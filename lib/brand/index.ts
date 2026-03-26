/**
 * Brand Module
 *
 * Centralized exports for brand configuration and theming.
 *
 * @example
 * // Client components
 * import { useBrand } from '@/lib/brand';
 * const { name } = useBrand();
 *
 * // Server components
 * import { brand } from '@/lib/brand';
 * const { name } = brand;
 */

export { brand } from "@/lib/brand.config";
export type { Brand, BrandColors, BrandFonts } from "@/lib/brand.config";
export { BrandProvider, useBrand } from "./BrandProvider";
