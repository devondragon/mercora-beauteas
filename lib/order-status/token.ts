/**
 * Stateless, unforgeable guest order-status tokens (BMC-216).
 *
 * A token is `base64url(HMAC-SHA256("order-status:v1:<orderId>:<email>"))`,
 * signed with ORDER_STATUS_SECRET. It is a SIGNATURE ONLY — no email, address,
 * or order payload travels inside it. The verifier already knows the order id
 * (from the URL) and re-derives the customer email from the order row, so
 * nothing about the customer is exposed by the link itself.
 *
 * The scope binds a token to exactly one (order, email) pair, so a token for
 * one order cannot be replayed against another, and rotating the customer's
 * stored email invalidates old links.
 *
 * Pure Web Crypto (`crypto.subtle`) — Workers- and unit-test-compatible, and
 * imports nothing from Next/Cloudflare/D1, mirroring
 * lib/email/unsubscribe-token.ts.
 */

/** Versioned scope prefix. Bump to v2 to invalidate every issued token. */
const SCOPE_VERSION = 'order-status:v1';

/**
 * Upper bound on token length before we base64-decode + HMAC a public,
 * unauthenticated input. A real token is base64url of a 32-byte signature (43
 * chars); 256 is generous headroom that still caps CPU/memory work from a
 * megabyte-sized query param.
 *
 * Tokens intentionally never expire: a customer must be able to check an old
 * order's status, and the link is already scoped to one order + email.
 */
export const MAX_ORDER_STATUS_TOKEN_LENGTH = 256;

/** Raw HMAC-SHA256 output length, in bytes. */
const SIGNATURE_BYTES = 32;

function b64urlEncode(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Normalize so tokens are stable regardless of case/whitespace in the address. */
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

async function hmacSha256(secret: string, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return new Uint8Array(sig);
}

function getSecret(): string | null {
  const s = process.env.ORDER_STATUS_SECRET;
  return s && s.length > 0 ? s : null;
}

function scopeFor(orderId: string, normalizedEmail: string): string {
  return `${SCOPE_VERSION}:${orderId}:${normalizedEmail}`;
}

/**
 * Whether guest status tokens can be minted (ORDER_STATUS_SECRET is set).
 * Senders should check this once up front and omit the guest link entirely
 * when false, rather than emailing a link that can never verify.
 */
export function isOrderStatusTokenConfigured(): boolean {
  return getSecret() !== null;
}

/**
 * Create a guest order-status token. Returns null when the secret is unset
 * (fail closed) or when the order has no resolvable email — a token bound to
 * an empty string would verify for ANY email-less order, so callers MUST treat
 * null as "emit no guest link".
 */
export async function createOrderStatusToken(
  orderId: string,
  email: string,
): Promise<string | null> {
  const secret = getSecret();
  if (!secret) return null;
  if (typeof orderId !== 'string' || orderId.trim() === '') return null;
  if (typeof email !== 'string') return null;

  const normalized = normalizeEmail(email);
  if (!normalized) return null;

  const sig = await hmacSha256(secret, scopeFor(orderId, normalized));
  return b64urlEncode(sig);
}

/** Length-safe byte comparison (signatures are fixed 32-byte, so no length leak). */
function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a[i] ^ b[i];
  return mismatch === 0;
}

/**
 * Verify a guest order-status token against an (orderId, email) pair. Returns
 * false when the secret is unset, the token is over-length, malformed, the
 * wrong size, or the signature does not match. Never throws.
 */
export async function verifyOrderStatusToken(
  token: string,
  orderId: string,
  email: string,
): Promise<boolean> {
  const secret = getSecret();
  if (!secret) return false;
  if (typeof token !== 'string' || token.length === 0) return false;
  if (token.length > MAX_ORDER_STATUS_TOKEN_LENGTH) return false;
  if (typeof orderId !== 'string' || orderId.trim() === '') return false;
  if (typeof email !== 'string') return false;

  const normalized = normalizeEmail(email);
  if (!normalized) return false;

  let presented: Uint8Array;
  try {
    presented = b64urlDecode(token);
  } catch {
    return false;
  }
  if (presented.length !== SIGNATURE_BYTES) return false;

  const expected = await hmacSha256(secret, scopeFor(orderId, normalized));
  return bytesEqual(expected, presented);
}
