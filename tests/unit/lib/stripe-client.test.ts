/**
 * BMC-212: the money path must run on the real Stripe SDK, not the hand-rolled
 * `CloudflareStripe` fetch client pinned to API version 2020-08-27.
 *
 * `getStripeClient()` used to branch on Workers globals / NODE_ENV and return
 * `CloudflareStripe` in the deployed Worker — so PaymentIntent create/retrieve/
 * cancel and Stripe Tax ran six years behind everything else in the integration.
 *
 * These pin the two things that make the SDK safe to use here:
 *   - it is pinned to the SAME API version as the subscription/webhook path
 *   - it uses the FETCH http client (the SDK's default Node http client does
 *     not work in the Workers runtime)
 *
 * Imports the REAL module — no `vi.mock('@/lib/stripe')` — since the whole
 * point is which client the factory hands back.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';

/** The API version the SDK path (subscriptions, webhooks) is already pinned to. */
const CURRENT_API_VERSION = '2026-06-24.dahlia';

async function loadStripeModule(nodeEnv: string) {
  vi.resetModules();
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_bmc212');
  vi.stubEnv('NODE_ENV', nodeEnv);
  return import('@/lib/stripe');
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('getStripeClient (BMC-212)', () => {
  it('returns an SDK client exposing paymentIntents, in production', async () => {
    const { getStripeClient } = await loadStripeModule('production');

    const client = getStripeClient() as any;

    expect(typeof client.paymentIntents?.create).toBe('function');
    expect(typeof client.paymentIntents?.retrieve).toBe('function');
    expect(typeof client.paymentIntents?.cancel).toBe('function');
    expect(typeof client.tax?.calculations?.create).toBe('function');
  });

  it('pins the money path to the same API version as subscriptions/webhooks', async () => {
    const { getStripeClient } = await loadStripeModule('production');

    const client = getStripeClient() as any;

    expect(client.getApiField('version')).toBe(CURRENT_API_VERSION);
    expect(client.getApiField('version')).not.toBe('2020-08-27');
  });

  it('uses the fetch http client so it works in the Workers runtime', async () => {
    const { getStripeClient } = await loadStripeModule('production');

    const client = getStripeClient() as any;

    expect(client.getApiField('httpClient').getClientName()).toBe('fetch');
  });

  it('returns the same client type in development as in production', async () => {
    const prod = await loadStripeModule('production');
    const prodName = (prod.getStripeClient() as any).constructor.name;

    const dev = await loadStripeModule('development');
    const devName = (dev.getStripeClient() as any).constructor.name;

    expect(devName).toBe(prodName);
  });

  it('no longer exports the hand-rolled CloudflareStripe client', async () => {
    const mod = (await loadStripeModule('production')) as Record<string, unknown>;

    expect(mod.CloudflareStripe).toBeUndefined();
    expect(mod.getCloudflareStripe).toBeUndefined();
  });
});
