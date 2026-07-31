/**
 * BMC-184 — /api/email/unsubscribe pre-fetch-safety contract.
 *
 * The core CAN-SPAM footgun: email clients, Gmail's link proxy, and security
 * scanners GET every link. So a GET must ONLY render a confirmation page and
 * never opt anyone out; the mutation happens only on POST (the confirm button
 * and RFC 8058 one-click). These tests pin that contract by mocking the DB
 * model and asserting exactly when recordUnsubscribe is/ isn't called — which
 * also lets the POST path run without a live D1 binding.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/models/email-preferences', () => ({
  recordUnsubscribe: vi.fn().mockResolvedValue(undefined),
}));

import { GET, POST } from '@/app/api/email/unsubscribe/route';
import { recordUnsubscribe } from '@/lib/models/email-preferences';
import { createUnsubscribeToken } from '@/lib/email/unsubscribe-token';

const SECRET = 'route-test-secret-that-is-at-least-32-chars-long';
const EMAIL = 'shopper@example.com';
const URL_BASE = 'https://beauteas.com/api/email/unsubscribe';

async function validToken(): Promise<string> {
  const t = await createUnsubscribeToken(EMAIL);
  if (!t) throw new Error('token creation failed');
  return t;
}

describe('/api/email/unsubscribe', () => {
  beforeEach(() => {
    process.env.EMAIL_UNSUBSCRIBE_SECRET = SECRET;
    vi.mocked(recordUnsubscribe).mockClear();
  });
  afterEach(() => {
    delete process.env.EMAIL_UNSUBSCRIBE_SECRET;
  });

  it('GET renders a confirmation page and does NOT mutate (pre-fetch safe)', async () => {
    const token = await validToken();
    const res = await GET(new Request(`${URL_BASE}?token=${encodeURIComponent(token)}`));
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(recordUnsubscribe).not.toHaveBeenCalled(); // the whole point
    expect(body).toContain('Confirm unsubscribe');
    expect(body).toContain(EMAIL);
    expect(body).toContain('method="POST"');
  });

  it('GET with an invalid token returns 400 and does not mutate', async () => {
    const res = await GET(new Request(`${URL_BASE}?token=not-a-real-token`));
    expect(res.status).toBe(400);
    expect(recordUnsubscribe).not.toHaveBeenCalled();
  });

  it('GET with no token returns 400', async () => {
    const res = await GET(new Request(URL_BASE));
    expect(res.status).toBe(400);
    expect(recordUnsubscribe).not.toHaveBeenCalled();
  });

  it('POST (confirm form) opts the address out', async () => {
    const token = await validToken();
    const res = await POST(
      new Request(`${URL_BASE}?token=${encodeURIComponent(token)}`, { method: 'POST' }),
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('unsubscribed');
    expect(recordUnsubscribe).toHaveBeenCalledWith(EMAIL, 'review_reminders');
  });

  it('POST one-click (token in query, RFC 8058 body) opts out', async () => {
    const token = await validToken();
    const res = await POST(
      new Request(`${URL_BASE}?token=${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'List-Unsubscribe=One-Click',
      }),
    );
    expect(res.status).toBe(200);
    expect(recordUnsubscribe).toHaveBeenCalledWith(EMAIL, 'review_reminders');
  });

  it('POST with an invalid token returns 400 and never touches the DB', async () => {
    const res = await POST(
      new Request(`${URL_BASE}?token=tampered`, { method: 'POST' }),
    );
    expect(res.status).toBe(400);
    expect(recordUnsubscribe).not.toHaveBeenCalled();
  });
});
