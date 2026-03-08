/**
 * ETL Shared Types for Shopify Migration
 *
 * Standalone type definitions for migration scripts.
 * Cannot import from app code (Cloudflare runtime deps).
 * Reference: lib/db/schema/products.ts, lib/db/schema/category.ts
 */

// =====================================================
// ETL Pipeline Types
// =====================================================

/** Each extractor produces this shape */
export interface ExtractResult<T> {
  records: T[];
  source: 'api' | 'file';
  extractedAt: string;
}

/** Each transformer produces this shape */
export interface TransformResult<TSource, TTarget> {
  records: TTarget[];
  idMap: Map<string, string>;
  skipped: Array<{ record: TSource; reason: string }>;
  warnings: string[];
}

/** Each loader returns this shape */
export interface LoadResult {
  entity: string;
  inserted: number;
  skipped: number;
  errors: Array<{ id: string; error: string }>;
}

// =====================================================
// Shopify Source Types
// =====================================================

export interface ShopifyProductImage {
  id?: number;
  src: string;
  position?: number;
  alt?: string | null;
  width?: number;
  height?: number;
}

export interface ShopifyProductOption {
  id?: number;
  name: string;
  position?: number;
  values: string[];
}

export interface ShopifyProductVariant {
  id?: number;
  title?: string;
  sku: string;
  price: string; // Shopify stores as decimal string "14.99"
  compare_at_price?: string | null;
  grams?: number;
  weight?: number;
  weight_unit?: string;
  inventory_quantity?: number;
  inventory_policy?: string; // 'deny' | 'continue'
  inventory_management?: string;
  fulfillment_service?: string;
  requires_shipping?: boolean;
  taxable?: boolean;
  barcode?: string | null;
  option1?: string | null;
  option2?: string | null;
  option3?: string | null;
  image_id?: number | null;
  position?: number;
  created_at?: string;
  updated_at?: string;
}

export interface ShopifyProduct {
  id: number | string;
  title: string;
  body_html: string;
  handle: string;
  vendor?: string;
  product_type?: string;
  tags?: string;
  status: string; // 'active' | 'draft' | 'archived'
  published_at?: string | null;
  created_at?: string;
  updated_at?: string;
  variants: ShopifyProductVariant[];
  images: ShopifyProductImage[];
  options?: ShopifyProductOption[];
  image?: ShopifyProductImage;
  // CSV-specific fields
  seo_title?: string;
  seo_description?: string;
}

export interface ShopifyCollectionImage {
  src: string;
  alt?: string | null;
  width?: number;
  height?: number;
}

export interface ShopifyCollection {
  id: number | string;
  title: string;
  handle: string;
  body_html?: string;
  image?: ShopifyCollectionImage | null;
  published_at?: string | null;
  sort_order?: string;
  collection_type?: 'custom' | 'smart';
  updated_at?: string;
  // For products_count (API)
  products_count?: number;
}

export interface ShopifyCustomerAddress {
  address1?: string;
  address2?: string;
  city?: string;
  province?: string;
  province_code?: string;
  country?: string;
  country_code?: string;
  zip?: string;
  phone?: string;
  first_name?: string;
  last_name?: string;
  company?: string;
  default?: boolean;
}

export interface ShopifyCustomer {
  id: number | string;
  email: string;
  first_name?: string;
  last_name?: string;
  phone?: string;
  verified_email?: boolean;
  total_spent?: string;
  orders_count?: number;
  accepts_marketing?: boolean;
  tags?: string;
  created_at?: string;
  updated_at?: string;
  default_address?: ShopifyCustomerAddress;
  addresses?: ShopifyCustomerAddress[];
}

export interface ShopifyOrderLineItem {
  id?: number;
  product_id?: number;
  variant_id?: number;
  title: string;
  sku?: string;
  quantity: number;
  price: string;
  total_discount?: string;
}

export interface ShopifyOrder {
  id: number | string;
  name?: string; // e.g., "#1001"
  order_number?: number;
  email?: string;
  customer?: { id: number | string };
  financial_status?: string;
  fulfillment_status?: string | null;
  total_price: string;
  subtotal_price?: string;
  total_tax?: string;
  total_discounts?: string;
  currency?: string;
  line_items: ShopifyOrderLineItem[];
  shipping_address?: ShopifyCustomerAddress;
  billing_address?: ShopifyCustomerAddress;
  created_at?: string;
  updated_at?: string;
  closed_at?: string | null;
  cancelled_at?: string | null;
  cancel_reason?: string | null;
  tags?: string;
  note?: string;
}

export interface ShopifyPage {
  id: number | string;
  title: string;
  handle: string;
  body_html: string;
  author?: string;
  published_at?: string | null;
  created_at?: string;
  updated_at?: string;
  template_suffix?: string | null;
}

export interface JudgeMeReview {
  title?: string;
  body: string;
  rating: number;
  review_date?: string;
  reviewer_name?: string;
  reviewer_email?: string;
  product_id?: string;
  product_handle?: string;
  reply?: string;
  picture_urls?: string;
  source?: string;
  status?: string; // 'ok', 'spam', 'not-yet'
}

