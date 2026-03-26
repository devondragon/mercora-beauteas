# Mercora Theming System

This document describes how to customize the branding and theming of your Mercora storefront.

## Quick Start

To rebrand Mercora for your store:

1. Edit `lib/brand.config.ts` with your brand settings
2. Update font imports in `app/layout.tsx` if using different fonts
3. Build and deploy

That's it! All components automatically use your brand configuration.

## Brand Configuration

The central configuration file is `lib/brand.config.ts`:

```typescript
export const brand = {
  // Identity
  name: "Your Store Name",
  tagline: "Your tagline",
  description: "SEO description",
  copyright: "©2025 Your Store. All rights reserved.",

  // Colors (consumed by Tailwind)
  colors: {
    primary: { /* color scale 50-900 */ },
    surface: { /* background colors */ },
    text: { /* text colors */ },
    border: { /* border colors */ },
  },

  // Typography
  fonts: {
    heading: "Font Name",
    body: "Font Name",
  },

  // MCP metadata
  mcp: { /* ... */ },

  // Footer links
  footerLinks: { /* ... */ },
};
```

## Color System

### Semantic Colors

Components use semantic color names that map to your brand config:

| Semantic Name | Usage |
|--------------|-------|
| `primary-{50-900}` | Accent color for buttons, links, highlights |
| `surface-{dark,DEFAULT,light,lighter}` | Background colors |
| `text-primary` | Primary text color |
| `text-secondary` | Muted text |
| `text-muted` | Very muted text |
| `border-default` | Default border color |

### Usage in Components

```tsx
// Instead of hardcoded colors:
className="bg-black text-white hover:text-orange-500"

// Use semantic colors:
className="bg-surface-dark text-text-primary hover:text-primary-500"
```

## Accessing Brand Values

### Client Components

Use the `useBrand()` hook:

```tsx
"use client";
import { useBrand } from "@/lib/brand";

function MyComponent() {
  const { name, tagline, colors } = useBrand();
  return <h1>{name}</h1>;
}
```

### Server Components

Import the brand config directly:

```tsx
import { brand } from "@/lib/brand";

export default function MyServerComponent() {
  return <h1>{brand.name}</h1>;
}
```

## Changing Fonts

1. Update font imports in `app/layout.tsx`:

```tsx
import { YourFont } from "next/font/google";

const yourFont = YourFont({
  variable: "--font-your-font",
  subsets: ["latin"],
});
```

2. Update the brand config:

```typescript
fonts: {
  heading: "YourFont",
  body: "YourFont",
  headingVar: "--font-your-font",
  bodyVar: "--font-your-font",
}
```

3. Update the body className in layout.tsx to use your font variables.

## Dark vs Light Mode

The `brand.mode` setting determines the default color scheme:

- `"dark"` - Dark background, light text (default)
- `"light"` - Light background, dark text

Adjust your `colors.surface` and `colors.text` accordingly.

## Example: Light Theme

```typescript
colors: {
  primary: { /* your accent color */ },
  surface: {
    dark: "#ffffff",      // Main background (inverted for light)
    DEFAULT: "#f5f5f5",
    light: "#e5e5e5",
    lighter: "#d4d4d4",
  },
  text: {
    primary: "#171717",   // Dark text on light bg
    secondary: "#525252",
    muted: "#737373",
    inverse: "#ffffff",
  },
  border: {
    DEFAULT: "#e5e5e5",
    light: "#f5f5f5",
    dark: "#d4d4d4",
  },
},
mode: "light",
```

## Migration from Hardcoded Styles

If you're updating existing components, replace:

| Old | New |
|-----|-----|
| `bg-black` | `bg-surface-dark` |
| `bg-neutral-900` | `bg-surface-light` |
| `text-white` | `text-text-primary` |
| `text-gray-400` | `text-text-secondary` |
| `text-orange-500` | `text-primary-500` |
| `hover:text-orange-500` | `hover:text-primary-500` |
| `border-neutral-700` | `border-border-default` |

## Files Changed

When rebranding, you primarily modify:

- `lib/brand.config.ts` - All brand settings
- `app/layout.tsx` - Font imports (if changing fonts)

Components automatically adapt through:

- `tailwind.config.ts` - Consumes brand colors
- `lib/brand/BrandProvider.tsx` - Provides context
- `lib/brand/index.ts` - Clean exports
