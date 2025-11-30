/**
 * Subscription Email Templates and Sending Functions
 *
 * Handles all subscription-related email notifications including:
 * - Subscription created confirmation
 * - Payment successful/failed
 * - Subscription paused/resumed
 * - Subscription cancelled
 * - Trial ending soon
 * - Renewal reminder
 * - Gift subscription notifications
 */

import { getResendClient, EmailResult } from './email';
import type { Subscription, SubscriptionPlan, SubscriptionInvoice } from '@/lib/types/subscription';

// =====================================================
// Email Data Interfaces
// =====================================================

export interface SubscriptionEmailData {
  customerName: string;
  customerEmail: string;
  subscriptionId: string;
  planName: string;
  planPrice: number;
  planInterval: string;
  currency: string;
}

export interface PaymentEmailData extends SubscriptionEmailData {
  invoiceNumber?: string;
  amountPaid: number;
  invoiceUrl?: string;
  invoicePdfUrl?: string;
  nextBillingDate?: string;
}

export interface TrialEndingEmailData extends SubscriptionEmailData {
  trialEndDate: string;
  daysRemaining: number;
}

export interface CancellationEmailData extends SubscriptionEmailData {
  endDate: string;
  reason?: string;
}

export interface PauseEmailData extends SubscriptionEmailData {
  pausedUntil?: string;
}

export interface GiftSubscriptionEmailData extends SubscriptionEmailData {
  senderName: string;
  senderEmail: string;
  recipientName: string;
  recipientEmail: string;
  giftMessage?: string;
  redeemCode: string;
  expiresAt?: string;
}

export interface PlanChangeEmailData extends SubscriptionEmailData {
  oldPlanName: string;
  oldPlanPrice: number;
  newPlanName: string;
  newPlanPrice: number;
  effectiveDate: string;
  proratedAmount?: number;
}

export interface PaymentFailedEmailData extends SubscriptionEmailData {
  attemptNumber: number;
  maxAttempts: number;
  nextRetryDate?: string;
  updatePaymentUrl: string;
  lastFourDigits?: string;
  failureReason?: string;
}

// =====================================================
// Helper Functions
// =====================================================

