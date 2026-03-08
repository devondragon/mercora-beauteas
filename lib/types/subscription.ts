export type SubscriptionFrequency = 'biweekly' | 'monthly' | 'bimonthly';
export type SubscriptionStatus = 'active' | 'paused' | 'canceled' | 'past_due' | 'incomplete' | 'incomplete_expired' | 'trialing' | 'unpaid';
export type SubscriptionEventType = 'created' | 'renewed' | 'payment_failed' | 'paused' | 'resumed' | 'skipped' | 'canceled' | 'updated';

export interface SubscriptionPlan {
  id: string;
  product_id: string;
  frequency: SubscriptionFrequency;
  discount_percent: number;
  stripe_price_id: string | null;
  is_active: boolean;
  created_at: string | null;
  updated_at: string | null;
}

export interface CustomerSubscription {
  id: string;
  customer_id: string;
  plan_id: string;
  stripe_subscription_id: string;
  stripe_customer_id: string;
  status: SubscriptionStatus;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean | null;
  pause_collection: string | null;
  created_at: string | null;
  updated_at: string | null;
  canceled_at: string | null;
}

export interface SubscriptionEvent {
  id: string;
  subscription_id: string;
  event_type: SubscriptionEventType;
  stripe_event_id: string | null;
  details: string | null;
  created_at: string;
}

// Email data types used by webhook handlers to send lifecycle emails
export interface SubscriptionEmailData {
  customerEmail: string;
  customerName: string;
  productName: string;
  frequency: SubscriptionFrequency;
  subscriptionId: string;
  nextBillingDate?: string;
  amount?: number;
  failureReason?: string;
  nextRetryDate?: string;
  manageUrl: string;
}
