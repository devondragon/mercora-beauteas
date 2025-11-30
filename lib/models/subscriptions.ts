// lib/models/subscriptions.ts - Subscription Operations

import { eq, desc, and, sql, isNull, or } from "drizzle-orm";
import { getDbAsync } from "@/lib/db";
import {
  subscription_plans,
  subscriptions,
  subscription_items,
  subscription_invoices,
  subscription_events,
  customer_payment_methods,
} from "@/lib/db/schema/subscriptions";
import {
  SubscriptionPlan,
  Subscription,
  SubscriptionInvoice,
  CustomerPaymentMethod,
  SubscriptionEvent,
  CreateSubscriptionPlanRequest,
  UpdateSubscriptionPlanRequest,
  SubscriptionStatus,
  SubscriptionEventType,
  Money,
} from "@/lib/types/subscription";
import { Address } from "@/lib/types";

// =====================================================
// Utility Functions
// =====================================================

function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

function centsToMoney(cents: number, currency: string = "USD"): Money {
  return { amount: cents, currency };
}

// =====================================================
// Subscription Plan Operations
// =====================================================

export async function createSubscriptionPlan(
  data: CreateSubscriptionPlanRequest
): Promise<SubscriptionPlan> {
  const db = await getDbAsync();
  const id = generateId("plan");

  const [plan] = await db
    .insert(subscription_plans)
    .values({
      id,
      name: data.name,
      description: data.description,
      product_id: data.product_id,
      variant_id: data.variant_id,
      interval: data.interval,
      interval_count: data.interval_count ?? 1,
      price_amount: data.price_amount,
      currency_code: data.currency_code ?? "USD",
      trial_period_days: data.trial_period_days ?? 0,
      setup_fee_amount: data.setup_fee_amount ?? 0,
      features: data.features ? JSON.stringify(data.features) : null,
      metadata: data.metadata ? JSON.stringify(data.metadata) : null,
      status: "active",
    })
    .returning();

  return hydratePlan(plan);
}

export async function getSubscriptionPlan(id: string): Promise<SubscriptionPlan | null> {
  const db = await getDbAsync();

  const [plan] = await db
    .select()
    .from(subscription_plans)
    .where(eq(subscription_plans.id, id))
    .limit(1);

  return plan ? hydratePlan(plan) : null;
}

export async function getSubscriptionPlanByStripePrice(
  stripePriceId: string
): Promise<SubscriptionPlan | null> {
  const db = await getDbAsync();

  const [plan] = await db
    .select()
    .from(subscription_plans)
    .where(eq(subscription_plans.stripe_price_id, stripePriceId))
    .limit(1);

  return plan ? hydratePlan(plan) : null;
}

export async function listSubscriptionPlans(
  status?: "active" | "inactive" | "archived"
): Promise<SubscriptionPlan[]> {
  const db = await getDbAsync();

  let query = db.select().from(subscription_plans);

  if (status) {
    query = query.where(eq(subscription_plans.status, status)) as typeof query;
  }

  const plans = await query.orderBy(desc(subscription_plans.created_at));
  return plans.map(hydratePlan);
}

export async function updateSubscriptionPlan(
  id: string,
  data: UpdateSubscriptionPlanRequest
): Promise<SubscriptionPlan | null> {
  const db = await getDbAsync();

  const updateData: Record<string, unknown> = {
    updated_at: sql`(datetime('now'))`,
  };

  if (data.name !== undefined) updateData.name = data.name;
  if (data.description !== undefined) updateData.description = data.description;
  if (data.status !== undefined) updateData.status = data.status;
  if (data.features !== undefined) updateData.features = JSON.stringify(data.features);
  if (data.metadata !== undefined) updateData.metadata = JSON.stringify(data.metadata);

  const [plan] = await db
    .update(subscription_plans)
    .set(updateData)
    .where(eq(subscription_plans.id, id))
    .returning();

  return plan ? hydratePlan(plan) : null;
}

export async function updatePlanStripeIds(
  id: string,
  stripeProductId: string,
  stripePriceId: string
): Promise<void> {
  const db = await getDbAsync();

  await db
    .update(subscription_plans)
    .set({
      stripe_product_id: stripeProductId,
      stripe_price_id: stripePriceId,
      updated_at: sql`(datetime('now'))`,
    })
    .where(eq(subscription_plans.id, id));
}

