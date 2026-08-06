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
 * BMC-242 adds `shipping_rates`, which reads the storefront shipping model.
 * The settings layer is mocked here rather than the Cloudflare binding, per the
 * repo's unit-test rule.
 *
 * NOTE: only `@/lib/utils/settings` is mocked. `lib/services/shipping-options.ts`
 * is left REAL so these tests exercise the actual rate card — including its
 * built-in defaults — rather than a stand-in. That is the point of BMC-242's
 * "no copied constants" requirement: if someone re-hardcodes $5.99 in the AI
 * layer, or the storefront defaults change without the answer following, the
 * `getSettings` → `{}` cases below break.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const getRefundPolicy = vi.fn();
const getSettings = vi.fn();
vi.mock('@/lib/utils/settings', () => ({
  getRefundPolicy: (...args: unknown[]) => getRefundPolicy(...args),
  getSettings: (...args: unknown[]) => getSettings(...args),
}));

// `@/lib/sale/rules` is intentionally NOT mocked — it's pure and should run for
// real. Only the D1 read (`getSaleRules`, in `@/lib/sale/settings`) is mocked,
// matching how `@/lib/utils/settings` is handled above.
const getSaleRules = vi.fn();
vi.mock('@/lib/sale/settings', () => ({
  getSaleRules: (...args: unknown[]) => getSaleRules(...args),
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
  SHIPPING_POLICY_URL,
  SITE_URL,
} from '@/lib/ai/canonical-facts';

beforeEach(() => {
  vi.clearAllMocks();
  getRefundPolicy.mockResolvedValue({ returnWindowDays: 30 });
  // Pre-sale posture by default so every pre-existing test below (written
  // before the GOOB sale existed) keeps asserting the return-window answer
  // without having to know about `getSaleRules`. GOOB-specific tests override
  // this per-case.
  getSaleRules.mockResolvedValue({
    minimumBoxes: 10,
    finalSale: false,
    subscriptionsEnabled: false,
    tiers: [],
  });
  // `{}` → the storefront defaults baked into `shipping-options.ts`
  // (standard $5.99 / express $9.99 / overnight $19.99, free ≥ $75 on standard).
  getSettings.mockResolvedValue({});
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

describe('classifyQuery — shipping rates and timelines (BMC-242)', () => {
  const phrasings = [
    'How much does shipping cost?',
    'how much is shipping',
    'What are your shipping rates?',
    "What's the shipping cost?",
    'What is the cost of shipping?',
    'Do you offer free shipping?',
    'is there free shipping',
    'Do you offer free-shipping?',
    'whats the free-shipping minimum',
    'How long does shipping take?',
    'how long does delivery take',
    'How fast do you ship?',
    'How soon will it get here?',
    'What are my shipping options?',
    'what are your shipping methods',
    'delivery times?',
    'Do you offer overnight shipping?',
    'do you have express',
    'How much for express shipping?',
    // Domestic destination questions: the rate card is flat, so these are
    // answerable. An earlier exclude of any "shipping to ..." swallowed them.
    'How much is shipping to Colorado?',
    'How long does shipping to California take?',
    'How much is shipping to my address?',
  ];

  it.each(phrasings)('answers %j from the storefront rate card', async (question) => {
    const category = classifyQuery(question);
    expect(category).toBe('shipping_rates');

    const answer = await resolveDeterministicAnswer(category!);
    // Rates come from `shipping-options.ts`, not a literal in the AI layer.
    expect(answer).toContain('$5.99');
    expect(answer).toContain('$9.99');
    expect(answer).toContain('$19.99');
    expect(answer).toContain(SHIPPING_POLICY_URL);
    expect(getSettings).toHaveBeenCalledWith('shipping');
    expect(getSettings).toHaveBeenCalledWith('store');
  });

  it('states the free-shipping THRESHOLD and never that the shopper qualifies', async () => {
    const answer = await resolveDeterministicAnswer('shipping_rates');

    // The policy, as a condition on the order — not a claim about this person.
    expect(answer).toContain('$75.00 or more');
    expect(answer).toMatch(/i can'?t see your cart/i);
    // The rate card is US-only, so a destination question can't read as an
    // international quote.
    expect(answer).toMatch(/within the US|US rates/);
    // No second-person qualification claim.
    expect(answer).not.toMatch(/you (qualify|get free|have free|are eligible)/i);
    expect(answer).not.toMatch(/your order ships free/i);
    // And the quoted rates are the UNDISCOUNTED ones: standard is still $5.99,
    // which is only true if the lookup passed a $0 subtotal.
    expect(answer).toContain('$5.99');
  });

  it('reflects admin-configured methods and threshold rather than baked-in rates', async () => {
    getSettings.mockImplementation(async (category: string) =>
      category === 'shipping'
        ? {
            'shipping.methods': [
              { id: 'ground', label: 'Ground', cost: 4.5, estimatedDays: 6, enabled: true },
              { id: 'air', label: 'Air (1–2 days)', cost: 24, estimatedDays: 2, enabled: true },
              { id: 'retired', label: 'Retired', cost: 1, estimatedDays: 9, enabled: false },
            ],
            'shipping.free_methods': ['ground'],
          }
        : { 'store.free_shipping_threshold': 120 }
    );

    const answer = await resolveDeterministicAnswer('shipping_rates');

    expect(answer).toContain('Ground — $4.50');
    // The label carries no timing, so the estimate is appended from the setting.
    expect(answer).toContain('about 6 business days');
    expect(answer).toContain('Air (1–2 days) — $24.00');
    expect(answer).toContain('$120.00 or more');
    expect(answer).toContain('ship free via Ground');
    // Disabled methods are not quoted.
    expect(answer).not.toContain('Retired');
    // Nothing from the defaults leaks through.
    expect(answer).not.toContain('$5.99');
  });

  it.each([
    [['ground', 'air'], 'Ground and Air'],
    [['ground', 'air', 'rocket'], 'Ground, Air and Rocket'],
  ])('joins %j free-eligible methods as %j', async (freeMethods, expected) => {
    // A store can make more than one method free. Without this the two- and
    // three-item branches of the list join never run.
    getSettings.mockImplementation(async (category: string) =>
      category === 'shipping'
        ? {
            'shipping.methods': [
              { id: 'ground', label: 'Ground', cost: 4, estimatedDays: 6, enabled: true },
              { id: 'air', label: 'Air', cost: 12, estimatedDays: 2, enabled: true },
              { id: 'rocket', label: 'Rocket', cost: 99, estimatedDays: 1, enabled: true },
            ],
            'shipping.free_methods': freeMethods,
          }
        : {}
    );

    expect(await resolveDeterministicAnswer('shipping_rates')).toContain(
      `ship free via ${expected}`
    );
  });

  it('omits the free-shipping sentence when no enabled method is eligible', async () => {
    getSettings.mockImplementation(async (category: string) =>
      category === 'shipping'
        ? {
            'shipping.methods': [
              { id: 'flat', label: 'Flat rate', cost: 7, estimatedDays: 4, enabled: true },
            ],
            'shipping.free_methods': [],
          }
        : {}
    );

    const answer = await resolveDeterministicAnswer('shipping_rates');

    expect(answer).toContain('Flat rate — $7.00');
    expect(answer).not.toMatch(/free/i);
  });

  // `shipping.methods` is admin-edited JSON, so a cost field can arrive cleared
  // or the wrong type. EVERY one of these coerces to 0 under `Number(raw)` and
  // would render as "free" — advertising a rate we don't charge, the same
  // failure class as an invented price.
  it.each([
    ['missing', undefined],
    ['null', null],
    ['empty string', ''],
    ['blank string', '   '],
    ['empty array', []],
    ['boolean', false],
    ['non-numeric string', 'abc'],
  ])('states NO rate rather than "free" when cost is %s', async (_label, cost) => {
    getSettings.mockImplementation(async (category: string) =>
      category === 'shipping'
        ? {
            'shipping.methods': [
              { id: 'broken', label: 'Broken', cost, estimatedDays: 3, enabled: true },
            ],
          }
        : {}
    );

    const answer = await resolveDeterministicAnswer('shipping_rates');

    expect(answer).not.toMatch(/free/i);
    expect(answer).not.toMatch(/\$\s*\d/);
    expect(answer).toContain(SHIPPING_POLICY_URL);
  });

  it('still reports a genuinely zero-cost method as free', async () => {
    // The guard above must not swallow the real case: cost 0 means free.
    getSettings.mockImplementation(async (category: string) =>
      category === 'shipping'
        ? {
            'shipping.methods': [
              { id: 'std', label: 'Standard', cost: 0, estimatedDays: 4, enabled: true },
            ],
          }
        : {}
    );

    expect(await resolveDeterministicAnswer('shipping_rates')).toContain('Standard — free');
  });

  it('states NO rate rather than "free" when the threshold is unreadable', async () => {
    // A garbled `store.free_shipping_threshold` makes `Money.fromMajor` throw
    // inside the shared seam, so the whole answer degrades to the policy page.
    // Pinned because the wrong outcome here — announcing free shipping off an
    // unreadable setting — is exactly the confidently-wrong failure BMC-242
    // exists to prevent.
    getSettings.mockImplementation(async (category: string) =>
      category === 'shipping'
        ? {
            'shipping.methods': [
              { id: 'standard', label: 'Standard', cost: 6, estimatedDays: 5, enabled: true },
            ],
            'shipping.free_methods': ['standard'],
          }
        : { 'store.free_shipping_threshold': 'not-a-number' }
    );

    const answer = await resolveDeterministicAnswer('shipping_rates');

    expect(answer).not.toMatch(/free/i);
    expect(answer).not.toMatch(/\$\s*\d/);
    expect(answer).toContain(SHIPPING_POLICY_URL);
  });

  it('states NO rate when the settings read fails', async () => {
    // Same rule as the refund window: the response guard rewrites invented
    // emails and URLs but cannot catch an invented price, so a degraded read
    // points at the policy page instead of guessing a number.
    getSettings.mockRejectedValue(new Error('D1 unavailable'));

    const answer = await resolveDeterministicAnswer('shipping_rates');

    expect(answer).toContain(SHIPPING_POLICY_URL);
    expect(answer).toContain(CONTACT_EMAIL);
    expect(answer).not.toMatch(/\$\s*\d/);
  });

  it('states NO rate when no shipping method is enabled', async () => {
    getSettings.mockImplementation(async (category: string) =>
      category === 'shipping'
        ? { 'shipping.methods': [{ id: 'off', label: 'Off', cost: 3, estimatedDays: 3, enabled: false }] }
        : {}
    );

    const answer = await resolveDeterministicAnswer('shipping_rates');

    expect(answer).toContain(SHIPPING_POLICY_URL);
    expect(answer).not.toMatch(/\$\s*\d/);
  });

  it('leaves questions the rate card cannot answer to retrieval', async () => {
    const notOurs = [
      // Return postage is a different policy from the outbound rate card.
      'How much does return shipping cost?',
      'Do I have to pay shipping to send it back?',
      // Destination COVERAGE is not in the rate card (US-only rates).
      'Do you ship to Canada?',
      'do you ship internationally',
      'Can you ship overseas?',
      'Do you ship outside the US?',
      'What are your international shipping rates?',
      'Who pays customs duties?',
      // The customer's own address on an order.
      'Can I change the shipping address on my subscription?',
      // Packaging/sustainability, not rates. A bare /\bfree shipping\b/ matches
      // inside "plastic-free shipping" and hands these the rate card.
      'Do you use plastic-free shipping materials?',
      'Is your packaging carbon-free shipping?',
      // Carrier and materials questions belong to retrieval.
      'What shipping carrier do you use?',
      'Is your shipping carbon neutral?',
      'Where do you ship from?',
    ];

    for (const question of notOurs) expect(classifyQuery(question)).not.toBe('shipping_rates');
  });

  it('leaves "when will MY order arrive" to order_status, not the rate card', () => {
    // A question about ONE shipment must route to the account page, not to a
    // generic rate card that cannot see their order.
    expect(classifyQuery('When will my order arrive?')).toBe('order_status');
    expect(classifyQuery('Has my order shipped yet?')).toBe('order_status');
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

  it('performs NO I/O on a miss (BMC-243, BMC-242)', () => {
    // This is the property that makes it safe to run the classifier ahead of
    // every chat request. If classification ever goes async or reads settings
    // eagerly, every ordinary product question starts paying for D1.
    for (const question of passthrough) classifyQuery(question);
    expect(getRefundPolicy).not.toHaveBeenCalled();
    expect(getSettings).not.toHaveBeenCalled();
  });

  it('performs NO I/O for a question a rule EXCLUDES (BMC-242)', () => {
    // An exclusion must be a plain miss, not a hit that resolves and discards —
    // otherwise adding exclusions quietly puts D1 back on the miss path.
    classifyQuery('How much does return shipping cost?');
    classifyQuery('Do you ship internationally?');
    expect(getSettings).not.toHaveBeenCalled();
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
      'minimum_order',
      'store_closing',
      'tea_freshness',
      'shipping_rates',
    ]);
  });
});

describe('final-sale returns answer (GOOB)', () => {
  it('states that sales are final instead of quoting a return window', async () => {
    getSaleRules.mockResolvedValue({
      minimumBoxes: 10,
      finalSale: true,
      subscriptionsEnabled: false,
      tiers: [],
    });

    const category = classifyQuery('what is your return policy?');
    expect(category).toBe('refund_window');
    const answer = await resolveDeterministicAnswer(category!);

    expect(answer).toMatch(/final/i);
    expect(answer).not.toMatch(/\d+ days/);
  });

  it('still names the damaged-or-lost exception so the policy reads as fair', async () => {
    getSaleRules.mockResolvedValue({
      minimumBoxes: 10,
      finalSale: true,
      subscriptionsEnabled: false,
      tiers: [],
    });

    const category = classifyQuery('can i return this?');
    const answer = await resolveDeterministicAnswer(category!);

    expect(answer).toMatch(/damaged|arrives? broken|never arrives/i);
  });

  it('falls back to the return window when final sale is off', async () => {
    getSaleRules.mockResolvedValue({
      minimumBoxes: 10,
      finalSale: false,
      subscriptionsEnabled: false,
      tiers: [],
    });
    getRefundPolicy.mockResolvedValue({ returnWindowDays: 30 });

    const category = classifyQuery('what is your return policy?');
    expect(await resolveDeterministicAnswer(category!)).toMatch(/30 days/);
  });
});

describe('minimum order answer (GOOB)', () => {
  it.each([
    'is there a minimum order?',
    'what is the minimum order?',
    'do i have to buy a minimum?',
    'how many boxes do i have to buy?',
  ])('answers %s with the configured minimum', async (question) => {
    getSaleRules.mockResolvedValue({
      minimumBoxes: 10,
      finalSale: true,
      subscriptionsEnabled: false,
      tiers: [],
    });

    const category = classifyQuery(question);
    expect(category).toBe('minimum_order');
    expect(await resolveDeterministicAnswer(category!)).toMatch(/10 boxes/);
  });

  it('does not hijack an unrelated question about order status', () => {
    expect(classifyQuery('where is my order?')).not.toBe('minimum_order');
    expect(classifyQuery('where is my order?')).toBe('order_status');
  });

  it.each([
    // The bare "is there a minimum" pattern must co-occur with an
    // order-shaped subject. Without that, it matched ANY "is there a
    // minimum X" regardless of subject.
    'is there a minimum steep time for the tea?',
    'is there a minimum brew temperature?',
    // "buy" appears in this sentence, but not as the subject of "minimum" —
    // this is an age-restriction question, not an order-size one.
    'is there a minimum age to buy tea?',
  ])('does not hijack %s (bare "minimum" needs an order-shaped subject)', (question) => {
    expect(classifyQuery(question)).not.toBe('minimum_order');
  });

  it.each([
    // The fully bare form, with no subject at all, is a real and common
    // phrasing on a store with a hard minimum — it must still match, or the
    // model gets to invent an answer to the exact question the deterministic
    // layer exists to pin. Distinct from the cases above: there is no
    // trailing subject text for the anchor to reject.
    'is there a minimum?',
    'Is there a minimum?',
    'is there a minimum',
    'is there a minimum???',
  ])('still answers the fully bare form: %s', async (question) => {
    getSaleRules.mockResolvedValue({
      minimumBoxes: 10,
      finalSale: true,
      subscriptionsEnabled: false,
      tiers: [],
    });

    const category = classifyQuery(question);
    expect(category).toBe('minimum_order');
    expect(await resolveDeterministicAnswer(category!)).toMatch(/10 boxes/);
  });

  it.each([
    // Past-tense self-reference belongs to order history, not the box
    // minimum, even though it shares the "how many boxes...buy/order" shape.
    'how many boxes did i order?',
    'how many boxes have i ordered?',
    'how many boxes did i buy last time?',
    // Present-tense self-reference is the same shape and was still hijacked
    // by a first attempt that only excluded past tense — "are in my order"
    // matches no `did/have/has i order` phrasing, so an exclude list would
    // have had to enumerate this too. The obligation-shaped positive pattern
    // ("do i have to" / "must i" / "should i" / "am i required to") rules it
    // out structurally instead.
    'how many boxes are in my order?',
    'how many boxes were in my last order?',
    'how many boxes have i purchased this year?',
  ])('does not hijack self-referential order history: %s', (question) => {
    expect(classifyQuery(question)).not.toBe('minimum_order');
  });

  it.each([
    // Obligation-shaped phrasings beyond the brief's original "do i have to
    // buy" — confirms the narrower positive pattern didn't just move the
    // false negative from "how many boxes ... buy/order" to only that one
    // exact modal.
    'how many boxes must i order?',
    'how many boxes should i order?',
    'how many boxes am i required to purchase?',
  ])('still answers other obligation phrasings: %s', (question) => {
    expect(classifyQuery(question)).toBe('minimum_order');
  });

  it.each([
    // "spend" and "cart" were dropped from the noun list entirely: the
    // sale's minimum is denominated in BOXES (`sale.minimum_boxes`), never
    // dollars, and this phrasing belongs to `shipping_rates` (the free-
    // shipping threshold) or retrieval (coupon/discount code minimums) —
    // neither of which this store even has a dollar-based order minimum for.
    // "minimum spend for shipping" containing the literal "free shipping"
    // phrase now correctly reaches `shipping_rates` instead of being
    // hijacked into the box-minimum answer.
    ['minimum spend for free shipping?', 'shipping_rates'],
    ['whats the minimum spend to get free shipping?', 'shipping_rates'],
    // No "free" in this one, so it isn't in `shipping_rates`'s vocabulary
    // either — it falls through to retrieval rather than to either canned
    // answer, which is the safe outcome: retrieval has the VERIFIED FACTS
    // block and can honestly say free shipping is off for the sale.
    ['is there a minimum spend for shipping?', null],
    ['whats the minimum cart total for the coupon code to work?', null],
    ['is there a minimum cart value for the discount code?', null],
  ])('does not let "spend"/"cart" hijack shipping or coupon questions: %s -> %s', (question, expected) => {
    expect(classifyQuery(question)).not.toBe('minimum_order');
    expect(classifyQuery(question)).toBe(expected);
  });
});

describe('tea freshness answer (GOOB)', () => {
  it.each([
    'how old is the tea?',
    'is the tea still fresh?',
    'is this tea expired?',
    'when does this tea expire?',
  ])('answers %s honestly about age and storage', async (question) => {
    const category = classifyQuery(question);
    expect(category).toBe('tea_freshness');
    expect(await resolveDeterministicAnswer(category!)).toMatch(/sealed|airtight/i);
  });

  it('does not hijack an ordinary product question', () => {
    // The freshness rule must be narrow. These are questions the catalog and
    // retrieval answer far better than a canned line about storage.
    expect(classifyQuery('what is in the morning blend?')).not.toBe('tea_freshness');
    expect(classifyQuery('how do i brew this?')).not.toBe('tea_freshness');
    expect(classifyQuery('how much caffeine is in it?')).not.toBe('tea_freshness');
  });
});

describe('store closing answer (GOOB)', () => {
  it.each([
    'are you going out of business?',
    'why are you closing?',
    'is beauteas shutting down?',
  ])('answers %s and points at the closing page', async (question) => {
    const category = classifyQuery(question);
    expect(category).toBe('store_closing');

    const answer = await resolveDeterministicAnswer(category!);
    expect(answer).toMatch(/thank-you/);
    expect(answer).toContain(`${SITE_URL}/thank-you`);
  });

  it.each([
    // Store-HOURS phrasing shares "closed"/"closing" vocabulary with
    // permanent closure but asks a different question. A customer asking
    // about Sunday hours must not get the going-out-of-business announcement.
    'are you closed today?',
    'are you closed for the holiday?',
    'is beauteas closed on sundays?',
    'why are you closing early today?',
  ])('does not hijack a store-hours question: %s', (question) => {
    expect(classifyQuery(question)).not.toBe('store_closing');
  });
});

describe('tiered shipping answer (GOOB)', () => {
  it('states the tiers and drops the free-shipping sentence when nothing is free', async () => {
    getSettings.mockImplementation(async (category: string) =>
      category === 'shipping'
        ? {
            'shipping.methods': [
              { id: 'standard', label: 'Standard', cost: 5.99, estimatedDays: 5, enabled: true },
            ],
            'shipping.free_methods': [],
          }
        : {}
    );

    const category = classifyQuery('how much is shipping?');
    expect(category).toBe('shipping_rates');
    const answer = await resolveDeterministicAnswer(category!);

    expect(answer).not.toMatch(/free shipping/i);
    // Still a complete, natural rate card — not a fragment with a dangling join.
    expect(answer).toContain('Standard — $5.99');
    expect(answer).toMatch(/i can'?t see your cart from here/i);
  });
});
