// tests/unit/lib/email/unsubscribe-token.test.ts
//
// Covers the HMAC-signed unsubscribe token used for CAN-SPAM one-click /
// confirm-page unsubscribe (BMC-184). The token must round-trip an address,
// reject tampering and wrong secrets, and refuse to operate with no secret.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createUnsubscribeToken,
  verifyUnsubscribeToken,
  normalizeEmail,
  isUnsubscribeConfigured,
} from '@/lib/email/unsubscribe-token';

const SECRET = 'test-unsubscribe-secret-that-is-at-least-32-chars-long';

describe('unsubscribe-token', () => {
  beforeEach(() => {
    process.env.EMAIL_UNSUBSCRIBE_SECRET = SECRET;
  });
  afterEach(() => {
    delete process.env.EMAIL_UNSUBSCRIBE_SECRET;
  });

  it('round-trips an email address', async () => {
    const token = await createUnsubscribeToken('Person@Example.com');
    expect(token).toBeTruthy();
    const email = await verifyUnsubscribeToken(token!);
    expect(email).toBe('person@example.com');
  });

  it('normalizes case/whitespace so the token is stable', async () => {
    const a = await createUnsubscribeToken('  Person@Example.com  ');
    const b = await createUnsubscribeToken('person@example.com');
    expect(a).toBe(b);
    expect(normalizeEmail('  A@B.COM ')).toBe('a@b.com');
  });

  it('rejects a tampered signature', async () => {
    const token = (await createUnsubscribeToken('person@example.com'))!;
    const [payload, sig] = token.split('.');
    // Mutate the FIRST sig char — it maps to the high bits of signature byte 0,
    // so the decoded bytes definitely differ (the last char is partly padding).
    const flipped = (sig[0] === 'A' ? 'B' : 'A') + sig.slice(1);
    expect(await verifyUnsubscribeToken(`${payload}.${flipped}`)).toBeNull();
  });

  it('rejects a swapped payload (unsubscribing a different address)', async () => {
    const mine = (await createUnsubscribeToken('victim@example.com'))!;
    const attackerPayload = Buffer.from('someoneelse@example.com')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    expect(await verifyUnsubscribeToken(`${attackerPayload}.${mine.split('.')[1]}`)).toBeNull();
  });

  it('rejects malformed tokens', async () => {
    expect(await verifyUnsubscribeToken('')).toBeNull();
    expect(await verifyUnsubscribeToken('nodot')).toBeNull();
    expect(await verifyUnsubscribeToken('a.b.c')).toBeNull();
    expect(await verifyUnsubscribeToken('!!!.!!!')).toBeNull();
  });

  it('rejects an over-long token without doing HMAC work (DoS guard)', async () => {
    const huge = 'a'.repeat(2000) + '.' + 'b'.repeat(2000);
    expect(await verifyUnsubscribeToken(huge)).toBeNull();
  });

  it('rejects a token signed with a different secret', async () => {
    const token = (await createUnsubscribeToken('person@example.com'))!;
    process.env.EMAIL_UNSUBSCRIBE_SECRET = 'a-different-secret-that-is-also-at-least-32-chars';
    expect(await verifyUnsubscribeToken(token)).toBeNull();
  });

  it('rejects a secret shorter than the minimum length (weak-secret guard)', async () => {
    process.env.EMAIL_UNSUBSCRIBE_SECRET = 'short-secret';
    expect(isUnsubscribeConfigured()).toBe(false);
    expect(await createUnsubscribeToken('person@example.com')).toBeNull();
  });

  it('reports configuration state via isUnsubscribeConfigured', () => {
    expect(isUnsubscribeConfigured()).toBe(true);
    delete process.env.EMAIL_UNSUBSCRIBE_SECRET;
    expect(isUnsubscribeConfigured()).toBe(false);
    process.env.EMAIL_UNSUBSCRIBE_SECRET = '';
    expect(isUnsubscribeConfigured()).toBe(false);
  });

  it('returns null (no create, no verify) when the secret is unset', async () => {
    delete process.env.EMAIL_UNSUBSCRIBE_SECRET;
    expect(await createUnsubscribeToken('person@example.com')).toBeNull();
    // A token minted earlier cannot be verified without the secret either.
    process.env.EMAIL_UNSUBSCRIBE_SECRET = SECRET;
    const token = (await createUnsubscribeToken('person@example.com'))!;
    delete process.env.EMAIL_UNSUBSCRIBE_SECRET;
    expect(await verifyUnsubscribeToken(token)).toBeNull();
  });
});
