import { Resend } from 'resend';
import { brand } from '@/lib/brand.config';
import { BASE_URL } from '@/lib/seo/metadata';
import type { SubscriptionEmailData, SubscriptionFrequency } from '@/lib/types/subscription';
import { postalAddressHtml } from '@/lib/utils/email-footer';
import { Money } from '@/lib/money';
import { CARRIER_LABELS, type Carrier } from '@/lib/fulfillment/types';

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
  // BMC-143/BMC-164: money fields are pre-formatted display strings (via
  // Money.format(), see lib/utils/order-email-totals.ts), never raw numbers —
  // that ambiguity (minor units rendered with .toFixed(2) as if they were
  // dollars) previously inflated the total 100x in this email.
  items: Array<{
    productId: string;
    name: string;
    /** Formatted unit price, e.g. "$12.50". */
    price: string;
    /** Formatted line total (unit price x quantity), e.g. "$25.00". */
    lineTotal: string;
    quantity: number;
    imageUrl?: string;
  }>;
  subtotal: string;
  shipping: string;
  tax: string;
  /** PRE-gift-card order total (matches the persisted order total_amount). */
  total: string;
  /** Gift-card amount tendered against this order, if any (formatted). */
  giftCard?: string;
  /** Post-gift-card amount actually charged, if a gift card was applied (formatted). */
  amountCharged?: string;
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
  /**
   * @deprecated BMC-216F: no longer rendered — the template does not emit stored
   * tracking URLs. Kept only because the refund route still populates it.
   */
  trackingUrl?: string;
  notes?: string;
  cancellationReason?: string;
  /**
   * Pre-formatted refund amount (e.g. "$12.50", via Money.format()) shown in the
   * `refunded` status email. Set by the refund route for both full and partial
   * refunds. Formatted string, never a raw number (same BMC-143 contract as OrderData).
   */
  refundAmount?: string;
  /**
   * True when a full refund also cancelled the order (order status → 'cancelled'),
   * so the `refunded` email can add a "will not be shipped" line. Omitted/false for
   * a partial refund, which leaves the order active and shippable.
   */
  orderCancelled?: boolean;
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
      from: `${brand.name} <${brand.contact.email}>`,
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
    return `https://img.beauteas.com/cdn-cgi/image/width=100,quality=80,format=auto/${normalizedPath}`;
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
        <div style="color: #64748b; font-size: 14px; margin: 0;">Quantity: ${item.quantity} × ${item.price}</div>
      </td>
      <td style="padding: 12px 0; text-align: right; vertical-align: top;">
        <div style="color: #1e293b; font-size: 16px; font-weight: bold; margin: 0;">${item.lineTotal}</div>
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
          <p style="color: #64748b; font-size: 16px; line-height: 24px; margin: 0 0 16px;">Thank you for your order! Your teas are being prepared and will be shipped soon.</p>
          
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
              <td style="text-align: right; color: #1e293b; font-size: 14px;">${orderData.subtotal}</td>
            </tr>
            <tr style="padding: 4px 0;">
              <td style="color: #64748b; font-size: 14px;">Shipping:</td>
              <td style="text-align: right; color: #1e293b; font-size: 14px;">${orderData.shipping}</td>
            </tr>
            <tr style="padding: 4px 0;">
              <td style="color: #64748b; font-size: 14px;">Tax:</td>
              <td style="text-align: right; color: #1e293b; font-size: 14px;">${orderData.tax}</td>
            </tr>
            <tr style="border-top: 2px solid #e2e8f0; padding: 12px 0 0; margin: 12px 0 0;">
              <td style="color: #1e293b; font-size: 16px; font-weight: bold; padding-top: 12px;">Total:</td>
              <td style="text-align: right; color: #cf8577; font-size: 18px; font-weight: bold; padding-top: 12px;">${orderData.total}</td>
            </tr>
            ${orderData.giftCard ? `
            <tr style="padding: 4px 0;">
              <td style="color: #64748b; font-size: 14px;">Gift card:</td>
              <td style="text-align: right; color: #1e293b; font-size: 14px;">-${orderData.giftCard}</td>
            </tr>
            <tr style="border-top: 2px solid #e2e8f0; padding: 12px 0 0; margin: 12px 0 0;">
              <td style="color: #1e293b; font-size: 16px; font-weight: bold; padding-top: 12px;">Amount charged:</td>
              <td style="text-align: right; color: #cf8577; font-size: 18px; font-weight: bold; padding-top: 12px;">${orderData.amountCharged}</td>
            </tr>
            ` : ''}
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
          ${postalAddressHtml('light')}
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
    return `https://img.beauteas.com/cdn-cgi/image/width=100,quality=80,format=auto/${normalizedPath}`;
  };

  // Generate status-specific content
  let statusMessage = "";
  let statusColor = "#64748b";
  let statusContent = "";

  switch (orderData.status) {
    case 'processing':
      statusMessage = "Your order is being processed";
      statusColor = "#3b82f6";
      statusContent = `<p style="color: #64748b; font-size: 16px; line-height: 24px; margin: 0 0 16px;">We're preparing your teas for shipment. You'll receive another email with tracking information once your order ships.</p>`;
      break;

    case 'shipped':
      statusMessage = "Your order has shipped!";
      statusColor = "#10b981";
      statusContent = `
        <p style="color: #64748b; font-size: 16px; line-height: 24px; margin: 0 0 16px;">Great news! Your order is on its way to you.</p>
        ${orderData.carrier ? `
          <div style="background-color: #f1f5f9; border-radius: 8px; padding: 16px; margin: 16px 0;">
            <h3 style="color: #1e293b; font-size: 16px; font-weight: bold; margin: 0 0 8px;">Shipping Details</h3>
            <p style="color: #64748b; font-size: 14px; margin: 0 0 4px;"><strong>Carrier:</strong> ${escapeHtml(orderData.carrier)}</p>
            ${orderData.trackingNumber ? `<p style="color: #64748b; font-size: 14px; margin: 0 0 4px;"><strong>Tracking Number:</strong> ${escapeHtml(orderData.trackingNumber)}</p>` : ''}
          </div>
        ` : ''}
      `;
      break;

    case 'delivered':
      statusMessage = "Your order has been delivered!";
      statusColor = "#059669";
      statusContent = `
        <p style="color: #64748b; font-size: 16px; line-height: 24px; margin: 0 0 16px;">Your order has been successfully delivered. We hope you love your new teas!</p>
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
            <p style="color: #7f1d1d; font-size: 14px; margin: 0;"><strong>Reason:</strong> ${escapeHtml(orderData.cancellationReason)}</p>
          </div>
        ` : ''}
        <p style="color: #64748b; font-size: 14px; line-height: 20px; margin: 0 0 16px;">If you have any questions about this cancellation or need assistance with a new order, please contact our support team.</p>
      `;
      break;

    case 'refunded':
      statusMessage = "Your order has been refunded";
      statusColor = "#cf8577";
      statusContent = `
        <p style="color: #64748b; font-size: 16px; line-height: 24px; margin: 0 0 16px;">Your order has been refunded and the payment has been processed back to your original payment method.</p>
        ${orderData.orderCancelled ? `<p style="color: #64748b; font-size: 16px; line-height: 24px; margin: 0 0 16px;">Your order has been cancelled and will not be shipped.</p>` : ''}
        <div style="background-color: #fef3f2; border-left: 4px solid #cf8577; padding: 12px 16px; margin: 16px 0;">
          ${orderData.refundAmount ? `<p style="color: #7c2d12; font-size: 14px; margin: 0 0 8px;"><strong>Refund amount:</strong> ${escapeHtml(orderData.refundAmount)}</p>` : ''}
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
        ${absoluteImageUrl ? `<img src="${escapeHtml(absoluteImageUrl)}" alt="${escapeHtml(item.name)}" style="width: 40px; height: 40px; border-radius: 4px; object-fit: cover; display: block;">` : `<div style="width: 40px; height: 40px; background-color: #f1f5f9; border-radius: 4px; display: flex; align-items: center; justify-content: center; color: #64748b; font-size: 10px; text-align: center;">No Image</div>`}
      </td>
      <td style="padding: 8px 0 8px 12px; vertical-align: top;">
        <div style="color: #1e293b; font-size: 14px; font-weight: bold; margin: 0 0 2px;">${escapeHtml(item.name)}</div>
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
          <p style="color: #64748b; font-size: 16px; line-height: 24px; margin: 0 0 16px;">Hi ${escapeHtml(orderData.customerName)},</p>
          
          ${statusContent}

          <div style="background-color: #f8fafc; border-radius: 8px; padding: 16px; margin: 16px 0;">
            <p style="color: #1e293b; font-size: 16px; font-weight: bold; margin: 0 0 8px;">Order #${escapeHtml(orderData.orderNumber)}</p>
            <p style="color: #64748b; font-size: 14px; margin: 0;">Status: <span style="color: ${statusColor}; font-weight: bold;">${escapeHtml(orderData.status.charAt(0).toUpperCase() + orderData.status.slice(1))}</span></p>
          </div>

          ${orderData.notes ? `
            <div style="background-color: #f1f5f9; border-radius: 8px; padding: 12px; margin: 16px 0;">
              <p style="color: #64748b; font-size: 14px; margin: 0;"><strong>Note:</strong> ${escapeHtml(orderData.notes)}</p>
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
            ${escapeHtml(orderData.shippingAddress.street)}<br>
            ${escapeHtml(orderData.shippingAddress.city)}, ${escapeHtml(orderData.shippingAddress.state)} ${escapeHtml(orderData.shippingAddress.zipCode)}<br>
            ${escapeHtml(orderData.shippingAddress.country)}
          </p>
        </div>

        <!-- Footer -->
        <div style="text-align: center; padding: 32px 32px 0; border-top: 1px solid #e6ebf1;">
          <p style="color: #64748b; font-size: 12px; line-height: 16px; margin: 0 0 8px;">Questions about your order? Reply to this email or contact our support team.</p>
          <p style="color: #64748b; font-size: 12px; line-height: 16px; margin: 0 0 8px;">Thank you for choosing BeauTeas!</p>
          ${postalAddressHtml('light')}
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
      from: `${brand.name} <${brand.contact.email}>`,
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

// ─── Gift Card Delivery Email ───────────────────────────────────

export interface GiftCardEmailData {
  recipientEmail: string;
  recipientName?: string;
  purchaserName?: string;
  code: string;
  amount: number; // cents
  currency?: string;
  giftMessage?: string;
  redeemUrl?: string;
}

export async function sendGiftCardDeliveryEmail(
  data: GiftCardEmailData
): Promise<EmailResult> {
  try {
    const emailHtml = generateGiftCardDeliveryHTML(data);
    const resendClient = getResendClient();

    const { data: resendData, error } = await resendClient.emails.send({
      from: `${brand.name} <${brand.contact.email}>`,
      to: [data.recipientEmail],
      subject: `You've received a BeauTeas gift card`,
      html: emailHtml,
    });

    if (error) {
      console.error('Gift card email sending error:', error);
      return { success: false, error: error.message || 'Email sending failed' };
    }

    console.log('Gift card delivery email sent:', resendData?.id);
    return { success: true, id: resendData?.id };
  } catch (error) {
    console.error('Gift card email sending failed:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

// Escape user-controlled values before embedding them in email HTML.
function escapeHtml(value = ''): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function generateGiftCardDeliveryHTML(data: GiftCardEmailData): string {
  const recipient = escapeHtml(data.recipientName?.trim() || 'there');
  const purchaser = data.purchaserName?.trim() ? escapeHtml(data.purchaserName.trim()) : '';
  const fromLine = purchaser
    ? `${purchaser} has sent you a BeauTeas gift card.`
    : `Someone special has sent you a BeauTeas gift card.`;
  const giftMessage = data.giftMessage ? escapeHtml(data.giftMessage) : '';
  const code = escapeHtml(data.code);
  const amountDisplay = Money.fromMinor(data.amount, data.currency || 'USD').format();
  // Only allow an absolute https URL; otherwise fall back to the brand origin.
  const redeemUrl =
    data.redeemUrl && /^https:\/\//i.test(data.redeemUrl) ? data.redeemUrl : BASE_URL;

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Your BeauTeas Gift Card</title>
    </head>
    <body style="margin: 0; padding: 0; background-color: #f6f9fc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Ubuntu, sans-serif;">
      <div style="background-color: #ffffff; margin: 0 auto; padding: 20px 0 48px; margin-bottom: 64px; max-width: 600px;">

        <!-- Header -->
        <div style="text-align: center; padding: 32px 0; border-bottom: 1px solid #e6ebf1;">
          <h1 style="color: #c4a87c; font-size: 32px; font-weight: bold; margin: 0; padding: 0;">BeauTeas</h1>
          <p style="color: #64748b; font-size: 14px; margin: 8px 0 0;">Organic Skincare Teas</p>
        </div>

        <!-- Intro -->
        <div style="padding: 24px 32px;">
          <h2 style="color: #1e293b; font-size: 24px; font-weight: bold; margin: 0 0 16px;">A little glow, just for you 🎁</h2>
          <p style="color: #64748b; font-size: 16px; line-height: 24px; margin: 0 0 16px;">Hi ${recipient},</p>
          <p style="color: #64748b; font-size: 16px; line-height: 24px; margin: 0 0 16px;">${fromLine} Build your beauty from within — redeem it at checkout for any of our organic skincare teas.</p>
        </div>

        ${
          giftMessage
            ? `<div style="background-color: #fdf8f6; border-left: 4px solid #c4a87c; border-radius: 4px; padding: 16px; margin: 0 32px 24px;">
                 <p style="color: #555555; font-size: 15px; font-style: italic; line-height: 22px; margin: 0;">&ldquo;${giftMessage}&rdquo;</p>
               </div>`
            : ''
        }

        <!-- Gift Card -->
        <div style="margin: 0 32px 24px; background: linear-gradient(135deg, #fdf8f6 0%, #f3e6dd 100%); border-radius: 12px; padding: 28px; text-align: center;">
          <p style="color: #64748b; font-size: 13px; letter-spacing: 1px; text-transform: uppercase; margin: 0 0 8px;">Gift Card Value</p>
          <p style="color: #c4a87c; font-size: 40px; font-weight: bold; margin: 0 0 16px;">${amountDisplay}</p>
          <p style="color: #64748b; font-size: 13px; margin: 0 0 6px;">Your code</p>
          <p style="color: #1e293b; font-size: 22px; font-weight: bold; letter-spacing: 2px; margin: 0; font-family: 'Courier New', monospace;">${code}</p>
        </div>

        <!-- CTA -->
        <div style="text-align: center; margin: 0 0 24px;">
          <a href="${redeemUrl}" style="display: inline-block; background-color: #c4a87c; color: #ffffff; padding: 12px 28px; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 16px;">
            Shop &amp; Redeem
          </a>
        </div>

        <!-- How to redeem -->
        <div style="padding: 0 32px 8px;">
          <p style="color: #64748b; font-size: 14px; line-height: 20px; margin: 0;">To redeem, add your favorites to the cart and enter the code above in the gift card field at checkout. Any remaining balance stays on your card for next time.</p>
        </div>

        <!-- Footer -->
        <div style="text-align: center; padding: 32px 32px 0; border-top: 1px solid #e6ebf1; margin-top: 24px;">
          <p style="color: #64748b; font-size: 12px; line-height: 16px; margin: 0 0 8px;">Questions? Reply to this email or contact our support team.</p>
          <p style="color: #64748b; font-size: 12px; line-height: 16px; margin: 0 0 8px;">Thank you for choosing BeauTeas!</p>
          ${postalAddressHtml('light')}
        </div>

      </div>
    </body>
    </html>
  `;
}

// ─── Shipping Confirmation Email (BMC-216C) ─────────────────────

/**
 * Payload for the dedicated shipment-confirmation email.
 *
 * Deliberately narrow: order number, recipient, a SHORT item preview, and the
 * two links a customer can act on. No internal notes, payment references,
 * audit events, delivery estimates, or live carrier state — a shipping email
 * is a customer-facing receipt of "it left the building", not an order dump.
 *
 * `trackingUrl` is DERIVED at the boundary via buildTrackingUrl(); it is never
 * read from storage, so a stale admin form cannot persist an arbitrary
 * customer-facing URL. `orderStatusUrl` is the account link for a registered
 * customer or a signed guest link otherwise; `null` omits the button entirely.
 */
export interface ShippingConfirmationData {
  orderNumber: string;
  customerName: string | null;
  customerEmail: string;
  /** Short preview only — the template renders at most MAX_SHIPPING_PREVIEW_ITEMS. */
  items: Array<{ name: string; quantity: number }>;
  carrier: Carrier | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  orderStatusUrl: string | null;
}

/**
 * Typed send result. Callers MUST inspect `success` — a resolved promise is
 * not proof of delivery (Resend reports failures in the response body).
 */
export interface ShippingEmailResult {
  success: boolean;
  error?: string;
}

/** The email is a preview, not a packing slip. */
const MAX_SHIPPING_PREVIEW_ITEMS = 5;

/**
 * Send the shipment-confirmation email.
 *
 * `opts.idempotencyKey` is forwarded to Resend as the `Idempotency-Key`
 * header (resend 4.8.0 `emails.send(payload, options)`), so a retry of the
 * SAME attempt cannot double-send within the provider's 24h retention window.
 * Keys are built by the caller:
 *   shipping-confirmation/<order-id>/initial/<payload-digest>
 *   shipping-confirmation/<order-id>/resend/<event-id>
 */
export async function sendShippingConfirmationEmail(
  data: ShippingConfirmationData,
  opts: { idempotencyKey: string }
): Promise<ShippingEmailResult> {
  try {
    const emailHtml = generateShippingConfirmationHTML(data);
    const resendClient = getResendClient();

    const { data: resendData, error } = await resendClient.emails.send(
      {
        from: `${brand.name} <${brand.contact.email}>`,
        to: [data.customerEmail],
        subject: `Your order has shipped! #${data.orderNumber} - BeauTeas`,
        html: emailHtml,
      },
      { idempotencyKey: opts.idempotencyKey }
    );

    if (error) {
      console.error('[shipping-email] send failed:', error);
      return { success: false, error: error.message || 'Email sending failed' };
    }

    console.log('[shipping-email] sent:', resendData?.id);
    return { success: true };
  } catch (error) {
    console.error('[shipping-email] threw:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

function generateShippingConfirmationHTML(data: ShippingConfirmationData): string {
  // EVERY interpolation below is escaped, including values from fixed unions:
  // one unescaped hole is all it takes, and "this one is safe today" is how
  // they get reintroduced.
  const greeting = escapeHtml(data.customerName?.trim() || 'there');
  const orderNumber = escapeHtml(data.orderNumber);
  // CARRIER_LABELS is the A-owned registry in lib/fulfillment/types.ts (keyed by
  // Carrier, so adding a code fails the build there until a label exists). A
  // local copy here would be a sixth place that has to agree — and would have
  // silently dropped "usps".
  const carrierLabel = data.carrier ? escapeHtml(CARRIER_LABELS[data.carrier]) : '';
  const trackingNumber = data.trackingNumber ? escapeHtml(data.trackingNumber) : '';

  const itemRows = data.items
    .slice(0, MAX_SHIPPING_PREVIEW_ITEMS)
    .map(
      (item) => `<tr>
              <td style="padding: 6px 0; border-bottom: 1px solid #e6ebf1; color: #1e293b; font-size: 15px;"><strong>${escapeHtml(String(item.quantity))} &times;</strong> ${escapeHtml(item.name)}</td>
            </tr>`
    )
    .join('');

  const itemsBlock = itemRows
    ? `<div style="padding: 0 32px 8px;">
          <h3 style="color: #1e293b; font-size: 16px; font-weight: bold; margin: 0 0 8px;">In this shipment</h3>
          <table style="border-collapse: collapse; width: 100%; margin: 0 0 8px;">
            ${itemRows}
          </table>
        </div>`
    : '';

  // Rendered only when there is a tracking number — an untracked shipment must
  // not ship an empty "Tracking:" panel.
  const trackingBlock = trackingNumber
    ? `<div style="margin: 0 32px 24px; background: linear-gradient(135deg, #fdf8f6 0%, #f3e6dd 100%); border-radius: 12px; padding: 24px; text-align: center;">
          <p style="color: #64748b; font-size: 13px; letter-spacing: 1px; text-transform: uppercase; margin: 0 0 8px;">${carrierLabel || 'Shipment'}</p>
          <p style="color: #1e293b; font-size: 20px; font-weight: bold; letter-spacing: 1px; margin: 0; font-family: 'Courier New', monospace;">${trackingNumber}</p>
        </div>`
    : '';

  // Carrier button only when a carrier-owned URL exists (UPS/FedEx/USPS).
  // Never a search-engine fallback, and never for `other`.
  const trackingButton = data.trackingUrl
    ? `<div style="text-align: center; margin: 0 0 16px;">
          <a href="${escapeHtml(data.trackingUrl)}" style="display: inline-block; background-color: #c4a87c; color: #ffffff; padding: 12px 28px; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 16px;">Track with ${carrierLabel}</a>
        </div>`
    : '';

  const statusButton = data.orderStatusUrl
    ? `<div style="text-align: center; margin: 0 0 24px;">
          <a href="${escapeHtml(data.orderStatusUrl)}" style="display: inline-block; border: 1px solid #c4a87c; color: #c4a87c; padding: 12px 28px; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 16px;">View your order</a>
        </div>`
    : '';

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Your order has shipped - BeauTeas</title>
    </head>
    <body style="margin: 0; padding: 0; background-color: #f6f9fc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Ubuntu, sans-serif;">
      <div style="background-color: #ffffff; margin: 0 auto; padding: 20px 0 48px; margin-bottom: 64px; max-width: 600px;">

        <!-- Header -->
        <div style="text-align: center; padding: 32px 0; border-bottom: 1px solid #e6ebf1;">
          <h1 style="color: #c4a87c; font-size: 32px; font-weight: bold; margin: 0; padding: 0;">BeauTeas</h1>
          <p style="color: #64748b; font-size: 14px; margin: 8px 0 0;">Organic Skincare Teas</p>
        </div>

        <!-- Intro -->
        <div style="padding: 24px 32px;">
          <h2 style="color: #1e293b; font-size: 24px; font-weight: bold; margin: 0 0 16px;">Your order has shipped</h2>
          <p style="color: #64748b; font-size: 16px; line-height: 24px; margin: 0 0 16px;">Hi ${greeting},</p>
          <p style="color: #64748b; font-size: 16px; line-height: 24px; margin: 0 0 8px;">Good news — order <strong>#${orderNumber}</strong> is on its way to you. Your daily glow ritual is nearly home.</p>
        </div>

        ${trackingBlock}

        ${trackingButton}

        ${statusButton}

        ${itemsBlock}

        <!-- Footer -->
        <div style="text-align: center; padding: 32px 32px 0; border-top: 1px solid #e6ebf1; margin-top: 24px;">
          <p style="color: #64748b; font-size: 12px; line-height: 16px; margin: 0 0 8px;">Questions about your delivery? Reply to this email and we will help.</p>
          <p style="color: #64748b; font-size: 12px; line-height: 16px; margin: 0 0 8px;">Thank you for choosing BeauTeas!</p>
          ${postalAddressHtml('light')}
        </div>

      </div>
    </body>
    </html>
  `;
}

// ─── Subscription Lifecycle Emails ──────────────────────────────

const FREQUENCY_DISPLAY: Record<SubscriptionFrequency, string> = {
  biweekly: 'Every 2 Weeks',
  monthly: 'Monthly',
  bimonthly: 'Every 2 Months',
};

// Lower-case cadence phrase for inline sentences, e.g. "billed $X every 2 weeks".
const FREQUENCY_CADENCE: Record<SubscriptionFrequency, string> = {
  biweekly: 'every 2 weeks',
  monthly: 'every month',
  bimonthly: 'every 2 months',
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
      from: `${brand.name} <${brand.contact.email}>`,
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
                <td style="color: #1e293b; font-size: 14px; text-align: right; padding: 4px 0;">${Money.fromMinor(data.amount, 'USD').format()}</td>
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
          ${postalAddressHtml('light')}
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
    case 'created': {
      // Restate the recurring terms + surface the cancel path in the
      // post-purchase acknowledgment (several state automatic-renewal laws
      // require this in the confirmation itself, BMC-186).
      const amountText =
        data.amount !== undefined ? Money.fromMinor(data.amount, 'USD').format() : 'the subscription price';
      const cadence = FREQUENCY_CADENCE[data.frequency];
      const nextChargeLine = data.nextBillingDate
        ? ` Your first renewal charge is on ${data.nextBillingDate}.`
        : '';
      return {
        body: 'Your subscription has been activated! We will automatically prepare and ship your order according to your selected schedule.',
        extra: `
          <div style="background-color: #fdf8f6; border-left: 4px solid #c4a87c; border-radius: 4px; padding: 12px 16px; margin: 16px 0;">
            <p style="color: #7c2d12; font-size: 14px; line-height: 20px; margin: 0 0 8px;"><strong>Recurring billing:</strong> You'll be charged ${amountText} ${cadence}, automatically, until you cancel.${nextChargeLine}</p>
            <p style="color: #7c2d12; font-size: 14px; line-height: 20px; margin: 0;">You can cancel anytime — no fees, no commitment — from your <a href="${escapeHtml(data.manageUrl)}" style="color: #c4a87c; font-weight: bold;">subscription management page</a>.</p>
          </div>
        `,
      };
    }
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

// ─── Merchant new-order notification (stopgap for BMC-216) ──────────────────

/**
 * Recipient for internal new-order notifications. Overridable per environment
 * so a staging host can notify a test inbox instead of the real one.
 */
const MERCHANT_NOTIFICATION_EMAIL =
  process.env.MERCHANT_NOTIFICATION_EMAIL || brand.contact.email;

/**
 * Notify the shop owner that an order needs fulfilling.
 *
 * WHY THIS EXISTS: BeauTeas has no fulfillment flow (BMC-216). Before this, the
 * only signal that an order had arrived was Stripe's payment email — which says
 * money moved, but not what to ship or where. Confirmed missing against the
 * first live production order on 2026-07-27.
 *
 * Deliberately minimal: everything needed to pick, pack and ship, in plain
 * text, plus a link into the admin order view. It is a stopgap, NOT a
 * fulfillment feature — the real flow is scoped in BMC-216.
 *
 * Reuses the {@link OrderData} already assembled for the customer confirmation,
 * so it adds one email send and no extra database reads.
 *
 * Best-effort by contract: returns a result and never throws, so it can never
 * break order finalization or the customer's confirmation email.
 */
export async function sendNewOrderMerchantNotification(
  orderData: OrderData
): Promise<EmailResult> {
  try {
    const addr = orderData.shippingAddress;
    const shipTo = [
      orderData.customerName,
      addr?.street,
      [addr?.city, addr?.state, addr?.zipCode].filter(Boolean).join(', '),
      addr?.country,
    ]
      .filter(Boolean)
      .join('\n');

    const lines = orderData.items
      .map((i) => `  ${i.quantity} x ${i.name} — ${i.lineTotal}`)
      .join('\n');

    // Deep-link to the specific order (BMC-216C). The per-order admin page is
    // app/admin/orders/[id], keyed by the same value carried as orderNumber.
    // encodeURIComponent so an order id with URL-significant characters cannot
    // break out of the path segment.
    const adminUrl = `${BASE_URL}/admin/orders/${encodeURIComponent(orderData.orderNumber)}`;

    const text = [
      `New order ${orderData.orderNumber}`,
      '',
      'ITEMS TO SHIP',
      lines,
      '',
      `Subtotal: ${orderData.subtotal}`,
      `Shipping: ${orderData.shipping}`,
      `Tax:      ${orderData.tax}`,
      `TOTAL:    ${orderData.total}`,
      '',
      'SHIP TO',
      shipTo,
      '',
      `Customer email: ${orderData.customerEmail}`,
      '',
      `Manage this order: ${adminUrl}`,
    ].join('\n');

    const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px">
      <h2 style="margin:0 0 4px">New order ${escapeHtml(orderData.orderNumber)}</h2>
      <p style="color:#64748b;margin:0 0 20px">${escapeHtml(orderData.total)} · ${escapeHtml(orderData.customerEmail)}</p>
      <h3 style="margin:0 0 8px;font-size:15px">Items to ship</h3>
      <table style="border-collapse:collapse;width:100%;margin-bottom:20px">
        ${orderData.items
          .map(
            (i) => `<tr>
              <td style="padding:6px 0;border-bottom:1px solid #e2e8f0"><strong>${i.quantity} &times;</strong> ${escapeHtml(i.name)}</td>
              <td style="padding:6px 0;border-bottom:1px solid #e2e8f0;text-align:right">${escapeHtml(i.lineTotal)}</td>
            </tr>`
          )
          .join('')}
      </table>
      <h3 style="margin:0 0 8px;font-size:15px">Ship to</h3>
      <p style="margin:0 0 20px;line-height:1.5">${escapeHtml(shipTo).replace(/\n/g, '<br>')}</p>
      <p style="margin:0 0 20px">
        Subtotal ${escapeHtml(orderData.subtotal)} &middot;
        Shipping ${escapeHtml(orderData.shipping)} &middot;
        Tax ${escapeHtml(orderData.tax)} &middot;
        <strong>Total ${escapeHtml(orderData.total)}</strong>
      </p>
      <p><a href="${escapeHtml(adminUrl)}" style="display:inline-block;padding:10px 18px;background:#c4a87c;color:#fff;border-radius:6px;text-decoration:none">Manage this order</a></p>
    </div>`;

    const resendClient = getResendClient();
    const { data, error } = await resendClient.emails.send({
      from: `${brand.name} Orders <${brand.contact.email}>`,
      to: [MERCHANT_NOTIFICATION_EMAIL],
      replyTo: orderData.customerEmail,
      subject: `New order ${orderData.orderNumber} — ${orderData.total}`,
      html,
      text,
    });

    if (error) {
      console.error('[merchant-notification] send failed:', error);
      return { success: false, error: error.message || 'Merchant notification failed' };
    }
    return { success: true, id: data?.id };
  } catch (error) {
    console.error('[merchant-notification] threw:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}
