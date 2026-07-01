/**
 * === Image Blur Placeholders ===
 * 
 * Consistent blur placeholders for Next.js Image components that match
 * the dark theme color scheme. Prevents blue placeholder flashes.
 */

// Light theme blur placeholder — cream (surface) tones for the BeauTeas light UI
export const LIGHT_BLUR_PLACEHOLDER = "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAwIiBoZWlnaHQ9IjIyNSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iNDAwIiBoZWlnaHQ9IjIyNSIgZmlsbD0iI2Y1ZWJlNiIvPjxjaXJjbGUgY3g9IjIwMCIgY3k9IjExMi41IiByPSIzMCIgZmlsbD0iI2U4ZDVjZiIgb3BhY2l0eT0iMC41Ii8+PC9zdmc+";

/**
 * Returns the appropriate blur placeholder for the light (BeauTeas) theme
 */
export function getLightBlurPlaceholder(): string {
  return LIGHT_BLUR_PLACEHOLDER;
}
