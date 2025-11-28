import type { Config } from "tailwindcss";
import { brand } from "./lib/brand.config";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // === Semantic Colors (use these in components) ===
        // These map to brand colors and enable easy theming

        // Primary accent color (buttons, links, highlights)
        primary: brand.colors.primary,

        // Surface colors for backgrounds
        surface: brand.colors.surface,

        // Text colors
        "text-primary": brand.colors.text.primary,
        "text-secondary": brand.colors.text.secondary,
        "text-muted": brand.colors.text.muted,
        "text-inverse": brand.colors.text.inverse,

        // Border colors
        "border-default": brand.colors.border.DEFAULT,
        "border-light": brand.colors.border.light,
        "border-dark": brand.colors.border.dark,

        // === Legacy mappings (for backwards compatibility) ===
        background: brand.colors.surface.dark,
        foreground: brand.colors.text.primary,
        border: brand.colors.border.dark,
        ring: brand.colors.border.DEFAULT,
      },
      fontFamily: {
        // Heading font
        sans: [brand.fonts.heading, "Georgia", "serif"],
        serif: [brand.fonts.heading, "Georgia", "serif"],
        // Body font
        body: [brand.fonts.body, "Georgia", "serif"],
        // Monospace
        mono: [brand.fonts.mono, "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [require("@tailwindcss/typography")],
};

export default config;
