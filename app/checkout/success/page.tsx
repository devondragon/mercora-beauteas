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
 *  1. Retrieve the PaymentIntent (status + id) via its client secret.
 *  2. On `succeeded` / `processing`, POST the pending-order snapshot bound to
 *     THAT PaymentIntent (stashed by CheckoutClient before the redirect) to
 *     `/api/orders`. That endpoint is idempotent and re-verifies payment against
 *     Stripe, so a refresh or a race with the webhook can't double-create.
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

// 'received' = payment went through but we could not finalize the order locally
// (no snapshot for this PaymentIntent); distinct from 'confirmed' so we never
// show a fake confirmation. 'error' = couldn't determine status / order POST
// failed (retryable — snapshot kept, cart preserved).
type Phase = 'loading' | 'confirmed' | 'processing' | 'received' | 'failed' | 'error';

export default function CheckoutSuccessPage() {
  const { userId } = useAuth();
  const [phase, setPhase] = useState<Phase>('loading');
  const [orderId, setOrderId] = useState<string>('');
  const [reference, setReference] = useState<string>('');
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
      let paymentIntentId: string | undefined;
      try {
        const stripe = await loadStripe();
        if (!stripe) throw new Error('Stripe failed to load');
        const { paymentIntent, error } = await stripe.retrievePaymentIntent(clientSecret);
        if (error) throw new Error(error.message || 'Could not retrieve payment status');
        status = paymentIntent?.status;
        paymentIntentId = paymentIntent?.id;
      } catch (err) {
        console.error('[checkout/success] failed to retrieve PaymentIntent:', err);
        setPhase('error');
        setMessage(
          'We could not confirm your payment status. If you completed payment, your order is still being processed and a confirmation email will follow.'
        );
        return;
      } finally {
        // Strip the client secret from the URL so it can't leak via the Referer
        // header, browser history, or same-origin analytics.
        try {
          window.history.replaceState({}, '', window.location.pathname);
        } catch {
          // ignore — non-critical hardening
        }
      }

      setReference(paymentIntentId || '');

      // Only an explicitly successful (or async-settling) PaymentIntent proceeds.
      // Everything else — requires_payment_method, canceled, requires_action,
      // requires_confirmation, undefined — is a non-success: return to checkout
      // rather than show a confirmation. (The server re-verifies too.)
      const succeeded = status === 'succeeded';
      const processing = status === 'processing';
      if (!succeeded && !processing) {
        setPhase('failed');
        return;
      }

      // Load the snapshot bound to THIS PaymentIntent — never post a body for a
      // different PI (a concurrent checkout in another tab could hold the key).
      const pending = paymentIntentId ? loadPendingOrder(paymentIntentId) : null;
      if (!pending) {
        // No snapshot for this PI (returned in a different browser, localStorage
        // cleared, or overwritten) so we can't finalize the order on THIS device.
        // BMC-167: a server-side PENDING order was persisted at PaymentIntent
        // creation, so the Stripe `payment_intent.succeeded` webhook promotes it
        // to paid and sends the confirmation email server-side — this case now
        // reconciles automatically. We still don't show a local confirmation
        // (we have no order id to display) and we clear the cart to avoid an
        // accidental re-payment.
        setPhase('received');
        setMessage(
          'Your payment was received and your order is being finalized. A confirmation email will follow shortly — if you don’t see it, contact support with your payment reference below.'
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
        clearPendingOrder(paymentIntentId!);
        await clearCartSafely();
        setOrderId(pending.orderId);
        setPhase(processing ? 'processing' : 'confirmed');
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

  // Payment succeeded but the order couldn't be finalized on this device.
  if (phase === 'received') {
    return (
      <CenteredCard>
        <h1 className="text-2xl font-bold text-text-primary mb-2">Payment received</h1>
        <p className="text-text-secondary mb-4">{message}</p>
        {reference && (
          <p className="text-sm text-text-secondary mb-6">
            Payment reference: <span className="font-mono text-primary-700 break-all">{reference}</span>
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
        <p className="text-text-secondary mb-4">{message}</p>
        {reference && (
          <p className="text-sm text-text-secondary mb-6">
            Payment reference: <span className="font-mono text-primary-700 break-all">{reference}</span>
          </p>
        )}
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
