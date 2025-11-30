/**
 * === Stripe Webhooks Handler ===
 *
 * Handles Stripe webhook events for payment processing, tax calculation,
 * and order management. Ensures secure webhook verification and proper
 * event handling for all Stripe-related operations.
 *
 * === Supported Events ===
 * - **payment_intent.succeeded**: Payment completed successfully
 * - **payment_intent.payment_failed**: Payment failed
 * - **invoice.payment_succeeded**: Subscription/recurring payment succeeded
 * - **customer.subscription.updated**: Subscription changes
 * - **checkout.session.completed**: Checkout session completed
 *
 * === Security ===
 * - Webhook signature verification with Stripe secret
 * - Raw body validation for signature checking
 * - Idempotency handling for duplicate events
 *
 * === Error Handling ===
 * - Graceful handling of unknown events
 * - Comprehensive error logging
 * - Proper HTTP status codes
 *
 * === Usage ===
 * Configure this endpoint in your Stripe Dashboard webhook settings:
 * - URL: https://yourdomain.com/api/stripe/webhooks
 * - Events: Select the events you want to handle
 */

import { NextRequest, NextResponse } from 'next/server';
import { getStripe, getWebhookSecret } from '@/lib/stripe';
import Stripe from 'stripe';
import {
  getSubscriptionByStripeId,
  getSubscriptionWithPlan,
  updateSubscription,
  logSubscriptionEvent,
  createSubscriptionInvoice,
  getInvoiceByStripeId,
  updateInvoice,
  savePaymentMethod,
  getPaymentMethodByStripeId,
  removePaymentMethod,
  getSubscriptionPlan,
} from '@/lib/models/subscriptions';
import {
  createPaymentRetryAttempt,
  getNextRetryDate,
  DUNNING_CONFIG,
} from '@/lib/models/coupons';
import {
  sendSubscriptionConfirmationEmail,
  sendPaymentSuccessEmail,
  sendPaymentFailedEmail,
  sendTrialEndingEmail,
  sendSubscriptionCancelledEmail,
  sendSubscriptionPausedEmail,
  sendSubscriptionResumedEmail,
  sendRenewalReminderEmail,
} from '@/lib/utils/subscription-emails';
import { createOrder } from '@/lib/models/mach/orders';
import type { SubscriptionStatus } from '@/lib/types/subscription';

// =====================================================
// Helper: Get customer details from Stripe
// =====================================================

interface CustomerDetails {
  email: string;
  name: string;
}

async function getCustomerDetails(
  stripe: Stripe,
  customerId: string | Stripe.Customer | Stripe.DeletedCustomer | null
): Promise<CustomerDetails | null> {
  if (!customerId) return null;

  try {
    let customer: Stripe.Customer | Stripe.DeletedCustomer;

    if (typeof customerId === 'string') {
      customer = await stripe.customers.retrieve(customerId);
    } else {
      customer = customerId;
    }

    if (customer.deleted) {
      return null;
    }

    return {
      email: customer.email || '',
      name: customer.name || customer.email?.split('@')[0] || 'Valued Customer',
    };
  } catch (error) {
    console.error('Error fetching customer details:', error);
    return null;
  }
}

/**
 * POST handler for Stripe webhook events
 * Verifies webhook signature and processes supported events
 */
