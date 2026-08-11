import type { Config } from "tailwindcss";
import { brand } from "./lib/brand.config";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    // `lib/` too, because class strings live there as well — `lib/ui/state-styles.ts`
    // holds the shared price/stock classNames that ProductCard, the agent's
    // ProductCard, ProductDisplay and SubscriptionToggle all spread into JSX.
    // Tailwind only emits utilities it can SEE in the scanned files, so without
    // this glob any class used solely from `lib/` is purged: the markup ships
    // the className and no rule ever defines it. That is exactly what happened
    // to `line-through` in `priceOriginal` — every sale price rendered its
    // pre-sale figure with no strikethrough, so "$20.00" sat above "$3.00"
    // looking like two prices rather than a discount. It survived unnoticed
    // because every OTHER class in that file coincidentally also appears under
    // `app/` or `components/`, so `line-through` was the lone casualty.
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // === Semantic Colors (use these in components) ===
        // These map to brand colors and enable easy theming

        // Primary accent color (buttons, links, highlights)
        primary: brand.colors.primary,

        // Secondary accent color (honey/gold)
        secondary: brand.colors.secondary,

        // Functional/state colors
        state: brand.colors.state,

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
