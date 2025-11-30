import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    globals: true,
    setupFiles: [],
    include: ["__tests__/**/*.{test,spec}.{js,ts,tsx}"],
    exclude: ["node_modules", ".next"],
    coverage: {
      reporter: ["text", "json", "html"],
      exclude: ["node_modules/", "__tests__/"],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./"),
    },
  },
});
