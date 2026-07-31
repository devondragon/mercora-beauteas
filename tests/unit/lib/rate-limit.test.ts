/**
 * Unit tests for the public-route rate limiter (BMC-180).
 *
 * Covers key extraction and — critically — the fail-OPEN contract: a missing
 * binding, an unavailable Cloudflare context, or a throwing limiter must never
 * block the request (rate limiting is abuse mitigation, not a correctness gate).
 * Runs in the jsdom unit env with @opennextjs/cloudflare mocked, so no Workers
 * runtime is required.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const getCloudflareContext = vi.fn();
vi.mock('@opennextjs/cloudflare', () => ({
  getCloudflareContext: (...args: unknown[]) => getCloudflareContext(...args),
}));

import { NextRequest } from 'next/server';
import { getClientIp, getClientIpFromHeaders, enforceRateLimit } from '@/lib/rate-limit';

const reqWith = (headers: Record<string, string>) =>
  new NextRequest('http://localhost/api/x', { method: 'POST', headers });

beforeEach(() => {
  vi.clearAllMocks();
  // Silence the intentional fail-open warnings/errors.
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('getClientIp', () => {
  it('prefers CF-Connecting-IP over x-forwarded-for', () => {
    expect(getClientIp(reqWith({ 'CF-Connecting-IP': '1.2.3.4', 'x-forwarded-for': '9.9.9.9' }))).toBe('1.2.3.4');
  });

  it('falls back to the first x-forwarded-for entry', () => {
    expect(getClientIp(reqWith({ 'x-forwarded-for': '5.6.7.8, 9.9.9.9' }))).toBe('5.6.7.8');
  });

  it('returns "unknown" when no client IP header is present', () => {
    expect(getClientIp(reqWith({}))).toBe('unknown');
  });
});

describe('getClientIpFromHeaders (server components — no Request object)', () => {
  it('prefers CF-Connecting-IP over x-forwarded-for', () => {
    const h = new Headers({ 'CF-Connecting-IP': '1.2.3.4', 'x-forwarded-for': '9.9.9.9' });
    expect(getClientIpFromHeaders(h)).toBe('1.2.3.4');
  });

  it('falls back to the first x-forwarded-for entry', () => {
    expect(getClientIpFromHeaders(new Headers({ 'x-forwarded-for': '5.6.7.8, 9.9.9.9' }))).toBe('5.6.7.8');
  });

  it('returns "unknown" when no client IP header is present', () => {
    expect(getClientIpFromHeaders(new Headers())).toBe('unknown');
  });

  it('agrees with getClientIp for the same headers', () => {
    const headers = { 'CF-Connecting-IP': '4.3.2.1' };
    expect(getClientIpFromHeaders(new Headers(headers))).toBe(getClientIp(reqWith(headers)));
  });
});

describe('enforceRateLimit', () => {
  it('allows (returns null) when under the limit and passes the key through', async () => {
    const limit = vi.fn().mockResolvedValue({ success: true });
    getCloudflareContext.mockResolvedValue({ env: { PUBLIC_RATE_LIMITER: { limit } } });

    const res = await enforceRateLimit('PUBLIC_RATE_LIMITER', 'tax:1.2.3.4');

    expect(res).toBeNull();
    expect(limit).toHaveBeenCalledWith({ key: 'tax:1.2.3.4' });
  });

  it('returns a 429 with Retry-After when over the limit', async () => {
    const limit = vi.fn().mockResolvedValue({ success: false });
    getCloudflareContext.mockResolvedValue({ env: { AI_RATE_LIMITER: { limit } } });

    const res = await enforceRateLimit('AI_RATE_LIMITER', 'ip:1.2.3.4');

    expect(res).not.toBeNull();
    expect(res!.status).toBe(429);
    expect(res!.headers.get('Retry-After')).toBe('60');
  });

  it('fails open when the binding is not configured', async () => {
    getCloudflareContext.mockResolvedValue({ env: {} });
    expect(await enforceRateLimit('AI_RATE_LIMITER', 'k')).toBeNull();
  });

  it('fails open when the Cloudflare context is unavailable (no Workers runtime)', async () => {
    getCloudflareContext.mockRejectedValue(new Error('no runtime'));
    expect(await enforceRateLimit('PUBLIC_RATE_LIMITER', 'k')).toBeNull();
  });

  it('fails open when the limiter itself throws', async () => {
    const limit = vi.fn().mockRejectedValue(new Error('boom'));
    getCloudflareContext.mockResolvedValue({ env: { AI_RATE_LIMITER: { limit } } });
    expect(await enforceRateLimit('AI_RATE_LIMITER', 'k')).toBeNull();
  });
});