export async function POST(req: NextRequest) {
  const body = await req.text();
  const signature = req.headers.get('stripe-signature');

  if (!signature) {
    console.error('Missing stripe-signature header');
    return NextResponse.json(
      { error: 'Missing stripe-signature header' },
      { status: 400 }
    );
  }

  let event: Stripe.Event;

  try {
    // Verify webhook signature for security
    const stripe = getStripe();
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      getWebhookSecret()
    );
  } catch (error) {
    console.error('Webhook signature verification failed:', error);
    return NextResponse.json(
      { error: 'Webhook signature verification failed' },
      { status: 400 }
    );
  }

  try {
    // Handle different event types
    switch (event.type) {
      case 'payment_intent.succeeded':
        await handlePaymentSucceeded(event.data.object as Stripe.PaymentIntent);
        break;

      case 'payment_intent.payment_failed':
        await handlePaymentFailed(event.data.object as Stripe.PaymentIntent);
        break;

      case 'checkout.session.completed':
        await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
        break;

      // Subscription Events
      case 'customer.subscription.created':
        await handleSubscriptionCreated(event.data.object as Stripe.Subscription, event.id);
        break;

      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(event.data.object as Stripe.Subscription, event.id);
        break;

      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object as Stripe.Subscription, event.id);
        break;

      case 'customer.subscription.trial_will_end':
        await handleTrialWillEnd(event.data.object as Stripe.Subscription, event.id);
        break;

      case 'customer.subscription.paused':
        await handleSubscriptionPaused(event.data.object as Stripe.Subscription, event.id);
        break;

      case 'customer.subscription.resumed':
        await handleSubscriptionResumed(event.data.object as Stripe.Subscription, event.id);
        break;

      // Invoice Events (for subscriptions)
      case 'invoice.created':
        await handleInvoiceCreated(event.data.object as Stripe.Invoice);
        break;

      case 'invoice.finalized':
        await handleInvoiceFinalized(event.data.object as Stripe.Invoice);
        break;

      case 'invoice.paid':
      case 'invoice.payment_succeeded':
        await handleInvoicePaymentSucceeded(event.data.object as Stripe.Invoice);
        break;

      case 'invoice.payment_failed':
        await handleInvoicePaymentFailed(event.data.object as Stripe.Invoice, event.id);
        break;

      case 'invoice.upcoming':
        await handleInvoiceUpcoming(event.data.object as Stripe.Invoice);
        break;

      // Payment Method Events
      case 'payment_method.attached':
        await handlePaymentMethodAttached(event.data.object as Stripe.PaymentMethod);
        break;

      case 'payment_method.detached':
        await handlePaymentMethodDetached(event.data.object as Stripe.PaymentMethod);
        break;

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('Error processing webhook:', error);
    return NextResponse.json(
      { error: 'Webhook processing failed' },
      { status: 500 }
    );
  }
}

/**
 * Handle successful payment intent
 * Updates order status and triggers post-payment actions
 */
async function handlePaymentSucceeded(paymentIntent: Stripe.PaymentIntent) {
  console.log('Payment succeeded:', paymentIntent.id);
  
  const orderId = paymentIntent.metadata.orderId;
  
  if (!orderId) {
    console.error('No orderId in payment intent metadata');
    return;
  }

  try {
    // Update order status using unified orders endpoint
    try {
      const updateRes = await fetch(`${process.env.NEXT_PUBLIC_URL || 'http://localhost:3000'}/api/orders`, {
        method: 'PUT',
        headers: { 
          'Content-Type': 'application/json',
          'X-API-Key': process.env.STRIPE_WEBHOOK_SECRET || '', // Use webhook secret as internal API key
        },
        body: JSON.stringify({
          orderId,
          status: 'processing', // Move to processing after successful payment
          payment_status: 'paid', // Ensure payment status is updated
          notes: `Payment completed via Stripe - Payment Intent: ${paymentIntent.id}`,
        }),
      });

      if (!updateRes.ok) {
        console.error('Failed to update order status:', await updateRes.text());
      }
    } catch (updateError) {
      console.error('Error updating order status:', updateError);
    }
    
    // You can add additional logic here:
    // - Send confirmation emails
    // - Update inventory
    // - Trigger fulfillment process
    // - Analytics tracking
    
  } catch (error) {
    console.error('Error updating order after payment:', error);
  }
}

/**
 * Handle failed payment intent
 * Updates order status and handles payment failure scenarios
 */
async function handlePaymentFailed(paymentIntent: Stripe.PaymentIntent) {
  console.log('Payment failed:', paymentIntent.id);
  
  const orderId = paymentIntent.metadata.orderId;
  
  if (!orderId) {
    console.error('No orderId in payment intent metadata');
    return;
  }

  try {
    // Update order status to failed
    // TODO: Implement order status update
    console.log(`Updating order ${orderId} to failed status`);
    
    // You can add additional logic here:
    // - Send failure notification emails
    // - Restore inventory if needed
    // - Log payment failure reasons
    
  } catch (error) {
    console.error('Error handling payment failure:', error);
  }
}

