import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  BASE_URL,
  SITE_NAME,
  resolveLocalizedField,
  resolveImageUrl,
} from '@/lib/seo/metadata';

describe('constants', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  // BASE_URL is env-driven (NEXT_PUBLIC_SITE_URL, set per environment in
  // wrangler.jsonc) so the staging host emits its own canonicals instead of
  // pointing search engines and customer emails at the production site.
  it('BASE_URL falls back to the www canonical when NEXT_PUBLIC_SITE_URL is unset', () => {
    expect(BASE_URL).toBe('https://www.beauteas.com');
  });

  it('BASE_URL is NOT the bare apex — www is the canonical host', () => {
    // Guards the cutover decision (2026-07-27): Shopify served www with
    // apex → www, and www keeps the accumulated link equity, so the apex must
    // never become the canonical.
    expect(BASE_URL).not.toBe('https://beauteas.com');
  });

  it('BASE_URL honours NEXT_PUBLIC_SITE_URL when set (staging host)', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://shop.beauteas.com');
    vi.resetModules();
    const { BASE_URL: staged } = await import('@/lib/seo/metadata');
    expect(staged).toBe('https://shop.beauteas.com');
  });

  it('SITE_NAME is BeauTeas', () => {
    expect(SITE_NAME).toBe('BeauTeas');
  });
});

describe('resolveLocalizedField', () => {
  it('returns a plain string directly', () => {
    expect(resolveLocalizedField('hello')).toBe('hello');
  });

  it('returns the en field from a localized object', () => {
    expect(resolveLocalizedField({ en: 'English', fr: 'Français' })).toBe('English');
  });

  it('returns the first value when en is not present', () => {
    expect(resolveLocalizedField({ fr: 'Français', de: 'Deutsch' })).toBe('Français');
  });

  it('returns the fallback for null input', () => {
    expect(resolveLocalizedField(null)).toBe('');
    expect(resolveLocalizedField(null, 'fallback')).toBe('fallback');
  });

  it('returns the fallback for undefined input', () => {
    expect(resolveLocalizedField(undefined, 'default')).toBe('default');
  });

  it('returns empty string as the default fallback', () => {
    expect(resolveLocalizedField(undefined)).toBe('');
  });

  it('returns the custom fallback for an empty object', () => {
    expect(resolveLocalizedField({}, 'none')).toBe('none');
  });
});

describe('resolveImageUrl', () => {
  const CDN = 'https://img.beauteas.com';

  it('prefixes relative paths with the R2 CDN URL', () => {
    expect(resolveImageUrl('products/image.jpg')).toBe(`${CDN}/products/image.jpg`);
  });

  it('returns absolute https URLs unchanged', () => {
    const url = 'https://example.com/image.jpg';
    expect(resolveImageUrl(url)).toBe(url);
  });

  it('resolves .url property from an object', () => {
    expect(resolveImageUrl({ url: 'products/photo.jpg' })).toBe(`${CDN}/products/photo.jpg`);
  });

  it('resolves .file.url from a MACHMedia-shaped object', () => {
    expect(resolveImageUrl({ file: { url: 'products/photo.jpg' } })).toBe(
      `${CDN}/products/photo.jpg`
    );
  });

  it('returns null for null input', () => {
    expect(resolveImageUrl(null)).toBeNull();
  });

  it('returns null for undefined input', () => {
    expect(resolveImageUrl(undefined)).toBeNull();
  });

  it('returns null for an object with no recognisable url shape', () => {
    expect(resolveImageUrl({ name: 'no url here' })).toBeNull();
  });

  it('handles a .url that is itself an absolute URL', () => {
    const url = 'https://cdn.example.com/img.png';
    expect(resolveImageUrl({ url })).toBe(url);
  });
});
