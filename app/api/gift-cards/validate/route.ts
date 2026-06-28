/**
 * === Gift Card Validation ===
 *
 * Public endpoint used by the checkout redemption input to check a gift card
 * code and return its REAL server-side balance. The client never asserts the
 * balance itself — this is the source of truth used to compute how much of the
 * card can be applied. Actual redemption (the balance deduction) happens
 * server-side at payment time via the fulfillment service, so this endpoint is
 * read-only and safe to call repeatedly.
 *
 * === Request ===  { "code": string }
 * === Response === { "valid": boolean, "balance"?: number (cents),
 *                    "currency"?: string, "code"?: string, "error"?: string }
 */

import { NextRequest, NextResponse } from 'next/server';
import { validateGiftCardForRedemption } from '@/lib/models/mach/giftCard';

export async function POST(req: NextRequest) {
  try {
    const { code } = (await req.json()) as { code?: string };

    if (!code || typeof code !== 'string' || !code.trim()) {
      return NextResponse.json(
        { valid: false, error: 'Gift card code is required' },
        { status: 400 }
      );
    }

    const result = await validateGiftCardForRedemption(code);

    if (!result.valid) {
      return NextResponse.json({ valid: false, error: result.reason });
    }

    return NextResponse.json({
      valid: true,
      code: result.code,
      balance: result.balance,
      currency: result.currency,
    });
  } catch (error) {
    console.error('Gift card validation error:', error);
    return NextResponse.json(
      { valid: false, error: 'Failed to validate gift card' },
      { status: 500 }
    );
  }
}
