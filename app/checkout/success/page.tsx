/**
 * === Checkout Return Page (redirect-based payment methods) ===
 *
 * Stripe redirects here after an off-site / redirect payment method — Klarna,
 * Cash App Pay, Amazon Pay — completes, appending `payment_intent`,
 * `payment_intent_client_secret`, and `redirect_status` to the URL.
 *
 * Card / Link never reach this page: they confirm inline with
 * `redirect: 'if_required'`, so `CheckoutClient.handlePaymentSuccess` creates
 * the order on the checkout page itself. For redirect methods that flow never
 * runs, so this page finalizes the order:
 *
 *  1. Retrieve the PaymentIntent status via its client secret.
 *  2. On `succeeded` / `processing`, POST the pending-order snapshot (stashed by
 *     CheckoutClient before the redirect) to `/api/orders`. That endpoint is
 *     idempotent and re-verifies payment against Stripe, so a refresh or a race
 *     with the Stripe webhook can't double-create or mispay the order.
 *  3. Clear the snapshot + cart and show confirmation.
 *
 * If payment failed, send the customer back to checkout with their cart intact.
 */

'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@clerk/nextjs';
import { loadStripe } from '@/lib/stripe';
import { useCartStore } from '@/lib/stores/cart-store';
import { loadPendingOrder, clearPendingOrder } from '@/lib/checkout/order-payload';
import OrderConfirmationModal from '@/components/checkout/OrderConfirmationModal';
import { Button } from '@/components/ui/button';

type Phase = 'loading' | 'confirmed' | 'processing' | 'failed' | 'error';

export default function CheckoutSuccessPage() {
  const { userId } = useAuth();
  const [phase, setPhase] = useState<Phase>('loading');
  const [orderId, setOrderId] = useState<string>('');
  const [message, setMessage] = useState<string>('');
  // React runs effects twice in dev StrictMode; guard so we only finalize once.
  const finalizedRef = useRef(false);

  useEffect(() => {
    if (finalizedRef.current) return;
    finalizedRef.current = true;

    const finalize = async () => {
      const params = new URLSearchParams(window.location.search);
      const clientSecret = params.get('payment_intent_client_secret');

      if (!clientSecret) {
        // Direct navigation with no Stripe context — nothing to finalize.
        setPhase('error');
        setMessage('No payment information was found for this page.');
        return;
      }

      let status: string | undefined;
      try {
        const stripe = await loadStripe();
        if (!stripe) throw new Error('Stripe failed to load');
        const { paymentIntent, error } = await stripe.retrievePaymentIntent(clientSecret);
        if (error) throw new Error(error.message || 'Could not retrieve payment status');
        status = paymentIntent?.status;
      } catch (err) {
        console.error('[checkout/success] failed to retrieve PaymentIntent:', err);
        setPhase('error');
        setMessage(
          'We could not confirm your payment status. If you completed payment, your order is still being processed and a confirmation email will follow.'
        );
        return;
      }

      // Payment did not complete — return the shopper to checkout to retry. The
      // cart was never cleared, so their items are intact.
      if (status === 'requires_payment_method' || status === 'canceled') {
        setPhase('failed');
        return;
      }

      // `succeeded` (captured) or `processing` (async capture, e.g. some Klarna/
      // Cash App flows) — create the order. The server leaves a still-processing
      // order 'pending' and the Stripe webhook marks it paid once captured.
      const pending = loadPendingOrder();
      if (!pending) {
        // No snapshot (returned in a different browser, or localStorage cleared).
        // We can't reconstruct the order here and the webhook can't create it
        // from PaymentIntent metadata alone — surface honestly rather than
        // implying an order exists. (See BMC-165 follow-up: server-side pending
        // order at PI creation would close this gap.)
        setPhase(status === 'processing' ? 'processing' : 'confirmed');
        setMessage(
          'Your payment was received. If you don’t see a confirmation email shortly, please contact support with your payment reference.'
        );
        await clearCartSafely();
        return;
      }

      try {
        const res = await fetch('/api/orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(pending.body),
        });
        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
          throw new Error(err.message || err.error || 'Failed to create order');
        }
        clearPendingOrder();
        await clearCartSafely();
        setOrderId(pending.orderId);
        setPhase(status === 'processing' ? 'processing' : 'confirmed');
      } catch (err) {
        console.error('[checkout/success] order creation failed:', err);
        // Payment succeeded but order creation failed. Keep the snapshot so a
        // refresh retries, and the webhook still reconciles payment server-side.
        setPhase('error');
        setMessage(
          'Your payment was received, but we hit a snag saving your order. Please refresh this page; if it persists, contact support — you will not be charged twice.'
        );
      }
    };

    finalize();
  }, []);

  // The cart store uses skipHydration — rehydrate before clearing so we wipe the
  // persisted copy too, not just the in-memory initial state.
  const clearCartSafely = async () => {
    try {
      await useCartStore.persist.rehydrate();
    } catch {
      // ignore — clearCart below still resets in-memory + persisted state
    }
    useCartStore.getState().clearCart();
  };

  if (phase === 'loading') {
    return (
      <CenteredCard>
        <div className="flex flex-col items-center gap-3 py-6">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500" />
          <p className="text-text-secondary">Confirming your payment…</p>
        </div>
      </CenteredCard>
    );
  }

  if (phase === 'failed') {
    return (
      <CenteredCard>
        <h1 className="text-2xl font-bold text-text-primary mb-2">Payment not completed</h1>
        <p className="text-text-secondary mb-6">
          Your payment wasn’t completed and you haven’t been charged. Your cart is still saved — you can try again.
        </p>
        <Button asChild className="bg-primary-500 text-text-inverse hover:bg-primary-600">
          <Link href="/checkout">Return to checkout</Link>
        </Button>
      </CenteredCard>
    );
  }

  if (phase === 'processing') {
    return (
      <CenteredCard>
        <h1 className="text-2xl font-bold text-text-primary mb-2">Payment processing</h1>
        <p className="text-text-secondary mb-2">
          Thanks! Your payment is being processed. We’ll email your confirmation as soon as it clears.
        </p>
        {orderId && (
          <p className="text-sm text-text-secondary mb-6">
            Order reference: <span className="font-mono text-primary-700">{orderId}</span>
          </p>
        )}
        <Button asChild className="bg-primary-500 text-text-inverse hover:bg-primary-600">
          <Link href="/">Continue shopping</Link>
        </Button>
      </CenteredCard>
    );
  }

  if (phase === 'error') {
    return (
      <CenteredCard>
        <h1 className="text-2xl font-bold text-text-primary mb-2">Almost there</h1>
        <p className="text-text-secondary mb-6">{message}</p>
        <Button asChild className="bg-primary-500 text-text-inverse hover:bg-primary-600">
          <Link href="/">Continue shopping</Link>
        </Button>
      </CenteredCard>
    );
  }

  // phase === 'confirmed'
  return (
    <OrderConfirmationModal
      isOpen={true}
      onClose={() => {
        window.location.href = '/';
      }}
      orderId={orderId}
      userId={userId || null}
    />
  );
}

function CenteredCard({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen px-4 py-16 flex items-start justify-center">
      <div className="bg-white p-8 rounded-xl shadow-sm max-w-md w-full text-center">{children}</div>
    </main>
  );
}
