import { Money } from '@/lib/money';

/**
 * Pure formatter for order-confirmation email totals. Every input is a MINOR-unit
 * integer (cents) — never dollars — matching the order/checkout Money contract
 * (Money.toJSON() / body.total_amount.amount / body.extensions.*). Output is
 * pre-formatted display strings via Money.format() so downstream email templates
 * never need to know the unit and never call .toFixed() on raw numbers
 * (BMC-143: that mismatch produced a 100x-inflated total in the confirmation email).
 */
export interface OrderEmailTotalsInput {
  subtotal: number;
  shipping: number;
  tax: number;
  /** PRE-gift-card order total (matches the persisted order total_amount). */
  total: number;
  currency?: string;
  /**
   * Gift-card tender applied to this order, in minor units, if any. When present,
   * the builder also returns `giftCard` and `amountCharged` (total - giftCard) so
   * the email reflects what the customer actually paid post-redemption.
   */
  giftCardAmount?: number;
}

export interface OrderEmailTotals {
  subtotal: string;
  shipping: string;
  tax: string;
  total: string;
  giftCard?: string;
  amountCharged?: string;
}

export function buildOrderEmailTotals(input: OrderEmailTotalsInput): OrderEmailTotals {
  const currency = input.currency ?? 'USD';
  const format = (minor: number) => Money.fromMinor(minor, currency).format();

  const result: OrderEmailTotals = {
    subtotal: format(input.subtotal),
    shipping: format(input.shipping),
    tax: format(input.tax),
    total: format(input.total),
  };

  if (input.giftCardAmount && input.giftCardAmount > 0) {
    result.giftCard = format(input.giftCardAmount);
    result.amountCharged = format(Math.max(0, input.total - input.giftCardAmount));
  }

  return result;
}