// =====================================================
// Mercora Insert Types (matching D1 schema columns)
// All JSON fields must be JSON.stringify()'d before SQL insertion
// =====================================================

export interface MercoraMediaObject {
  url: string;
  alt_text?: string;
  width?: number;
  height?: number;
}

export interface MercoraMoneyObject {
  amount: number; // in cents
  currency: string;
}

export interface MercoraProductInsert {
  id: string;
  name: string;
  description?: string | null;
  type?: string | null;
  status: string;
  slug: string;
  brand: string;
  categories?: string | null; // JSON.stringify(string[])
  tags?: string | null; // JSON.stringify(string[])
  options?: string | null; // JSON.stringify(ProductOption[])
  default_variant_id?: string | null;
  fulfillment_type: string;
  tax_category?: string | null;
  primary_image?: string | null; // JSON.stringify(Media)
  media?: string | null; // JSON.stringify(Media[])
  seo?: string | null; // JSON.stringify(SEO)
  rating?: string | null; // JSON.stringify(Rating)
  related_products?: string | null; // JSON.stringify(string[])
  external_references?: string | null; // JSON.stringify(object)
  extensions?: string | null; // JSON.stringify(object)
  created_at: string;
  updated_at: string;
}

export interface MercoraVariantInsert {
  id: string;
  product_id: string;
  sku: string;
  status: string;
  position: number;
  option_values: string; // JSON.stringify(OptionValue[])
  price: string; // JSON.stringify(Money)
  compare_at_price?: string | null; // JSON.stringify(Money)
  cost?: string | null; // JSON.stringify(Money)
  weight?: string | null; // JSON.stringify(Weight)
  dimensions?: string | null; // JSON.stringify(Dimensions)
  barcode?: string | null;
  inventory?: string | null; // JSON.stringify(ProductInventory)
  tax_category?: string | null;
  shipping_required: boolean;
  media?: string | null; // JSON.stringify(Media[])
  attributes?: string | null; // JSON.stringify(object)
  created_at: string;
  updated_at: string;
}

export interface MercoraCategoryInsert {
  id: string;
  name: string; // JSON.stringify({"en": value}) -- localized
  description?: string | null; // JSON.stringify({"en": value})
  slug?: string | null; // JSON.stringify({"en": value}) or plain string
  status: string;
  parent_id?: string | null;
  position?: number | null;
  path?: string | null;
  external_references?: string | null; // JSON.stringify(object)
  created_at: string;
  updated_at: string;
  children?: string | null; // JSON.stringify(string[])
  product_count?: number | null;
  attributes?: string | null; // JSON.stringify(object)
  tags?: string | null; // JSON.stringify(string[])
  primary_image?: string | null; // JSON.stringify(Media)
  media?: string | null; // JSON.stringify(Media[])
  seo?: string | null; // JSON.stringify(SEO)
  extensions?: string | null; // JSON.stringify(object)
}

export interface MercoraCustomerInsert {
  id: string;
  clerk_user_id: string;
  email: string;
  first_name?: string | null;
  last_name?: string | null;
  phone?: string | null;
  status: string;
  addresses?: string | null; // JSON.stringify(Address[])
  default_address?: string | null; // JSON.stringify(Address)
  preferences?: string | null; // JSON.stringify(object)
  external_references?: string | null; // JSON.stringify(object)
  metadata?: string | null; // JSON.stringify(object)
  created_at: string;
  updated_at: string;
}

export interface MercoraOrderInsert {
  id: string;
  customer_id?: string | null;
  status: string;
  items: string; // JSON.stringify(OrderItem[])
  subtotal: string; // JSON.stringify(Money)
  tax: string; // JSON.stringify(Money)
  shipping_cost: string; // JSON.stringify(Money)
  total: string; // JSON.stringify(Money)
  currency: string;
  shipping_address?: string | null; // JSON.stringify(Address)
  billing_address?: string | null; // JSON.stringify(Address)
  payment_method?: string | null; // JSON.stringify(object)
  notes?: string | null;
  external_references?: string | null; // JSON.stringify(object)
  metadata?: string | null; // JSON.stringify(object)
  created_at: string;
  updated_at: string;
}

export interface MercoraReviewInsert {
  id: string;
  product_id: string;
  customer_id: string;
  order_id: string;
  rating: number;
  title?: string | null;
  body?: string | null;
  status: string;
  is_verified: boolean;
  helpful_count: number;
  images?: string | null; // JSON.stringify(string[])
  reply?: string | null;
  reply_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface MercoraPageInsert {
  id: string;
  title: string;
  slug: string;
  content: string;
  status: string;
  template?: string | null;
  seo?: string | null; // JSON.stringify(SEO)
  author?: string | null;
  published_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface RedirectMapEntry {
  source_path: string;
  target_path: string;
  status_code: number;
  entity_type: string;
}