function hydratePlan(record: typeof subscription_plans.$inferSelect): SubscriptionPlan {
  return {
    id: record.id,
    name: record.name,
    description: record.description ?? undefined,
    product_id: record.product_id ?? undefined,
    variant_id: record.variant_id ?? undefined,
    interval: record.interval as SubscriptionPlan["interval"],
    interval_count: record.interval_count,
    price: centsToMoney(record.price_amount, record.currency_code),
    trial_period_days: record.trial_period_days ?? 0,
    setup_fee: record.setup_fee_amount
      ? centsToMoney(record.setup_fee_amount, record.currency_code)
      : undefined,
    stripe_product_id: record.stripe_product_id ?? undefined,
    stripe_price_id: record.stripe_price_id ?? undefined,
    status: record.status as SubscriptionPlan["status"],
    features: record.features ? JSON.parse(record.features as string) : undefined,
    metadata: record.metadata ? JSON.parse(record.metadata as string) : undefined,
    created_at: record.created_at,
    updated_at: record.updated_at,
    external_references: record.external_references
      ? JSON.parse(record.external_references as string)
      : undefined,
    extensions: record.extensions ? JSON.parse(record.extensions as string) : undefined,
  };
}

// =====================================================
// Subscription Operations
// =====================================================

export async function createSubscription(data: {
  customer_id: string;
  plan_id: string;
  stripe_subscription_id?: string;
  stripe_customer_id?: string;
  status?: SubscriptionStatus;
  quantity?: number;
  shipping_address?: Address;
  trial_end?: string;
}): Promise<Subscription> {
  const db = await getDbAsync();
  const id = generateId("sub");

  const [subscription] = await db
    .insert(subscriptions)
    .values({
      id,
      customer_id: data.customer_id,
      plan_id: data.plan_id,
      stripe_subscription_id: data.stripe_subscription_id,
      stripe_customer_id: data.stripe_customer_id,
      status: data.status ?? "pending",
      quantity: data.quantity ?? 1,
      shipping_address: data.shipping_address ? JSON.stringify(data.shipping_address) : null,
      trial_end: data.trial_end,
    })
    .returning();

  return hydrateSubscription(subscription);
}

export async function getSubscription(id: string): Promise<Subscription | null> {
  const db = await getDbAsync();

  const [subscription] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.id, id))
    .limit(1);

  return subscription ? hydrateSubscription(subscription) : null;
}

export async function getSubscriptionByStripeId(
  stripeSubscriptionId: string
): Promise<Subscription | null> {
  const db = await getDbAsync();

  const [subscription] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.stripe_subscription_id, stripeSubscriptionId))
    .limit(1);

  return subscription ? hydrateSubscription(subscription) : null;
}

export async function getSubscriptionWithPlan(id: string): Promise<(Subscription & { plan: SubscriptionPlan }) | null> {
  const db = await getDbAsync();

  const results = await db
    .select()
    .from(subscriptions)
    .innerJoin(subscription_plans, eq(subscriptions.plan_id, subscription_plans.id))
    .where(eq(subscriptions.id, id))
    .limit(1);

  if (results.length === 0) return null;

  const { subscriptions: sub, subscription_plans: plan } = results[0];
  return {
    ...hydrateSubscription(sub),
    plan: hydratePlan(plan),
  };
}

export async function listCustomerSubscriptions(
  customerId: string,
  includeInactive: boolean = false
): Promise<Subscription[]> {
  const db = await getDbAsync();

  const activeStatuses: SubscriptionStatus[] = ["pending", "trialing", "active", "paused", "past_due"];

  let query = db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.customer_id, customerId));

  if (!includeInactive) {
    query = db
      .select()
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.customer_id, customerId),
          or(
            eq(subscriptions.status, "pending"),
            eq(subscriptions.status, "trialing"),
            eq(subscriptions.status, "active"),
            eq(subscriptions.status, "paused"),
            eq(subscriptions.status, "past_due")
          )
        )
      );
  }

  const subs = await query.orderBy(desc(subscriptions.created_at));
  return subs.map(hydrateSubscription);
}

export async function listAllSubscriptions(
  status?: SubscriptionStatus,
  limit: number = 50,
  offset: number = 0
): Promise<Subscription[]> {
  const db = await getDbAsync();

  let query = db.select().from(subscriptions);

  if (status) {
    query = query.where(eq(subscriptions.status, status)) as typeof query;
  }

  const subs = await query
    .orderBy(desc(subscriptions.created_at))
    .limit(limit)
    .offset(offset);

  return subs.map(hydrateSubscription);
}

