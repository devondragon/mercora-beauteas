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

const US_REGION_CODES = new Set([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID',
  'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS',
  'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK',
  'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV',
  'WI', 'WY', 'DC', 'AS', 'GU', 'MP', 'PR', 'VI', 'UM', 'FM', 'MH', 'PW',
]);

const US_REGION_NAMES: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA',
  colorado: 'CO', connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA',
  hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA', kansas: 'KS',
  kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD', massachusetts: 'MA',
  michigan: 'MI', minnesota: 'MN', mississippi: 'MS', missouri: 'MO', montana: 'MT',
  nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ',
  'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND',
  ohio: 'OH', oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI',
  'south carolina': 'SC', 'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT',
  vermont: 'VT', virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI',
  wyoming: 'WY', 'district of columbia': 'DC', 'american samoa': 'AS', guam: 'GU',
  'northern mariana islands': 'MP', 'puerto rico': 'PR', 'u.s. virgin islands': 'VI',
};

/** Normalize a supported US state/territory name or postal abbreviation. */
export function normalizeUsRegion(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  const code = trimmed.toUpperCase();
  if (US_REGION_CODES.has(code)) return code;
  return US_REGION_NAMES[trimmed.toLowerCase()] ?? null;
}

export function isValidUsPostalCode(input: unknown): boolean {
  return typeof input === 'string' && /^\d{5}(?:-\d{4})?$/.test(input.trim());
}

/** Validate the launch checkout's US-only state/territory and ZIP fields. */
export function validateUsShippingAddress(input: LooseAddressInput | null | undefined): string[] {
  if (!input || typeof input !== 'object') return ['Shipping address is required'];
  const errors: string[] = [];
  // Legacy storefront clients omitted country and the server has always treated
  // that as US. Preserve that compatibility, while any explicit non-US value is
  // still rejected authoritatively.
  const country = input.country == null || input.country === '' ? 'US' : normalizeCountryCode(input.country);
  if (country !== 'US') errors.push('We currently ship within the United States only');
  if (!normalizeUsRegion(input.region)) errors.push('Enter a valid US state or territory');
  if (!isValidUsPostalCode(input.postal_code)) errors.push('Enter a valid 5-digit US ZIP code');
  return errors;
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
