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

        // Primary accent color (buttons, links, highlights).
        // DEFAULT is what makes the bare `bg-primary` / `text-primary` /
        // `border-primary` classes resolve at all — without it Tailwind emits
        // nothing for them, which is why stock shadcn components rendered with
        // no accent colour. It points at the same 500 the admin CSS and the
        // Button component already use, so nothing that was already styled moves.
        primary: { ...brand.colors.primary, DEFAULT: brand.colors.primary[500] },

        // Secondary accent color (honey/gold). 400 is the "main" tone per
        // brand.config, and matches the Button component's secondary variant.
        secondary: { ...brand.colors.secondary, DEFAULT: brand.colors.secondary[400] },

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

        // === shadcn token aliases ===
        // Everything under components/ui/ is stock shadcn, written for Tailwind
        // v4 against shadcn's CSS-variable palette (`bg-primary`, `bg-input`,
        // `text-muted-foreground`, `bg-destructive`, ...). This project is
        // Tailwind v3 with the brand palette above, where several of those names
        // did not exist at all and `primary` was a scale with no DEFAULT key.
        //
        // Tailwind only emits utilities it can resolve, so those classes silently
        // produced NO CSS: the markup shipped `bg-primary` / `bg-input` and no
        // rule ever defined them. The Switch was the visible casualty — both
        // track states painted nothing while the thumb (bg-background, which DID
        // resolve) still showed, leaving a floating dot with no pill and no way
        // to read whether a setting was on. The same dead tokens sit in nine
        // other ui components; this maps them onto the brand palette in one
        // place rather than rewriting each file, so future shadcn components
        // drop in and theme themselves.
        //
        // Same family of bug as the `content` glob above: a class that resolves
        // to nothing fails silently and looks like a styling opinion.
        "primary-foreground": brand.colors.text.inverse,
        "secondary-foreground": brand.colors.text.primary,
        // The subtle fill shadcn uses for hover/selected rows and for muted
        // surfaces; the brand's default surface is exactly that tone.
        accent: {
          DEFAULT: brand.colors.surface.DEFAULT,
          foreground: brand.colors.text.primary,
        },
        muted: {
          DEFAULT: brand.colors.surface.DEFAULT,
          foreground: brand.colors.text.muted,
        },
        // Overlay surfaces sit ON the cream page, so they are white rather than
        // another cream tone — otherwise a dialog has no edge against the body.
        popover: {
          DEFAULT: "#ffffff",
          foreground: brand.colors.text.primary,
        },
        card: {
          DEFAULT: "#ffffff",
          foreground: brand.colors.text.primary,
        },
        destructive: {
          DEFAULT: brand.colors.state.error.DEFAULT,
          foreground: brand.colors.text.inverse,
        },
        // shadcn uses one `input` token for both a control's border and its
        // fill; the brand's default border tone reads correctly as either.
        input: brand.colors.border.DEFAULT,
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
