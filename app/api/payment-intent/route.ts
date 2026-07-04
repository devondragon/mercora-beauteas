/**
 * === Payment Intent Creation ===
 *
 * Creates Stripe Payment Intents for secure payment processing.
 * Tax calculation should be done via /api/tax before calling this endpoint.
 *
 * === Features ===
 * - **Payment Intent Creation**: Secure payment setup with Stripe
 * - **Order Metadata**: Links payments to order records
 * - **Address Handling**: Shipping and billing address attachment
 * - **Error Handling**: Comprehensive error management and logging
 *
 * === Request Format ===
 * ```json
 * {
 *   "amount": number,        // Total amount including tax
 *   "taxAmount": number,     // Tax amount (from /api/tax)
 *   "shippingAddress": Address,
 *   "orderId": string,
 *   "description"?: string
 * }
 * ```
 *
 * === Response Format ===
 * ```json
 * {
 *   "clientSecret": string,
 *   "paymentIntentId": string,
 *   "amount": number
 * }
 * ```
 */

import { NextRequest, NextResponse } from 'next/server';
import { createPaymentIntent, formatAmountForStripe, isStripeConfigured } from '@/lib/stripe';
import { validateGiftCardForRedemption } from '@/lib/models/mach/giftCard';
import { computeCatalogSubtotalCents, AMOUNT_TOLERANCE_CENTS, MAX_ORDER_LINE_ITEMS } from '@/lib/services/order-pricing';
import type { Address } from '@/lib/types';

// Minimal shape of a cart line needed to price it from the catalog. Accepts
// both the cart-store shape (productId/variantId) and the MACH order shape.
interface PaymentIntentLineItem {
  productId?: string;
  product_id?: string;
  variantId?: string;
  variant_id?: string;
  quantity?: number;
}

interface PaymentIntentRequest {
  amount: number;
  taxAmount: number;
  shippingAddress: Address;
  orderId: string;
  description?: string;
  // Cart lines, used to recompute the goods subtotal from the catalog and
  // reject an `amount` that undercuts it (BMC-131). Optional for backward
  // compatibility; the authoritative gate is at order creation + the webhook.
  items?: PaymentIntentLineItem[];
  // Present when a gift card is applied as tender. The server re-verifies the
  // card's CURRENT balance before charging so a stale client-side balance can't
  // under-collect the amount due.
  giftCard?: { code: string; appliedCents: number };
}

