import { describe, it, expect } from 'vitest';
import { sqlString } from '@/scripts/lib/sql-escape.mjs';

describe('sqlString', () => {
  it('wraps a plain value in single quotes', () => {
    expect(sqlString('hello')).toBe("'hello'");
  });

  it('doubles embedded single quotes', () => {
    expect(sqlString("o'brien")).toBe("'o''brien'");
  });

  it('doubles multiple embedded single quotes', () => {
    expect(sqlString("it's a 'test'")).toBe("'it''s a ''test'''");
  });

  it('passes normal alphanumeric values through unchanged (aside from quoting)', () => {
    expect(sqlString('carrier_webhook_123')).toBe("'carrier_webhook_123'");
  });

  it('stringifies non-string values before escaping', () => {
    expect(sqlString(42)).toBe("'42'");
  });

  it('handles an empty string', () => {
    expect(sqlString('')).toBe("''");
  });
});
