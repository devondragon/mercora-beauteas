import { Resend } from 'resend';
import type { SubscriptionEmailData, SubscriptionFrequency } from '@/lib/types/subscription';

let resend: Resend | null = null;

export function getResendClient(): Resend {
  if (!resend) {
    resend = new Resend(process.env.RESEND_API_KEY);
  }
  return resend;
}

export interface OrderData {
  orderNumber: string;
  customerName: string;
  customerEmail: string;
  items: Array<{
    productId: string;
    name: string;
    price: number;
    quantity: number;
    imageUrl?: string;
  }>;
  subtotal: number;
  shipping: number;
  tax: number;
  total: number;
  shippingAddress: {
    street: string;
    city: string;
    state: string;
    zipCode: string;
    country: string;
  };
  estimatedDelivery?: string;
}

export interface EmailResult {
  success: boolean;
  id?: string;
  error?: string;
}

export interface OrderStatusUpdateData {
  orderNumber: string;
  customerName: string;
  customerEmail: string;
  status: string;
  carrier?: string;
  trackingNumber?: string;
  trackingUrl?: string;
  notes?: string;
  cancellationReason?: string;
  items: Array<{
    productId: string;
    name: string;
    price: number;
    quantity: number;
    imageUrl?: string;
  }>;
  shippingAddress: {
    street: string;
    city: string;
    state: string;
    zipCode: string;
    country: string;
  };
}

