/**
 * Regression test for BMC-151 / L1 — admin-middleware's ADMIN_VECTORIZE_TOKEN
 * compare must be constant-time.
 *
 * timingSafeEqual() is a pure crypto helper (Web Crypto's crypto.subtle.digest,
 * available in the jsdom unit env), so it's imported directly from
 * lib/auth/unified-auth.ts. Nothing here invokes the module's other exports,
 * so the heavier imports they pull in (Clerk, OpenNext, D1 models) never run.
 */
import { describe, it, expect } from 'vitest';
import { timingSafeEqual } from '@/lib/auth/unified-auth';

describe('timingSafeEqual', () => {
  it('resolves true for equal strings', async () => {
    expect(await timingSafeEqual('super-secret-token', 'super-secret-token')).toBe(true);
  });

  it('resolves false for unequal strings of the same length', async () => {
    expect(await timingSafeEqual('super-secret-token', 'super-secret-tokeX')).toBe(false);
  });

  it('resolves false for strings of different lengths', async () => {
    expect(await timingSafeEqual('short', 'a-much-longer-value')).toBe(false);
  });

  it('resolves false when comparing against an empty string', async () => {
    expect(await timingSafeEqual('non-empty', '')).toBe(false);
  });
});