function formatPrice(amount: number, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency,
  }).format(amount / 100);
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function getBaseEmailTemplate(title: string, content: string): string {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${title} - BeauTeas</title>
    </head>
    <body style="margin: 0; padding: 0; background-color: #f6f9fc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Ubuntu, sans-serif;">
      <div style="background-color: #ffffff; margin: 0 auto; padding: 20px 0 48px; margin-bottom: 64px; max-width: 600px;">

        <!-- Header -->
        <div style="text-align: center; padding: 32px 0; border-bottom: 1px solid #e6ebf1;">
          <h1 style="color: #c4a87c; font-size: 32px; font-weight: bold; margin: 0; padding: 0;">BeauTeas</h1>
          <p style="color: #64748b; font-size: 14px; margin: 8px 0 0;">Organic Skincare Teas</p>
        </div>

        <!-- Content -->
        ${content}

        <!-- Footer -->
        <div style="text-align: center; padding: 32px 32px 0; border-top: 1px solid #e6ebf1;">
          <p style="color: #64748b; font-size: 12px; line-height: 16px; margin: 0 0 8px;">
            Questions about your subscription? Reply to this email or contact our support team.
          </p>
          <p style="color: #64748b; font-size: 12px; line-height: 16px; margin: 0 0 8px;">
            <a href="${process.env.NEXT_PUBLIC_APP_URL}/account/subscriptions" style="color: #f97316;">Manage Your Subscription</a>
          </p>
          <p style="color: #64748b; font-size: 12px; line-height: 16px; margin: 0;">
            Thank you for being a BeauTeas subscriber!
          </p>
        </div>

      </div>
    </body>
    </html>
  `;
}

// =====================================================
// Email Templates
// =====================================================

function generateSubscriptionConfirmationHTML(data: SubscriptionEmailData): string {
  const content = `
    <div style="padding: 24px 32px;">
      <h2 style="color: #10b981; font-size: 24px; font-weight: bold; margin: 0 0 16px;">
        Welcome to Your Subscription!
      </h2>
      <p style="color: #64748b; font-size: 16px; line-height: 24px; margin: 0 0 16px;">
        Hi ${data.customerName},
      </p>
      <p style="color: #64748b; font-size: 16px; line-height: 24px; margin: 0 0 16px;">
        Thank you for subscribing to BeauTeas! Your subscription has been set up successfully.
      </p>

      <div style="background-color: #f1f5f9; border-radius: 8px; padding: 20px; margin: 24px 0;">
        <h3 style="color: #1e293b; font-size: 18px; font-weight: bold; margin: 0 0 12px;">
          Subscription Details
        </h3>
        <table style="width: 100%;">
          <tr>
            <td style="color: #64748b; font-size: 14px; padding: 4px 0;">Plan:</td>
            <td style="color: #1e293b; font-size: 14px; font-weight: bold; text-align: right;">${data.planName}</td>
          </tr>
          <tr>
            <td style="color: #64748b; font-size: 14px; padding: 4px 0;">Price:</td>
            <td style="color: #1e293b; font-size: 14px; font-weight: bold; text-align: right;">
              ${formatPrice(data.planPrice, data.currency)}/${data.planInterval}
            </td>
          </tr>
        </table>
      </div>

      <p style="color: #64748b; font-size: 14px; line-height: 20px; margin: 0 0 16px;">
        You can manage your subscription, update payment methods, or make changes anytime from your account dashboard.
      </p>

      <div style="text-align: center; margin: 24px 0;">
        <a href="${process.env.NEXT_PUBLIC_APP_URL}/account/subscriptions/${data.subscriptionId}"
           style="display: inline-block; background-color: #f97316; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">
          View Your Subscription
        </a>
      </div>
    </div>
  `;

  return getBaseEmailTemplate('Subscription Confirmed', content);
}

function generatePaymentSuccessHTML(data: PaymentEmailData): string {
  const content = `
    <div style="padding: 24px 32px;">
      <h2 style="color: #10b981; font-size: 24px; font-weight: bold; margin: 0 0 16px;">
        Payment Successful
      </h2>
      <p style="color: #64748b; font-size: 16px; line-height: 24px; margin: 0 0 16px;">
        Hi ${data.customerName},
      </p>
      <p style="color: #64748b; font-size: 16px; line-height: 24px; margin: 0 0 16px;">
        We've successfully processed your subscription payment.
      </p>

      <div style="background-color: #f1f5f9; border-radius: 8px; padding: 20px; margin: 24px 0;">
        <h3 style="color: #1e293b; font-size: 18px; font-weight: bold; margin: 0 0 12px;">
          Payment Details
        </h3>
        <table style="width: 100%;">
          ${data.invoiceNumber ? `
          <tr>
            <td style="color: #64748b; font-size: 14px; padding: 4px 0;">Invoice:</td>
            <td style="color: #1e293b; font-size: 14px; text-align: right;">#${data.invoiceNumber}</td>
          </tr>
          ` : ''}
          <tr>
            <td style="color: #64748b; font-size: 14px; padding: 4px 0;">Amount Paid:</td>
            <td style="color: #10b981; font-size: 14px; font-weight: bold; text-align: right;">
              ${formatPrice(data.amountPaid, data.currency)}
            </td>
          </tr>
          <tr>
            <td style="color: #64748b; font-size: 14px; padding: 4px 0;">Plan:</td>
            <td style="color: #1e293b; font-size: 14px; text-align: right;">${data.planName}</td>
          </tr>
          ${data.nextBillingDate ? `
          <tr>
            <td style="color: #64748b; font-size: 14px; padding: 4px 0;">Next Billing:</td>
            <td style="color: #1e293b; font-size: 14px; text-align: right;">${formatDate(data.nextBillingDate)}</td>
          </tr>
          ` : ''}
        </table>
      </div>

      ${data.invoiceUrl ? `
      <div style="text-align: center; margin: 24px 0;">
        <a href="${data.invoiceUrl}"
           style="display: inline-block; background-color: #f97316; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">
          View Invoice
        </a>
        ${data.invoicePdfUrl ? `
        <a href="${data.invoicePdfUrl}"
           style="display: inline-block; background-color: #64748b; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; margin-left: 12px;">
          Download PDF
        </a>
        ` : ''}
      </div>
      ` : ''}
    </div>
  `;

  return getBaseEmailTemplate('Payment Successful', content);
}

function generatePaymentFailedHTML(data: PaymentFailedEmailData): string {
  const content = `
    <div style="padding: 24px 32px;">
      <h2 style="color: #dc2626; font-size: 24px; font-weight: bold; margin: 0 0 16px;">
        Payment Failed
      </h2>
      <p style="color: #64748b; font-size: 16px; line-height: 24px; margin: 0 0 16px;">
        Hi ${data.customerName},
      </p>
      <p style="color: #64748b; font-size: 16px; line-height: 24px; margin: 0 0 16px;">
        We were unable to process your subscription payment${data.lastFourDigits ? ` for card ending in ${data.lastFourDigits}` : ''}.
      </p>

      <div style="background-color: #fef2f2; border-left: 4px solid #dc2626; padding: 16px; margin: 24px 0;">
        <p style="color: #7f1d1d; font-size: 14px; margin: 0;">
          ${data.failureReason || 'Your payment could not be processed. Please update your payment method.'}
        </p>
      </div>

      <div style="background-color: #f1f5f9; border-radius: 8px; padding: 20px; margin: 24px 0;">
        <table style="width: 100%;">
          <tr>
            <td style="color: #64748b; font-size: 14px; padding: 4px 0;">Plan:</td>
            <td style="color: #1e293b; font-size: 14px; text-align: right;">${data.planName}</td>
          </tr>
          <tr>
            <td style="color: #64748b; font-size: 14px; padding: 4px 0;">Amount:</td>
            <td style="color: #1e293b; font-size: 14px; text-align: right;">
              ${formatPrice(data.planPrice, data.currency)}
            </td>
          </tr>
          <tr>
            <td style="color: #64748b; font-size: 14px; padding: 4px 0;">Retry Attempt:</td>
            <td style="color: #1e293b; font-size: 14px; text-align: right;">
              ${data.attemptNumber} of ${data.maxAttempts}
            </td>
          </tr>
          ${data.nextRetryDate ? `
          <tr>
            <td style="color: #64748b; font-size: 14px; padding: 4px 0;">Next Retry:</td>
            <td style="color: #f97316; font-size: 14px; font-weight: bold; text-align: right;">
              ${formatDate(data.nextRetryDate)}
            </td>
          </tr>
          ` : ''}
        </table>
      </div>

      <p style="color: #64748b; font-size: 14px; line-height: 20px; margin: 0 0 16px;">
        Please update your payment method to avoid service interruption.
      </p>

      <div style="text-align: center; margin: 24px 0;">
        <a href="${data.updatePaymentUrl}"
           style="display: inline-block; background-color: #f97316; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">
          Update Payment Method
        </a>
      </div>
    </div>
  `;

  return getBaseEmailTemplate('Payment Failed', content);
}

function generateTrialEndingHTML(data: TrialEndingEmailData): string {
  const content = `
    <div style="padding: 24px 32px;">
      <h2 style="color: #f97316; font-size: 24px; font-weight: bold; margin: 0 0 16px;">
        Your Trial is Ending Soon
      </h2>
      <p style="color: #64748b; font-size: 16px; line-height: 24px; margin: 0 0 16px;">
        Hi ${data.customerName},
      </p>
      <p style="color: #64748b; font-size: 16px; line-height: 24px; margin: 0 0 16px;">
        Your free trial for ${data.planName} will end in <strong>${data.daysRemaining} day${data.daysRemaining !== 1 ? 's' : ''}</strong> on ${formatDate(data.trialEndDate)}.
      </p>

      <div style="background-color: #fff7ed; border-left: 4px solid #f97316; padding: 16px; margin: 24px 0;">
        <p style="color: #9a3412; font-size: 14px; margin: 0;">
          After your trial ends, you'll be automatically charged ${formatPrice(data.planPrice, data.currency)}/${data.planInterval}.
        </p>
      </div>

      <p style="color: #64748b; font-size: 14px; line-height: 20px; margin: 0 0 16px;">
        Enjoying BeauTeas? No action needed - your subscription will continue automatically. Not ready to commit? Cancel anytime before your trial ends.
      </p>

      <div style="text-align: center; margin: 24px 0;">
        <a href="${process.env.NEXT_PUBLIC_APP_URL}/account/subscriptions/${data.subscriptionId}"
           style="display: inline-block; background-color: #f97316; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">
          Manage Subscription
        </a>
      </div>
    </div>
  `;

  return getBaseEmailTemplate('Trial Ending Soon', content);
}

function generateSubscriptionCancelledHTML(data: CancellationEmailData): string {
  const content = `
    <div style="padding: 24px 32px;">
      <h2 style="color: #64748b; font-size: 24px; font-weight: bold; margin: 0 0 16px;">
        Subscription Cancelled
      </h2>
      <p style="color: #64748b; font-size: 16px; line-height: 24px; margin: 0 0 16px;">
        Hi ${data.customerName},
      </p>
      <p style="color: #64748b; font-size: 16px; line-height: 24px; margin: 0 0 16px;">
        We're sorry to see you go. Your ${data.planName} subscription has been cancelled.
      </p>

      <div style="background-color: #f1f5f9; border-radius: 8px; padding: 20px; margin: 24px 0;">
        <table style="width: 100%;">
          <tr>
            <td style="color: #64748b; font-size: 14px; padding: 4px 0;">Plan:</td>
            <td style="color: #1e293b; font-size: 14px; text-align: right;">${data.planName}</td>
          </tr>
          <tr>
            <td style="color: #64748b; font-size: 14px; padding: 4px 0;">Access Until:</td>
            <td style="color: #f97316; font-size: 14px; font-weight: bold; text-align: right;">
              ${formatDate(data.endDate)}
            </td>
          </tr>
          ${data.reason ? `
          <tr>
            <td style="color: #64748b; font-size: 14px; padding: 4px 0;">Reason:</td>
            <td style="color: #1e293b; font-size: 14px; text-align: right;">${data.reason}</td>
          </tr>
          ` : ''}
        </table>
      </div>

      <p style="color: #64748b; font-size: 14px; line-height: 20px; margin: 0 0 16px;">
        You'll continue to have access until the end of your current billing period. Changed your mind? You can resubscribe anytime.
      </p>

      <div style="text-align: center; margin: 24px 0;">
        <a href="${process.env.NEXT_PUBLIC_APP_URL}/subscribe"
           style="display: inline-block; background-color: #f97316; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">
          Resubscribe
        </a>
      </div>
    </div>
  `;

  return getBaseEmailTemplate('Subscription Cancelled', content);
}

function generateSubscriptionPausedHTML(data: PauseEmailData): string {
  const content = `
    <div style="padding: 24px 32px;">
      <h2 style="color: #3b82f6; font-size: 24px; font-weight: bold; margin: 0 0 16px;">
        Subscription Paused
      </h2>
      <p style="color: #64748b; font-size: 16px; line-height: 24px; margin: 0 0 16px;">
        Hi ${data.customerName},
      </p>
      <p style="color: #64748b; font-size: 16px; line-height: 24px; margin: 0 0 16px;">
        Your ${data.planName} subscription has been paused${data.pausedUntil ? ` until ${formatDate(data.pausedUntil)}` : ''}.
      </p>

      <div style="background-color: #eff6ff; border-left: 4px solid #3b82f6; padding: 16px; margin: 24px 0;">
        <p style="color: #1e40af; font-size: 14px; margin: 0;">
          While paused, you won't be charged. ${data.pausedUntil ? `Your subscription will automatically resume on ${formatDate(data.pausedUntil)}.` : 'You can resume your subscription anytime.'}
        </p>
      </div>

      <div style="text-align: center; margin: 24px 0;">
        <a href="${process.env.NEXT_PUBLIC_APP_URL}/account/subscriptions/${data.subscriptionId}"
           style="display: inline-block; background-color: #f97316; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">
          Resume Subscription
        </a>
      </div>
    </div>
  `;

  return getBaseEmailTemplate('Subscription Paused', content);
}

function generateSubscriptionResumedHTML(data: SubscriptionEmailData): string {
  const content = `
    <div style="padding: 24px 32px;">
      <h2 style="color: #10b981; font-size: 24px; font-weight: bold; margin: 0 0 16px;">
        Subscription Resumed
      </h2>
      <p style="color: #64748b; font-size: 16px; line-height: 24px; margin: 0 0 16px;">
        Hi ${data.customerName},
      </p>
      <p style="color: #64748b; font-size: 16px; line-height: 24px; margin: 0 0 16px;">
        Great news! Your ${data.planName} subscription has been resumed and is now active again.
      </p>

      <div style="background-color: #f1f5f9; border-radius: 8px; padding: 20px; margin: 24px 0;">
        <table style="width: 100%;">
          <tr>
            <td style="color: #64748b; font-size: 14px; padding: 4px 0;">Plan:</td>
            <td style="color: #1e293b; font-size: 14px; text-align: right;">${data.planName}</td>
          </tr>
          <tr>
            <td style="color: #64748b; font-size: 14px; padding: 4px 0;">Price:</td>
            <td style="color: #1e293b; font-size: 14px; text-align: right;">
              ${formatPrice(data.planPrice, data.currency)}/${data.planInterval}
            </td>
          </tr>
        </table>
      </div>

      <div style="text-align: center; margin: 24px 0;">
        <a href="${process.env.NEXT_PUBLIC_APP_URL}/account/subscriptions/${data.subscriptionId}"
           style="display: inline-block; background-color: #f97316; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">
          View Subscription
        </a>
      </div>
    </div>
  `;

  return getBaseEmailTemplate('Subscription Resumed', content);
}

function generatePlanChangeHTML(data: PlanChangeEmailData): string {
  const content = `
    <div style="padding: 24px 32px;">
      <h2 style="color: #8b5cf6; font-size: 24px; font-weight: bold; margin: 0 0 16px;">
        Plan Changed
      </h2>
      <p style="color: #64748b; font-size: 16px; line-height: 24px; margin: 0 0 16px;">
        Hi ${data.customerName},
      </p>
      <p style="color: #64748b; font-size: 16px; line-height: 24px; margin: 0 0 16px;">
        Your subscription plan has been updated.
      </p>

      <div style="background-color: #f1f5f9; border-radius: 8px; padding: 20px; margin: 24px 0;">
        <h3 style="color: #1e293b; font-size: 16px; font-weight: bold; margin: 0 0 12px;">
          Plan Change Details
        </h3>
        <table style="width: 100%;">
          <tr>
            <td style="color: #64748b; font-size: 14px; padding: 4px 0;">Previous Plan:</td>
            <td style="color: #64748b; font-size: 14px; text-align: right; text-decoration: line-through;">
              ${data.oldPlanName} (${formatPrice(data.oldPlanPrice, data.currency)})
            </td>
          </tr>
          <tr>
            <td style="color: #64748b; font-size: 14px; padding: 4px 0;">New Plan:</td>
            <td style="color: #10b981; font-size: 14px; font-weight: bold; text-align: right;">
              ${data.newPlanName} (${formatPrice(data.newPlanPrice, data.currency)})
            </td>
          </tr>
          <tr>
            <td style="color: #64748b; font-size: 14px; padding: 4px 0;">Effective:</td>
            <td style="color: #1e293b; font-size: 14px; text-align: right;">
              ${formatDate(data.effectiveDate)}
            </td>
          </tr>
          ${data.proratedAmount ? `
          <tr>
            <td style="color: #64748b; font-size: 14px; padding: 4px 0;">Prorated ${data.proratedAmount > 0 ? 'Charge' : 'Credit'}:</td>
            <td style="color: ${data.proratedAmount > 0 ? '#dc2626' : '#10b981'}; font-size: 14px; font-weight: bold; text-align: right;">
              ${data.proratedAmount > 0 ? '' : '-'}${formatPrice(Math.abs(data.proratedAmount), data.currency)}
            </td>
          </tr>
          ` : ''}
        </table>
      </div>

      <div style="text-align: center; margin: 24px 0;">
        <a href="${process.env.NEXT_PUBLIC_APP_URL}/account/subscriptions/${data.subscriptionId}"
           style="display: inline-block; background-color: #f97316; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">
          View Subscription
        </a>
      </div>
    </div>
  `;

  return getBaseEmailTemplate('Plan Changed', content);
}

function generateGiftSubscriptionSenderHTML(data: GiftSubscriptionEmailData): string {
  const content = `
    <div style="padding: 24px 32px;">
      <h2 style="color: #10b981; font-size: 24px; font-weight: bold; margin: 0 0 16px;">
        Gift Sent Successfully!
      </h2>
      <p style="color: #64748b; font-size: 16px; line-height: 24px; margin: 0 0 16px;">
        Hi ${data.senderName},
      </p>
      <p style="color: #64748b; font-size: 16px; line-height: 24px; margin: 0 0 16px;">
        Your gift subscription to BeauTeas has been sent to ${data.recipientName}!
      </p>

      <div style="background-color: #f1f5f9; border-radius: 8px; padding: 20px; margin: 24px 0;">
        <h3 style="color: #1e293b; font-size: 16px; font-weight: bold; margin: 0 0 12px;">
          Gift Details
        </h3>
        <table style="width: 100%;">
          <tr>
            <td style="color: #64748b; font-size: 14px; padding: 4px 0;">Recipient:</td>
            <td style="color: #1e293b; font-size: 14px; text-align: right;">${data.recipientName}</td>
          </tr>
          <tr>
            <td style="color: #64748b; font-size: 14px; padding: 4px 0;">Plan:</td>
            <td style="color: #1e293b; font-size: 14px; text-align: right;">${data.planName}</td>
          </tr>
          <tr>
            <td style="color: #64748b; font-size: 14px; padding: 4px 0;">Value:</td>
            <td style="color: #1e293b; font-size: 14px; text-align: right;">
              ${formatPrice(data.planPrice, data.currency)}/${data.planInterval}
            </td>
          </tr>
          <tr>
            <td style="color: #64748b; font-size: 14px; padding: 4px 0;">Redemption Code:</td>
            <td style="color: #f97316; font-size: 14px; font-weight: bold; text-align: right;">${data.redeemCode}</td>
          </tr>
          ${data.expiresAt ? `
          <tr>
            <td style="color: #64748b; font-size: 14px; padding: 4px 0;">Expires:</td>
            <td style="color: #1e293b; font-size: 14px; text-align: right;">${formatDate(data.expiresAt)}</td>
          </tr>
          ` : ''}
        </table>
      </div>

      ${data.giftMessage ? `
      <div style="background-color: #fef3c7; border-radius: 8px; padding: 16px; margin: 24px 0;">
        <p style="color: #92400e; font-size: 14px; font-style: italic; margin: 0;">
          "${data.giftMessage}"
        </p>
      </div>
      ` : ''}
    </div>
  `;

  return getBaseEmailTemplate('Gift Subscription Sent', content);
}

function generateGiftSubscriptionRecipientHTML(data: GiftSubscriptionEmailData): string {
  const content = `
    <div style="padding: 24px 32px;">
      <h2 style="color: #10b981; font-size: 24px; font-weight: bold; margin: 0 0 16px;">
        You've Received a Gift!
      </h2>
      <p style="color: #64748b; font-size: 16px; line-height: 24px; margin: 0 0 16px;">
        Hi ${data.recipientName},
      </p>
      <p style="color: #64748b; font-size: 16px; line-height: 24px; margin: 0 0 16px;">
        ${data.senderName} has gifted you a BeauTeas subscription!
      </p>

      ${data.giftMessage ? `
      <div style="background-color: #fef3c7; border-radius: 8px; padding: 16px; margin: 24px 0;">
        <p style="color: #64748b; font-size: 12px; margin: 0 0 8px;">Personal message from ${data.senderName}:</p>
        <p style="color: #92400e; font-size: 16px; font-style: italic; margin: 0;">
          "${data.giftMessage}"
        </p>
      </div>
      ` : ''}

      <div style="background-color: #f1f5f9; border-radius: 8px; padding: 20px; margin: 24px 0;">
        <h3 style="color: #1e293b; font-size: 16px; font-weight: bold; margin: 0 0 12px;">
          Your Gift
        </h3>
        <table style="width: 100%;">
          <tr>
            <td style="color: #64748b; font-size: 14px; padding: 4px 0;">Plan:</td>
            <td style="color: #1e293b; font-size: 14px; text-align: right;">${data.planName}</td>
          </tr>
          <tr>
            <td style="color: #64748b; font-size: 14px; padding: 4px 0;">Value:</td>
            <td style="color: #10b981; font-size: 14px; font-weight: bold; text-align: right;">
              ${formatPrice(data.planPrice, data.currency)}/${data.planInterval}
            </td>
          </tr>
        </table>
      </div>

      <div style="background-color: #fff7ed; border-radius: 8px; padding: 20px; margin: 24px 0; text-align: center;">
        <p style="color: #1e293b; font-size: 14px; margin: 0 0 8px;">Your Redemption Code:</p>
        <p style="color: #f97316; font-size: 24px; font-weight: bold; margin: 0; letter-spacing: 2px;">${data.redeemCode}</p>
        ${data.expiresAt ? `
        <p style="color: #64748b; font-size: 12px; margin: 8px 0 0;">Expires: ${formatDate(data.expiresAt)}</p>
        ` : ''}
      </div>

      <div style="text-align: center; margin: 24px 0;">
        <a href="${process.env.NEXT_PUBLIC_APP_URL}/gift/redeem?code=${data.redeemCode}"
           style="display: inline-block; background-color: #f97316; color: white; padding: 16px 32px; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 18px;">
          Redeem Your Gift
        </a>
      </div>
    </div>
  `;

  return getBaseEmailTemplate("You've Received a Gift!", content);
}

function generateRenewalReminderHTML(data: PaymentEmailData): string {
  const content = `
    <div style="padding: 24px 32px;">
      <h2 style="color: #f97316; font-size: 24px; font-weight: bold; margin: 0 0 16px;">
        Renewal Reminder
      </h2>
      <p style="color: #64748b; font-size: 16px; line-height: 24px; margin: 0 0 16px;">
        Hi ${data.customerName},
      </p>
      <p style="color: #64748b; font-size: 16px; line-height: 24px; margin: 0 0 16px;">
        Your BeauTeas subscription will renew on ${data.nextBillingDate ? formatDate(data.nextBillingDate) : 'soon'}.
      </p>

      <div style="background-color: #f1f5f9; border-radius: 8px; padding: 20px; margin: 24px 0;">
        <table style="width: 100%;">
          <tr>
            <td style="color: #64748b; font-size: 14px; padding: 4px 0;">Plan:</td>
            <td style="color: #1e293b; font-size: 14px; text-align: right;">${data.planName}</td>
          </tr>
          <tr>
            <td style="color: #64748b; font-size: 14px; padding: 4px 0;">Amount:</td>
            <td style="color: #1e293b; font-size: 14px; font-weight: bold; text-align: right;">
              ${formatPrice(data.planPrice, data.currency)}
            </td>
          </tr>
          <tr>
            <td style="color: #64748b; font-size: 14px; padding: 4px 0;">Renewal Date:</td>
            <td style="color: #f97316; font-size: 14px; font-weight: bold; text-align: right;">
              ${data.nextBillingDate ? formatDate(data.nextBillingDate) : 'Soon'}
            </td>
          </tr>
        </table>
      </div>

      <p style="color: #64748b; font-size: 14px; line-height: 20px; margin: 0 0 16px;">
        No action is needed if you want to continue your subscription. If you'd like to make changes, you can do so from your account.
      </p>

      <div style="text-align: center; margin: 24px 0;">
        <a href="${process.env.NEXT_PUBLIC_APP_URL}/account/subscriptions/${data.subscriptionId}"
           style="display: inline-block; background-color: #f97316; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">
          Manage Subscription
        </a>
      </div>
    </div>
  `;

  return getBaseEmailTemplate('Subscription Renewal Reminder', content);
}

// =====================================================
// Email Sending Functions
// =====================================================

export async function sendSubscriptionConfirmationEmail(
  data: SubscriptionEmailData
): Promise<EmailResult> {
  try {
    const resendClient = getResendClient();
    const html = generateSubscriptionConfirmationHTML(data);

    const { data: result, error } = await resendClient.emails.send({
      from: 'BeauTeas <hello@beauteas.com>',
      to: [data.customerEmail],
      subject: `Welcome to ${data.planName} - BeauTeas`,
      html,
    });

    if (error) {
      console.error('Email sending error:', error);
      return { success: false, error: error.message || 'Email sending failed' };
    }

    console.log('Subscription confirmation email sent:', result?.id);
    return { success: true, id: result?.id };
  } catch (error) {
    console.error('Email sending failed:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function sendPaymentSuccessEmail(
  data: PaymentEmailData
): Promise<EmailResult> {
  try {
    const resendClient = getResendClient();
    const html = generatePaymentSuccessHTML(data);

    const { data: result, error } = await resendClient.emails.send({
      from: 'BeauTeas <hello@beauteas.com>',
      to: [data.customerEmail],
      subject: `Payment Received - BeauTeas`,
      html,
    });

    if (error) {
      return { success: false, error: error.message || 'Email sending failed' };
    }

    return { success: true, id: result?.id };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function sendPaymentFailedEmail(
  data: PaymentFailedEmailData
): Promise<EmailResult> {
  try {
    const resendClient = getResendClient();
    const html = generatePaymentFailedHTML(data);

    const { data: result, error } = await resendClient.emails.send({
      from: 'BeauTeas <hello@beauteas.com>',
      to: [data.customerEmail],
      subject: `Action Required: Payment Failed - BeauTeas`,
      html,
    });

    if (error) {
      return { success: false, error: error.message || 'Email sending failed' };
    }

    return { success: true, id: result?.id };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function sendTrialEndingEmail(
  data: TrialEndingEmailData
): Promise<EmailResult> {
  try {
    const resendClient = getResendClient();
    const html = generateTrialEndingHTML(data);

    const { data: result, error } = await resendClient.emails.send({
      from: 'BeauTeas <hello@beauteas.com>',
      to: [data.customerEmail],
      subject: `Your Trial Ends in ${data.daysRemaining} Day${data.daysRemaining !== 1 ? 's' : ''} - BeauTeas`,
      html,
    });

    if (error) {
      return { success: false, error: error.message || 'Email sending failed' };
    }

    return { success: true, id: result?.id };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function sendSubscriptionCancelledEmail(
  data: CancellationEmailData
): Promise<EmailResult> {
  try {
    const resendClient = getResendClient();
    const html = generateSubscriptionCancelledHTML(data);

    const { data: result, error } = await resendClient.emails.send({
      from: 'BeauTeas <hello@beauteas.com>',
      to: [data.customerEmail],
      subject: `Subscription Cancelled - BeauTeas`,
      html,
    });

    if (error) {
      return { success: false, error: error.message || 'Email sending failed' };
    }

    return { success: true, id: result?.id };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function sendSubscriptionPausedEmail(
  data: PauseEmailData
): Promise<EmailResult> {
  try {
    const resendClient = getResendClient();
    const html = generateSubscriptionPausedHTML(data);

    const { data: result, error } = await resendClient.emails.send({
      from: 'BeauTeas <hello@beauteas.com>',
      to: [data.customerEmail],
      subject: `Subscription Paused - BeauTeas`,
      html,
    });

    if (error) {
      return { success: false, error: error.message || 'Email sending failed' };
    }

    return { success: true, id: result?.id };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function sendSubscriptionResumedEmail(
  data: SubscriptionEmailData
): Promise<EmailResult> {
  try {
    const resendClient = getResendClient();
    const html = generateSubscriptionResumedHTML(data);

    const { data: result, error } = await resendClient.emails.send({
      from: 'BeauTeas <hello@beauteas.com>',
      to: [data.customerEmail],
      subject: `Subscription Resumed - BeauTeas`,
      html,
    });

    if (error) {
      return { success: false, error: error.message || 'Email sending failed' };
    }

    return { success: true, id: result?.id };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function sendPlanChangeEmail(
  data: PlanChangeEmailData
): Promise<EmailResult> {
  try {
    const resendClient = getResendClient();
    const html = generatePlanChangeHTML(data);

    const { data: result, error } = await resendClient.emails.send({
      from: 'BeauTeas <hello@beauteas.com>',
      to: [data.customerEmail],
      subject: `Plan Updated to ${data.newPlanName} - BeauTeas`,
      html,
    });

    if (error) {
      return { success: false, error: error.message || 'Email sending failed' };
    }

    return { success: true, id: result?.id };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function sendGiftSubscriptionEmails(
  data: GiftSubscriptionEmailData
): Promise<{ sender: EmailResult; recipient: EmailResult }> {
  const resendClient = getResendClient();

  // Send to sender
  let senderResult: EmailResult;
  try {
    const senderHtml = generateGiftSubscriptionSenderHTML(data);
    const { data: result, error } = await resendClient.emails.send({
      from: 'BeauTeas <hello@beauteas.com>',
      to: [data.senderEmail],
      subject: `Gift Sent to ${data.recipientName} - BeauTeas`,
      html: senderHtml,
    });

    senderResult = error
      ? { success: false, error: error.message }
      : { success: true, id: result?.id };
  } catch (error) {
    senderResult = { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }

  // Send to recipient
  let recipientResult: EmailResult;
  try {
    const recipientHtml = generateGiftSubscriptionRecipientHTML(data);
    const { data: result, error } = await resendClient.emails.send({
      from: 'BeauTeas <hello@beauteas.com>',
      to: [data.recipientEmail],
      subject: `${data.senderName} sent you a gift! - BeauTeas`,
      html: recipientHtml,
    });

    recipientResult = error
      ? { success: false, error: error.message }
      : { success: true, id: result?.id };
  } catch (error) {
    recipientResult = { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }

  return { sender: senderResult, recipient: recipientResult };
}

export async function sendRenewalReminderEmail(
  data: PaymentEmailData
): Promise<EmailResult> {
  try {
    const resendClient = getResendClient();
    const html = generateRenewalReminderHTML(data);

    const { data: result, error } = await resendClient.emails.send({
      from: 'BeauTeas <hello@beauteas.com>',
      to: [data.customerEmail],
      subject: `Subscription Renewal Reminder - BeauTeas`,
      html,
    });

    if (error) {
      return { success: false, error: error.message || 'Email sending failed' };
    }

    return { success: true, id: result?.id };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}
