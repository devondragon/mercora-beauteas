"use client";

import { createContext, useContext, type ReactNode } from "react";
import { brand, type Brand } from "@/lib/brand.config";

/**
 * Brand Context
 *
 * Provides access to brand configuration throughout the component tree.
 * Use the `useBrand` hook to access brand values in components.
 *
 * @example
 * function Footer() {
 *   const { name, copyright } = useBrand();
 *   return <footer>{copyright}</footer>;
 * }
 */
const BrandContext = createContext<Brand>(brand);

/**
 * Brand Provider Component
 *
 * Wraps the application to provide brand context.
 * Already included in the root layout - no need to add manually.
 */
export function BrandProvider({ children }: { children: ReactNode }) {
  return (
    <BrandContext.Provider value={brand}>
      {children}
    </BrandContext.Provider>
  );
}

/**
 * Hook to access brand configuration
 *
 * @returns Brand configuration object
 *
 * @example
 * const { name, tagline, colors } = useBrand();
 */
export function useBrand(): Brand {
  const context = useContext(BrandContext);
  if (!context) {
    throw new Error("useBrand must be used within a BrandProvider");
  }
  return context;
}

/**
 * Server-side brand access
 *
 * For server components that can't use hooks, import brand directly:
 * import { brand } from '@/lib/brand.config';
 */
export { brand } from "@/lib/brand.config";
