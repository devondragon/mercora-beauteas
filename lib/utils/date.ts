/**
 * Formats an ISO date string as a long human-readable date, e.g. "June 29, 2026".
 */
export function formatDate(date: string): string {
  return new Date(date).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    // Date-only strings (YYYY-MM-DD) parse as UTC midnight; render in UTC so
    // viewers behind UTC don't see the previous day (off-by-one).
    timeZone: "UTC",
  });
}
