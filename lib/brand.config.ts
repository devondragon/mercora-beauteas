/**
 * Brand Configuration - BeauTeas
 *
 * Central configuration file for all brand-related settings.
 * This enables easy rebranding of the Mercora platform for different storefronts
 * without modifying individual components.
 *
 * To rebrand:
 * 1. Update the values in this file
 * 2. Update font imports in app/layout.tsx if changing fonts
 * 3. Run the build - all components will automatically use the new branding
 *
 * @example
 * // Importing brand config
 * import { brand } from '@/lib/brand.config';
 *
 * // Using in components
 * <h1>{brand.name}</h1>
 * <p>{brand.tagline}</p>
 */

export const brand = {
  // === Identity ===
  name: "BeauTeas",
  tagline: "Build Your Beauty from Within",
  description: "Organic skincare teas designed to improve your beauty from within. USDA certified organic tea blends with calendula, chamomile, and more.",
  copyright: `©${new Date().getFullYear()} BeauTeas. All rights reserved.`,

  // === Colors ===
  // BeauTeas uses a warm, light theme with blush/peach accents
  colors: {
    // Primary brand color (blush/peach accent)
    primary: {
      50: "#fdf8f6",
      100: "#f9ede8",
      200: "#f3dcd4",
      300: "#ebc3bb",   // Main primary - blush
      400: "#dfa699",
      500: "#cf8577",
      600: "#b86a5d",
      700: "#99544a",
      800: "#7f4740",
      900: "#6a3d38",
    },
    // Surface colors (light theme - cream backgrounds)
    surface: {
      dark: "#fdf8f6",      // Main background (warm cream)
      DEFAULT: "#f5ebe6",   // Default surface
      light: "#e8d5cf",     // Elevated surface
      lighter: "#d4b8ad",   // More elevated
    },
    // Text colors (dark text on light backgrounds)
    text: {
      primary: "#222222",     // Primary text (charcoal)
      secondary: "#555555",   // Muted text
      muted: "#777777",       // Very muted text
      inverse: "#ffffff",     // Text on dark backgrounds
    },
    // Border colors
    border: {
      DEFAULT: "#e8d5cf",     // Default border (soft blush)
      light: "#f3dcd4",       // Lighter border
      dark: "#d4b8ad",        // Darker border
    },
  },

  // === Typography ===
  fonts: {
    // Font family names (must match imports in app/layout.tsx)
    heading: "Lora",
    body: "Alegreya",
    mono: "Geist Mono",
    // CSS variable names
    headingVar: "--font-lora",
    bodyVar: "--font-alegreya",
    monoVar: "--font-geist-mono",
  },

  // === Theme Mode ===
  // 'light' for BeauTeas warm cream aesthetic
  mode: "light" as const,

  // === MCP Server Metadata ===
  mcp: {
    capabilities: "commerce,tea,skincare,organic,e-commerce",
    description: "BeauTeas MCP Server for organic skincare tea commerce",
  },

  // === Social Media ===
  social: {
    instagram: "https://instagram.com/beauteas",
    facebook: "https://facebook.com/beauteas",
    twitter: "",
    youtube: "",
    linkedin: "https://linkedin.com/company/beauteas",
    tiktok: "",
    pinterest: "https://pinterest.com/beauteas",
  },

  // === Footer Links ===
  footerLinks: {
    column1: [
      // These are pulled from CMS pages (About, FAQ, etc.)
    ],
    column2: [
      { label: "Contact Us", href: "/contact" },
      { label: "Shipping & Returns", href: "/shipping-returns" },
      { label: "Subscriptions", href: "/subscriptions" },
    ],
    column3: [
      { label: "How It Works", href: "/how-it-works" },
      { label: "Brewing Guide", href: "/brewing-directions" },
      { label: "Ingredients", href: "/ingredients" },
      { label: "Skin Concerns", href: "/skin-concerns" },
    ],
  },
} as const;

// Type exports for type safety
export type Brand = typeof brand;
export type BrandColors = typeof brand.colors;
export type BrandFonts = typeof brand.fonts;