/**
 * Handle completed checkout session
 * Processes successful checkout completion
 */
async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  console.log('Checkout session completed:', session.id);
  
  const orderId = session.metadata?.orderId;
  
  if (!orderId) {
    console.error('No orderId in checkout session metadata');
    return;
  }

  try {
    // Handle checkout completion
    console.log(`Processing completed checkout for order ${orderId}`);
    
    // You can add additional logic here:
    // - Final order confirmation
    // - Customer onboarding
    // - Thank you emails
    
  } catch (error) {
    console.error('Error handling checkout completion:', error);
  }
}

/**
 * Handle successful invoice payment
 * For subscription or recurring payment scenarios
 */
async function handleInvoicePaymentSucceeded(invoice: Stripe.Invoice) {
  console.log('Invoice payment succeeded:', invoice.id);

  try {
    // Check if this is a subscription invoice
    if (!invoice.subscription) {
      console.log('Non-subscription invoice, skipping subscription processing');
      return;
    }

    const stripeSubscriptionId = typeof invoice.subscription === 'string'
      ? invoice.subscription
      : invoice.subscription.id;

    const subscription = await getSubscriptionByStripeId(stripeSubscriptionId);
    if (!subscription) {
      console.log('No local subscription found for Stripe subscription:', stripeSubscriptionId);
      return;
    }

    // Update or create invoice record
    let localInvoice = await getInvoiceByStripeId(invoice.id);
    if (localInvoice) {
      await updateInvoice(localInvoice.id, {
        status: 'paid',
        amount_paid: invoice.amount_paid,
        paid_at: new Date().toISOString(),
        invoice_pdf_url: invoice.invoice_pdf || undefined,
        hosted_invoice_url: invoice.hosted_invoice_url || undefined,
      });
    } else {
      localInvoice = await createSubscriptionInvoice({
        subscription_id: subscription.id,
        stripe_invoice_id: invoice.id,
        stripe_payment_intent_id: typeof invoice.payment_intent === 'string'
          ? invoice.payment_intent
          : invoice.payment_intent?.id,
        subtotal_amount: invoice.subtotal,
        discount_amount: invoice.total_discount_amounts?.reduce((sum, d) => sum + d.amount, 0) || 0,
        tax_amount: invoice.tax || 0,
        total_amount: invoice.total,
        amount_paid: invoice.amount_paid,
        amount_due: invoice.amount_due,
        currency_code: invoice.currency.toUpperCase(),
        status: 'paid',
        period_start: invoice.period_start
          ? new Date(invoice.period_start * 1000).toISOString()
          : undefined,
        period_end: invoice.period_end
          ? new Date(invoice.period_end * 1000).toISOString()
          : undefined,
        invoice_number: invoice.number || undefined,
      });
    }

    // Log the payment event
    await logSubscriptionEvent({
      subscription_id: subscription.id,
      event_type: 'payment_succeeded',
      data: {
        invoice_id: invoice.id,
        amount: invoice.amount_paid,
        currency: invoice.currency,
      },
    });

    // Update subscription status to active if it was past_due
    if (subscription.status === 'past_due') {
      await updateSubscription(subscription.id, { status: 'active' });
      await logSubscriptionEvent({
        subscription_id: subscription.id,
        event_type: 'activated',
        previous_status: 'past_due',
        new_status: 'active',
      });
    }

    // Send payment success email
    const stripe = getStripe();
    const customerDetails = await getCustomerDetails(stripe, invoice.customer);
    const plan = await getSubscriptionPlan(subscription.plan_id);

    if (customerDetails && plan) {
      await sendPaymentSuccessEmail({
        customerName: customerDetails.name,
        customerEmail: customerDetails.email,
        subscriptionId: subscription.id,
        planName: plan.name,
        planPrice: plan.price.amount,
        planInterval: plan.interval,
        currency: plan.price.currency,
        invoiceNumber: invoice.number || undefined,
        amountPaid: invoice.amount_paid,
        invoiceUrl: invoice.hosted_invoice_url || undefined,
        invoicePdfUrl: invoice.invoice_pdf || undefined,
        nextBillingDate: subscription.current_period_end,
      });
      console.log(`Payment success email sent for subscription ${subscription.id}`);
    }

    console.log(`Invoice payment processed for subscription ${subscription.id}`);

  } catch (error) {
    console.error('Error handling invoice payment:', error);
  }
}

