/**
 * === Stripe Configuration ===
 *
 * Centralized Stripe configuration for both client and server-side usage.
 * Provides secure API key management and consistent Stripe instance creation.
 *
 * === Features ===
 * - **Environment Variables**: Secure API key management
 * - **Client Configuration**: Browser-safe publishable key handling
 * - **Server Configuration**: Server-side secret key management
 * - **Type Safety**: Full TypeScript support
 * - **Error Handling**: Graceful fallbacks for missing keys
 *
 * === Security ===
 * - Only publishable keys are exposed to the client
 * - Secret keys remain server-side only
 * - Environment-based configuration
 *
 * === Usage ===
 * ```tsx
 * // Client-side
 * import { loadStripe } from '@/lib/stripe';
 * const stripe = await loadStripe();
 * 
 * // Server-side
 * import { getStripeClient } from '@/lib/stripe';
 * const paymentIntent = await getStripeClient().paymentIntents.create({...});
 * ```
 */

import { loadStripe as loadStripeLib, Stripe } from '@stripe/stripe-js';
import StripeServer from 'stripe';
import { Money } from '@/lib/money';

// Workers-compatible crypto provider for webhook signature verification
const cryptoProvider = StripeServer.createSubtleCryptoProvider();

// Environment variables with validation
const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
const secretKey = process.env.STRIPE_SECRET_KEY;

if (!publishableKey) {
  console.warn('Missing NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY environment variable');
}

if (!secretKey && typeof window === 'undefined') {
  // Only require secret key on server-side
  console.warn('Missing STRIPE_SECRET_KEY environment variable');
}

/**
 * Client-side Stripe instance loader
 * Returns a promise that resolves to a Stripe instance for browser use
 */
let stripePromise: Promise<Stripe | null> | null = null;

export const loadStripe = (): Promise<Stripe | null> => {
  if (!publishableKey) {
    console.error('Cannot load Stripe: Missing publishable key');
    return Promise.resolve(null);
  }
  
  if (!stripePromise) {
    stripePromise = loadStripeLib(publishableKey);
  }
  return stripePromise;
};

/**
 * Whether server-side Stripe is usable in THIS runtime (secret key present).
 *
 * The Workers runtime (`wrangler dev` / deployed Worker) reads secrets from
 * `.dev.vars` or `wrangler secret put` — NOT `.env.local` (which only
 * `next dev` reads). A missing key here is a *configuration* problem and is
 * distinct from a transient Stripe API outage; callers should treat the two
 * differently (loud config error vs. graceful degradation).
 */
export const isStripeConfigured = (): boolean => Boolean(secretKey);

/**
 * Get a Stripe SDK instance configured for the Cloudflare Workers runtime.
 *
 * `createFetchHttpClient()` is not optional here: the SDK's DEFAULT http client
 * is the Node `http` module, which does not work in the Worker. Any code path
 * that talks to Stripe from the server must go through this factory (or
 * `getStripeClient()`, which wraps it) — never `new StripeServer(...)` directly.
 *
 * Memoized: this sits on the payment path, so a fresh client (and its agent /
 * config setup) per request is pure waste.
 */
let workersStripe: StripeServer | null = null;

export function getStripeForWorkers(): StripeServer {
  if (!secretKey) {
    throw new Error('Missing STRIPE_SECRET_KEY environment variable');
  }
  if (!workersStripe) {
    workersStripe = new StripeServer(secretKey, {
      apiVersion: '2026-06-24.dahlia',
      httpClient: StripeServer.createFetchHttpClient(),
      typescript: true,
    });
  }
  return workersStripe;
}

/**
 * Verify Stripe webhook signature using async SubtleCrypto (Workers-compatible).
 * Replaces the broken CloudflareStripe.webhooks.constructEvent which just parses JSON.
 *
 * SECURITY CRITICAL: This performs actual HMAC-SHA256 signature validation.
 * The old CloudflareStripe.constructEvent was a no-op that accepted any payload.
 *
 * @param payload - Raw request body string (read with req.text(), NOT req.json())
 * @param signature - Value of 'stripe-signature' header
 * @param secret - Webhook signing secret from STRIPE_WEBHOOK_SECRET env var
 * @returns Verified Stripe.Event object
 * @throws Error if signature is invalid or verification fails
 */
export async function verifyWebhookSignature(
  payload: string,
  signature: string,
  secret: string
): Promise<StripeServer.Event> {
  const stripe = getStripeForWorkers();
  return stripe.webhooks.constructEventAsync(
    payload,
    signature,
    secret,
    undefined,     // tolerance (use default 300 seconds)
    cryptoProvider  // SubtleCrypto for Workers
  );
}

