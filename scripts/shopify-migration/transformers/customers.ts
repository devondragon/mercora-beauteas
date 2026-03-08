/**
 * Customer Transformer
 *
 * Transforms Shopify customers + Clerk results into Mercora customer records
 * for the D1 customers table.
 *
 * Customer ID = Clerk user ID (matches how Clerk auth works in the app).
 * Customers that failed Clerk creation are skipped.
 */

import type { IdMap } from '../lib/id-map.js';
import type {
  ShopifyCustomer,
  ShopifyCustomerAddress,
} from '../lib/types.js';
import type { ClerkUserResult } from '../loaders/clerk-loader.js';

/** Mercora customer record matching the actual customers table columns */
export interface CustomerRecord {
  id: string;
  type: string;
  status: string;
  external_references: string | null;
  created_at: string;
  updated_at: string;
  person: string | null;
  addresses: string | null;
  communication_preferences: string | null;
  tags: string | null;
  extensions: string | null;
}

export interface CustomerTransformResult {
  records: CustomerRecord[];
  skipped: Array<{ record: ShopifyCustomer; reason: string }>;
  warnings: string[];
}

/**
 * Transform Shopify address to Mercora address format
 */
function transformAddress(addr: ShopifyCustomerAddress): Record<string, unknown> {
  return {
    type: addr.default ? 'shipping' : 'other',
    line1: addr.address1 || '',
    line2: addr.address2 || undefined,
    city: addr.city || '',
    state: addr.province || addr.province_code || '',
    postal_code: addr.zip || '',
    country: addr.country_code || addr.country || '',
    is_default: addr.default ?? false,
  };
}

/**
 * Transform Shopify customers with Clerk results into Mercora format.
 *
 * @param shopifyCustomers - Extracted Shopify customers
 * @param clerkResults - Successful Clerk user creation results
 * @param idMap - ID mapping registry
 */
export function transformCustomers(
  shopifyCustomers: ShopifyCustomer[],
  clerkResults: ClerkUserResult[],
  idMap: IdMap
): CustomerTransformResult {
  const records: CustomerRecord[] = [];
  const skipped: Array<{ record: ShopifyCustomer; reason: string }> = [];
  const warnings: string[] = [];

  // Build a lookup from shopifyId to clerkUserId
  const clerkMap = new Map<string, string>();
  for (const result of clerkResults) {
    clerkMap.set(result.shopifyId, result.clerkUserId);
  }

  for (const customer of shopifyCustomers) {
    const shopifyId = String(customer.id);
    const clerkUserId = clerkMap.get(shopifyId);

    if (!clerkUserId) {
      skipped.push({
        record: customer,
        reason: 'Failed Clerk user creation -- no Clerk user ID available',
      });
      continue;
    }

    // Customer ID = Clerk user ID (the app uses Clerk user ID as customer ID)
    const mercoraId = clerkUserId;

    // Person data
    const person = {
      firstName: customer.first_name || '',
      lastName: customer.last_name || '',
      email: customer.email,
      phone: customer.phone || undefined,
    };

    // Addresses
    const addresses = (customer.addresses || [])
      .map(transformAddress);

    // Communication preferences
    const communicationPreferences = {
      email: customer.accepts_marketing ?? false,
    };

    // External references
    const externalReferences = {
      shopify_id: shopifyId,
      clerk_user_id: clerkUserId,
    };

    // Extensions (unmapped Shopify fields)
    const extensions = {
      total_spent: customer.total_spent || '0.00',
      orders_count: customer.orders_count ?? 0,
      shopify_tags: customer.tags || '',
    };

    records.push({
      id: mercoraId,
      type: 'person', // BeauTeas is B2C
      status: 'active',
      external_references: JSON.stringify(externalReferences),
      created_at: customer.created_at || new Date().toISOString(),
      updated_at: customer.updated_at || new Date().toISOString(),
      person: JSON.stringify(person),
      addresses: addresses.length > 0 ? JSON.stringify(addresses) : null,
      communication_preferences: JSON.stringify(communicationPreferences),
      tags: customer.tags
        ? JSON.stringify(customer.tags.split(',').map((t) => t.trim()))
        : null,
      extensions: JSON.stringify(extensions),
    });

    // Register in idMap for downstream use (orders, reviews)
    idMap.register('customers', shopifyId, mercoraId);
    if (customer.email) {
      idMap.register('customer_emails', customer.email.toLowerCase(), mercoraId);
    }
  }

  return { records, skipped, warnings };
}