export async function POST(req: NextRequest) {
  try {
    const {
      amount,
      taxAmount,
      shippingAddress,
      orderId,
      description,
      giftCard,
      items,
    }: PaymentIntentRequest = await req.json();

    // Validate required fields
    if (!amount || amount <= 0) {
      return NextResponse.json(
        { error: 'Valid amount is required' },
        { status: 400 }
      );
    }

    // Stripe rejects charges below its $0.50 minimum. Enforce it server-side
    // (the checkout UI also guards this, but a direct API call must not slip a
    // sub-minimum amount through to Stripe and surface as an opaque 500).
    if (amount < 0.5) {
      return NextResponse.json(
        { error: 'Amount must be at least $0.50' },
        { status: 400 }
      );
    }

    if (!shippingAddress) {
      return NextResponse.json(
        { error: 'Shipping address is required' },
        { status: 400 }
      );
    }

    if (!orderId) {
      return NextResponse.json(
        { error: 'Order ID is required' },
        { status: 400 }
      );
    }

    // Fail loudly and specifically when Stripe isn't configured in this runtime.
    // Previously this surfaced as an opaque 500 ("Failed to create payment
    // intent") because the missing-secret-key throw was swallowed by the generic
    // catch below. The Workers runtime reads secrets from `.dev.vars` /
    // `wrangler secret`, NOT `.env.local`.
    if (!isStripeConfigured()) {
      console.error(
        '[payment-intent] STRIPE_SECRET_KEY is not configured in this runtime. ' +
          'For `wrangler dev`/OpenNext preview set it in `.dev.vars`; for deployed ' +
          'envs use `wrangler secret put STRIPE_SECRET_KEY --env <env>`. ' +
          '`.env.local` is only read by `next dev`.'
      );
      return NextResponse.json(
        {
          error: 'Payments are temporarily unavailable. Please try again later.',
          code: 'stripe_not_configured',
        },
        { status: 503 }
      );
    }

    // If a gift card is applied as tender, re-verify its CURRENT balance here.
    // The client derives `amount` from a balance it fetched earlier; if the card
    // was partially redeemed in the meantime, that amount would under-collect.
    // Reject (don't silently charge the stale, too-low amount) so the shopper
    // re-applies the card at its current balance.
    if (giftCard?.code) {
      const appliedCents = Math.round(giftCard.appliedCents);
      const check = await validateGiftCardForRedemption(giftCard.code);
      const currentBalanceCents = check.valid ? check.balance ?? 0 : 0;
      if (!check.valid || appliedCents > currentBalanceCents) {
        return NextResponse.json(
          {
            error:
              'Your gift card balance changed. Please re-apply your gift card to continue.',
            code: 'gift_card_balance_changed',
          },
          { status: 409 }
        );
      }
    }

    // BMC-131: fail early if the requested charge doesn't even cover the
    // catalog value of the goods. The authoritative gate is at order creation
    // and the Stripe webhook (which re-verify against the CAPTURED amount);
    // rejecting an under-priced PaymentIntent here stops a bogus charge from
    // ever being created and gives the shopper an immediate, clear error.
    if (Array.isArray(items) && items.length > 0) {
      // M6: cap the line count before it drives one catalog lookup per item.
      if (items.length > MAX_ORDER_LINE_ITEMS) {
        console.warn(
          `[payment-intent] order ${orderId}: rejected — ${items.length} items exceeds the ${MAX_ORDER_LINE_ITEMS} line limit`
        );
        return NextResponse.json(
          { error: 'Too many items in your cart. Please reduce the number of items and try again.', code: 'too_many_items' },
          { status: 400 }
        );
      }
      const normalized = items.map((it) => ({
        product_id: it.product_id ?? it.productId,
        variant_id: it.variant_id ?? it.variantId,
        quantity: it.quantity,
      }));
      const { subtotalCents, errors } = await computeCatalogSubtotalCents(normalized);
      if (errors.length) {
        console.warn(
          `[payment-intent] order ${orderId}: catalog pricing errors — ${errors.join('; ')}`
        );
        return NextResponse.json(
          {
            error: 'One or more items are no longer available. Please refresh your cart and try again.',
            code: 'catalog_price_unavailable',
          },
          { status: 409 }
        );
      }

      // The gift card was already re-validated above against its live balance,
      // so appliedCents is a safe (<= balance) tender to credit here.
      const giftCardTenderCents = giftCard?.code
        ? Math.max(0, Math.round(giftCard.appliedCents || 0))
        : 0;
      const requiredCashCents = Math.max(0, subtotalCents - giftCardTenderCents);
      const amountCents = Math.round(amount * 100);
      if (amountCents + AMOUNT_TOLERANCE_CENTS < requiredCashCents) {
        console.warn(
          `[payment-intent] order ${orderId}: requested amount ${amountCents}c is below ` +
            `catalog floor ${requiredCashCents}c (goods ${subtotalCents}c, gift card ${giftCardTenderCents}c)`
        );
        return NextResponse.json(
          {
            error: 'The payment amount is less than the price of your items. Please refresh your cart and try again.',
            code: 'amount_below_catalog',
          },
          { status: 400 }
        );
      }
    }

    // Create Payment Intent
    const paymentIntent = await createPaymentIntent({
      amount: formatAmountForStripe(amount),
      currency: 'usd',
      automatic_payment_methods: {
        enabled: true,
      },
      metadata: {
        orderId,
        taxAmount: taxAmount.toString(),
        totalAmount: amount.toString(),
      },
      shipping: {
        address: {
          line1: String(shippingAddress.line1),
          line2: shippingAddress.line2 ? String(shippingAddress.line2) : undefined,
          city: String(shippingAddress.city),
          state: String(shippingAddress.region),
          postal_code: String(shippingAddress.postal_code),
          country: 'US',
        },
        name: String(shippingAddress.recipient || 'Customer'),
      },
      description: description || `Order ${orderId}`,
    });

    return NextResponse.json({
      clientSecret: (paymentIntent as any).client_secret,
      paymentIntentId: (paymentIntent as any).id,
      amount,
    });

  } catch (error) {
    // Log the actual cause (message + full error) so a real Stripe failure is
    // diagnosable from `wrangler tail` instead of hiding behind the generic
    // client-facing message.
    const detail = error instanceof Error ? error.message : String(error);
    console.error('Error creating payment intent:', detail, error);
    return NextResponse.json(
      { error: 'Failed to create payment intent' },
      { status: 500 }
    );
  }
}