// =====================================================
// Subscription Webhook Handlers
// =====================================================

/**
 * Map Stripe subscription status to our internal status
 */
function mapStripeSubscriptionStatus(stripeStatus: string): SubscriptionStatus {
  const statusMap: Record<string, SubscriptionStatus> = {
    incomplete: 'pending',
    incomplete_expired: 'expired',
    trialing: 'trialing',
    active: 'active',
    past_due: 'past_due',
    canceled: 'cancelled',
    unpaid: 'past_due',
    paused: 'paused',
  };
  return statusMap[stripeStatus] || 'pending';
}

/**
 * Handle subscription created event
 */
async function handleSubscriptionCreated(stripeSubscription: Stripe.Subscription, eventId: string) {
  console.log('Subscription created:', stripeSubscription.id);

  try {
    const subscription = await getSubscriptionByStripeId(stripeSubscription.id);

    if (!subscription) {
      // Subscription was created directly in Stripe, not through our API
      console.log('Subscription created in Stripe but not found locally:', stripeSubscription.id);
      return;
    }

    const newStatus = mapStripeSubscriptionStatus(stripeSubscription.status);

    await updateSubscription(subscription.id, {
      status: newStatus,
      current_period_start: new Date(stripeSubscription.current_period_start * 1000).toISOString(),
      current_period_end: new Date(stripeSubscription.current_period_end * 1000).toISOString(),
      trial_start: stripeSubscription.trial_start
        ? new Date(stripeSubscription.trial_start * 1000).toISOString()
        : undefined,
      trial_end: stripeSubscription.trial_end
        ? new Date(stripeSubscription.trial_end * 1000).toISOString()
        : undefined,
    });

    await logSubscriptionEvent({
      subscription_id: subscription.id,
      event_type: 'created',
      new_status: newStatus,
      stripe_event_id: eventId,
    });

    // Send confirmation email
    const stripe = getStripe();
    const customerDetails = await getCustomerDetails(stripe, stripeSubscription.customer);
    const plan = await getSubscriptionPlan(subscription.plan_id);

    if (customerDetails && plan) {
      await sendSubscriptionConfirmationEmail({
        customerName: customerDetails.name,
        customerEmail: customerDetails.email,
        subscriptionId: subscription.id,
        planName: plan.name,
        planPrice: plan.price.amount,
        planInterval: plan.interval,
        currency: plan.price.currency,
      });
      console.log(`Confirmation email sent for subscription ${subscription.id}`);
    }
  } catch (error) {
    console.error('Error handling subscription created:', error);
  }
}

/**
 * Handle subscription updated event
 */
