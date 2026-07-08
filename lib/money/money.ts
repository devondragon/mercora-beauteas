import Big from 'big.js';
import { getPrecision } from './currencies';

export interface MachMoney { amount: number; currency: string; precision: number; }
export interface StoredMoney { amount: number; currency: string; }

/** Immutable monetary value held as integer minor units (e.g. cents). */
export class Money {
  readonly #minor: number;
  readonly #currency: string;

  private constructor(minorUnits: number, currency: string) {
    if (!Number.isInteger(minorUnits)) {
      throw new Error(`Money minor units must be an integer, got ${minorUnits}`);
    }
    this.#minor = minorUnits;
    this.#currency = currency.toUpperCase();
  }

  static fromMinor(minorUnits: number, currency = 'USD'): Money {
    return new Money(minorUnits, currency);
  }

  static fromMajor(major: number | string, currency = 'USD'): Money {
    const precision = getPrecision(currency);
    const minor = Big(major).times(Big(10).pow(precision)).round(0, Big.roundHalfUp);
    return new Money(Number(minor), currency);
  }

  static zero(currency = 'USD'): Money {
    return new Money(0, currency);
  }

  /** Parse a persisted/legacy value — object, JSON string, or bare number/string — as MINOR units. */
  static fromStored(value: unknown, currency = 'USD'): Money {
    if (value && typeof value === 'object' && 'amount' in (value as Record<string, unknown>)) {
      const v = value as { amount: unknown; currency?: string };
      const amt = typeof v.amount === 'number' ? v.amount : parseInt(String(v.amount), 10);
      return new Money(Math.round(Number.isNaN(amt) ? 0 : amt), v.currency ?? currency);
    }
    if (typeof value === 'number') {
      return new Money(Math.round(value), currency);
    }
    if (typeof value === 'string') {
      const s = value.trim();
      if (s.startsWith('{')) {
        try { return Money.fromStored(JSON.parse(s), currency); } catch { /* fall through */ }
      }
      const n = parseInt(s, 10);
      return new Money(Number.isNaN(n) ? 0 : n, currency);
    }
    return new Money(0, currency);
  }

  #assertSameCurrency(other: Money): void {
    if (other.#currency !== this.#currency) {
      throw new Error(`Currency mismatch: ${this.#currency} vs ${other.#currency}`);
    }
  }

  add(other: Money): Money {
    this.#assertSameCurrency(other);
    return new Money(this.#minor + other.#minor, this.#currency);
  }

  subtract(other: Money): Money {
    this.#assertSameCurrency(other);
    return new Money(this.#minor - other.#minor, this.#currency);
  }

  negate(): Money {
    return new Money(-this.#minor, this.#currency);
  }

  /** Multiply by an integer quantity (a count of items). */
  times(qty: number): Money {
    if (!Number.isInteger(qty)) {
      throw new Error(`times() expects an integer quantity, got ${qty}`);
    }
    return new Money(this.#minor * qty, this.#currency);
  }

  /** Multiply by a rate (tax %, discount %) with exact big.js math, round half-up to integer minor. */
  applyRate(rate: number | string): Money {
    const minor = Big(this.#minor).times(rate).round(0, Big.roundHalfUp);
    return new Money(Number(minor), this.#currency);
  }

  /** Split into shares by integer ratios, distributing the remainder so the sum is preserved. */
  allocate(ratios: number[]): Money[] {
    const total = ratios.reduce((a, b) => a + b, 0);
    if (total <= 0) throw new Error('allocate() ratios must sum to a positive number');
    const shares = ratios.map(r => Math.floor((this.#minor * r) / total));
    let remainder = this.#minor - shares.reduce((a, b) => a + b, 0);
    for (let i = 0; remainder > 0; i = (i + 1) % ratios.length) { shares[i]++; remainder--; }
    return shares.map(s => new Money(s, this.#currency));
  }

  equals(other: Money): boolean {
    return this.#currency === other.#currency && this.#minor === other.#minor;
  }

  gte(other: Money): boolean {
    this.#assertSameCurrency(other);
    return this.#minor >= other.#minor;
  }

  gt(other: Money): boolean {
    this.#assertSameCurrency(other);
    return this.#minor > other.#minor;
  }

  lte(other: Money): boolean {
    this.#assertSameCurrency(other);
    return this.#minor <= other.#minor;
  }

  lt(other: Money): boolean {
    this.#assertSameCurrency(other);
    return this.#minor < other.#minor;
  }

  isZero(): boolean {
    return this.#minor === 0;
  }

  isNegative(): boolean {
    return this.#minor < 0;
  }

  /** MACH Alliance wire shape: decimal MAJOR units + precision. Use at API/MCP/JSON-LD boundaries only. */
  toMach(): MachMoney {
    const precision = getPrecision(this.#currency);
    const amount = Number(Big(this.#minor).div(Big(10).pow(precision)).toFixed(precision));
    return { amount, currency: this.#currency, precision };
  }

  /** Localized currency string for display. The single display entry point. */
  format(locale = 'en-US'): string {
    const { amount } = this.toMach();
    return new Intl.NumberFormat(locale, { style: 'currency', currency: this.#currency }).format(amount);
  }

  get currency(): string { return this.#currency; }

  toMinorUnits(): number { return this.#minor; }

  toJSON(): StoredMoney { return { amount: this.#minor, currency: this.#currency }; }
}
