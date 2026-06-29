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
import { createPaymentIntent, formatAmountForStripe } from '@/lib/stripe';
import { validateGiftCardForRedemption } from '@/lib/models/mach/giftCard';
import type { Address } from '@/lib/types';

interface PaymentIntentRequest {
  amount: number;
  taxAmount: number;
  shippingAddress: Address;
  orderId: string;
  description?: string;
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
    console.error('Error creating payment intent:', error);
    return NextResponse.json(
      { error: 'Failed to create payment intent' },
      { status: 500 }
    );
  }
}