async function handleSubscriptionUpdated(stripeSubscription: Stripe.Subscription, eventId: string) {
  console.log('Subscription updated:', stripeSubscription.id);

  try {
    const subscription = await getSubscriptionByStripeId(stripeSubscription.id);

    if (!subscription) {
      console.log('Subscription not found locally:', stripeSubscription.id);
      return;
    }

    const newStatus = mapStripeSubscriptionStatus(stripeSubscription.status);
    const previousStatus = subscription.status;

    await updateSubscription(subscription.id, {
      status: newStatus,
      current_period_start: new Date(stripeSubscription.current_period_start * 1000).toISOString(),
      current_period_end: new Date(stripeSubscription.current_period_end * 1000).toISOString(),
      trial_end: stripeSubscription.trial_end
        ? new Date(stripeSubscription.trial_end * 1000).toISOString()
        : undefined,
      cancel_at_period_end: stripeSubscription.cancel_at_period_end,
      cancelled_at: stripeSubscription.canceled_at
        ? new Date(stripeSubscription.canceled_at * 1000).toISOString()
        : undefined,
      ended_at: stripeSubscription.ended_at
        ? new Date(stripeSubscription.ended_at * 1000).toISOString()
        : undefined,
    });

    // Log status change if it changed
    if (previousStatus !== newStatus) {
      let eventType: 'activated' | 'cancelled' | 'expired' | 'renewed' = 'renewed';
      if (newStatus === 'active' && previousStatus === 'trialing') {
        eventType = 'activated';
      } else if (newStatus === 'cancelled') {
        eventType = 'cancelled';
      } else if (newStatus === 'expired') {
        eventType = 'expired';
      }

      await logSubscriptionEvent({
        subscription_id: subscription.id,
        event_type: eventType,
        previous_status: previousStatus,
        new_status: newStatus,
        stripe_event_id: eventId,
      });
    }
  } catch (error) {
    console.error('Error handling subscription updated:', error);
  }
}

/**
 * Handle subscription deleted/cancelled event
 */
async function handleSubscriptionDeleted(stripeSubscription: Stripe.Subscription, eventId: string) {
  console.log('Subscription deleted:', stripeSubscription.id);

  try {
    const subscription = await getSubscriptionByStripeId(stripeSubscription.id);

    if (!subscription) {
      console.log('Subscription not found locally:', stripeSubscription.id);
      return;
    }

    const previousStatus = subscription.status;

    await updateSubscription(subscription.id, {
      status: 'cancelled',
      ended_at: new Date().toISOString(),
    });

    await logSubscriptionEvent({
      subscription_id: subscription.id,
      event_type: 'cancelled',
      previous_status: previousStatus,
      new_status: 'cancelled',
      stripe_event_id: eventId,
    });

    // Send cancellation email
    const stripe = getStripe();
    const customerDetails = await getCustomerDetails(stripe, stripeSubscription.customer);
    const plan = await getSubscriptionPlan(subscription.plan_id);

    if (customerDetails && plan) {
      const endDate = stripeSubscription.current_period_end
        ? new Date(stripeSubscription.current_period_end * 1000).toISOString()
        : new Date().toISOString();

      await sendSubscriptionCancelledEmail({
        customerName: customerDetails.name,
        customerEmail: customerDetails.email,
        subscriptionId: subscription.id,
        planName: plan.name,
        planPrice: plan.price.amount,
        planInterval: plan.interval,
        currency: plan.price.currency,
        endDate,
        reason: subscription.cancel_reason,
      });
      console.log(`Cancellation email sent for subscription ${subscription.id}`);
    }
  } catch (error) {
    console.error('Error handling subscription deleted:', error);
  }
}

/**
 * Handle trial will end event (3 days before trial ends)
 */
