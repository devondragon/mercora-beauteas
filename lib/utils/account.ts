import type { MACHAddress } from "@/lib/types/mach/Address";

export function formatDate(dateString?: string | null, showTime = false): string {
  if (!dateString) return "—";
  const options: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    year: "numeric",
  };
  if (showTime) {
    options.hour = "numeric";
    options.minute = "2-digit";
  }
  return new Date(dateString).toLocaleDateString("en-US", { ...options, timeZone: "UTC" });
}

export function formatAddress(address: MACHAddress | null | undefined): string {
  if (!address) return "—";
  const line1 = typeof address.line1 === "string" ? address.line1 : "";
  const city = typeof address.city === "string" ? address.city : "";
  return [
    line1,
    address.line2 ? (typeof address.line2 === "string" ? address.line2 : "") : undefined,
    [city, address.region, address.postal_code].filter(Boolean).join(", "),
    address.country,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Format address as a single inline string (comma-separated).
 * Use for dashboard cards and summaries where multi-line isn't appropriate.
 */
export function formatAddressInline(addr: { address?: MACHAddress | null } | null): string {
  if (!addr?.address) return "No address saved";
  const a = addr.address;
  const line1 = typeof a.line1 === "string" ? a.line1 : "";
  const city = typeof a.city === "string" ? a.city : "";
  return [line1, [city, a.region, a.postal_code].filter(Boolean).join(", ")]
    .filter(Boolean)
    .join(", ");
}

/** Format monetary amount. Expects `amount` in minor units (cents). */
export function formatMoney(money?: { amount: number; currency_code?: string } | null): string {
  if (!money) return "\u2014";
  const symbol = money.currency_code === "USD" || !money.currency_code ? "$" : money.currency_code + " ";
  return `${symbol}${(money.amount / 100).toFixed(2)}`;
}

export function getMediaUrl(media: { file?: { url?: string } } | string | null | undefined): string {
  if (!media) return "/placeholder.jpg";
  if (typeof media === "string") return media;
  return media.file?.url || "/placeholder.jpg";
}
