// lib/db/schema/settings.ts - Admin Settings Schema

import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

/**
 * Admin Settings Table - Stores configurable system settings
 * Key-value store for various configuration options
 */
export const admin_settings = sqliteTable("admin_settings", {
  key: text("key").primaryKey(), // Setting identifier
  value: text("value").notNull(), // JSON string value
  category: text("category").notNull(), // system, store, shipping, refund, promotions
  description: text("description"), // Human-readable description
  data_type: text("data_type").notNull(), // string, number, boolean, object
  created_at: text("created_at").default(sql`CURRENT_TIMESTAMP`),
  updated_at: text("updated_at").default(sql`CURRENT_TIMESTAMP`)
});

// Default settings for new installations
export const defaultSettings = [
  // System Operations
  {
    key: 'system.maintenance_mode',
    value: JSON.stringify(false),
    category: 'system',
    description: 'Block public access (admin still accessible)',
    data_type: 'boolean'
  },
  {
    key: 'system.maintenance_message',
    value: JSON.stringify('We\'re making some improvements! We\'ll be back soon.'),
    category: 'system',
    description: 'Message shown during maintenance',
    data_type: 'string'
  },
  {
    key: 'system.debug_mode',
    value: JSON.stringify(false),
    category: 'system',
    description: 'Enable detailed error logging',
    data_type: 'boolean'
  },
  {
    // BMC-163: kill switch for admin-authored CMS page custom_js. Default OFF —
    // existing pages with custom_js stay inert until this is explicitly enabled.
    key: 'cms.custom_js_enabled',
    value: JSON.stringify(false),
    category: 'system',
    description: 'Allow admin-authored custom JavaScript on CMS pages to execute (security-sensitive)',
    data_type: 'boolean'
  },

  // Store Operations
  {
    key: 'store.free_shipping_threshold',
    value: JSON.stringify(75),
    category: 'store',
    description: 'Minimum order amount for free shipping ($)',
    data_type: 'number'
  },
  {
    key: 'store.tax_rate',
    value: JSON.stringify(8.25),
    category: 'store',
    description: 'Default tax rate percentage',
    data_type: 'number'
  },
  {
    key: 'store.auto_fulfill_orders',
    value: JSON.stringify(true),
    category: 'store',
    description: 'Automatically fulfill orders vs manual review',
    data_type: 'boolean'
  },
  
  
  // Shipping Configuration
  {
    key: 'shipping.methods',
    // GOOB: the sale ships a single Standard method — express and overnight
    // are disabled rather than removed so the shape survives for any future
    // use. Migration 0028 mirrors this for already-deployed databases.
    value: JSON.stringify([
      { id: 'standard', label: 'Standard (5–7 days)', cost: 5.99, estimatedDays: 5, enabled: true },
      { id: 'express', label: 'Express (2–3 days)', cost: 9.99, estimatedDays: 2, enabled: false },
      { id: 'overnight', label: 'Overnight', cost: 19.99, estimatedDays: 1, enabled: false }
    ]),
    category: 'shipping',
    description: 'Available shipping methods and pricing',
    data_type: 'object'
  },
  {
    // GOOB: empty, matching what migration 0025 sets on every existing database.
    // This array is not just documentation — app/api/admin/settings/route.ts
    // inserts the whole `defaultSettings` block whenever `admin_settings` has
    // zero rows, so a freshly provisioned or reset environment seeds from HERE,
    // not from the migration. Leaving `['standard']` would silently re-enable
    // free shipping over $75 during the closing sale, which is the exact
    // failure 0025 exists to prevent. Empty = no method is ever free.
    key: 'shipping.free_methods',
    value: JSON.stringify([]),
    category: 'shipping',
    description: 'Which methods become free over threshold',
    data_type: 'object'
  },
  
  // Refund Policy Settings (Default: Don\'t refund shipping - industry standard)
  {
    key: 'refund.shipping_refunded_partial',
    value: JSON.stringify(false),
    category: 'refund',
    description: 'Refund shipping costs on partial returns',
    data_type: 'boolean'
  },
  {
    key: 'refund.shipping_refunded_full',
    value: JSON.stringify(false),
    category: 'refund', 
    description: 'Refund shipping costs on full returns',
    data_type: 'boolean'
  },
  {
    key: 'refund.restocking_fee_percent',
    value: JSON.stringify(0),
    category: 'refund',
    description: 'Restocking fee percentage (0-15)',
    data_type: 'number'
  },
  {
    key: 'refund.return_window_days',
    value: JSON.stringify(30),
    category: 'refund',
    description: 'Return window in days',
    data_type: 'number'
  },
  {
    key: 'refund.minimum_refund_amount',
    value: JSON.stringify(500),
    category: 'refund',
    description: 'Minimum refund amount in cents ($5.00)',
    data_type: 'number'
  },
  {
    // BMC-213: a refund issued outside the app (Stripe Dashboard) is reconciled
    // into the ledger by the `charge.refunded` webhook. Whether it also restores
    // stock is a business decision — default ON for parity with an app refund,
    // but turn it OFF if Dashboard refunds are typically goodwill gestures where
    // the goods were never returned. Only FULL external refunds ever restock;
    // partial ones carry no line attribution.
    key: 'refund.restock_on_external_refund',
    value: JSON.stringify(true),
    category: 'refund',
    description: 'Restock inventory when a full refund is issued outside the app (e.g. Stripe Dashboard)',
    data_type: 'boolean'
  },
  
  // Promotions & Banners
  {
    key: 'promotions.site_wide_discount_percent',
    value: JSON.stringify(0),
    category: 'promotions',
    description: 'Global discount percentage (0-50)',
    data_type: 'number'
  },
  {
    key: 'promotions.banner_enabled',
    value: JSON.stringify(false),
    category: 'promotions',
    description: 'Show promotional banner',
    data_type: 'boolean'
  },
  {
    key: 'promotions.banner_text',
    value: JSON.stringify('🎉 Free shipping on orders over $75!'),
    category: 'promotions',
    description: 'Banner message text',
    data_type: 'string'
  },
  {
    key: 'promotions.banner_type',
    value: JSON.stringify('info'),
    category: 'promotions',
    description: 'Banner style: info, warning, success, error',
    data_type: 'string'
  },
  {
    key: 'promotions.new_customer_discount',
    value: JSON.stringify(0),
    category: 'promotions',
    description: 'First-time buyer discount percentage',
    data_type: 'number'
  },

  // Recommendations (PDP "Recommended for you")
  {
    key: 'recommendations.strategy',
    value: JSON.stringify('deterministic'),
    category: 'recommendations',
    description: 'PDP recommendation source: deterministic or ai_batch',
    data_type: 'string'
  },
  {
    key: 'recommendations.personalize',
    value: JSON.stringify(true),
    category: 'recommendations',
    description: 'Personalize one slot for logged-in customers with order history',
    data_type: 'boolean'
  },
  {
    key: 'recommendations.limit',
    value: JSON.stringify(3),
    category: 'recommendations',
    description: 'Number of products shown in the PDP recommendations strip',
    data_type: 'number'
  },
  {
    key: 'recommendations.exclude_owned',
    value: JSON.stringify(true),
    category: 'recommendations',
    description: 'Hide products the customer already purchased',
    data_type: 'boolean'
  },

  // Going-out-of-business sale (0025)
  {
    key: 'sale.minimum_boxes',
    value: JSON.stringify(10),
    category: 'sale',
    description: 'Minimum number of boxes required to check out',
    data_type: 'number'
  },
  {
    key: 'sale.final_sale',
    value: JSON.stringify(true),
    category: 'sale',
    description: 'All sales are final (no returns); damaged or lost shipments are still made right',
    data_type: 'boolean'
  },
  {
    key: 'sale.subscriptions_enabled',
    value: JSON.stringify(false),
    category: 'sale',
    description: 'Show subscription options on the storefront',
    data_type: 'boolean'
  },
  {
    key: 'shipping.tiers',
    // EMPTY is intentional: resolveShippingOptions (shipping-options.ts:99) treats
    // any non-empty array as "configured" and overrides per-method costs. Placeholder
    // bands with cost: 0 would ship every order free until an admin enters real prices.
    // Empty array keeps flat rates ($5.99/$9.99/$19.99) in force.
    value: JSON.stringify([]),
    category: 'shipping',
    description: 'Quantity-tiered shipping cost in dollars; the last entry has a null max_boxes and covers everything above. EMPTY means not configured: the flat shipping.methods rates stay in force.',
    data_type: 'object'
  },
  {
    key: 'promotions.banner_link',
    value: JSON.stringify('/thank-you'),
    category: 'promotions',
    description: 'URL the promotional banner links to',
    data_type: 'string'
  }
];