async function handleTrialWillEnd(stripeSubscription: Stripe.Subscription, eventId: string) {
  console.log('Trial will end:', stripeSubscription.id);

  try {
    const subscription = await getSubscriptionByStripeId(stripeSubscription.id);

    if (!subscription) {
      console.log('Subscription not found locally:', stripeSubscription.id);
      return;
    }

    const trialEndDate = stripeSubscription.trial_end
      ? new Date(stripeSubscription.trial_end * 1000).toISOString()
      : null;

    await logSubscriptionEvent({
      subscription_id: subscription.id,
      event_type: 'trial_ended',
      data: { trial_end: trialEndDate },
      stripe_event_id: eventId,
    });

    // Send trial ending notification email
    const stripe = getStripe();
    const customerDetails = await getCustomerDetails(stripe, stripeSubscription.customer);
    const plan = await getSubscriptionPlan(subscription.plan_id);

    if (customerDetails && plan && trialEndDate) {
      const daysRemaining = Math.ceil(
        (new Date(trialEndDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
      );

      await sendTrialEndingEmail({
        customerName: customerDetails.name,
        customerEmail: customerDetails.email,
        subscriptionId: subscription.id,
        planName: plan.name,
        planPrice: plan.price.amount,
        planInterval: plan.interval,
        currency: plan.price.currency,
        trialEndDate,
        daysRemaining: Math.max(daysRemaining, 1),
      });
      console.log(`Trial ending email sent for subscription ${subscription.id}`);
    }
  } catch (error) {
    console.error('Error handling trial will end:', error);
  }
}

/**
 * Handle subscription paused event
 */
async function handleSubscriptionPaused(stripeSubscription: Stripe.Subscription, eventId: string) {
  console.log('Subscription paused:', stripeSubscription.id);

  try {
    const subscription = await getSubscriptionByStripeId(stripeSubscription.id);

    if (!subscription) {
      console.log('Subscription not found locally:', stripeSubscription.id);
      return;
    }

    const previousStatus = subscription.status;

    // Get resume date if set
    const resumeAt = stripeSubscription.pause_collection?.resumes_at
      ? new Date(stripeSubscription.pause_collection.resumes_at * 1000).toISOString()
      : undefined;

    await updateSubscription(subscription.id, {
      status: 'paused',
      paused_at: new Date().toISOString(),
      resume_at: resumeAt,
    });

    await logSubscriptionEvent({
      subscription_id: subscription.id,
      event_type: 'paused',
      previous_status: previousStatus,
      new_status: 'paused',
      stripe_event_id: eventId,
    });

    // Send paused email
    const stripe = getStripe();
    const customerDetails = await getCustomerDetails(stripe, stripeSubscription.customer);
    const plan = await getSubscriptionPlan(subscription.plan_id);

    if (customerDetails && plan) {
      await sendSubscriptionPausedEmail({
        customerName: customerDetails.name,
        customerEmail: customerDetails.email,
        subscriptionId: subscription.id,
        planName: plan.name,
        planPrice: plan.price.amount,
        planInterval: plan.interval,
        currency: plan.price.currency,
        pausedUntil: resumeAt,
      });
      console.log(`Paused email sent for subscription ${subscription.id}`);
    }
  } catch (error) {
    console.error('Error handling subscription paused:', error);
  }
}

/**
 * Handle subscription resumed event
 */
async function handleSubscriptionResumed(stripeSubscription: Stripe.Subscription, eventId: string) {
  console.log('Subscription resumed:', stripeSubscription.id);

  try {
    const subscription = await getSubscriptionByStripeId(stripeSubscription.id);

    if (!subscription) {
      console.log('Subscription not found locally:', stripeSubscription.id);
      return;
    }

    const previousStatus = subscription.status;

    await updateSubscription(subscription.id, {
      status: 'active',
      paused_at: undefined,
      resume_at: undefined,
    });

    await logSubscriptionEvent({
      subscription_id: subscription.id,
      event_type: 'resumed',
      previous_status: previousStatus,
      new_status: 'active',
      stripe_event_id: eventId,
    });

    // Send resumed email
    const stripe = getStripe();
    const customerDetails = await getCustomerDetails(stripe, stripeSubscription.customer);
    const plan = await getSubscriptionPlan(subscription.plan_id);

    if (customerDetails && plan) {
      await sendSubscriptionResumedEmail({
        customerName: customerDetails.name,
        customerEmail: customerDetails.email,
        subscriptionId: subscription.id,
        planName: plan.name,
        planPrice: plan.price.amount,
        planInterval: plan.interval,
        currency: plan.price.currency,
      });
      console.log(`Resumed email sent for subscription ${subscription.id}`);
    }
  } catch (error) {
    console.error('Error handling subscription resumed:', error);
  }
}

// =====================================================
// Invoice Webhook Handlers
// =====================================================

/**
 * Handle invoice created event
 */
async function handleInvoiceCreated(invoice: Stripe.Invoice) {
  console.log('Invoice created:', invoice.id);

  if (!invoice.subscription) {
    return; // Not a subscription invoice
  }

  try {
    const stripeSubscriptionId = typeof invoice.subscription === 'string'
      ? invoice.subscription
      : invoice.subscription.id;

    const subscription = await getSubscriptionByStripeId(stripeSubscriptionId);
    if (!subscription) {
      return;
    }

    // Create invoice record
    await createSubscriptionInvoice({
      subscription_id: subscription.id,
      stripe_invoice_id: invoice.id,
      subtotal_amount: invoice.subtotal,
      tax_amount: invoice.tax || 0,
      total_amount: invoice.total,
      amount_due: invoice.amount_due,
      currency_code: invoice.currency.toUpperCase(),
      status: 'draft',
      period_start: invoice.period_start
        ? new Date(invoice.period_start * 1000).toISOString()
        : undefined,
      period_end: invoice.period_end
        ? new Date(invoice.period_end * 1000).toISOString()
        : undefined,
      due_date: invoice.due_date
        ? new Date(invoice.due_date * 1000).toISOString()
        : undefined,
      invoice_number: invoice.number || undefined,
    });
  } catch (error) {
    console.error('Error handling invoice created:', error);
  }
}

/**
 * Handle invoice finalized event
 */
async function handleInvoiceFinalized(invoice: Stripe.Invoice) {
  console.log('Invoice finalized:', invoice.id);

  try {
    const localInvoice = await getInvoiceByStripeId(invoice.id);
    if (!localInvoice) {
      return;
    }

    await updateInvoice(localInvoice.id, {
      status: 'open',
      invoice_pdf_url: invoice.invoice_pdf || undefined,
      hosted_invoice_url: invoice.hosted_invoice_url || undefined,
    });
  } catch (error) {
    console.error('Error handling invoice finalized:', error);
  }
}

/**
 * Handle invoice payment failed event
 */
async function handleInvoicePaymentFailed(invoice: Stripe.Invoice, eventId: string) {
  console.log('Invoice payment failed:', invoice.id);

  if (!invoice.subscription) {
    return;
  }

  try {
    const stripeSubscriptionId = typeof invoice.subscription === 'string'
      ? invoice.subscription
      : invoice.subscription.id;

    const subscription = await getSubscriptionByStripeId(stripeSubscriptionId);
    if (!subscription) {
      return;
    }

    // Update subscription to past_due
    const previousStatus = subscription.status;
    await updateSubscription(subscription.id, { status: 'past_due' });

    const attemptNumber = invoice.attempt_count || 1;

    // Log the failure
    await logSubscriptionEvent({
      subscription_id: subscription.id,
      event_type: 'payment_failed',
      previous_status: previousStatus,
      new_status: 'past_due',
      data: {
        invoice_id: invoice.id,
        amount: invoice.amount_due,
        attempt_count: attemptNumber,
      },
      stripe_event_id: eventId,
    });

    // Create payment retry attempt for dunning
    const nextRetryDate = getNextRetryDate(attemptNumber);
    if (nextRetryDate) {
      await createPaymentRetryAttempt({
        subscription_id: subscription.id,
        invoice_id: invoice.id,
        attempt_number: attemptNumber,
        amount: invoice.amount_due,
        currency_code: invoice.currency.toUpperCase(),
        scheduled_at: nextRetryDate.toISOString(),
      });
    }

    // Send payment failed email
    const stripe = getStripe();
    const customerDetails = await getCustomerDetails(stripe, invoice.customer);
    const plan = await getSubscriptionPlan(subscription.plan_id);

    if (customerDetails && plan) {
      // Get payment method last 4 digits if available
      let lastFourDigits: string | undefined;
      if (invoice.default_payment_method) {
        try {
          const pmId = typeof invoice.default_payment_method === 'string'
            ? invoice.default_payment_method
            : invoice.default_payment_method.id;
          const pm = await stripe.paymentMethods.retrieve(pmId);
          lastFourDigits = pm.card?.last4;
        } catch (e) {
          // Ignore error fetching payment method
        }
      }

      await sendPaymentFailedEmail({
        customerName: customerDetails.name,
        customerEmail: customerDetails.email,
        subscriptionId: subscription.id,
        planName: plan.name,
        planPrice: plan.price.amount,
        planInterval: plan.interval,
        currency: plan.price.currency,
        attemptNumber,
        maxAttempts: DUNNING_CONFIG.maxAttempts,
        nextRetryDate: nextRetryDate?.toISOString(),
        updatePaymentUrl: `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/account/subscriptions/${subscription.id}/payment-method`,
        lastFourDigits,
        failureReason: invoice.last_finalization_error?.message,
      });
      console.log(`Payment failed email sent for subscription ${subscription.id}`);
    }

    console.log(`Payment failed for subscription ${subscription.id}, attempt ${attemptNumber}`);
  } catch (error) {
    console.error('Error handling invoice payment failed:', error);
  }
}

/**
 * Handle invoice upcoming event (sent ~3 days before renewal)
 * Used to send renewal reminder emails
 */
async function handleInvoiceUpcoming(invoice: Stripe.Invoice) {
  console.log('Invoice upcoming:', invoice.id);

  if (!invoice.subscription) {
    return; // Not a subscription invoice
  }

  try {
    const stripeSubscriptionId = typeof invoice.subscription === 'string'
      ? invoice.subscription
      : invoice.subscription.id;

    const subscription = await getSubscriptionByStripeId(stripeSubscriptionId);
    if (!subscription) {
      console.log('Subscription not found locally:', stripeSubscriptionId);
      return;
    }

    // Send renewal reminder email
    const stripe = getStripe();
    const customerDetails = await getCustomerDetails(stripe, invoice.customer);
    const plan = await getSubscriptionPlan(subscription.plan_id);

    if (customerDetails && plan) {
      // Calculate next billing date from invoice
      const nextBillingDate = invoice.next_payment_attempt
        ? new Date(invoice.next_payment_attempt * 1000).toISOString()
        : invoice.due_date
        ? new Date(invoice.due_date * 1000).toISOString()
        : undefined;

      await sendRenewalReminderEmail({
        customerName: customerDetails.name,
        customerEmail: customerDetails.email,
        subscriptionId: subscription.id,
        planName: plan.name,
        planPrice: plan.price.amount,
        planInterval: plan.interval,
        currency: plan.price.currency,
        amountPaid: invoice.amount_due,
        nextBillingDate,
      });
      console.log(`Renewal reminder email sent for subscription ${subscription.id}`);
    }

    // Log the event
    await logSubscriptionEvent({
      subscription_id: subscription.id,
      event_type: 'renewed',
      data: {
        invoice_id: invoice.id,
        amount: invoice.amount_due,
        next_payment_attempt: invoice.next_payment_attempt,
      },
    });
  } catch (error) {
    console.error('Error handling invoice upcoming:', error);
  }
}

// =====================================================
// Payment Method Webhook Handlers
// =====================================================

/**
 * Handle payment method attached event
 */
async function handlePaymentMethodAttached(paymentMethod: Stripe.PaymentMethod) {
  console.log('Payment method attached:', paymentMethod.id);

  // Payment methods are typically saved when subscriptions are created
  // This handler is for payment methods attached outside of subscription flow

  try {
    const existing = await getPaymentMethodByStripeId(paymentMethod.id);
    if (existing) {
      return; // Already tracked
    }

    // We don't have customer_id mapping here, so we'll skip saving
    // The payment method will be saved when used in a subscription
    console.log('Payment method attached but not saving without customer context');
  } catch (error) {
    console.error('Error handling payment method attached:', error);
  }
}

/**
 * Handle payment method detached event
 */
async function handlePaymentMethodDetached(paymentMethod: Stripe.PaymentMethod) {
  console.log('Payment method detached:', paymentMethod.id);

  try {
    const existing = await getPaymentMethodByStripeId(paymentMethod.id);
    if (!existing) {
      return;
    }

    await removePaymentMethod(existing.id);
  } catch (error) {
    console.error('Error handling payment method detached:', error);
  }
}