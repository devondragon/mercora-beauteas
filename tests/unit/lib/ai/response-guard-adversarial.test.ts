/**
 * Adversarial sweep for the Chai response guard (BMC-215).
 *
 * Separate from `response-guard.test.ts` — that file covers the intended
 * behaviour, this one covers evasion. Every payload here is a bypass that was
 * ACTUALLY live at some point during BMC-215 review, not a hypothetical:
 * the userinfo trick, the query-string-embedded second destination, the
 * unlisted-TLD gap, and an all-caps lookalike that the prose heuristic skipped.
 * They are pinned so a future "simplification" of the matcher can't quietly
 * reopen one.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { scrubContacts, guardAssistantReply } from '@/lib/ai/response-guard';
import { SITE_URL, CONTACT_EMAIL } from '@/lib/ai/canonical-facts';

let warnSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  // clearAllMocks first: re-spying an already-spied method returns the SAME spy
  // with its call history intact, so without this the "stays quiet" assertion
  // sees the previous test's warning.
  vi.clearAllMocks();
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('guardAssistantReply logging', () => {
  it('warns when it rewrites, so the silent failure stops being silent', () => {
    const out = guardAssistantReply('Email support@beauteteas.com for help.');
    expect(out).toContain(CONTACT_EMAIL);
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(String(warnSpy.mock.calls[0][0])).toContain('[chai-guard]');
  });

  it('stays quiet on a clean reply', () => {
    guardAssistantReply(`Email ${CONTACT_EMAIL} for help.`);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

describe('adversarial sweep', () => {
  const mustScrub = [
    'https://beauteas.com@evil.com/login',           // real userinfo trick
    'https://beauteas.com.evil.net/phish',           // suffix lookalike
    'http://beauteas.com:8080@attacker.io/x',        // port + userinfo
    'BEAUTEAS.COM.EVIL.COM/login',                   // uppercase suffix lookalike
    'https://www.beauteas.com/r?next=http://bad.io', // embedded, www host
    'beauteas.co/orders',                            // TLD swap
    'support@beauteas.co',                           // email TLD swap
    'https://beauteas.com/x#https://bad.com',        // fragment-embedded
  ];

  it.each(mustScrub)('scrubs %s', (payload) => {
    const { text } = scrubContacts(`Please visit ${payload} today.`);
    expect(text).not.toContain('evil');
    expect(text).not.toContain('attacker');
    expect(text).not.toContain('bad.');
    expect(text === `Please visit ${SITE_URL} today.` || text === `Please visit ${CONTACT_EMAIL} today.`).toBe(true);
  });

  const mustKeep = [
    'https://www.beauteas.com/account/orders',
    'https://img.beauteas.com/blog/a.jpg',
    'https://beauteas.com/faq?topic=steeping&sort=new',
  ];

  it.each(mustKeep)('keeps %s', (url) => {
    const original = `See ${url} for details.`;
    expect(scrubContacts(original)).toEqual({ text: original, replaced: [] });
  });

  it('is fast on a reply at the model token cap', () => {
    // AI_MODELS.CHAT.maxTokens = 400 → ~2KB. Guard must be trivially cheap there.
    const reply = 'Steep the evening blend for 5 min.Then sip. '.repeat(50);
    const start = Date.now();
    scrubContacts(reply);
    expect(Date.now() - start).toBeLessThan(100);
  });
});
