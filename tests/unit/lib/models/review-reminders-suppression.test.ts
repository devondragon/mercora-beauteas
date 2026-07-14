// tests/unit/lib/models/review-reminders-suppression.test.ts
//
// BMC-184 acceptance: an opted-out customer in the reminder candidate list must
// NOT be emailed. Exercises dispatchReviewReminders directly (the extracted
// send loop) so the suppression branch is covered without mocking the whole
// candidate-discovery query chain.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/models/email-preferences', () => ({
  getReviewReminderOptOuts: vi.fn(),
}));

vi.mock('@/lib/utils/review-notifications', () => ({
  sendReviewReminderEmail: vi.fn().mockResolvedValue(undefined),
  sendReviewStatusNotification: vi.fn(),
}));

import { dispatchReviewReminders } from '@/lib/models/reviews';
import { getReviewReminderOptOuts } from '@/lib/models/email-preferences';
import { sendReviewReminderEmail } from '@/lib/utils/review-notifications';

const OPTED_OUT = 'optedout@example.com';
const SUBSCRIBED = 'subscribed@example.com';

function candidate(email: string, orderId: string) {
  return {
    orderId,
    productId: `prod-${orderId}`,
    deliveredAt: '2026-07-01T00:00:00.000Z',
    customerId: `cust-${orderId}`,
    customerEmail: email,
    customerName: 'Test Customer',
    orderItemId: `item-${orderId}`,
    productName: 'Calendula Morning',
  };
}

// Minimal db stub — dispatchReviewReminders only calls db.insert(...).values(...).
function fakeDb() {
  const values = vi.fn().mockResolvedValue(undefined);
  return { db: { insert: vi.fn(() => ({ values })) } as never, values };
}

describe('dispatchReviewReminders — suppression (BMC-184)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does NOT email an opted-out customer but DOES email a subscribed one', async () => {
    vi.mocked(getReviewReminderOptOuts).mockResolvedValue(new Set([OPTED_OUT]));
    const { db, values } = fakeDb();

    const result = await dispatchReviewReminders(
      [candidate(OPTED_OUT, 'A'), candidate(SUBSCRIBED, 'B')],
      db,
    );

    // Opted-out address is never emailed...
    const emailed = vi.mocked(sendReviewReminderEmail).mock.calls.map((c) => c[0].email);
    expect(emailed).toEqual([SUBSCRIBED]);
    expect(emailed).not.toContain(OPTED_OUT);

    // ...and gets no reminder row written (only the sent one for B).
    expect(result.sent).toBe(1);
    expect(result.failed).toEqual([]);
    expect(values).toHaveBeenCalledTimes(1);
  });

  it('suppresses every candidate when all are opted out (no sends, no rows)', async () => {
    vi.mocked(getReviewReminderOptOuts).mockResolvedValue(
      new Set([OPTED_OUT, 'another@example.com']),
    );
    const { db, values } = fakeDb();

    const result = await dispatchReviewReminders(
      [candidate(OPTED_OUT, 'A'), candidate('another@example.com', 'B')],
      db,
    );

    expect(sendReviewReminderEmail).not.toHaveBeenCalled();
    expect(values).not.toHaveBeenCalled();
    expect(result).toEqual({ sent: 0, failed: [] });
  });
});