export async function updateSubscription(
  id: string,
  data: Partial<{
    status: SubscriptionStatus;
    plan_id: string;
    quantity: number;
    current_period_start: string;
    current_period_end: string;
    trial_start: string;
    trial_end: string;
    cancel_at_period_end: boolean;
    cancelled_at: string;
    cancel_reason: string;
    ended_at: string;
    shipping_address: Address;
    paused_at: string;
    resume_at: string;
  }>
): Promise<Subscription | null> {
  const db = await getDbAsync();

  const updateData: Record<string, unknown> = {
    updated_at: sql`(datetime('now'))`,
  };

  if (data.status !== undefined) updateData.status = data.status;
  if (data.plan_id !== undefined) updateData.plan_id = data.plan_id;
  if (data.quantity !== undefined) updateData.quantity = data.quantity;
  if (data.current_period_start !== undefined) updateData.current_period_start = data.current_period_start;
  if (data.current_period_end !== undefined) updateData.current_period_end = data.current_period_end;
  if (data.trial_start !== undefined) updateData.trial_start = data.trial_start;
  if (data.trial_end !== undefined) updateData.trial_end = data.trial_end;
  if (data.cancel_at_period_end !== undefined) updateData.cancel_at_period_end = data.cancel_at_period_end;
  if (data.cancelled_at !== undefined) updateData.cancelled_at = data.cancelled_at;
  if (data.cancel_reason !== undefined) updateData.cancel_reason = data.cancel_reason;
  if (data.ended_at !== undefined) updateData.ended_at = data.ended_at;
  if (data.shipping_address !== undefined) {
    updateData.shipping_address = JSON.stringify(data.shipping_address);
  }
  if (data.paused_at !== undefined) updateData.paused_at = data.paused_at;
  if (data.resume_at !== undefined) updateData.resume_at = data.resume_at;

  const [subscription] = await db
    .update(subscriptions)
    .set(updateData)
    .where(eq(subscriptions.id, id))
    .returning();

  return subscription ? hydrateSubscription(subscription) : null;
}

export async function updateSubscriptionStripeId(
  id: string,
  stripeSubscriptionId: string,
  stripeCustomerId?: string
): Promise<void> {
  const db = await getDbAsync();

  const updateData: Record<string, unknown> = {
    stripe_subscription_id: stripeSubscriptionId,
    updated_at: sql`(datetime('now'))`,
  };

  if (stripeCustomerId) {
    updateData.stripe_customer_id = stripeCustomerId;
  }

  await db
    .update(subscriptions)
    .set(updateData)
    .where(eq(subscriptions.id, id));
}

function hydrateSubscription(record: typeof subscriptions.$inferSelect): Subscription {
  return {
    id: record.id,
    customer_id: record.customer_id,
    plan_id: record.plan_id,
    stripe_subscription_id: record.stripe_subscription_id ?? undefined,
    stripe_customer_id: record.stripe_customer_id ?? undefined,
    status: record.status as SubscriptionStatus,
    current_period_start: record.current_period_start ?? undefined,
    current_period_end: record.current_period_end ?? undefined,
    trial_start: record.trial_start ?? undefined,
    trial_end: record.trial_end ?? undefined,
    cancel_at_period_end: record.cancel_at_period_end ?? false,
    cancelled_at: record.cancelled_at ?? undefined,
    cancel_reason: record.cancel_reason ?? undefined,
    ended_at: record.ended_at ?? undefined,
    shipping_address: record.shipping_address
      ? JSON.parse(record.shipping_address as string)
      : undefined,
    quantity: record.quantity,
    paused_at: record.paused_at ?? undefined,
    resume_at: record.resume_at ?? undefined,
    created_at: record.created_at,
    updated_at: record.updated_at,
    external_references: record.external_references
      ? JSON.parse(record.external_references as string)
      : undefined,
    extensions: record.extensions ? JSON.parse(record.extensions as string) : undefined,
  };
}

// =====================================================
// Subscription Invoice Operations
// =====================================================

