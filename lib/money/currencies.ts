/** ISO 4217 minor-unit exponents (subset). Number of decimal places in the major unit. */
export const CURRENCY_PRECISION: Record<string, number> = {
  USD: 2, EUR: 2, GBP: 2, CAD: 2, AUD: 2, CHF: 2, CNY: 2, INR: 2, BRL: 2,
  JPY: 0,
  BHD: 3, KWD: 3,
};

export const DEFAULT_PRECISION = 2;

export function getPrecision(currency: string): number {
  return CURRENCY_PRECISION[currency.toUpperCase()] ?? DEFAULT_PRECISION;
}
