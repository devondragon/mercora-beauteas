// lib/fulfillment/tracking.ts
//
// Pure carrier normalization and tracking-link construction (BMC-216).
// Imports nothing from D1/Next/Clerk/Resend so it runs in the plain Vitest pool.
//
// The tracking URL is ALWAYS derived here from (carrier, trackingNumber) — no
// customer-facing tracking URL is ever persisted or accepted from a browser.

import { CARRIERS, type Carrier } from "./types";

/**
 * Upper bound on an accepted tracking number. Real carrier numbers top out
 * around 34 characters; 100 is generous headroom that still caps what a
 * compromised admin session could push into an email and an href.
 */
export const MAX_TRACKING_LENGTH = 100;

const CARRIER_CODES: ReadonlySet<string> = new Set<string>(CARRIERS);

/**
 * Strict normalization for API input: only the exact carrier codes, case- and
 * whitespace-insensitive. "UPS Ground" is NOT accepted here — the API takes a
 * code, not free text.
 */
export function normalizeCarrier(raw: unknown): Carrier | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim().toLowerCase();
  return CARRIER_CODES.has(value) ? (value as Carrier) : null;
}

/**
 * Lowercase and drop separators so "UPS Ground", "u.p.s.", and "Fed-Ex" all
 * collapse to a comparable token. Mirrored in SQL by the nested `replace(...)`
 * chain in migrations/0022_add_shipping_carrier.sql — change both together.
 */
function compactCarrierToken(raw: string): string {
  return raw.trim().toLowerCase().replace(/[\s._-]/g, "");
}

/**
 * Lenient normalization for legacy values (the 0022 backfill and any legacy
 * display path): UPS/FedEx variants map to their code, any other non-empty
 * string becomes "other" (lossless original stays in extensions.carrier), and
 * empty/whitespace/non-string becomes null.
 */
export function normalizeLegacyCarrier(raw: unknown): Carrier | null {
  if (typeof raw !== "string") return null;
  const token = compactCarrierToken(raw);
  if (token === "") return null;
  if (token.startsWith("ups") || token.startsWith("unitedparcel")) return "ups";
  if (token.startsWith("fedex") || token.startsWith("federalexpress")) return "fedex";
  return "other";
}

/**
 * Trim, strip C0/C1 control characters and DEL, and enforce
 * MAX_TRACKING_LENGTH. Over-length input returns null — callers treat that as
 * invalid input rather than silently emailing a truncated tracking number.
 */
export function sanitizeTrackingNumber(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const stripped = raw.replace(/[\u0000-\u001F\u007F-\u009F]/g, "");
  const trimmed = stripped.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > MAX_TRACKING_LENGTH) return null;
  return trimmed;
}

/**
 * Build the carrier-owned tracking URL. Returns null for "other", a missing
 * carrier, or a missing tracking number. Deliberately never falls back to a
 * search-engine URL: that would leak the tracking value to an unrelated third
 * party and is not a carrier-owned destination.
 */
export function buildTrackingUrl(
  carrier: Carrier | null,
  trackingNumber: string | null,
): string | null {
  if (!carrier || !trackingNumber) return null;
  const encoded = encodeURIComponent(trackingNumber);
  switch (carrier) {
    case "ups":
      return `https://www.ups.com/track?loc=en_US&tracknum=${encoded}`;
    case "fedex":
      return `https://www.fedex.com/fedextrack/?trknbr=${encoded}`;
    default:
      return null;
  }
}
