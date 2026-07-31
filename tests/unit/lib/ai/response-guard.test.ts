/**
 * Regression tests for the Chai response guard (BMC-215).
 *
 * AC: "No email address or URL outside an allowlist can appear in a Chai
 * response." These cover the guard itself; `agent-chat-deterministic.test.ts`
 * covers that every route exit actually runs it.
 *
 * The false-positive cases matter as much as the true positives — a guard that
 * mangles ordinary tea copy into a site link is a worse bug than the one it
 * fixes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { scrubContacts, isAllowedEmail, isAllowedHost } from '@/lib/ai/response-guard';
import { CONTACT_EMAIL, SITE_URL } from '@/lib/ai/canonical-facts';

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('scrubContacts — invented email addresses (BMC-215)', () => {
  it('rewrites the exact address hallucinated in production', () => {
    const { text, replaced } = scrubContacts(
      'You can reach us at support@beauteteas.com for help with your order.'
    );
    expect(text).toBe(`You can reach us at ${CONTACT_EMAIL} for help with your order.`);
    expect(replaced).toEqual(['support@beauteteas.com']);
  });

  it('rewrites a plausible address on the CORRECT domain', () => {
    // The domain being right doesn't make the mailbox real.
    const { text } = scrubContacts('Email support@beauteas.com and we will help.');
    expect(text).toBe(`Email ${CONTACT_EMAIL} and we will help.`);
  });

  it('leaves the canonical address untouched, including odd casing', () => {
    const original = `Write to ${CONTACT_EMAIL} any time.`;
    expect(scrubContacts(original)).toEqual({ text: original, replaced: [] });

    const upper = 'Write to INFO@BEAUTEAS.COM any time.';
    expect(scrubContacts(upper).replaced).toEqual([]);
    expect(scrubContacts(upper).text).toBe(upper);
  });

  it('preserves a mailto: prefix so markdown links stay well-formed', () => {
    const { text } = scrubContacts('[Contact us](mailto:help@wrong-domain.com)');
    expect(text).toBe(`[Contact us](mailto:${CONTACT_EMAIL})`);
  });

  it('keeps trailing sentence punctuation attached to the sentence', () => {
    const { text } = scrubContacts('Just email orders@fake-shop.com.');
    expect(text).toBe(`Just email ${CONTACT_EMAIL}.`);
  });

  it('rewrites every bad address in a reply, not just the first', () => {
    const { text, replaced } = scrubContacts(
      'Try help@nope.com or returns@alsonope.com if that fails.'
    );
    expect(text).toBe(`Try ${CONTACT_EMAIL} or ${CONTACT_EMAIL} if that fails.`);
    expect(replaced).toHaveLength(2);
  });
});

describe('scrubContacts — invented URLs (BMC-215)', () => {
  it('rewrites an off-site absolute URL', () => {
    const { text, replaced } = scrubContacts('See https://evil.example.net/returns for details.');
    expect(text).toBe(`See ${SITE_URL} for details.`);
    expect(replaced).toEqual(['https://evil.example.net/returns']);
  });

  it('rewrites a bare lookalike domain with no scheme', () => {
    const { text } = scrubContacts('Visit beauteteas.com/orders to track it.');
    expect(text).toBe(`Visit ${SITE_URL} to track it.`);
  });

  it('rewrites a www-prefixed off-site host', () => {
    const { text } = scrubContacts('Go to www.some-other-shop.com now.');
    expect(text).toBe(`Go to ${SITE_URL} now.`);
  });

  it('leaves BeauTeas-owned URLs untouched', () => {
    const owned = [
      'https://www.beauteas.com/account/orders',
      'https://beauteas.com/faq',
      'https://shop.beauteas.com/product/morning',
      'https://img.beauteas.com/blog/steeping.jpg',
      SITE_URL,
    ];
    for (const url of owned) {
      const original = `Head to ${url} for that.`;
      expect(scrubContacts(original)).toEqual({ text: original, replaced: [] });
    }
  });

  it('leaves relative links untouched', () => {
    const original = 'You can find it at /account/orders on the site.';
    expect(scrubContacts(original)).toEqual({ text: original, replaced: [] });
  });

  // An earlier 10-entry TLD list let a bare `evil.xyz` through untouched, which
  // broke the guard's guarantee for most of the real TLD space (BMC-215 review).
  const tlds = [
    'com', 'net', 'org', 'info', 'biz', 'io', 'co', 'ai', 'app', 'dev', 'us',
    'uk', 'ca', 'de', 'me', 'tv', 'ly', 'xyz', 'top', 'club', 'shop', 'store',
    'online', 'site', 'life', 'live', 'world', 'today', 'email', 'help',
    'support', 'care', 'health', 'beauty', 'organic', 'green', 'market',
    'gift', 'brand', 'company', 'global', 'team', 'agency', 'services',
    'digital', 'media', 'news', 'blog', 'link', 'click', 'one', 'now',
  ];

  it.each(tlds)('rewrites a bare lookalike domain on .%s', (tld) => {
    const { text, replaced } = scrubContacts(`Reach us at fake-beauteas.${tld} instead.`);
    expect(text).toBe(`Reach us at ${SITE_URL} instead.`);
    expect(replaced).toEqual([`fake-beauteas.${tld}`]);
  });

  it('rewrites an off-site URL hidden in an allowlisted host\'s query string', () => {
    // Matching only the LEADING host is not enough — the second destination
    // rides through on the first host's reputation.
    const { text, replaced } = scrubContacts(
      'we are at https://beauteas.com/redirect?to=https://evil-phish.com/login'
    );
    expect(text).toBe(`we are at ${SITE_URL}`);
    expect(replaced).toHaveLength(1);
    expect(text).not.toContain('evil-phish.com');
  });

  it('rewrites an off-site host carrying a real address in its query string', () => {
    // Classification is by WHICH regex branch matched, not by "contains @" —
    // otherwise this reads as an email and is accepted on the strength of the
    // canonical address sitting in its query string.
    const { text } = scrubContacts('Visit evil-tracker.net/track?ref=info@beauteas.com now.');
    expect(text).toBe(`Visit ${SITE_URL} now.`);
    expect(text).not.toContain('evil-tracker.net');
  });

  it('rewrites a percent-encoded embedded destination', () => {
    const { text } = scrubContacts('go to https://beauteas.com/go?u=https%3A%2F%2Fevil.com');
    expect(text).toBe(`go to ${SITE_URL}`);
  });

  it('does not re-inspect the domain of an address it just rewrote', () => {
    // Single-pass alternation: the rewritten address must not then be seen as a
    // bare domain and replaced again with the site URL.
    const { text, replaced } = scrubContacts('Email support@beauteteas.com today.');
    expect(text).toBe(`Email ${CONTACT_EMAIL} today.`);
    expect(text).not.toContain(SITE_URL);
    expect(replaced).toHaveLength(1);
  });
});

describe('scrubContacts — no false positives on ordinary copy (BMC-215)', () => {
  const untouched = [
    // Run-together sentences are the false-positive case the TLD list and the
    // lowercase-TLD check exist to protect. `min.Then` is shaped exactly like a
    // hostname; the capital T is what distinguishes it from one.
    'Steep for 5 min.Then sip slowly and enjoy the glow.',
    'Let it cool.Then add honey if you like.',
    'Our blends are USDA organic, e.g. calendula and chamomile.',
    'That one is $18.99 for a 30-serving tin.',
    'Try the Evening blend...it is so cozy.',
    'Morning, Afternoon, Evening — pick your ritual.',
    'It contains calendula, chamomile, and rose. No caffeine!',
    'Rated 4.9 out of 5 by customers.',
  ];

  it.each(untouched)('leaves %j byte-for-byte unchanged', (copy) => {
    expect(scrubContacts(copy)).toEqual({ text: copy, replaced: [] });
  });

  it('handles empty and non-string input safely', () => {
    expect(scrubContacts('')).toEqual({ text: '', replaced: [] });
    expect(scrubContacts(undefined as unknown as string).replaced).toEqual([]);
    expect(scrubContacts(null as unknown as string).replaced).toEqual([]);
  });
});

describe('allowlist predicates (BMC-215)', () => {
  it('accepts only the canonical mailbox', () => {
    expect(isAllowedEmail(CONTACT_EMAIL)).toBe(true);
    expect(isAllowedEmail(CONTACT_EMAIL.toUpperCase())).toBe(true);
    expect(isAllowedEmail('support@beauteas.com')).toBe(false);
    expect(isAllowedEmail('info@beauteteas.com')).toBe(false);
  });

  it('accepts only BeauTeas-owned hosts, and never a suffix lookalike', () => {
    expect(isAllowedHost('beauteas.com')).toBe(true);
    expect(isAllowedHost('WWW.BEAUTEAS.COM')).toBe(true);
    expect(isAllowedHost('beauteteas.com')).toBe(false);
    // Exact-match allowlist: an attacker-controlled suffix must not pass.
    expect(isAllowedHost('beauteas.com.evil.net')).toBe(false);
    expect(isAllowedHost('notbeauteas.com')).toBe(false);
  });
});
