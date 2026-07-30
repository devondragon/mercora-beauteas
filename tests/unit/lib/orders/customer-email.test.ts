// tests/unit/lib/orders/customer-email.test.ts
//
// Single source of truth for "who is this order's customer?" (BMC-216A).
// Orders have no email column: the address resolves as
// extensions.email || shipping_address.email — exactly what the
// order-confirmation sender did inline before this helper existed.
//
// The normalized value is also what the guest order-status token is bound to,
// so an unstable result here would invalidate live guest links.

import { describe, it, expect } from 'vitest';
import { getOrderCustomerEmail } from '@/lib/orders/customer-email';

describe('getOrderCustomerEmail', () => {
  it('prefers extensions.email', () => {
    expect(
      getOrderCustomerEmail({
        extensions: { email: 'ext@example.com' },
        shipping_address: { email: 'addr@example.com' },
      }),
    ).toBe('ext@example.com');
  });

  it('falls back to shipping_address.email', () => {
    expect(
      getOrderCustomerEmail({ extensions: {}, shipping_address: { email: 'addr@example.com' } }),
    ).toBe('addr@example.com');
  });

  it('trims and lowercases so the value is stable for token signing', () => {
    expect(getOrderCustomerEmail({ extensions: { email: '  Person@Example.COM ' } })).toBe(
      'person@example.com',
    );
    expect(getOrderCustomerEmail({ shipping_address: { email: 'ADDR@Example.com' } })).toBe(
      'addr@example.com',
    );
  });

  it('skips an empty or whitespace-only extensions email and uses the address', () => {
    expect(
      getOrderCustomerEmail({ extensions: { email: '   ' }, shipping_address: { email: 'addr@example.com' } }),
    ).toBe('addr@example.com');
  });

  it('returns null when neither source resolves', () => {
    expect(getOrderCustomerEmail({})).toBeNull();
    expect(getOrderCustomerEmail({ extensions: null, shipping_address: null })).toBeNull();
    expect(getOrderCustomerEmail({ extensions: {}, shipping_address: {} })).toBeNull();
    expect(getOrderCustomerEmail({ extensions: { email: '' }, shipping_address: { email: '  ' } })).toBeNull();
  });

  it('ignores non-string and structurally invalid values', () => {
    expect(getOrderCustomerEmail({ extensions: { email: 42 } as Record<string, unknown> })).toBeNull();
    expect(getOrderCustomerEmail({ shipping_address: 'not-an-object' })).toBeNull();
    expect(getOrderCustomerEmail({ shipping_address: ['a@b.com'] })).toBeNull();
    expect(getOrderCustomerEmail({ extensions: { email: { value: 'a@b.com' } } })).toBeNull();
  });
});
