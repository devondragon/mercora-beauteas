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

  get currency(): string { return this.#currency; }

  toMinorUnits(): number { return this.#minor; }

  toJSON(): StoredMoney { return { amount: this.#minor, currency: this.#currency }; }
}
