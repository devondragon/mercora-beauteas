/**
 * Brand Configuration
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
  name: "Voltique",
  tagline: "Gear for the wild",
  description: "AI-powered outdoor gear eCommerce platform",
  copyright: `©${new Date().getFullYear()} Voltique. All rights reserved.`,

  // === Colors ===
  // These are consumed by tailwind.config.ts for the color palette
  colors: {
    // Primary brand color (accent color for buttons, links, highlights)
    primary: {
      50: "#fff7ed",
      100: "#ffedd5",
      200: "#fed7aa",
      300: "#fdba74",
      400: "#fb923c",
      500: "#f97316",   // Main primary
      600: "#ea580c",
      700: "#c2410c",
      800: "#9a3412",
      900: "#7c2d12",
    },
    // Surface colors (backgrounds, cards)
    surface: {
      dark: "#000000",      // Dark mode background
      DEFAULT: "#0a0a0a",   // Default surface (neutral-950)
      light: "#171717",     // Elevated surface (neutral-900)
      lighter: "#262626",   // More elevated (neutral-800)
    },
    // Text colors
    text: {
      primary: "#ffffff",     // Primary text on dark
      secondary: "#a3a3a3",   // Muted text (neutral-400)
      muted: "#737373",       // Very muted (neutral-500)
      inverse: "#000000",     // Text on light backgrounds
    },
    // Border colors
    border: {
      DEFAULT: "#404040",     // Default border (neutral-700)
      light: "#525252",       // Lighter border (neutral-600)
      dark: "#262626",        // Darker border (neutral-800)
    },
  },

  // === Typography ===
  fonts: {
    // Font family names (must match imports in app/layout.tsx)
    heading: "Geist",
    body: "Geist",
    mono: "Geist Mono",
    // CSS variable names
    headingVar: "--font-geist-sans",
    bodyVar: "--font-geist-sans",
    monoVar: "--font-geist-mono",
  },

  // === Theme Mode ===
  // 'dark' or 'light' - determines default color scheme
  mode: "dark" as const,

  // === MCP Server Metadata ===
  mcp: {
    capabilities: "commerce,outdoor-gear,multi-agent,e-commerce",
    description: "Voltique MCP Server for multi-agent outdoor gear commerce",
  },

  // === Social Media (defaults, can be overridden in admin) ===
  social: {
    instagram: "",
    facebook: "",
    twitter: "",
    youtube: "",
    linkedin: "",
    tiktok: "",
    pinterest: "",
  },

  // === Footer Links ===
  footerLinks: {
    column1: [
      // These are pulled from CMS pages
    ],
    column2: [
      { label: "Contact us", href: "#" },
      { label: "Keep in touch", href: "#" },
      { label: "Careers", href: "#" },
    ],
    column3: [
      { label: "News & media", href: "#" },
      { label: "Community", href: "#" },
      { label: "Events", href: "#" },
      { label: "Specs", href: "#" },
    ],
  },
} as const;

// Type exports for type safety
export type Brand = typeof brand;
export type BrandColors = typeof brand.colors;
export type BrandFonts = typeof brand.fonts;