/**
 * The single server-side Stripe client (BMC-212).
 *
 * This used to pick between the real SDK and a hand-rolled `CloudflareStripe`
 * fetch client based on Workers globals / `NODE_ENV` — which meant the deployed
 * Worker ran PaymentIntents and Stripe Tax against API version `2020-08-27`
 * while subscriptions and webhooks ran on `2026-06-24.dahlia`. The hand-rolled
 * client is gone; the SDK works on Workers via `createFetchHttpClient()`.
 */
export const getStripeClient = (): StripeServer => getStripeForWorkers();

/**
 * Create a payment intent.
 */
export const createPaymentIntent = async (params: {
  amount: number;
  currency: string;
  automatic_payment_methods?: { enabled: boolean; allow_redirects?: 'always' | 'never' };
  metadata?: Record<string, string>;
  shipping?: any;
  description?: string;
}): Promise<{ id: string; client_secret: string | null; [key: string]: any }> => {
  const client = getStripeClient();
  return await client.paymentIntents.create(params) as { id: string; client_secret: string | null; [key: string]: any };
};

/**
 * Retrieve a Payment Intent.
 * Used to verify payment server-side (status / amount / order binding) rather
 * than trusting client-supplied flags.
 */
export const retrievePaymentIntent = async (
  id: string
): Promise<{ id: string; status: string; amount_received?: number; amount?: number; metadata?: Record<string, string>; [key: string]: any }> => {
  const client = getStripeClient();
  return (await client.paymentIntents.retrieve(id)) as any;
};

/**
 * Cancel a Payment Intent.
 *
 * Best-effort hygiene (BMC-167): when the server mints a PaymentIntent but then
 * cannot persist its pending order, it withholds the client secret — so the PI
 * can never capture money — and cancels it here so it does not linger as an
 * abandoned intent in the Stripe dashboard. Callers should treat any failure as
 * non-fatal.
 */
export const cancelPaymentIntent = async (id: string): Promise<any> => {
  const client = getStripeClient();
  return (await client.paymentIntents.cancel(id)) as any;
};

/**
 * Calculate tax via Stripe Tax.
 */
export const calculateTax = async (params: any): Promise<any> => {
  const client = getStripeClient();
  return await client.tax.calculations.create(params);
};

/**
 * Stripe Tax configuration
 * Settings for tax calculation functionality
 */
export const stripeTaxConfig = {
  // Enable automatic tax for supported regions
  automaticTax: {
    enabled: true,
  },
  // Tax behavior for different scenarios
  taxBehavior: 'exclusive' as const, // Tax calculated separately from item prices
  // Tax code for general products
  defaultTaxCode: 'txcd_99999999', // General - Tangible Goods
};

/**
 * Common Stripe configuration options
 */
export const stripeConfig = {
  currency: 'usd',
  paymentMethodTypes: ['card'] as const,
  mode: 'payment' as const,
  billingAddressCollection: 'required' as const,
  shippingAddressCollection: {
    allowedCountries: ['US'] as const,
  },
};

/**
 * Utility function to format amounts for Stripe
 * Stripe requires amounts in cents (smallest currency unit)
 *
 * Callers currently operate in major units (dollars); this stays a
 * dollars-in/cents-out helper, but the conversion arithmetic is routed
 * through Money instead of a raw `* 100` so it can't drift from the
 * Money type's rounding rules.
 *
 * Assumes non-negative, well-formed numeric dollar amounts. Uses exact-decimal
 * big.js rounding (half-up), which is more accurate than the previous float-based
 * `Math.round(amount*100)` at half-cent ties.
 */
export const formatAmountForStripe = (amount: number): number => {
  return Money.fromMajor(amount, 'USD').toMinorUnits();
};

/**
 * Utility function to format amounts from Stripe
 * Converts cents back to dollars
 *
 * Callers currently operate in major units (dollars); this stays a
 * cents-in/dollars-out helper, but the conversion arithmetic is routed
 * through Money instead of a raw `/ 100`.
 *
 * Assumes non-negative, well-formed numeric cent amounts. Uses exact-decimal
 * big.js rounding (half-up) for round-trip accuracy.
 */
export const formatAmountFromStripe = (amount: number): number => {
  return Money.fromMinor(Math.round(amount), 'USD').toMach().amount;
};

/**
 * Environment check for webhook secret
 */
export const getWebhookSecret = (): string => {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    throw new Error('Missing STRIPE_WEBHOOK_SECRET environment variable');
  }
  return webhookSecret;
};