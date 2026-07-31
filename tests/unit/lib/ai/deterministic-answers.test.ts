/**
 * Regression tests for the Chai deterministic-answer classifier (BMC-215).
 *
 * The production failure was PHRASING-dependent: "What is your customer support
 * email address?" answered correctly while "What email address should I use to
 * contact support about my order?" invented `support@beauteteas.com`. So these
 * tests lean on breadth of phrasing per category rather than one happy path, and
 * pin the exact question that failed.
 *
 * BMC-243 adds `refund_window`, the first category whose value comes from D1.
 * The settings layer is mocked here rather than the Cloudflare binding, per the
 * repo's unit-test rule.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const getRefundPolicy = vi.fn();
vi.mock('@/lib/utils/settings', () => ({
  getRefundPolicy: (...args: unknown[]) => getRefundPolicy(...args),
}));

import {
  classifyQuery,
  resolveDeterministicAnswer,
  DETERMINISTIC_CATEGORIES,
} from '@/lib/ai/deterministic-answers';
import {
  BUSINESS_ADDRESS_LINE,
  CONTACT_EMAIL,
  ORDER_HISTORY_URL,
  REFUND_POLICY_URL,
} from '@/lib/ai/canonical-facts';

beforeEach(() => {
  vi.clearAllMocks();
  getRefundPolicy.mockResolvedValue({ returnWindowDays: 30 });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('classifyQuery — contact email (BMC-215)', () => {
  const phrasings = [
    // The exact question that hallucinated in production on 2026-07-27.
    'What email address should I use to contact support about my order?',
    'What is your customer support email address?',
    'How do I contact BeauTeas?',
    'how can i reach you',
    'How do I get in touch with someone?',
    "What's your email?",
    'whats the support email',
    'Which email do I use for returns?',
    'Can I email your team?',
    'I want to speak to a human',
    'talk to customer service please',
    'contact info?',
    'Where do I email you about a subscription problem?',
  ];

  it.each(phrasings)('answers %j deterministically with the canonical address', async (question) => {
    const category = classifyQuery(question);
    expect(category).toBe('contact_email');
    expect(await resolveDeterministicAnswer(category!)).toContain(CONTACT_EMAIL);
  });

  it('never emits an address other than the canonical one', async () => {
    for (const question of phrasings) {
      const answer = await resolveDeterministicAnswer(classifyQuery(question)!);
      const addresses = answer.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? [];
      expect(addresses.length).toBeGreaterThan(0);
      for (const address of addresses) expect(address).toBe(CONTACT_EMAIL);
    }
  });
});

describe('classifyQuery — order status (BMC-215)', () => {
  const phrasings = [
    'Where is my order?',
    "where's my order",
    'How do I track my package?',
    'tracking for my shipment',
    'order status',
    'Can I get an update on my order?',
    'Has my order shipped yet?',
    'When will my order arrive?',
    'when does my package get here',
  ];

  it.each(phrasings)('routes %j to the account orders page', async (question) => {
    const category = classifyQuery(question);
    expect(category).toBe('order_status');
    expect(await resolveDeterministicAnswer(category!)).toContain(ORDER_HISTORY_URL);
  });

  it('prefers contact_email for phrasings that genuinely match BOTH categories', () => {
    // These must match an order_status pattern too, or this test proves nothing
    // about rule ordering — it would pass with the table in any order. The
    // production phrasing ("...to contact support about my order?") does NOT
    // match any order_status pattern, so it is a poor ordering probe; these are
    // the real ones.
    const ambiguous = [
      'Where can I email you about my order status?',
      'What email do I use to track my order?',
      'Who do I email when my order status is wrong?',
    ];

    for (const question of ambiguous) {
      // Guard the premise: if these stop overlapping, the test silently rots.
      const orderStatusPhrasings = /\border status\b|\btrack\b/i;
      expect(orderStatusPhrasings.test(question)).toBe(true);

      expect(classifyQuery(question)).toBe('contact_email');
    }
  });
});

describe('classifyQuery — business address (BMC-215)', () => {
  const phrasings = [
    'What is your mailing address?',
    'what is your business address',
    'What is your postal address?',
    'Can I have your physical address?',
    'What is your company address?',
    'Can I have your return address?',
    'Whats your street address?',
    'Where are you located?',
    "What's your address?",
    'where is beauteas based',
    'Where is your office located?',
    'Where is your warehouse located?',
    'What is your headquarters address?',
    'whats your hq',
  ];

  it.each(phrasings)('answers %j from the CAN-SPAM footer address', async (question) => {
    const category = classifyQuery(question);
    expect(category).toBe('business_address');
    expect(await resolveDeterministicAnswer(category!)).toContain(BUSINESS_ADDRESS_LINE);
  });
});

describe('classifyQuery — refund window (BMC-243)', () => {
  const phrasings = [
    'What is your return policy?',
    "what's your refund policy",
    'How long do I have to return something?',
    'how many days do I have to send it back',
    'Can I still return this?',
    'can i get a refund',
    'What is the refund window?',
    'What is the deadline for a return?',
    'Do you accept returns?',
    'whats your return period',
  ];

  it.each(phrasings)('answers %j from the refund settings', async (question) => {
    const category = classifyQuery(question);
    expect(category).toBe('refund_window');

    const answer = await resolveDeterministicAnswer(category!);
    expect(answer).toContain('30 days');
    expect(answer).toContain(REFUND_POLICY_URL);
    expect(getRefundPolicy).toHaveBeenCalled();
  });

  it('reflects a changed setting rather than a baked-in number', async () => {
    // The whole point of reading D1: an admin changing the window must change
    // what Chai says, with no code edit.
    getRefundPolicy.mockResolvedValue({ returnWindowDays: 45 });
    const answer = await resolveDeterministicAnswer('refund_window');
    expect(answer).toContain('45 days');
    expect(answer).not.toContain('30 days');
  });

  it('states NO number when the settings read fails', async () => {
    // A wrong return window is the same class of failure as the invented support
    // address that started this work — and the response guard only rewrites
    // emails and URLs, so it cannot catch a bad number. Degrade to the policy
    // page rather than guess.
    getRefundPolicy.mockRejectedValue(new Error('D1 unavailable'));

    const answer = await resolveDeterministicAnswer('refund_window');

    expect(answer).toContain(REFUND_POLICY_URL);
    expect(answer).toContain(CONTACT_EMAIL);
    expect(answer).not.toMatch(/\d+\s*days/i);
  });

  it('still prefers contact_email when the question asks who to email about a return', () => {
    expect(classifyQuery('Which email do I use for returns?')).toBe('contact_email');
  });
});

describe('classifyQuery — leaves ordinary questions to retrieval (BMC-215)', () => {
  const passthrough = [
    'Which tea helps with breakouts?',
    'Do you have anything with chamomile?',
    'How long should I steep the evening blend?',
    'Is the calendula blend caffeine free?',
    'hi',
    'What is in the Morning blend?',
    'Can I gift a subscription?',
    // Mentions "address" but is about the CUSTOMER's shipping address, not ours.
    'Can I change the shipping address on my subscription?',
    'How much does shipping cost?',
    // "Where are you ..." small talk must NOT be read as an address question.
    // The location qualifier is required precisely so these reach the model.
    'Where are you today?',
    'Where are you going?',
    'Where are you from?',
  ];

  it.each(passthrough)('returns null for %j', (question) => {
    expect(classifyQuery(question)).toBeNull();
  });

  it('returns null for empty and non-string input', () => {
    expect(classifyQuery('')).toBeNull();
    expect(classifyQuery('   ')).toBeNull();
    expect(classifyQuery(undefined as unknown as string)).toBeNull();
    expect(classifyQuery(null as unknown as string)).toBeNull();
  });

  it('performs NO I/O on a miss (BMC-243)', () => {
    // This is the property that makes it safe to run the classifier ahead of
    // every chat request. If classification ever goes async or reads settings
    // eagerly, every ordinary product question starts paying for D1.
    for (const question of passthrough) classifyQuery(question);
    expect(getRefundPolicy).not.toHaveBeenCalled();
  });
});

describe('deterministic category table (BMC-215)', () => {
  it('exposes categories in match order, contact_email first', () => {
    expect(DETERMINISTIC_CATEGORIES[0]).toBe('contact_email');
    expect([...DETERMINISTIC_CATEGORIES]).toEqual([
      'contact_email',
      'order_status',
      'business_address',
      'refund_window',
    ]);
  });
});
