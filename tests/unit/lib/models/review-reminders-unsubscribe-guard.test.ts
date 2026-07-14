// tests/unit/lib/models/review-reminders-unsubscribe-guard.test.ts
//
// BMC-184: sendReviewReminders must refuse to run when EMAIL_UNSUBSCRIBE_SECRET
// is unset (it can't build a compliant unsubscribe), and it must do so WITHOUT
// touching the DB — writing `failed` review_reminders rows for a config-level
// problem would permanently exclude those orders from future reminders (their
// keys feed findReviewReminderCandidates' exclusion set).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  getDbAsync: vi.fn(async () => {
    throw new Error('DB must not be touched when unsubscribe is unconfigured');
  }),
  getDb: vi.fn(),
}));

vi.mock('@/lib/utils/review-notifications', () => ({
  sendReviewReminderEmail: vi.fn(),
  sendReviewStatusNotification: vi.fn(),
}));

import { sendReviewReminders } from '@/lib/models/reviews';
import { getDbAsync } from '@/lib/db';
import { sendReviewReminderEmail } from '@/lib/utils/review-notifications';

describe('sendReviewReminders — unsubscribe config guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    delete process.env.EMAIL_UNSUBSCRIBE_SECRET;
  });

  it('skips the whole run and never touches the DB when the secret is unset', async () => {
    delete process.env.EMAIL_UNSUBSCRIBE_SECRET;

    const result = await sendReviewReminders();

    expect(result).toEqual({ sent: 0, failed: [], skipped: 'unsubscribe_not_configured' });
    expect(getDbAsync).not.toHaveBeenCalled();
    expect(sendReviewReminderEmail).not.toHaveBeenCalled();
  });
});
