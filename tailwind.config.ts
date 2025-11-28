import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // BeauTeas brand palette
        background: "#fdf8f6",      // Warm cream background
        foreground: "#222222",      // Charcoal text
        border: "#e8d5cf",          // Soft blush border
        ring: "#ebc3bb",            // Blush ring/focus
        // Brand colors
        blush: {
          50: "#fdf8f6",
          100: "#f9ede8",
          200: "#f3dcd4",
          300: "#ebc3bb",           // Primary brand color
          400: "#dfa699",
          500: "#cf8577",
          600: "#b86a5d",
          700: "#99544a",
          800: "#7f4740",
          900: "#6a3d38",
        },
        cream: {
          50: "#fffefa",
          100: "#fdf8f6",
          200: "#f5ebe6",
          300: "#e8d5cf",
          400: "#d4b8ad",
        },
        charcoal: {
          DEFAULT: "#222222",
          light: "#3a3a3a",
          lighter: "#555555",
        },
      },
      fontFamily: {
        serif: ['Lora', 'Georgia', 'serif'],
        body: ['Alegreya', 'Georgia', 'serif'],
      },
    },
  },
  plugins: [require("@tailwindcss/typography")],
};

export default config;
