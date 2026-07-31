/**
 * Regression tests for the Chai deterministic-answer classifier (BMC-215).
 *
 * The production failure was PHRASING-dependent: "What is your customer support
 * email address?" answered correctly while "What email address should I use to
 * contact support about my order?" invented `support@beauteteas.com`. So these
 * tests lean on breadth of phrasing per category rather than one happy path, and
 * pin the exact question that failed.
 *
 * Pure module — no mocks, no bindings.
 */
import { describe, it, expect } from 'vitest';

import { classifyQuery, DETERMINISTIC_CATEGORIES } from '@/lib/ai/deterministic-answers';
import {
  BUSINESS_ADDRESS_LINE,
  CONTACT_EMAIL,
  ORDER_HISTORY_URL,
} from '@/lib/ai/canonical-facts';

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

  it.each(phrasings)('answers %j deterministically with the canonical address', (question) => {
    const result = classifyQuery(question);
    expect(result).not.toBeNull();
    expect(result!.category).toBe('contact_email');
    expect(result!.answer).toContain(CONTACT_EMAIL);
  });

  it('never emits an address other than the canonical one', () => {
    for (const question of phrasings) {
      const answer = classifyQuery(question)!.answer;
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

  it.each(phrasings)('routes %j to the account orders page', (question) => {
    const result = classifyQuery(question);
    expect(result).not.toBeNull();
    expect(result!.category).toBe('order_status');
    expect(result!.answer).toContain(ORDER_HISTORY_URL);
  });

  it('prefers the contact-email category when a question asks for an email but mentions an order', () => {
    // Category ORDER matters: an order-status rule evaluated first would swallow
    // the phrasing that originally failed and answer the wrong question.
    const result = classifyQuery(
      'What email address should I use to contact support about my order?'
    );
    expect(result!.category).toBe('contact_email');
  });
});

describe('classifyQuery — business address (BMC-215)', () => {
  const phrasings = [
    'What is your mailing address?',
    'what is your business address',
    'Can I have your return address?',
    'Where are you located?',
    "What's your address?",
    'where is beauteas based',
  ];

  it.each(phrasings)('answers %j from the CAN-SPAM footer address', (question) => {
    const result = classifyQuery(question);
    expect(result).not.toBeNull();
    expect(result!.category).toBe('business_address');
    expect(result!.answer).toContain(BUSINESS_ADDRESS_LINE);
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
    'What is your refund window?',
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
});

describe('deterministic category table (BMC-215)', () => {
  it('exposes categories in match order, contact_email first', () => {
    expect(DETERMINISTIC_CATEGORIES[0]).toBe('contact_email');
    expect([...DETERMINISTIC_CATEGORIES]).toEqual([
      'contact_email',
      'order_status',
      'business_address',
    ]);
  });
});
