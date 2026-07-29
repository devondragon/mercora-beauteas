/**
 * Regression tests for the Next.js custom image loader.
 *
 * Guards the 2026-07-27 production fault: `image-loader.ts` routed every image
 * through Cloudflare Image Transformations (`/cdn-cgi/image/...`), which
 * requires Transformations to be ENABLED for the zone. It wasn't, so every
 * transform URL 404'd and the whole storefront rendered with broken images.
 *
 * The fault could not reproduce in dev, because dev leaves NEXT_PUBLIC_IMAGE_CDN
 * unset and falls back to the same-origin /media route — so the transform path
 * was only ever exercised in production.
 *
 * These tests pin BOTH paths, including the NEXT_PUBLIC_IMAGE_TRANSFORMS="false"
 * escape hatch that lets prod recover with a config change rather than a code
 * change.
 *
 * The loader reads env at MODULE LOAD time, so each case must stub the env and
 * re-import via vi.resetModules().
 */

import { describe, it, expect, afterEach, vi } from 'vitest';

const CDN = 'https://img.beauteas.com';
const KEY = 'products/clearly-calendula-afternoon.jpg';

/** Load a fresh copy of the loader under a specific env. */
async function loadLoader(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) vi.stubEnv(k, '');
    else vi.stubEnv(k, v);
  }
  const mod = await import('@/image-loader');
  return mod.default;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('image loader — transform path (production default)', () => {
  it('routes through /cdn-cgi/image when a CDN is set and transforms are enabled', async () => {
    const loader = await loadLoader({
      NEXT_PUBLIC_IMAGE_CDN: CDN,
      NEXT_PUBLIC_IMAGE_TRANSFORMS: 'true',
    });
    const url = loader({ src: `/${KEY}`, width: 800, quality: 80 });
    expect(url).toContain('/cdn-cgi/image/');
    expect(url).toContain('width=800');
    expect(url).toContain(KEY);
  });

  it('defaults to transforms when NEXT_PUBLIC_IMAGE_TRANSFORMS is unset', async () => {
    const loader = await loadLoader({ NEXT_PUBLIC_IMAGE_CDN: CDN });
    expect(loader({ src: `/${KEY}`, width: 640 })).toContain('/cdn-cgi/image/');
  });
});

describe('image loader — fallback when transforms are disabled', () => {
  it('serves the raw object off the CDN host, with NO /cdn-cgi/image segment', async () => {
    const loader = await loadLoader({
      NEXT_PUBLIC_IMAGE_CDN: CDN,
      NEXT_PUBLIC_IMAGE_TRANSFORMS: 'false',
    });
    const url = loader({ src: `/${KEY}`, width: 800, quality: 80 });
    expect(url).toBe(`${CDN}/${KEY}`);
    expect(url).not.toContain('cdn-cgi');
  });

  it('still produces a usable URL for a src already carrying a transform prefix', async () => {
    const loader = await loadLoader({
      NEXT_PUBLIC_IMAGE_CDN: CDN,
      NEXT_PUBLIC_IMAGE_TRANSFORMS: 'false',
    });
    const stored = `${CDN}/cdn-cgi/image/width=3840,format=auto/${KEY}`;
    const url = loader({ src: stored, width: 800 });
    expect(url).toBe(`${CDN}/${KEY}`);
    expect(url).not.toContain('cdn-cgi');
  });
});

describe('image loader — no CDN configured (dev Worker)', () => {
  it('falls back to the same-origin /media route', async () => {
    const loader = await loadLoader({ NEXT_PUBLIC_IMAGE_CDN: undefined });
    expect(loader({ src: `/${KEY}`, width: 800 })).toBe(`/media/${KEY}`);
  });
});

describe('image loader — external URLs', () => {
  it('passes third-party images through untouched', async () => {
    const loader = await loadLoader({
      NEXT_PUBLIC_IMAGE_CDN: CDN,
      NEXT_PUBLIC_IMAGE_TRANSFORMS: 'true',
    });
    const external = 'https://img.clerk.com/avatar.png';
    expect(loader({ src: external, width: 64 })).toBe(external);
  });
});