export async function createSubscriptionInvoice(data: {
  subscription_id: string;
  stripe_invoice_id?: string;
  stripe_payment_intent_id?: string;
  subtotal_amount: number;
  discount_amount?: number;
  tax_amount?: number;
  total_amount: number;
  amount_paid?: number;
  amount_due: number;
  currency_code?: string;
  status: "draft" | "open" | "paid" | "void" | "uncollectible";
  period_start?: string;
  period_end?: string;
  due_date?: string;
  invoice_number?: string;
}): Promise<SubscriptionInvoice> {
  const db = await getDbAsync();
  const id = generateId("inv");

  const [invoice] = await db
    .insert(subscription_invoices)
    .values({
      id,
      subscription_id: data.subscription_id,
      stripe_invoice_id: data.stripe_invoice_id,
      stripe_payment_intent_id: data.stripe_payment_intent_id,
      subtotal_amount: data.subtotal_amount,
      discount_amount: data.discount_amount ?? 0,
      tax_amount: data.tax_amount ?? 0,
      total_amount: data.total_amount,
      amount_paid: data.amount_paid ?? 0,
      amount_due: data.amount_due,
      currency_code: data.currency_code ?? "USD",
      status: data.status,
      period_start: data.period_start,
      period_end: data.period_end,
      due_date: data.due_date,
      invoice_number: data.invoice_number,
    })
    .returning();

  return hydrateInvoice(invoice);
}

export async function getSubscriptionInvoice(id: string): Promise<SubscriptionInvoice | null> {
  const db = await getDbAsync();

  const [invoice] = await db
    .select()
    .from(subscription_invoices)
    .where(eq(subscription_invoices.id, id))
    .limit(1);

  return invoice ? hydrateInvoice(invoice) : null;
}

export async function getInvoiceByStripeId(
  stripeInvoiceId: string
): Promise<SubscriptionInvoice | null> {
  const db = await getDbAsync();

  const [invoice] = await db
    .select()
    .from(subscription_invoices)
    .where(eq(subscription_invoices.stripe_invoice_id, stripeInvoiceId))
    .limit(1);

  return invoice ? hydrateInvoice(invoice) : null;
}

export async function listSubscriptionInvoices(
  subscriptionId: string,
  limit: number = 20
): Promise<SubscriptionInvoice[]> {
  const db = await getDbAsync();

  const invoices = await db
    .select()
    .from(subscription_invoices)
    .where(eq(subscription_invoices.subscription_id, subscriptionId))
    .orderBy(desc(subscription_invoices.created_at))
    .limit(limit);

  return invoices.map(hydrateInvoice);
}

export async function updateInvoice(
  id: string,
  data: Partial<{
    status: "draft" | "open" | "paid" | "void" | "uncollectible";
    amount_paid: number;
    paid_at: string;
    voided_at: string;
    order_id: string;
    invoice_pdf_url: string;
    hosted_invoice_url: string;
  }>
): Promise<SubscriptionInvoice | null> {
  const db = await getDbAsync();

  const updateData: Record<string, unknown> = {
    updated_at: sql`(datetime('now'))`,
  };

  if (data.status !== undefined) updateData.status = data.status;
  if (data.amount_paid !== undefined) updateData.amount_paid = data.amount_paid;
  if (data.paid_at !== undefined) updateData.paid_at = data.paid_at;
  if (data.voided_at !== undefined) updateData.voided_at = data.voided_at;
  if (data.order_id !== undefined) updateData.order_id = data.order_id;
  if (data.invoice_pdf_url !== undefined) updateData.invoice_pdf_url = data.invoice_pdf_url;
  if (data.hosted_invoice_url !== undefined) updateData.hosted_invoice_url = data.hosted_invoice_url;

  const [invoice] = await db
    .update(subscription_invoices)
    .set(updateData)
    .where(eq(subscription_invoices.id, id))
    .returning();

  return invoice ? hydrateInvoice(invoice) : null;
}

function hydrateInvoice(record: typeof subscription_invoices.$inferSelect): SubscriptionInvoice {
  const currency = record.currency_code;
  return {
    id: record.id,
    subscription_id: record.subscription_id,
    stripe_invoice_id: record.stripe_invoice_id ?? undefined,
    stripe_payment_intent_id: record.stripe_payment_intent_id ?? undefined,
    subtotal: centsToMoney(record.subtotal_amount, currency),
    discount: record.discount_amount ? centsToMoney(record.discount_amount, currency) : undefined,
    tax: record.tax_amount ? centsToMoney(record.tax_amount, currency) : undefined,
    total: centsToMoney(record.total_amount, currency),
    amount_paid: centsToMoney(record.amount_paid ?? 0, currency),
    amount_due: centsToMoney(record.amount_due, currency),
    status: record.status as SubscriptionInvoice["status"],
    period_start: record.period_start ?? undefined,
    period_end: record.period_end ?? undefined,
    due_date: record.due_date ?? undefined,
    paid_at: record.paid_at ?? undefined,
    voided_at: record.voided_at ?? undefined,
    order_id: record.order_id ?? undefined,
    invoice_number: record.invoice_number ?? undefined,
    invoice_pdf_url: record.invoice_pdf_url ?? undefined,
    hosted_invoice_url: record.hosted_invoice_url ?? undefined,
    created_at: record.created_at,
    updated_at: record.updated_at,
    external_references: record.external_references
      ? JSON.parse(record.external_references as string)
      : undefined,
    extensions: record.extensions ? JSON.parse(record.extensions as string) : undefined,
  };
}

