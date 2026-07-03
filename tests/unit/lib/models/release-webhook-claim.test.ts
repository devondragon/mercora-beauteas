/**
 * Regression test for releaseWebhookEventClaim's retry loop
 * (lib/models/mach/subscriptions.ts).
 *
 * When a Stripe webhook handler fails after claiming the event, the claim must
 * be released so a legitimate retry isn't dropped as a duplicate. The release
 * DELETE is retried up to MAX_RELEASE_ATTEMPTS (3) with backoff to survive
 * transient D1 contention, and it must NEVER throw — a swallowed final failure
 * is safe (downstream side effects are idempotent) but a thrown one would crash
 * the webhook route's catch block.
 *
 * Mocks @/lib/db so the real function runs against a fake db in the jsdom unit
 * env (CI `npm test`) without touching Cloudflare bindings.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { whereMock, deleteMock, getDbAsyncMock } = vi.hoisted(() => {
  const whereMock = vi.fn();
  const deleteMock = vi.fn(() => ({ where: whereMock }));
  const getDbAsyncMock = vi.fn(async () => ({ delete: deleteMock }));
  return { whereMock, deleteMock, getDbAsyncMock };
});

vi.mock('@/lib/db', () => ({
  getDbAsync: getDbAsyncMock,
}));

import { releaseWebhookEventClaim } from '@/lib/models/mach/subscriptions';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('releaseWebhookEventClaim retry loop', () => {
  it('succeeds on the first attempt without retrying', async () => {
    whereMock.mockResolvedValueOnce(undefined);

    await expect(releaseWebhookEventClaim('evt_1')).resolves.toBeUndefined();
    expect(whereMock).toHaveBeenCalledTimes(1);
  });

  it('retries transient failures and resolves once the DELETE succeeds', async () => {
    whereMock
      .mockRejectedValueOnce(new Error('D1_ERROR: database is locked'))
      .mockRejectedValueOnce(new Error('D1_ERROR: database is locked'))
      .mockResolvedValueOnce(undefined);

    await expect(releaseWebhookEventClaim('evt_2')).resolves.toBeUndefined();
    expect(whereMock).toHaveBeenCalledTimes(3);
  });

  it('never throws after exhausting all attempts — logs an ALERT marker instead', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    whereMock.mockRejectedValue(new Error('D1_ERROR: database is locked'));

    await expect(releaseWebhookEventClaim('evt_3')).resolves.toBeUndefined();
    expect(whereMock).toHaveBeenCalledTimes(3);
    // Surfaced with the stable, greppable alert marker for log-based alerting.
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('[webhook][ALERT] orphaned_claim'),
      'evt_3',
      expect.any(Error)
    );

    errorSpy.mockRestore();
  });
});
