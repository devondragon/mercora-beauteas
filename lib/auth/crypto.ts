/**
 * Dependency-free crypto helpers shared by the auth layer.
 *
 * This module intentionally imports nothing from Next/Clerk/Cloudflare/D1/models
 * so it can be exercised directly from the pure-module unit tests (tests/unit/**)
 * without pulling in the heavier framework runtime. It relies only on standard
 * Web Crypto (`crypto.subtle`) and `TextEncoder`, both available in the Workers
 * runtime and the jsdom unit env.
 */

/** SHA-256 hex digest using Web Crypto (Workers-compatible). */
export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Constant-time string comparison, so verifying a presented secret against
 * ADMIN_VECTORIZE_TOKEN doesn't leak its bytes via response timing.
 * Hashing both sides first reduces the comparison to fixed-length digests.
 */
export async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const [ah, bh] = await Promise.all([sha256Hex(a), sha256Hex(b)]);
  let mismatch = 0;
  for (let i = 0; i < ah.length; i++) {
    mismatch |= ah.charCodeAt(i) ^ bh.charCodeAt(i);
  }
  return mismatch === 0;
}