// =====================================================
// Payment Method Operations
// =====================================================

export async function savePaymentMethod(data: {
  customer_id: string;
  stripe_payment_method_id: string;
  stripe_customer_id?: string;
  type: "card" | "bank_account" | "sepa_debit" | "us_bank_account" | "link";
  card_brand?: string;
  card_last4?: string;
  card_exp_month?: number;
  card_exp_year?: number;
  card_funding?: string;
  bank_name?: string;
  bank_last4?: string;
  is_default?: boolean;
  billing_address?: Address;
}): Promise<CustomerPaymentMethod> {
  const db = await getDbAsync();
  const id = generateId("pm");

  // If setting as default, unset other defaults first
  if (data.is_default) {
    await db
      .update(customer_payment_methods)
      .set({ is_default: false, updated_at: sql`(datetime('now'))` })
      .where(eq(customer_payment_methods.customer_id, data.customer_id));
  }

  const [method] = await db
    .insert(customer_payment_methods)
    .values({
      id,
      customer_id: data.customer_id,
      stripe_payment_method_id: data.stripe_payment_method_id,
      stripe_customer_id: data.stripe_customer_id,
      type: data.type,
      card_brand: data.card_brand,
      card_last4: data.card_last4,
      card_exp_month: data.card_exp_month,
      card_exp_year: data.card_exp_year,
      card_funding: data.card_funding,
      bank_name: data.bank_name,
      bank_last4: data.bank_last4,
      is_default: data.is_default ?? false,
      billing_address: data.billing_address ? JSON.stringify(data.billing_address) : null,
      status: "active",
    })
    .returning();

  return hydratePaymentMethod(method);
}

export async function getPaymentMethod(id: string): Promise<CustomerPaymentMethod | null> {
  const db = await getDbAsync();

  const [method] = await db
    .select()
    .from(customer_payment_methods)
    .where(eq(customer_payment_methods.id, id))
    .limit(1);

  return method ? hydratePaymentMethod(method) : null;
}

export async function getPaymentMethodByStripeId(
  stripePaymentMethodId: string
): Promise<CustomerPaymentMethod | null> {
  const db = await getDbAsync();

  const [method] = await db
    .select()
    .from(customer_payment_methods)
    .where(eq(customer_payment_methods.stripe_payment_method_id, stripePaymentMethodId))
    .limit(1);

  return method ? hydratePaymentMethod(method) : null;
}

export async function listCustomerPaymentMethods(
  customerId: string
): Promise<CustomerPaymentMethod[]> {
  const db = await getDbAsync();

  const methods = await db
    .select()
    .from(customer_payment_methods)
    .where(
      and(
        eq(customer_payment_methods.customer_id, customerId),
        eq(customer_payment_methods.status, "active")
      )
    )
    .orderBy(desc(customer_payment_methods.is_default), desc(customer_payment_methods.created_at));

  return methods.map(hydratePaymentMethod);
}

export async function setDefaultPaymentMethod(
  customerId: string,
  paymentMethodId: string
): Promise<void> {
  const db = await getDbAsync();

  // Unset all defaults
  await db
    .update(customer_payment_methods)
    .set({ is_default: false, updated_at: sql`(datetime('now'))` })
    .where(eq(customer_payment_methods.customer_id, customerId));

  // Set new default
  await db
    .update(customer_payment_methods)
    .set({ is_default: true, updated_at: sql`(datetime('now'))` })
    .where(eq(customer_payment_methods.id, paymentMethodId));
}

export async function removePaymentMethod(id: string): Promise<void> {
  const db = await getDbAsync();

  await db
    .update(customer_payment_methods)
    .set({ status: "removed", updated_at: sql`(datetime('now'))` })
    .where(eq(customer_payment_methods.id, id));
}

