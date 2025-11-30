/**
 * Subscription Types
 *
 * Type definitions for the subscription system including plans,
 * customer subscriptions, invoices, and payment methods.
 */

import { Money, Address } from "./mach";

// =====================================================
// Subscription Plan Types
// =====================================================

export type SubscriptionInterval = "day" | "week" | "month" | "year";
export type SubscriptionPlanStatus = "active" | "inactive" | "archived";

export interface SubscriptionPlan {
  id: string;
  name: string;
  description?: string;

  // Product linkage
  product_id?: string;
  variant_id?: string;

  // Billing configuration
  interval: SubscriptionInterval;
  interval_count: number;
  price: Money;

  // Trial and fees
  trial_period_days: number;
  setup_fee?: Money;

  // Stripe integration
  stripe_product_id?: string;
  stripe_price_id?: string;

  // Status and metadata
  status: SubscriptionPlanStatus;
  features?: string[];
  metadata?: Record<string, unknown>;

  // Timestamps
  created_at?: string;
  updated_at?: string;

  // MACH compliance
  external_references?: Record<string, unknown>;
  extensions?: Record<string, unknown>;
}

export interface CreateSubscriptionPlanRequest {
  name: string;
  description?: string;
  product_id?: string;
  variant_id?: string;
  interval: SubscriptionInterval;
  interval_count?: number;
  price_amount: number;
  currency_code?: string;
  trial_period_days?: number;
  setup_fee_amount?: number;
  features?: string[];
  metadata?: Record<string, unknown>;
}

export interface UpdateSubscriptionPlanRequest {
  name?: string;
  description?: string;
  status?: SubscriptionPlanStatus;
  features?: string[];
  metadata?: Record<string, unknown>;
}

// =====================================================
// Subscription Types
// =====================================================

export type SubscriptionStatus =
  | "pending"       // Created, awaiting payment
  | "trialing"      // In trial period
  | "active"        // Paid and active
  | "paused"        // Temporarily paused
  | "past_due"      // Payment failed, retrying
  | "cancelled"     // Cancelled by user/admin
  | "expired";      // Ended after cancellation period

export interface Subscription {
  id: string;
  customer_id: string;
  plan_id: string;
  plan?: SubscriptionPlan;

  // Stripe integration
  stripe_subscription_id?: string;
  stripe_customer_id?: string;

  // Status
  status: SubscriptionStatus;

  // Billing cycle
  current_period_start?: string;
  current_period_end?: string;
  trial_start?: string;
  trial_end?: string;

  // Cancellation
  cancel_at_period_end: boolean;
  cancelled_at?: string;
  cancel_reason?: string;
  ended_at?: string;

  // Shipping
  shipping_address?: Address;

  // Quantity
  quantity: number;

  // Pause handling
  paused_at?: string;
  resume_at?: string;

  // Timestamps
  created_at?: string;
  updated_at?: string;

  // MACH compliance
  external_references?: Record<string, unknown>;
  extensions?: Record<string, unknown>;
}

export interface CreateSubscriptionRequest {
  customer_id: string;
  plan_id: string;
  payment_method_id: string;
  quantity?: number;
  shipping_address?: Address;
  trial_from_plan?: boolean;
  metadata?: Record<string, unknown>;
}

export interface UpdateSubscriptionRequest {
  plan_id?: string;
  quantity?: number;
  shipping_address?: Address;
  cancel_at_period_end?: boolean;
  metadata?: Record<string, unknown>;
}

// =====================================================
// Subscription Invoice Types
// =====================================================

export type InvoiceStatus = "draft" | "open" | "paid" | "void" | "uncollectible";

export interface SubscriptionInvoice {
  id: string;
  subscription_id: string;

  // Stripe integration
  stripe_invoice_id?: string;
  stripe_payment_intent_id?: string;

  // Amounts
  subtotal: Money;
  discount?: Money;
  tax?: Money;
  total: Money;
  amount_paid: Money;
  amount_due: Money;

  // Status
  status: InvoiceStatus;

  // Billing period
  period_start?: string;
  period_end?: string;

  // Dates
  due_date?: string;
  paid_at?: string;
  voided_at?: string;

  // Generated order
  order_id?: string;

  // Invoice details
  invoice_number?: string;
  invoice_pdf_url?: string;
  hosted_invoice_url?: string;

  // Timestamps
  created_at?: string;
  updated_at?: string;

  // MACH compliance
  external_references?: Record<string, unknown>;
  extensions?: Record<string, unknown>;
}

// =====================================================
// Payment Method Types
// =====================================================

export type PaymentMethodType = "card" | "bank_account" | "sepa_debit" | "us_bank_account" | "link";
export type PaymentMethodStatus = "active" | "expired" | "failed" | "removed";
export type CardFunding = "credit" | "debit" | "prepaid" | "unknown";

export interface CustomerPaymentMethod {
  id: string;
  customer_id: string;

  // Stripe integration
  stripe_payment_method_id: string;
  stripe_customer_id?: string;

  // Payment method details
  type: PaymentMethodType;

  // Card details
  card_brand?: string;
  card_last4?: string;
  card_exp_month?: number;
  card_exp_year?: number;
  card_funding?: CardFunding;

  // Bank account details
  bank_name?: string;
  bank_last4?: string;

  // Status
  is_default: boolean;
  status: PaymentMethodStatus;

  // Billing address
  billing_address?: Address;

  // Timestamps
  created_at?: string;
  updated_at?: string;

  // MACH compliance
  extensions?: Record<string, unknown>;
}

// =====================================================
// Subscription Event Types
// =====================================================

export type SubscriptionEventType =
  | "created"
  | "activated"
  | "trial_started"
  | "trial_ended"
  | "renewed"
  | "payment_succeeded"
  | "payment_failed"
  | "paused"
  | "resumed"
  | "cancelled"
  | "expired"
  | "plan_changed"
  | "quantity_changed"
  | "price_changed";

export interface SubscriptionEvent {
  id: string;
  subscription_id: string;
  event_type: SubscriptionEventType;
  data?: Record<string, unknown>;
  previous_status?: SubscriptionStatus;
  new_status?: SubscriptionStatus;
  stripe_event_id?: string;
  created_at?: string;
}

// =====================================================
// API Response Types
// =====================================================

export interface SubscriptionWithPlan extends Subscription {
  plan: SubscriptionPlan;
}

export interface CreateSubscriptionResponse {
  subscription_id: string;
  stripe_subscription_id?: string;
  status: SubscriptionStatus;
  client_secret?: string; // For payment confirmation if needed
}

export interface SubscriptionListResponse {
  subscriptions: SubscriptionWithPlan[];
  total: number;
  has_more: boolean;
}

export interface InvoiceListResponse {
  invoices: SubscriptionInvoice[];
  total: number;
  has_more: boolean;
}
