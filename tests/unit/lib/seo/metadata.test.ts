import { describe, it, expect } from 'vitest';
import {
  BASE_URL,
  SITE_NAME,
  resolveLocalizedField,
  resolveImageUrl,
} from '@/lib/seo/metadata';

describe('constants', () => {
  it('BASE_URL is the production URL', () => {
    expect(BASE_URL).toBe('https://beauteas.com');
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