function hydratePaymentMethod(
  record: typeof customer_payment_methods.$inferSelect
): CustomerPaymentMethod {
  return {
    id: record.id,
    customer_id: record.customer_id,
    stripe_payment_method_id: record.stripe_payment_method_id,
    stripe_customer_id: record.stripe_customer_id ?? undefined,
    type: record.type as CustomerPaymentMethod["type"],
    card_brand: record.card_brand ?? undefined,
    card_last4: record.card_last4 ?? undefined,
    card_exp_month: record.card_exp_month ?? undefined,
    card_exp_year: record.card_exp_year ?? undefined,
    card_funding: record.card_funding as CustomerPaymentMethod["card_funding"],
    bank_name: record.bank_name ?? undefined,
    bank_last4: record.bank_last4 ?? undefined,
    is_default: record.is_default ?? false,
    status: record.status as CustomerPaymentMethod["status"],
    billing_address: record.billing_address
      ? JSON.parse(record.billing_address as string)
      : undefined,
    created_at: record.created_at,
    updated_at: record.updated_at,
    extensions: record.extensions ? JSON.parse(record.extensions as string) : undefined,
  };
}

// =====================================================
// Subscription Event Operations
// =====================================================

export async function logSubscriptionEvent(data: {
  subscription_id: string;
  event_type: SubscriptionEventType;
  data?: Record<string, unknown>;
  previous_status?: SubscriptionStatus;
  new_status?: SubscriptionStatus;
  stripe_event_id?: string;
}): Promise<SubscriptionEvent> {
  const db = await getDbAsync();
  const id = generateId("evt");

  const [event] = await db
    .insert(subscription_events)
    .values({
      id,
      subscription_id: data.subscription_id,
      event_type: data.event_type,
      data: data.data ? JSON.stringify(data.data) : null,
      previous_status: data.previous_status,
      new_status: data.new_status,
      stripe_event_id: data.stripe_event_id,
    })
    .returning();

  return hydrateEvent(event);
}

export async function listSubscriptionEvents(
  subscriptionId: string,
  limit: number = 50
): Promise<SubscriptionEvent[]> {
  const db = await getDbAsync();

  const events = await db
    .select()
    .from(subscription_events)
    .where(eq(subscription_events.subscription_id, subscriptionId))
    .orderBy(desc(subscription_events.created_at))
    .limit(limit);

  return events.map(hydrateEvent);
}

function hydrateEvent(record: typeof subscription_events.$inferSelect): SubscriptionEvent {
  return {
    id: record.id,
    subscription_id: record.subscription_id,
    event_type: record.event_type as SubscriptionEventType,
    data: record.data ? JSON.parse(record.data as string) : undefined,
    previous_status: record.previous_status as SubscriptionStatus | undefined,
    new_status: record.new_status as SubscriptionStatus | undefined,
    stripe_event_id: record.stripe_event_id ?? undefined,
    created_at: record.created_at,
  };
}

// =====================================================
// Utility Operations
// =====================================================

export async function getActiveSubscriptionCount(): Promise<number> {
  const db = await getDbAsync();

  const result = await db
    .select({ count: sql<number>`count(*)` })
    .from(subscriptions)
    .where(
      or(
        eq(subscriptions.status, "active"),
        eq(subscriptions.status, "trialing")
      )
    );

  return result[0]?.count ?? 0;
}

export async function getMonthlyRecurringRevenue(): Promise<number> {
  const db = await getDbAsync();

  // Get all active subscriptions with their plans
  const results = await db
    .select({
      price_amount: subscription_plans.price_amount,
      interval: subscription_plans.interval,
      interval_count: subscription_plans.interval_count,
      quantity: subscriptions.quantity,
    })
    .from(subscriptions)
    .innerJoin(subscription_plans, eq(subscriptions.plan_id, subscription_plans.id))
    .where(
      or(
        eq(subscriptions.status, "active"),
        eq(subscriptions.status, "trialing")
      )
    );

  // Calculate MRR (normalize all to monthly)
  let mrr = 0;
  for (const sub of results) {
    const amount = sub.price_amount * sub.quantity;
    const intervalCount = sub.interval_count;

    switch (sub.interval) {
      case "day":
        mrr += (amount / intervalCount) * 30;
        break;
      case "week":
        mrr += (amount / intervalCount) * 4.33;
        break;
      case "month":
        mrr += amount / intervalCount;
        break;
      case "year":
        mrr += amount / intervalCount / 12;
        break;
    }
  }

  return Math.round(mrr);
}
