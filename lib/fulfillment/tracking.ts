// lib/fulfillment/tracking.ts
//
// Pure carrier normalization and tracking-link construction (BMC-216).
// Imports nothing from D1/Next/Clerk/Resend so it runs in the plain Vitest pool.
//
// Within THIS module, the tracking URL is always derived from
// (carrier, trackingNumber) via buildTrackingUrl — never persisted or accepted
// from a browser. That does not (yet) hold repo-wide: buildTrackingUrl has no
// production call sites as of BMC-216A, and the live legacy path still reads
// a client-supplied `extensions.trackingUrl` straight through to an email href
// (lib/utils/email.ts, app/api/orders/route.ts) with no encoding applied.
// Locking that down is BMC-216F/BMC-230's job, not this module's.

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
 * collapse to a comparable token. Approximated in SQL by the nested
 * `replace(...)` chain in migrations/0022_add_shipping_carrier.sql — change
 * both together, but they are NOT an exact mirror: this regex's `\s` strips
 * tab/CR/LF/NBSP/Unicode whitespace, while SQL `trim()`/`replace()` only
 * strip ASCII space. See 0022's header for the concrete divergent inputs.
 */
function compactCarrierToken(raw: string): string {
  return raw.trim().toLowerCase().replace(/[\s._-]/g, "");
}

/**
 * Lenient normalization for legacy values (the 0022 backfill and any legacy
 * display path): UPS/FedEx/USPS variants map to their code, any other non-empty
 * string becomes "other" (lossless original stays in extensions.carrier), and
 * empty/whitespace/non-string becomes null.
 *
 * "usps" is tested before "ups" for readability only — the two prefixes cannot
 * collide ("usps" does not start with "ups", nor the reverse), so reordering
 * these branches would not change any result.
 */
export function normalizeLegacyCarrier(raw: unknown): Carrier | null {
  if (typeof raw !== "string") return null;
  const token = compactCarrierToken(raw);
  if (token === "") return null;
  if (
    token.startsWith("usps") ||
    token.startsWith("unitedstatespostalservice") ||
    token.startsWith("uspostalservice")
  ) {
    return "usps";
  }
  if (token.startsWith("ups") || token.startsWith("unitedparcel")) return "ups";
  if (token.startsWith("fedex") || token.startsWith("federalexpress")) return "fedex";
  return "other";
}

/**
 * Characters that render as nothing (or reorder their neighbours) but survive a
 * byte-for-byte round trip. A tracking number is echoed back into the admin
 * table, the shipping email and an href, so a value containing these can
 * display differently from what was stored — a right-to-left override reverses
 * the digits on screen while the saved bytes are unchanged. Stripped rather
 * than rejected: no real carrier number contains them, so their presence is
 * noise or spoofing, never data.
 *
 * Covers C0/C1 controls and DEL, zero-width and directional marks
 * (U+200B–U+200F), the bidi embedding/override block (U+202A–U+202E), word
 * joiner and invisible operators (U+2060–U+2064), the isolate block
 * (U+2066–U+2069), and the BOM (U+FEFF).
 */
const INVISIBLE_CHARS =
  /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;

/**
 * Trim, strip invisible/bidi formatting characters, and enforce
 * MAX_TRACKING_LENGTH. Over-length input returns null — callers treat that as
 * invalid input rather than silently emailing a truncated tracking number.
 */
export function sanitizeTrackingNumber(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const stripped = raw.replace(INVISIBLE_CHARS, "");
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
    case "usps":
      return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${encoded}`;
    default:
      return null;
  }
}