export async function sendOrderConfirmationEmail(orderData: OrderData): Promise<EmailResult> {
  try {
    const emailHtml = generateOrderConfirmationHTML(orderData);
    const resendClient = getResendClient();
    
    const { data, error } = await resendClient.emails.send({
      from: 'BeauTeas<hello@beauteas.com>',
      to: [orderData.customerEmail],
      subject: `Order Confirmation #${orderData.orderNumber} - BeauTeas`,
      html: emailHtml,
    });

    if (error) {
      console.error('Email sending error:', error);
      return { success: false, error: error.message || 'Email sending failed' };
    }

    console.log('Order confirmation email sent:', data?.id);
    return { success: true, id: data?.id };
  } catch (error) {
    console.error('Email sending failed:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

function generateOrderConfirmationHTML(orderData: OrderData): string {
  // Helper function to ensure absolute URLs for images using Cloudflare Image service
  const getAbsoluteImageUrl = (imageUrl: string | undefined): string | undefined => {
    if (!imageUrl) return undefined;
    if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
      return imageUrl;
    }
    
    // Normalize the path (remove leading slash if present)
    const normalizedPath = imageUrl.startsWith('/') ? imageUrl.slice(1) : imageUrl;
    
    // Use Cloudflare Image service for optimized delivery in emails
    // Set width to 100px for email images and quality to 80 for good balance
    return `https://beauteas-images.beauteas.com/cdn-cgi/image/width=100,quality=80,format=auto/${normalizedPath}`;
  };

  const itemsHTML = orderData.items.map(item => {
    const absoluteImageUrl = getAbsoluteImageUrl(item.imageUrl);
    return `
    <tr style="border-bottom: 1px solid #e2e8f0;">
      <td style="padding: 12px 0; vertical-align: top; width: 60px;">
        ${absoluteImageUrl ? `<img src="${absoluteImageUrl}" alt="${item.name}" style="width: 50px; height: 50px; border-radius: 4px; object-fit: cover; display: block;">` : `<div style="width: 50px; height: 50px; background-color: #f1f5f9; border-radius: 4px; display: flex; align-items: center; justify-content: center; color: #64748b; font-size: 12px; text-align: center;">No Image</div>`}
      </td>
      <td style="padding: 12px 0 12px 16px; vertical-align: top;">
        <div style="color: #1e293b; font-size: 16px; font-weight: bold; margin: 0 0 4px;">${item.name}</div>
        <div style="color: #64748b; font-size: 14px; margin: 0;">Quantity: ${item.quantity} × $${item.price.toFixed(2)}</div>
      </td>
      <td style="padding: 12px 0; text-align: right; vertical-align: top;">
        <div style="color: #1e293b; font-size: 16px; font-weight: bold; margin: 0;">$${(item.price * item.quantity).toFixed(2)}</div>
      </td>
    </tr>
  `;
  }).join('');

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Order Confirmation - BeauTeas</title>
    </head>
    <body style="margin: 0; padding: 0; background-color: #f6f9fc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Ubuntu, sans-serif;">
      <div style="background-color: #ffffff; margin: 0 auto; padding: 20px 0 48px; margin-bottom: 64px; max-width: 600px;">

        <!-- Header -->
        <div style="text-align: center; padding: 32px 0; border-bottom: 1px solid #e6ebf1;">
          <h1 style="color: #c4a87c; font-size: 32px; font-weight: bold; margin: 0; padding: 0;">BeauTeas</h1>
          <p style="color: #64748b; font-size: 14px; margin: 8px 0 0;">Organic Skincare Teas</p>
        </div>

        <!-- Order Confirmation -->
        <div style="padding: 24px 32px;">
          <h2 style="color: #1e293b; font-size: 24px; font-weight: bold; margin: 0 0 16px;">Order Confirmed!</h2>
          <p style="color: #64748b; font-size: 16px; line-height: 24px; margin: 0 0 16px;">Hi ${orderData.customerName},</p>
          <p style="color: #64748b; font-size: 16px; line-height: 24px; margin: 0 0 16px;">Thank you for your order! Your gear is being prepared and will be shipped soon.</p>
          
          <div style="background-color: #f1f5f9; border-radius: 8px; padding: 16px; margin: 16px 0;">
            <p style="color: #1e293b; font-size: 18px; font-weight: bold; margin: 0 0 8px;">Order #${orderData.orderNumber}</p>
            ${orderData.estimatedDelivery ? `<p style="color: #64748b; font-size: 14px; margin: 0;">Estimated delivery: ${orderData.estimatedDelivery}</p>` : ''}
          </div>
        </div>

        <!-- Order Items -->
        <div style="padding: 24px 32px;">
          <h3 style="color: #1e293b; font-size: 18px; font-weight: bold; margin: 0 0 12px;">Your Items</h3>
          <table style="width: 100%; border-collapse: collapse;">
            ${itemsHTML}
          </table>
        </div>

        <!-- Order Summary -->
        <div style="background-color: #f8fafc; border-radius: 8px; padding: 16px; margin: 24px 32px;">
          <table style="width: 100%;">
            <tr style="padding: 4px 0;">
              <td style="color: #64748b; font-size: 14px;">Subtotal:</td>
              <td style="text-align: right; color: #1e293b; font-size: 14px;">$${orderData.subtotal.toFixed(2)}</td>
            </tr>
            <tr style="padding: 4px 0;">
              <td style="color: #64748b; font-size: 14px;">Shipping:</td>
              <td style="text-align: right; color: #1e293b; font-size: 14px;">$${orderData.shipping.toFixed(2)}</td>
            </tr>
            <tr style="padding: 4px 0;">
              <td style="color: #64748b; font-size: 14px;">Tax:</td>
              <td style="text-align: right; color: #1e293b; font-size: 14px;">$${orderData.tax.toFixed(2)}</td>
            </tr>
            <tr style="border-top: 2px solid #e2e8f0; padding: 12px 0 0; margin: 12px 0 0;">
              <td style="color: #1e293b; font-size: 16px; font-weight: bold; padding-top: 12px;">Total:</td>
              <td style="text-align: right; color: #f97316; font-size: 18px; font-weight: bold; padding-top: 12px;">$${orderData.total.toFixed(2)}</td>
            </tr>
          </table>
        </div>

        <!-- Shipping Address -->
        <div style="padding: 24px 32px;">
          <h3 style="color: #1e293b; font-size: 18px; font-weight: bold; margin: 0 0 12px;">Shipping Address</h3>
          <p style="color: #64748b; font-size: 14px; line-height: 20px; margin: 0;">
            ${orderData.shippingAddress.street}<br>
            ${orderData.shippingAddress.city}, ${orderData.shippingAddress.state} ${orderData.shippingAddress.zipCode}<br>
            ${orderData.shippingAddress.country}
          </p>
        </div>

        <!-- Footer -->
        <div style="text-align: center; padding: 32px 32px 0; border-top: 1px solid #e6ebf1;">
          <p style="color: #64748b; font-size: 12px; line-height: 16px; margin: 0 0 8px;">Questions about your order? Reply to this email or contact our support team.</p>
          <p style="color: #64748b; font-size: 12px; line-height: 16px; margin: 0 0 8px;">Thank you for choosing BeauTeas!</p>
        </div>

      </div>
    </body>
    </html>
  `;
}

function generateOrderStatusUpdateHTML(orderData: OrderStatusUpdateData): string {
  // Helper function to ensure absolute URLs for images using Cloudflare Image service
  const getAbsoluteImageUrl = (imageUrl: string | undefined): string | undefined => {
    if (!imageUrl) return undefined;
    if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
      return imageUrl;
    }
    
    // Normalize the path (remove leading slash if present)
    const normalizedPath = imageUrl.startsWith('/') ? imageUrl.slice(1) : imageUrl;
    
    // Use Cloudflare Image service for optimized delivery in emails
    // Set width to 100px for email images and quality to 80 for good balance
    return `https://beauteas-images.beauteas.com/cdn-cgi/image/width=100,quality=80,format=auto/${normalizedPath}`;
  };

  // Generate status-specific content
  let statusMessage = "";
  let statusColor = "#64748b";
  let statusContent = "";

  switch (orderData.status) {
    case 'processing':
      statusMessage = "Your order is being processed";
      statusColor = "#3b82f6";
      statusContent = `<p style="color: #64748b; font-size: 16px; line-height: 24px; margin: 0 0 16px;">We're preparing your gear for shipment. You'll receive another email with tracking information once your order ships.</p>`;
      break;

    case 'shipped':
      statusMessage = "Your order has shipped!";
      statusColor = "#10b981";
      statusContent = `
        <p style="color: #64748b; font-size: 16px; line-height: 24px; margin: 0 0 16px;">Great news! Your order is on its way to you.</p>
        ${orderData.carrier ? `
          <div style="background-color: #f1f5f9; border-radius: 8px; padding: 16px; margin: 16px 0;">
            <h3 style="color: #1e293b; font-size: 16px; font-weight: bold; margin: 0 0 8px;">Shipping Details</h3>
            <p style="color: #64748b; font-size: 14px; margin: 0 0 4px;"><strong>Carrier:</strong> ${orderData.carrier}</p>
            ${orderData.trackingNumber ? `<p style="color: #64748b; font-size: 14px; margin: 0 0 4px;"><strong>Tracking Number:</strong> ${orderData.trackingNumber}</p>` : ''}
            ${orderData.trackingUrl ? `
              <a href="${orderData.trackingUrl}" style="display: inline-block; background-color: #f97316; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; margin-top: 12px;">
                Track Your Package
              </a>
            ` : ''}
          </div>
        ` : ''}
      `;
      break;

    case 'delivered':
      statusMessage = "Your order has been delivered!";
      statusColor = "#059669";
      statusContent = `
        <p style="color: #64748b; font-size: 16px; line-height: 24px; margin: 0 0 16px;">Your order has been successfully delivered. We hope you love your new gear!</p>
        <p style="color: #64748b; font-size: 14px; line-height: 20px; margin: 0 0 16px;">If you have any issues with your order, please don't hesitate to contact our support team.</p>
      `;
      break;

    case 'cancelled':
      statusMessage = "Your order has been cancelled";
      statusColor = "#dc2626";
      statusContent = `
        <p style="color: #64748b; font-size: 16px; line-height: 24px; margin: 0 0 16px;">Your order has been cancelled as requested.</p>
        ${orderData.cancellationReason ? `
          <div style="background-color: #fef3f2; border-left: 4px solid #dc2626; padding: 12px 16px; margin: 16px 0;">
            <p style="color: #7f1d1d; font-size: 14px; margin: 0;"><strong>Reason:</strong> ${orderData.cancellationReason}</p>
          </div>
        ` : ''}
        <p style="color: #64748b; font-size: 14px; line-height: 20px; margin: 0 0 16px;">If you have any questions about this cancellation or need assistance with a new order, please contact our support team.</p>
      `;
      break;

    case 'refunded':
      statusMessage = "Your order has been refunded";
      statusColor = "#f97316";
      statusContent = `
        <p style="color: #64748b; font-size: 16px; line-height: 24px; margin: 0 0 16px;">Your order has been refunded and the payment has been processed back to your original payment method.</p>
        <div style="background-color: #fef3f2; border-left: 4px solid #f97316; padding: 12px 16px; margin: 16px 0;">
          <p style="color: #ea580c; font-size: 14px; margin: 0 0 4px;"><strong>Refund Processing:</strong></p>
          <p style="color: #7c2d12; font-size: 14px; margin: 0;">Please allow 5-10 business days for the refund to appear on your statement.</p>
        </div>
        <p style="color: #64748b; font-size: 14px; line-height: 20px; margin: 0 0 16px;">If you have any questions about this refund, please contact our support team.</p>
      `;
      break;

    default:
      statusMessage = "Order status updated";
      statusContent = `<p style="color: #64748b; font-size: 16px; line-height: 24px; margin: 0 0 16px;">Your order status has been updated.</p>`;
  }

  // Generate items HTML (simplified for status updates)
  const itemsHTML = orderData.items.slice(0, 3).map(item => {
    const absoluteImageUrl = getAbsoluteImageUrl(item.imageUrl);
    return `
    <tr style="border-bottom: 1px solid #e2e8f0;">
      <td style="padding: 8px 0; vertical-align: top; width: 50px;">
        ${absoluteImageUrl ? `<img src="${absoluteImageUrl}" alt="${item.name}" style="width: 40px; height: 40px; border-radius: 4px; object-fit: cover; display: block;">` : `<div style="width: 40px; height: 40px; background-color: #f1f5f9; border-radius: 4px; display: flex; align-items: center; justify-content: center; color: #64748b; font-size: 10px; text-align: center;">No Image</div>`}
      </td>
      <td style="padding: 8px 0 8px 12px; vertical-align: top;">
        <div style="color: #1e293b; font-size: 14px; font-weight: bold; margin: 0 0 2px;">${item.name}</div>
        <div style="color: #64748b; font-size: 12px; margin: 0;">Qty: ${item.quantity}</div>
      </td>
    </tr>
  `;
  }).join('');

  const hasMoreItems = orderData.items.length > 3;

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Order Update - BeauTeas</title>
    </head>
    <body style="margin: 0; padding: 0; background-color: #f6f9fc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Ubuntu, sans-serif;">
      <div style="background-color: #ffffff; margin: 0 auto; padding: 20px 0 48px; margin-bottom: 64px; max-width: 600px;">

        <!-- Header -->
        <div style="text-align: center; padding: 32px 0; border-bottom: 1px solid #e6ebf1;">
          <h1 style="color: #c4a87c; font-size: 32px; font-weight: bold; margin: 0; padding: 0;">BeauTeas</h1>
          <p style="color: #64748b; font-size: 14px; margin: 8px 0 0;">Organic Skincare Teas</p>
        </div>

        <!-- Status Update -->
        <div style="padding: 24px 32px;">
          <h2 style="color: ${statusColor}; font-size: 24px; font-weight: bold; margin: 0 0 16px;">${statusMessage}</h2>
          <p style="color: #64748b; font-size: 16px; line-height: 24px; margin: 0 0 16px;">Hi ${orderData.customerName},</p>
          
          ${statusContent}

          <div style="background-color: #f8fafc; border-radius: 8px; padding: 16px; margin: 16px 0;">
            <p style="color: #1e293b; font-size: 16px; font-weight: bold; margin: 0 0 8px;">Order #${orderData.orderNumber}</p>
            <p style="color: #64748b; font-size: 14px; margin: 0;">Status: <span style="color: ${statusColor}; font-weight: bold;">${orderData.status.charAt(0).toUpperCase() + orderData.status.slice(1)}</span></p>
          </div>
          
          ${orderData.notes ? `
            <div style="background-color: #f1f5f9; border-radius: 8px; padding: 12px; margin: 16px 0;">
              <p style="color: #64748b; font-size: 14px; margin: 0;"><strong>Note:</strong> ${orderData.notes}</p>
            </div>
          ` : ''}
        </div>

        <!-- Order Items (Preview) -->
        <div style="padding: 24px 32px;">
          <h3 style="color: #1e293b; font-size: 18px; font-weight: bold; margin: 0 0 12px;">Your Items</h3>
          <table style="width: 100%; border-collapse: collapse;">
            ${itemsHTML}
          </table>
          ${hasMoreItems ? `
            <p style="color: #64748b; font-size: 12px; margin: 8px 0 0; text-align: center;">
              and ${orderData.items.length - 3} more item${orderData.items.length - 3 > 1 ? 's' : ''}
            </p>
          ` : ''}
        </div>

        <!-- Shipping Address -->
        <div style="padding: 24px 32px;">
          <h3 style="color: #1e293b; font-size: 18px; font-weight: bold; margin: 0 0 12px;">Shipping Address</h3>
          <p style="color: #64748b; font-size: 14px; line-height: 20px; margin: 0;">
            ${orderData.shippingAddress.street}<br>
            ${orderData.shippingAddress.city}, ${orderData.shippingAddress.state} ${orderData.shippingAddress.zipCode}<br>
            ${orderData.shippingAddress.country}
          </p>
        </div>

        <!-- Footer -->
        <div style="text-align: center; padding: 32px 32px 0; border-top: 1px solid #e6ebf1;">
          <p style="color: #64748b; font-size: 12px; line-height: 16px; margin: 0 0 8px;">Questions about your order? Reply to this email or contact our support team.</p>
          <p style="color: #64748b; font-size: 12px; line-height: 16px; margin: 0 0 8px;">Thank you for choosing BeauTeas!</p>
        </div>

      </div>
    </body>
    </html>
  `;
}

export async function sendOrderStatusUpdateEmail(orderData: OrderStatusUpdateData): Promise<EmailResult> {
  try {
    const emailHtml = generateOrderStatusUpdateHTML(orderData);
    const resendClient = getResendClient();

    // Determine subject based on status
    let subject = `Order Update #${orderData.orderNumber}`;
    switch (orderData.status) {
      case 'shipped':
        subject = `Your Order Has Shipped! #${orderData.orderNumber}`;
        break;
      case 'delivered':
        subject = `Order Delivered #${orderData.orderNumber}`;
        break;
      case 'cancelled':
        subject = `Order Cancelled #${orderData.orderNumber}`;
        break;
      case 'processing':
        subject = `Order Processing #${orderData.orderNumber}`;
        break;
      case 'refunded':
        subject = `Order Refunded #${orderData.orderNumber}`;
        break;
    }

    const { data, error } = await resendClient.emails.send({
      from: 'BeauTeas<hello@beauteas.com>',
      to: [orderData.customerEmail],
      subject: `${subject} - BeauTeas`,
      html: emailHtml,
    });

    if (error) {
      console.error('Email sending error:', error);
      return { success: false, error: error.message || 'Email sending failed' };
    }

    console.log('Order status update email sent:', data?.id);
    return { success: true, id: data?.id };
  } catch (error) {
    console.error('Email sending failed:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

// ─── Subscription Lifecycle Emails ──────────────────────────────

const FREQUENCY_DISPLAY: Record<SubscriptionFrequency, string> = {
  biweekly: 'Every 2 Weeks',
  monthly: 'Monthly',
  bimonthly: 'Every 2 Months',
};

const SUBSCRIPTION_SUBJECTS: Record<string, string> = {
  created: 'Your Subscription is Active!',
  renewed: 'Subscription Renewed',
  payment_failed: 'Action Required: Payment Failed',
  paused: 'Subscription Paused',
  resumed: 'Subscription Resumed',
  canceled: 'Subscription Canceled',
};

export async function sendSubscriptionEmail(
  type: 'created' | 'renewed' | 'payment_failed' | 'paused' | 'resumed' | 'canceled',
  data: SubscriptionEmailData
): Promise<EmailResult> {
  try {
    const subject = `${SUBSCRIPTION_SUBJECTS[type]} - BeauTeas`;
    const emailHtml = generateSubscriptionEmailHTML(type, data);
    const resendClient = getResendClient();

    const { data: resendData, error } = await resendClient.emails.send({
      from: 'BeauTeas<hello@beauteas.com>',
      to: [data.customerEmail],
      subject,
      html: emailHtml,
    });

    if (error) {
      console.error('Subscription email sending error:', error);
      return { success: false, error: error.message || 'Email sending failed' };
    }

    console.log(`Subscription ${type} email sent:`, resendData?.id);
    return { success: true, id: resendData?.id };
  } catch (error) {
    console.error('Subscription email sending failed:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

function generateSubscriptionEmailHTML(
  type: 'created' | 'renewed' | 'payment_failed' | 'paused' | 'resumed' | 'canceled',
  data: SubscriptionEmailData
): string {
  const frequencyLabel = FREQUENCY_DISPLAY[data.frequency];
  const typeMessages = getTypeSpecificContent(type, data);

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${SUBSCRIPTION_SUBJECTS[type]} - BeauTeas</title>
    </head>
    <body style="margin: 0; padding: 0; background-color: #f6f9fc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Ubuntu, sans-serif;">
      <div style="background-color: #ffffff; margin: 0 auto; padding: 20px 0 48px; margin-bottom: 64px; max-width: 600px;">

        <!-- Header -->
        <div style="text-align: center; padding: 32px 0; border-bottom: 1px solid #e6ebf1;">
          <h1 style="color: #c4a87c; font-size: 32px; font-weight: bold; margin: 0; padding: 0;">BeauTeas</h1>
          <p style="color: #64748b; font-size: 14px; margin: 8px 0 0;">Organic Skincare Teas</p>
        </div>

        <!-- Content -->
        <div style="padding: 24px 32px;">
          <h2 style="color: #1e293b; font-size: 24px; font-weight: bold; margin: 0 0 16px;">${SUBSCRIPTION_SUBJECTS[type]}</h2>
          <p style="color: #64748b; font-size: 16px; line-height: 24px; margin: 0 0 16px;">Hi ${data.customerName},</p>
          <p style="color: #64748b; font-size: 16px; line-height: 24px; margin: 0 0 16px;">${typeMessages.body}</p>

          ${typeMessages.extra}

          <!-- Subscription Details -->
          <div style="background-color: #f8fafc; border-radius: 8px; padding: 16px; margin: 24px 0;">
            <h3 style="color: #1e293b; font-size: 16px; font-weight: bold; margin: 0 0 12px;">Subscription Details</h3>
            <table style="width: 100%;">
              <tr>
                <td style="color: #64748b; font-size: 14px; padding: 4px 0;">Product:</td>
                <td style="color: #1e293b; font-size: 14px; text-align: right; padding: 4px 0;">${data.productName}</td>
              </tr>
              <tr>
                <td style="color: #64748b; font-size: 14px; padding: 4px 0;">Frequency:</td>
                <td style="color: #1e293b; font-size: 14px; text-align: right; padding: 4px 0;">${frequencyLabel}</td>
              </tr>
              <tr>
                <td style="color: #64748b; font-size: 14px; padding: 4px 0;">Subscription ID:</td>
                <td style="color: #1e293b; font-size: 14px; text-align: right; padding: 4px 0;">${data.subscriptionId}</td>
              </tr>
              ${data.nextBillingDate ? `
              <tr>
                <td style="color: #64748b; font-size: 14px; padding: 4px 0;">Next Billing Date:</td>
                <td style="color: #1e293b; font-size: 14px; text-align: right; padding: 4px 0;">${data.nextBillingDate}</td>
              </tr>` : ''}
              ${data.amount !== undefined ? `
              <tr>
                <td style="color: #64748b; font-size: 14px; padding: 4px 0;">Amount:</td>
                <td style="color: #1e293b; font-size: 14px; text-align: right; padding: 4px 0;">$${(data.amount / 100).toFixed(2)}</td>
              </tr>` : ''}
            </table>
          </div>

          <!-- Manage Subscription Button -->
          <div style="text-align: center; margin: 24px 0;">
            <a href="${data.manageUrl}" style="display: inline-block; background-color: #c4a87c; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 16px;">
              Manage Subscription
            </a>
          </div>
        </div>

        <!-- Footer -->
        <div style="text-align: center; padding: 32px 32px 0; border-top: 1px solid #e6ebf1;">
          <p style="color: #64748b; font-size: 12px; line-height: 16px; margin: 0 0 8px;">Questions about your subscription? Reply to this email or contact our support team.</p>
          <p style="color: #64748b; font-size: 12px; line-height: 16px; margin: 0 0 8px;">Thank you for choosing BeauTeas!</p>
        </div>

      </div>
    </body>
    </html>
  `;
}

function getTypeSpecificContent(
  type: 'created' | 'renewed' | 'payment_failed' | 'paused' | 'resumed' | 'canceled',
  data: SubscriptionEmailData
): { body: string; extra: string } {
  switch (type) {
    case 'created':
      return {
        body: 'Your subscription has been activated! We will automatically prepare and ship your order according to your selected schedule.',
        extra: '',
      };
    case 'renewed':
      return {
        body: 'Your subscription has been renewed and your next order is being prepared.',
        extra: '',
      };
    case 'payment_failed':
      return {
        body: 'We were unable to process the payment for your subscription. Please update your payment method to keep your subscription active.',
        extra: `
          <div style="background-color: #fef3f2; border-left: 4px solid #dc2626; border-radius: 4px; padding: 12px 16px; margin: 16px 0;">
            <p style="color: #7f1d1d; font-size: 14px; margin: 0 0 4px;"><strong>Reason:</strong> ${data.failureReason || 'Unknown error'}</p>
            ${data.nextRetryDate ? `<p style="color: #7f1d1d; font-size: 14px; margin: 0;"><strong>Next retry:</strong> ${data.nextRetryDate}</p>` : ''}
          </div>
          <div style="text-align: center; margin: 16px 0;">
            <a href="${data.manageUrl}" style="display: inline-block; background-color: #dc2626; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 16px;">
              Update Payment Method
            </a>
          </div>
        `,
      };
    case 'paused':
      return {
        body: 'Your subscription has been paused. You will not be charged until you resume it. You can resume your subscription at any time from your account.',
        extra: '',
      };
    case 'resumed':
      return {
        body: 'Your subscription has been resumed! Your next order will be processed according to your regular schedule.',
        extra: '',
      };
    case 'canceled':
      return {
        body: 'Your subscription has been canceled. We are sorry to see you go! If you change your mind, you can start a new subscription at any time.',
        extra: '',
      };
  }
}
