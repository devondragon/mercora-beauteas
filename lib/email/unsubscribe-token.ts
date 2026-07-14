/**
 * Stateless, unforgeable unsubscribe tokens (BMC-184, CAN-SPAM).
 *
 * A token is `base64url(email) + "." + base64url(HMAC-SHA256(scope:email))`,
 * signed with EMAIL_UNSUBSCRIBE_SECRET. It carries the target email so the
 * unsubscribe endpoint needs no DB lookup to know who is opting out, and the
 * HMAC stops a visitor from unsubscribing an address they don't control.
 *
 * Pure Web Crypto (`crypto.subtle`) — Workers- and unit-test-compatible, and
 * imports nothing from Next/Cloudflare/D1, mirroring lib/auth/crypto.ts.
 */

/** Only marketing email today is the review reminder; scope binds tokens to it. */
const SCOPE = 'review_reminders';

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
export function normalizeEmail(email: string): string {
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
  const s = process.env.EMAIL_UNSUBSCRIBE_SECRET;
  return s && s.length > 0 ? s : null;
}

/**
 * Whether unsubscribe tokens can be minted (EMAIL_UNSUBSCRIBE_SECRET is set).
 * Callers that send marketing email should check this ONCE up front and skip
 * the whole run when false, rather than per-recipient — see sendReviewReminders.
 */
export function isUnsubscribeConfigured(): boolean {
  return getSecret() !== null;
}

/**
 * Create an unsubscribe token for `email`. Returns null when
 * EMAIL_UNSUBSCRIBE_SECRET is not configured — callers MUST treat that as
 * "cannot send a compliant marketing email" and refuse to send.
 */
export async function createUnsubscribeToken(email: string): Promise<string | null> {
  const secret = getSecret();
  if (!secret) return null;
  const normalized = normalizeEmail(email);
  const sig = await hmacSha256(secret, `${SCOPE}:${normalized}`);
  return `${b64urlEncode(new TextEncoder().encode(normalized))}.${b64urlEncode(sig)}`;
}

/** Length-safe byte comparison (signatures are fixed 32-byte, so no length leak). */
function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a[i] ^ b[i];
  return mismatch === 0;
}

/**
 * Verify a token and return the normalized email it authorizes, or null if the
 * token is malformed, tampered, or the secret is unset.
 */
export async function verifyUnsubscribeToken(token: string): Promise<string | null> {
  const secret = getSecret();
  if (!secret) return null;

  const parts = token.split('.');
  if (parts.length !== 2) return null;

  let normalized: string;
  try {
    normalized = normalizeEmail(new TextDecoder().decode(b64urlDecode(parts[0])));
  } catch {
    return null;
  }
  if (!normalized) return null;

  let presented: Uint8Array;
  try {
    presented = b64urlDecode(parts[1]);
  } catch {
    return null;
  }

  const expected = await hmacSha256(secret, `${SCOPE}:${normalized}`);
  return bytesEqual(expected, presented) ? normalized : null;
}
