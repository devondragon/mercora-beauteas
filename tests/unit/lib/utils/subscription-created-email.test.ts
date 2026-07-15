/**
 * Unit test for the BMC-186 automatic-renewal-law (ARL) disclosure in the
 * subscription "created" confirmation email.
 *
 * Several state ARL statutes require the post-purchase acknowledgment itself to
 * restate the recurring terms (amount + cadence + "until you cancel") and give a
 * cancel path. This pins that the rendered `created` email contains those
 * elements; the Resend transport is mocked so we can inspect the HTML.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.mock factories are hoisted above the file body, so the send spy must be
// created via vi.hoisted to be defined when the factory closure runs.
const { sendMock } = vi.hoisted(() => ({
  sendMock: vi.fn().mockResolvedValue({ data: { id: 'email-1' }, error: null }),
}));

vi.mock('resend', () => ({
  // `new Resend(...)` must be constructable — use a class, not an arrow impl.
  Resend: class {
    emails = { send: sendMock };
  },
}));

import { sendSubscriptionEmail } from '@/lib/utils/email';
import type { SubscriptionEmailData } from '@/lib/types/subscription';

function baseData(overrides: Partial<SubscriptionEmailData> = {}): SubscriptionEmailData {
  return {
    customerEmail: 'buyer@example.com',
    customerName: 'Buyer',
    productName: 'Morning Blend',
    frequency: 'monthly',
    subscriptionId: 'SUB-1',
    nextBillingDate: '8/15/2026',
    amount: 2499,
    manageUrl: 'https://beauteas.com/subscriptions',
    ...overrides,
  };
}

function renderedHtml(): string {
  const call = sendMock.mock.calls.at(-1)?.[0];
  return call?.html ?? '';
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('created subscription email — ARL recurring-terms disclosure (BMC-186)', () => {
  it('restates the amount, cadence, "until you cancel", and a cancel link', async () => {
    const res = await sendSubscriptionEmail('created', baseData());

    expect(res.success).toBe(true);
    const html = renderedHtml();
    expect(html).toContain('$24.99');
    expect(html).toContain('every month');
    expect(html).toContain('until you cancel');
    // Cancel path points at the subscription management page.
    expect(html).toContain('https://beauteas.com/subscriptions');
    expect(html.toLowerCase()).toContain('cancel anytime');
  });

  it('uses the correct cadence phrase per frequency', async () => {
    await sendSubscriptionEmail('created', baseData({ frequency: 'biweekly' }));
    expect(renderedHtml()).toContain('every 2 weeks');

    await sendSubscriptionEmail('created', baseData({ frequency: 'bimonthly' }));
    expect(renderedHtml()).toContain('every 2 months');
  });

  it('falls back gracefully when no amount is supplied', async () => {
    await sendSubscriptionEmail('created', baseData({ amount: undefined }));
    const html = renderedHtml();
    expect(html).toContain('the subscription price');
    expect(html).toContain('until you cancel');
  });
});
