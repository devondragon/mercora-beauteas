/**
 * Address normalization for untrusted boundaries (BMC-171).
 *
 * Both the subscription checkout body (`POST /api/subscriptions`) and the Stripe
 * subscription metadata read back in the webhook are untrusted inputs that must be
 * coerced into a MACH `Address` before they are persisted or used to build an
 * order. The MACH Address contract requires `country` to be an ISO 3166-1 alpha-2
 * code, and a shippable address needs at least line1 + city + country. Anything
 * short of that is treated as "no address" — non-blocking, so a missing/partial
 * address never fails subscription creation; the order is simply created without
 * one for the merchant to reconcile.
 */

import type { Address } from '@/lib/types';

/**
 * Normalize an arbitrary country value to an uppercase ISO 3166-1 alpha-2 code,
 * or null when it is not a 2-letter code (e.g. "us" → "US"; "United States",
 * "USA", "" → null).
 */
export function normalizeCountryCode(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const code = input.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : null;
}

/** Loose shape for an address arriving from a client body or Stripe metadata JSON. */
export interface LooseAddressInput {
  line1?: unknown;
  line2?: unknown;
  city?: unknown;
  region?: unknown;
  postal_code?: unknown;
  country?: unknown;
}

function trimmedString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Coerce an untrusted address into a shippable MACH `Address`, or return null if
 * it lacks the minimum fields to ship to (line1 + city + a valid ISO-2 country).
 * Country is uppercased and validated as ISO 3166-1 alpha-2; string fields are
 * trimmed and empty optionals are dropped.
 */
export function normalizeShippableAddress(
  input: LooseAddressInput | null | undefined
): Address | null {
  if (!input || typeof input !== 'object') return null;

  const line1 = trimmedString(input.line1);
  const city = trimmedString(input.city);
  const country = normalizeCountryCode(input.country);
  if (!line1 || !city || !country) return null;

  const address: Address = { type: 'shipping', line1, city, country };
  const line2 = trimmedString(input.line2);
  const region = trimmedString(input.region);
  const postal_code = trimmedString(input.postal_code);
  if (line2) address.line2 = line2;
  if (region) address.region = region;
  if (postal_code) address.postal_code = postal_code;
  return address;
}
