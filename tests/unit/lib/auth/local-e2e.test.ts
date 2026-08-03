import { describe, expect, it } from 'vitest';
import { shouldBypassClerkForLocalE2E } from '@/lib/auth/local-e2e';

describe('shouldBypassClerkForLocalE2E', () => {
  it('allows only the exact test marker on localhost', () => {
    expect(shouldBypassClerkForLocalE2E('local-playwright-only', 'localhost')).toBe(true);
  });

  it.each([
    [undefined, 'localhost'],
    ['wrong-marker', 'localhost'],
    ['local-playwright-only', 'shop.beauteas.com'],
    ['local-playwright-only', 'www.beauteas.com'],
    ['local-playwright-only', '127.0.0.1'],
  ])('fails closed for marker %s and hostname %s', (marker, hostname) => {
    expect(shouldBypassClerkForLocalE2E(marker, hostname)).toBe(false);
  });
});
