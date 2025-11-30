/**
 * Payment Retry Processing API
 *
 * This endpoint processes pending payment retries for failed subscription payments.
 * It should be called by a scheduled job (cron) on a regular basis.
 *
 * The dunning schedule is:
 * - Attempt 1: Immediately when payment fails
 * - Attempt 2: 1 day after failure
 * - Attempt 3: 3 days after attempt 2
 * - Attempt 4: 5 days after attempt 3
 * - After 4 failed attempts: Wait 3 more days, then cancel subscription
 */

import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import {
  getPendingRetryAttempts,
  updatePaymentRetryAttempt,
  createPaymentRetryAttempt,
  DUNNING_CONFIG,
  getNextRetryDate,
} from "@/lib/models/coupons";
import {
  getSubscription,
  updateSubscription,
  logSubscriptionEvent,
  getSubscriptionWithPlan,
} from "@/lib/models/subscriptions";
import { getCustomer } from "@/lib/models/customer";
import { sendPaymentFailedEmail } from "@/lib/utils/subscription-emails";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2024-11-20.acacia",
});

// POST /api/subscriptions/process-retries - Process pending payment retries
// This endpoint should be secured and called by a cron job
export async function POST(request: NextRequest) {
  try {
    // Verify the request is authorized (use a secret key or API key)
    const authHeader = request.headers.get("Authorization");
    const expectedKey = process.env.CRON_SECRET_KEY;

    if (expectedKey && authHeader !== `Bearer ${expectedKey}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const now = new Date();
    const pendingRetries = await getPendingRetryAttempts(now);

    const results = {
      processed: 0,
      succeeded: 0,
      failed: 0,
      errors: [] as string[],
    };

    for (const retry of pendingRetries) {
      try {
        results.processed++;

        const subscription = await getSubscriptionWithPlan(retry.subscription_id);
        if (!subscription) {
          results.errors.push(`Subscription ${retry.subscription_id} not found`);
          continue;
        }

        // Skip if subscription is no longer in past_due status
        if (subscription.status !== "past_due") {
          await updatePaymentRetryAttempt(retry.id, {
            status: "failed",
            failure_reason: "Subscription status changed",
            attempted_at: now.toISOString(),
          });
          continue;
        }

        // Attempt payment via Stripe
        if (subscription.stripe_subscription_id) {
          try {
            // Get the latest invoice for this subscription
            const invoices = await stripe.invoices.list({
              subscription: subscription.stripe_subscription_id,
              status: "open",
              limit: 1,
            });

            const latestInvoice = invoices.data[0];

            if (latestInvoice) {
              // Attempt to pay the invoice
              const paidInvoice = await stripe.invoices.pay(latestInvoice.id);

              if (paidInvoice.status === "paid") {
                // Payment succeeded!
                results.succeeded++;

                await updatePaymentRetryAttempt(retry.id, {
                  status: "succeeded",
                  attempted_at: now.toISOString(),
                  stripe_payment_intent_id:
                    typeof paidInvoice.payment_intent === "string"
                      ? paidInvoice.payment_intent
                      : paidInvoice.payment_intent?.id,
                });

                // Update subscription status
                await updateSubscription(retry.subscription_id, {
                  status: "active",
                });

                await logSubscriptionEvent({
                  subscription_id: retry.subscription_id,
                  event_type: "payment_succeeded",
                  previous_status: "past_due",
                  new_status: "active",
                  data: {
                    retry_attempt: retry.attempt_number,
                    invoice_id: latestInvoice.id,
                  },
                });

                continue;
              }
            }
          } catch (stripeError: any) {
            // Payment failed
            const failureReason = stripeError.message || "Payment declined";

            await updatePaymentRetryAttempt(retry.id, {
              status: "failed",
              failure_reason: failureReason,
              attempted_at: now.toISOString(),
            });

            results.failed++;

            // Schedule next retry or cancel
            const nextRetryDate = getNextRetryDate(retry.attempt_number);

            if (nextRetryDate) {
              // Schedule next retry
              await createPaymentRetryAttempt({
                subscription_id: retry.subscription_id,
                invoice_id: retry.invoice_id,
                attempt_number: retry.attempt_number + 1,
                amount: retry.amount,
                currency_code: retry.currency_code,
                scheduled_at: nextRetryDate.toISOString(),
              });

              await updatePaymentRetryAttempt(retry.id, {
                next_retry_at: nextRetryDate.toISOString(),
              });

              // Send payment failed email
              const customer = await getCustomer(subscription.customer_id);
              if (customer?.email) {
                await sendPaymentFailedEmail({
                  customerName: customer.first_name || customer.email.split("@")[0],
                  customerEmail: customer.email,
                  subscriptionId: subscription.id,
                  planName: subscription.plan?.name || "Subscription",
                  planPrice: subscription.plan?.price.amount || retry.amount,
                  planInterval: subscription.plan?.interval || "month",
                  currency: retry.currency_code,
                  attemptNumber: retry.attempt_number,
                  maxAttempts: DUNNING_CONFIG.maxAttempts,
                  nextRetryDate: nextRetryDate.toISOString(),
                  updatePaymentUrl: `${process.env.NEXT_PUBLIC_APP_URL}/account/payment-methods`,
                  failureReason,
                });
              }
            } else {
              // All retries exhausted - check grace period
              const gracePeriodEnd = new Date(retry.scheduled_at);
              gracePeriodEnd.setDate(
                gracePeriodEnd.getDate() + DUNNING_CONFIG.gracePeriodDays
              );

              if (now > gracePeriodEnd) {
                // Cancel the subscription
                await updateSubscription(retry.subscription_id, {
                  status: "cancelled",
                  cancelled_at: now.toISOString(),
                  cancel_reason: "Payment failed after all retry attempts",
                });

                await logSubscriptionEvent({
                  subscription_id: retry.subscription_id,
                  event_type: "cancelled",
                  previous_status: "past_due",
                  new_status: "cancelled",
                  data: {
                    reason: "dunning_exhausted",
                    total_attempts: retry.attempt_number,
                  },
                });

                // Cancel in Stripe
                if (subscription.stripe_subscription_id) {
                  try {
                    await stripe.subscriptions.cancel(
                      subscription.stripe_subscription_id
                    );
                  } catch {
                    // Ignore Stripe errors during cancellation
                  }
                }
              }
            }
          }
        } else {
          // No Stripe subscription - mark as failed
          await updatePaymentRetryAttempt(retry.id, {
            status: "failed",
            failure_reason: "No payment provider configured",
            attempted_at: now.toISOString(),
          });
          results.failed++;
        }
      } catch (error: any) {
        results.errors.push(
          `Error processing retry ${retry.id}: ${error.message}`
        );
      }
    }

    return NextResponse.json({
      success: true,
      data: results,
      processed_at: now.toISOString(),
    });
  } catch (error) {
    console.error("Error processing payment retries:", error);
    return NextResponse.json(
      { error: "Failed to process payment retries" },
      { status: 500 }
    );
  }
}

// GET /api/subscriptions/process-retries - Get retry status (admin only)
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get("Authorization");
    const expectedKey = process.env.CRON_SECRET_KEY;

    if (expectedKey && authHeader !== `Bearer ${expectedKey}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const now = new Date();
    const pendingRetries = await getPendingRetryAttempts(
      new Date(now.getTime() + 24 * 60 * 60 * 1000) // Next 24 hours
    );

    return NextResponse.json({
      data: {
        pending_count: pendingRetries.length,
        pending_retries: pendingRetries.map((r) => ({
          id: r.id,
          subscription_id: r.subscription_id,
          attempt_number: r.attempt_number,
          amount: r.amount,
          scheduled_at: r.scheduled_at,
        })),
        dunning_config: DUNNING_CONFIG,
      },
    });
  } catch (error) {
    console.error("Error fetching retry status:", error);
    return NextResponse.json(
      { error: "Failed to fetch retry status" },
      { status: 500 }
    );
  }
}
