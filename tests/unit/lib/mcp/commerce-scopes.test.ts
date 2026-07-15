/**
 * Unit tests for the MCP commerce permission-scope helper (BMC-188).
 *
 * The per-agent `permissions` array was previously only consulted for the
 * agent-management tier, so a key provisioned `["read:products"]` — or `[]` —
 * could still add_to_cart / create_payment_intent / place_order. hasPermission()
 * is the single, fail-closed mechanism the commerce tools + dispatcher now use
 * to gate cart-mutating (write:cart) and placement (place:orders) operations.
 */
import { describe, it, expect } from 'vitest';
import { hasPermission, COMMERCE_SCOPES, COMMERCE_TOOL_SCOPES } from '@/lib/mcp/auth';

describe('hasPermission (BMC-188 commerce scopes)', () => {
  it('grants when the exact scope is present', () => {
    expect(hasPermission(['write:cart'], COMMERCE_SCOPES.WRITE_CART)).toBe(true);
    expect(hasPermission(['place:orders'], COMMERCE_SCOPES.PLACE_ORDERS)).toBe(true);
  });

  it('grants any scope for the superuser wildcards admin / *', () => {
    for (const superuser of ['admin', '*']) {
      expect(hasPermission([superuser], COMMERCE_SCOPES.WRITE_CART)).toBe(true);
      expect(hasPermission([superuser], COMMERCE_SCOPES.PLACE_ORDERS)).toBe(true);
    }
  });

  it('denies when the required scope is absent', () => {
    expect(hasPermission(['read:products'], COMMERCE_SCOPES.WRITE_CART)).toBe(false);
    expect(hasPermission(['write:cart'], COMMERCE_SCOPES.PLACE_ORDERS)).toBe(false);
  });

  it('fails closed for empty or undefined permissions', () => {
    expect(hasPermission([], COMMERCE_SCOPES.WRITE_CART)).toBe(false);
    expect(hasPermission(undefined, COMMERCE_SCOPES.PLACE_ORDERS)).toBe(false);
  });

  it('does not treat the agent-management scope as a commerce grant', () => {
    // agents:manage is privileged for the management tier but is NOT a superuser
    // grant, so it must not satisfy an arbitrary commerce scope.
    expect(hasPermission(['agents:manage'], COMMERCE_SCOPES.WRITE_CART)).toBe(false);
    expect(hasPermission(['agents:manage'], COMMERCE_SCOPES.PLACE_ORDERS)).toBe(false);
  });
});

describe('COMMERCE_TOOL_SCOPES mapping', () => {
  it('requires write:cart for every cart-mutating tool', () => {
    for (const tool of ['add_to_cart', 'update_cart', 'remove_from_cart', 'bulk_add_to_cart', 'clear_cart']) {
      expect(COMMERCE_TOOL_SCOPES[tool]).toBe(COMMERCE_SCOPES.WRITE_CART);
    }
  });

  it('requires place:orders for order + payment placement', () => {
    expect(COMMERCE_TOOL_SCOPES['place_order']).toBe(COMMERCE_SCOPES.PLACE_ORDERS);
    expect(COMMERCE_TOOL_SCOPES['create_payment_intent']).toBe(COMMERCE_SCOPES.PLACE_ORDERS);
  });

  it('carries no commerce-scope requirement for read-only / catalog tools', () => {
    for (const tool of ['search_products', 'get_recommendations', 'get_cart', 'get_shipping_options', 'validate_payment']) {
      expect(COMMERCE_TOOL_SCOPES[tool]).toBeUndefined();
    }
  });
});
