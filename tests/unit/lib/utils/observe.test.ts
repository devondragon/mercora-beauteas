import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the Cloudflare context so logCritical's best-effort Analytics Engine
// write is observable and controllable (present / absent / throwing).
const getCloudflareContext = vi.fn();
vi.mock('@opennextjs/cloudflare', () => ({
  getCloudflareContext: (...args: unknown[]) => getCloudflareContext(...args),
}));

import { logCritical, CRITICAL_MARKER } from '@/lib/utils/observe';

describe('logCritical', () => {
  let writeDataPoint: ReturnType<typeof vi.fn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    writeDataPoint = vi.fn();
    getCloudflareContext.mockReturnValue({ env: { ANALYTICS: { writeDataPoint } } });
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it('emits a single stable [critical] <area>.<event> line with a JSON payload', () => {
    logCritical('order_create', 'order_create_failed', { orderId: 'o1' }, new Error('db down'));

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const [prefix, json] = errorSpy.mock.calls[0];
    expect(prefix).toBe(`${CRITICAL_MARKER} order_create.order_create_failed`);
    const payload = JSON.parse(json as string);
    expect(payload).toMatchObject({
      area: 'order_create',
      event: 'order_create_failed',
      orderId: 'o1',
      // Only the error CLASS is emitted — never the message (BMC-168 security).
      errorType: 'Error',
    });
  });

  it('never forwards raw error message text into the payload (PII/secret guard)', () => {
    logCritical(
      'payment_intent',
      'create_failed',
      {},
      new Error('Stripe API Error: invalid postal_code for John Q Public, 123 Main St')
    );
    const json = errorSpy.mock.calls[0][1] as string;
    expect(json).toContain('"errorType":"Error"');
    expect(json).not.toContain('John Q Public');
    expect(json).not.toContain('123 Main St');
  });

  it('does not let a colliding detail key clobber the real area/event', () => {
    logCritical('refund', 'processing_failed', { area: 'not-real', event: 'nope', orderId: 'o1' });
    const payload = JSON.parse(errorSpy.mock.calls[0][1] as string);
    expect(payload.area).toBe('refund');
    expect(payload.event).toBe('processing_failed');
    expect(payload.orderId).toBe('o1');
  });

  it('writes a best-effort Analytics Engine data point grouped by area', () => {
    logCritical('refund', 'processing_failed');
    expect(writeDataPoint).toHaveBeenCalledWith({
      blobs: ['refund', 'processing_failed'],
      doubles: [1],
      indexes: ['refund'],
    });
  });

  it('never throws when the Cloudflare context is unavailable', () => {
    getCloudflareContext.mockImplementation(() => {
      throw new Error('no workers runtime');
    });
    expect(() => logCritical('webhook', 'processing_failed')).not.toThrow();
    // The alertable log line is still emitted even when metrics are unavailable.
    expect(errorSpy).toHaveBeenCalledWith(`${CRITICAL_MARKER} webhook.processing_failed`, expect.any(String));
  });

  it('never throws when the ANALYTICS binding is absent', () => {
    getCloudflareContext.mockReturnValue({ env: {} });
    expect(() => logCritical('payment_intent', 'create_failed')).not.toThrow();
    expect(errorSpy).toHaveBeenCalled();
  });

  it('never throws on an unserializable (circular) detail, still emits the marker', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => logCritical('giftcard', 'fulfillment_errors', circular)).not.toThrow();
    // Marker is present in some form so the failure remains alertable.
    const firstArgs = errorSpy.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(firstArgs.some((a: string) => a.includes(CRITICAL_MARKER))).toBe(true);
  });
});
