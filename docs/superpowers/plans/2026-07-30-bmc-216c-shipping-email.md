# BMC-216C: Shipping Email and Retry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send exactly one automatic, fully-escaped shipping-confirmation email when an order ships, record its success or failure in the fulfillment audit trail, and expose an admin retry/resend endpoint whose idempotency keys make a retry and an intentional resend distinguishable.

**Architecture:** A dedicated `sendShippingConfirmationEmail` transformer + template lands in `lib/utils/email.ts` (same escaping/sender conventions as the existing templates, plus Resend's `idempotencyKey` request option). `lib/fulfillment/shipping-email.ts` — created as a stub by ticket B — gets its real body: it builds `ShippingConfirmationData` from the order (customer email via `getOrderCustomerEmail`, tracking link via `buildTrackingUrl`, status link via the account route or a signed guest token), sends with the deterministic `initial` key, and records a `shipping_email_sent`/`shipping_email_failed` event via `recordEmailEvent`. `POST /api/admin/orders/[id]/shipping-email` reads the event history via `listOrderEvents` to decide whether `retry` (no prior send → reuse the initial key) or `resend` (prior send → new event id + `resend/<event-id>` key + `shipping_email_resent`) is legal. Email delivery is a best-effort side effect: it never throws and never reverts a shipment.

**Tech Stack:** Next.js 15 App Router route handlers, TypeScript strict, `resend` 4.8.0 (`emails.send(payload, { idempotencyKey })`), Vitest unit tests under `tests/unit/**` with `vi.mock` for `resend` and the model/service layer.

**Depends on:** BMC-216A, BMC-216B (merged)

**Interface contract:** docs/superpowers/plans/2026-07-30-bmc-216-interfaces.md (binding)

## Global Constraints

- Tests live under `tests/unit/**` only (CI runs nothing else). Mock the model layer with `vi.mock("@/lib/models/…")` — unit tests must not touch Cloudflare bindings.
- `npm run lint` and `npx tsc --noEmit` must pass before every commit claim.
- Money: all monetary display/serialization through `lib/money` — never raw `*100`/`/100`.
- D1: `db.batch()` for atomic writes; no `db.transaction()`.
- Files kebab-case; components PascalCase; `@/*` path alias.
- Pure modules (`lib/fulfillment/tracking.ts`, `transitions.ts`, `lib/order-status/token.ts`, `lib/orders/customer-email.ts`) must import nothing from D1/Next/Clerk/Resend.
- Migration files: next free numbers `0022`, `0023`. Never renumber existing migrations. D1 LIKE patterns are capped at 50 chars — use `json_extract`, not long LIKE guards.
- `ORDER_STATUS_SECRET` typing is hand-added to `cloudflare-env.d.ts` — never regenerate that file wholesale.

**Ticket-C-specific constraints:**

- Every interpolation in the new template goes through the existing `escapeHtml` helper (`lib/utils/email.ts` ~line 515). No exceptions, including values from fixed unions.
- The shipping email must NOT contain internal notes, payment references, refund/audit data, or fabricated delivery estimates.
- The item preview renders at most 5 lines.
- Email failure is a `200` at the HTTP boundary and never mutates order status.

---

## Task 0: Verify upstream tickets are merged

**Files:**
- Read: `lib/fulfillment/shipping-email.ts`, `lib/fulfillment/service.ts`, `lib/fulfillment/types.ts`, `lib/fulfillment/tracking.ts`, `lib/orders/customer-email.ts`, `lib/order-status/token.ts`

**Interfaces:**
- Consumes: `getOrderCustomerEmail`, `createOrderStatusToken`, `isOrderStatusTokenConfigured`, `buildTrackingUrl`, `normalizeCarrier`, `recordEmailEvent`, `listOrderEvents`, `Actor`, `Carrier`, `InitialShippingEmailResult`

**Suggested agent:** haiku — pure verification reads, no design judgement.

- [ ] Read `lib/fulfillment/shipping-email.ts` and confirm it exports `InitialShippingEmailResult` and a stub `sendInitialShippingEmail(order, actor)` returning `{ attempted: false, success: false }`. If the file does not exist, STOP: BMC-216B is not merged and this ticket cannot start.
- [ ] Read `lib/fulfillment/service.ts` and write down the exact field names on the `OrderEventRow` type (the plan below assumes the raw Drizzle snake_case shape: `id`, `event_type`, `order_id`, `created_at`). If ticket B emitted camelCase instead, adjust the two accessors in Task 4 accordingly and note it in the commit message.
- [ ] Read `lib/fulfillment/types.ts` and confirm `Carrier` and `Actor` are exported with the contract shapes.
- [ ] Read `lib/orders/customer-email.ts` and `lib/order-status/token.ts` and confirm `getOrderCustomerEmail`, `isOrderStatusTokenConfigured`, and `createOrderStatusToken` exist with the contract signatures.
- [ ] Run `grep -n "shipping_carrier" lib/types/order.ts` and note whether ticket A added the field to the `Order` interface. The implementation below reads it through `Order & { shipping_carrier?: string | null }`, which compiles either way.

---

## Task 1: `sendShippingConfirmationEmail` + template

**Files:**
- Modify: `lib/utils/email.ts` (add imports at top ~line 1-5; append the new section after `sendGiftCardDeliveryEmail`/`escapeHtml`, i.e. after line ~600, before the `// ─── Subscription Lifecycle Emails ───` divider at ~line 602)
- Test: `tests/unit/lib/utils/shipping-confirmation-email.test.ts` (create)

**Interfaces:**
- Consumes: `Carrier` from `@/lib/fulfillment/types`; existing private `escapeHtml`, `getResendClient`, `postalAddressHtml`
- Produces:
  ```ts
  export interface ShippingConfirmationData {
    orderNumber: string;
    customerName: string | null;
    customerEmail: string;
    items: Array<{ name: string; quantity: number }>;
    carrier: Carrier | null;
    trackingNumber: string | null;
    trackingUrl: string | null;
    orderStatusUrl: string | null;
  }
  export interface ShippingEmailResult { success: boolean; error?: string }
  export function sendShippingConfirmationEmail(
    data: ShippingConfirmationData,
    opts: { idempotencyKey: string },
  ): Promise<ShippingEmailResult>;
  ```

**Suggested agent:** sonnet — HTML email template work with exact escaping requirements; no cross-module state machine.

- [ ] Create the failing test file `tests/unit/lib/utils/shipping-confirmation-email.test.ts` with this content:

```ts
/**
 * BMC-216C — shipping confirmation email template contract.
 *
 * Pins: tracked UPS / tracked FedEx / untracked rendering, that an untracked
 * shipment emits no empty tracking block or dead button, that the BeauTeas
 * order-status button is omitted when no status URL resolves, that the item
 * preview is capped at 5 lines, that every customer-controlled string is HTML
 * escaped, and that the Resend idempotency key is passed as the second arg.
 * The Resend transport is mocked so the rendered HTML can be inspected.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { sendMock } = vi.hoisted(() => ({
  sendMock: vi.fn().mockResolvedValue({ data: { id: 'email-1' }, error: null }),
}));

vi.mock('resend', () => ({
  Resend: class {
    emails = { send: sendMock };
  },
}));

import {
  sendShippingConfirmationEmail,
  type ShippingConfirmationData,
} from '@/lib/utils/email';

function baseData(overrides: Partial<ShippingConfirmationData> = {}): ShippingConfirmationData {
  return {
    orderNumber: 'ORD-1',
    customerName: 'Ada Lovelace',
    customerEmail: 'ada@example.com',
    items: [
      { name: 'Morning Blend', quantity: 2 },
      { name: 'Evening Blend', quantity: 1 },
    ],
    carrier: 'ups',
    trackingNumber: '1Z999AA10123456784',
    trackingUrl: 'https://www.ups.com/track?loc=en_US&tracknum=1Z999AA10123456784',
    orderStatusUrl: 'https://www.beauteas.com/account/orders/ORD-1',
    ...overrides,
  };
}

function payload(): { html: string; subject: string; to: string[] } {
  return sendMock.mock.calls.at(-1)?.[0];
}

function options(): { idempotencyKey?: string } | undefined {
  return sendMock.mock.calls.at(-1)?.[1];
}

beforeEach(() => {
  vi.clearAllMocks();
  sendMock.mockResolvedValue({ data: { id: 'email-1' }, error: null });
});

describe('sendShippingConfirmationEmail', () => {
  it('renders a tracked UPS shipment with a carrier button', async () => {
    const res = await sendShippingConfirmationEmail(baseData(), {
      idempotencyKey: 'shipping-confirmation/ORD-1/initial',
    });

    expect(res.success).toBe(true);
    const { html, subject, to } = payload();
    expect(to).toEqual(['ada@example.com']);
    expect(subject).toContain('ORD-1');
    expect(html).toContain('Your order has shipped');
    expect(html).toContain('UPS');
    expect(html).toContain('1Z999AA10123456784');
    expect(html).toContain('https://www.ups.com/track?loc=en_US&amp;tracknum=1Z999AA10123456784');
    expect(html).toContain('Track with UPS');
    expect(html).toContain('Morning Blend');
    expect(html).toContain('Evening Blend');
  });

  it('renders a tracked FedEx shipment with a FedEx button', async () => {
    await sendShippingConfirmationEmail(
      baseData({
        carrier: 'fedex',
        trackingNumber: '789012345678',
        trackingUrl: 'https://www.fedex.com/fedextrack/?trknbr=789012345678',
      }),
      { idempotencyKey: 'shipping-confirmation/ORD-1/initial' },
    );

    const { html } = payload();
    expect(html).toContain('FedEx');
    expect(html).toContain('789012345678');
    expect(html).toContain('https://www.fedex.com/fedextrack/?trknbr=789012345678');
    expect(html).toContain('Track with FedEx');
    expect(html).not.toContain('UPS');
  });

  it('renders an untracked shipment with no tracking block and no dead button', async () => {
    const res = await sendShippingConfirmationEmail(
      baseData({ carrier: null, trackingNumber: null, trackingUrl: null }),
      { idempotencyKey: 'shipping-confirmation/ORD-1/initial' },
    );

    expect(res.success).toBe(true);
    const { html } = payload();
    expect(html).toContain('Your order has shipped');
    expect(html).not.toContain('Track with');
    expect(html.toLowerCase()).not.toContain('tracking number');
    // No empty anchor left behind by an omitted tracking URL.
    expect(html).not.toContain('href=""');
  });

  it('omits the BeauTeas order-status button when no status URL resolves', async () => {
    await sendShippingConfirmationEmail(baseData({ orderStatusUrl: null }), {
      idempotencyKey: 'shipping-confirmation/ORD-1/initial',
    });

    const { html } = payload();
    expect(html).not.toContain('View your order');
    expect(html).not.toContain('href=""');
  });

  it('caps the item preview at 5 lines', async () => {
    await sendShippingConfirmationEmail(
      baseData({
        items: [
          { name: 'Item A', quantity: 1 },
          { name: 'Item B', quantity: 1 },
          { name: 'Item C', quantity: 1 },
          { name: 'Item D', quantity: 1 },
          { name: 'Item E', quantity: 1 },
          { name: 'Item F', quantity: 1 },
          { name: 'Item G', quantity: 1 },
        ],
      }),
      { idempotencyKey: 'shipping-confirmation/ORD-1/initial' },
    );

    const { html } = payload();
    expect(html).toContain('Item E');
    expect(html).not.toContain('Item F');
    expect(html).not.toContain('Item G');
  });

  it('escapes customer, item, and tracking content', async () => {
    await sendShippingConfirmationEmail(
      baseData({
        customerName: '<script>alert("name")</script>',
        items: [{ name: '<img src=x onerror=alert(1)>', quantity: 3 }],
        trackingNumber: '<script>alert("track")</script>',
        trackingUrl: 'https://www.ups.com/track?x="><script>alert(1)</script>',
        orderStatusUrl: 'https://www.beauteas.com/order-status/ORD-1?token="><script>x</script>',
      }),
      { idempotencyKey: 'shipping-confirmation/ORD-1/initial' },
    );

    const { html } = payload();
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('&quot;&gt;&lt;script&gt;');
  });

  it('never leaks internal fields the contract excludes', async () => {
    const { html } = await (async () => {
      await sendShippingConfirmationEmail(baseData(), {
        idempotencyKey: 'shipping-confirmation/ORD-1/initial',
      });
      return payload();
    })();

    expect(html.toLowerCase()).not.toContain('payment');
    expect(html.toLowerCase()).not.toContain('paymentintent');
    expect(html.toLowerCase()).not.toContain('internal note');
    expect(html.toLowerCase()).not.toContain('estimated delivery');
  });

  it('passes the idempotency key as the Resend second argument', async () => {
    await sendShippingConfirmationEmail(baseData(), {
      idempotencyKey: 'shipping-confirmation/ORD-1/initial',
    });

    expect(options()).toEqual({ idempotencyKey: 'shipping-confirmation/ORD-1/initial' });
  });

  it('returns a typed failure when Resend reports an error', async () => {
    sendMock.mockResolvedValueOnce({ data: null, error: { message: 'domain not verified' } });

    const res = await sendShippingConfirmationEmail(baseData(), {
      idempotencyKey: 'shipping-confirmation/ORD-1/initial',
    });

    expect(res.success).toBe(false);
    expect(res.error).toBe('domain not verified');
  });

  it('returns a typed failure instead of throwing when the transport throws', async () => {
    sendMock.mockRejectedValueOnce(new Error('network down'));

    const res = await sendShippingConfirmationEmail(baseData(), {
      idempotencyKey: 'shipping-confirmation/ORD-1/initial',
    });

    expect(res.success).toBe(false);
    expect(res.error).toBe('network down');
  });
});
```

- [ ] Run `npx vitest run tests/unit/lib/utils/shipping-confirmation-email.test.ts` — expect failure: `No "sendShippingConfirmationEmail" export is defined on the "@/lib/utils/email" mock` / TypeScript resolution error, because the export does not exist yet.
- [ ] Add the `Carrier` type import to the top of `lib/utils/email.ts`, immediately after the existing `import { Money } from '@/lib/money';` line:

```ts
import type { Carrier } from '@/lib/fulfillment/types';
```

- [ ] Append the new section to `lib/utils/email.ts` immediately after the closing `}` of `generateGiftCardDeliveryHTML` (~line 600) and before the `// ─── Subscription Lifecycle Emails ───` divider:

```ts
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
 * `other` deliberately renders as a neutral label: we have no carrier-owned
 * tracking URL for it, so naming a specific carrier would be a guess.
 */
const CARRIER_LABELS: Record<Carrier, string> = {
  ups: 'UPS',
  fedex: 'FedEx',
  other: 'Carrier',
};

/**
 * Send the shipment-confirmation email.
 *
 * `opts.idempotencyKey` is forwarded to Resend as the `Idempotency-Key`
 * header (resend 4.8.0 `emails.send(payload, options)`), so a retry of the
 * SAME attempt cannot double-send within the provider's 24h retention window.
 * Keys are built by the caller:
 *   shipping-confirmation/<order-id>/initial
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
        from: 'BeauTeas <info@beauteas.com>',
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

  // Carrier button only when a carrier-owned URL exists (UPS/FedEx). Never a
  // search-engine fallback.
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
```

- [ ] Run `npx vitest run tests/unit/lib/utils/shipping-confirmation-email.test.ts` — expect all 10 tests to pass.
- [ ] Run `npm run lint && npx tsc --noEmit` — expect no errors.
- [ ] Commit:

```bash
git add lib/utils/email.ts tests/unit/lib/utils/shipping-confirmation-email.test.ts
git commit -m "feat(email): dedicated shipping confirmation template with Resend idempotency keys (BMC-216C)"
```

---

## Task 2: Merchant notification deep-link

**Files:**
- Modify: `lib/utils/email.ts` (`sendNewOrderMerchantNotification`, `const adminUrl` at ~line 845; the text body's `Manage this order:` line at ~line 863; the HTML anchor at ~line 888)
- Test: `tests/unit/lib/utils/merchant-notification-link.test.ts` (create)

**Interfaces:**
- Consumes: `BASE_URL` from `@/lib/seo/metadata`, existing `OrderData`, existing private `escapeHtml`
- Produces: no signature change — `sendNewOrderMerchantNotification(orderData: OrderData): Promise<EmailResult>` is unchanged

**Suggested agent:** haiku — a three-line URL change plus one focused test.

- [ ] Create the failing test file `tests/unit/lib/utils/merchant-notification-link.test.ts` with this content:

```ts
/**
 * BMC-216C — the merchant new-order notification must deep-link to the
 * specific admin order, not the unfiltered order list. With a fulfillment
 * queue in place, "Manage this order" landing on /admin/orders makes the
 * operator hunt for the order the email is about.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { sendMock } = vi.hoisted(() => ({
  sendMock: vi.fn().mockResolvedValue({ data: { id: 'email-1' }, error: null }),
}));

vi.mock('resend', () => ({
  Resend: class {
    emails = { send: sendMock };
  },
}));

import { sendNewOrderMerchantNotification, type OrderData } from '@/lib/utils/email';

function baseOrderData(overrides: Partial<OrderData> = {}): OrderData {
  return {
    orderNumber: 'WEB-GUEST-123',
    customerName: 'Ada Lovelace',
    customerEmail: 'ada@example.com',
    items: [
      {
        productId: 'p1',
        name: 'Morning Blend',
        price: '$12.50',
        lineTotal: '$25.00',
        quantity: 2,
      },
    ],
    subtotal: '$25.00',
    shipping: '$5.00',
    tax: '$1.00',
    total: '$31.00',
    shippingAddress: {
      street: '1 Tea Lane',
      city: 'Denver',
      state: 'CO',
      zipCode: '80202',
      country: 'US',
    },
    ...overrides,
  };
}

function payload(): { html: string; text: string } {
  return sendMock.mock.calls.at(-1)?.[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  sendMock.mockResolvedValue({ data: { id: 'email-1' }, error: null });
});

describe('sendNewOrderMerchantNotification — admin deep link', () => {
  it('links to the per-order admin page in both HTML and text', async () => {
    const res = await sendNewOrderMerchantNotification(baseOrderData());

    expect(res.success).toBe(true);
    const { html, text } = payload();
    expect(html).toContain('/admin/orders/WEB-GUEST-123');
    expect(text).toContain('/admin/orders/WEB-GUEST-123');
  });

  it('does not link to the bare unfiltered order list', async () => {
    await sendNewOrderMerchantNotification(baseOrderData());

    const { html } = payload();
    expect(html).not.toContain('href="https://www.beauteas.com/admin/orders"');
    expect(html).not.toMatch(/\/admin\/orders"/);
  });

  it('URL-encodes an order number containing URL-significant characters', async () => {
    await sendNewOrderMerchantNotification(baseOrderData({ orderNumber: 'ORD 1/2?x=1' }));

    const { html } = payload();
    expect(html).toContain('/admin/orders/ORD%201%2F2%3Fx%3D1');
    expect(html).not.toContain('/admin/orders/ORD 1/2?x=1');
  });
});
```

- [ ] Run `npx vitest run tests/unit/lib/utils/merchant-notification-link.test.ts` — expect the first and third tests to fail because `adminUrl` is still `${BASE_URL}/admin/orders`.
- [ ] In `lib/utils/email.ts`, replace the `adminUrl` line inside `sendNewOrderMerchantNotification` (~line 845):

```ts
    const adminUrl = `${BASE_URL}/admin/orders`;
```

with:

```ts
    // Deep-link to the specific order (BMC-216C). The per-order admin page is
    // app/admin/orders/[id], keyed by the same value carried as orderNumber.
    // encodeURIComponent so an order id with URL-significant characters cannot
    // break out of the path segment.
    const adminUrl = `${BASE_URL}/admin/orders/${encodeURIComponent(orderData.orderNumber)}`;
```

- [ ] In the same function, replace the HTML anchor line (~line 888):

```ts
      <p><a href="${adminUrl}" style="display:inline-block;padding:10px 18px;background:#c4a87c;color:#fff;border-radius:6px;text-decoration:none">Manage this order</a></p>
```

with:

```ts
      <p><a href="${escapeHtml(adminUrl)}" style="display:inline-block;padding:10px 18px;background:#c4a87c;color:#fff;border-radius:6px;text-decoration:none">Manage this order</a></p>
```

- [ ] Run `npx vitest run tests/unit/lib/utils/merchant-notification-link.test.ts` — expect all 3 tests to pass. (The plain-text body already interpolates `adminUrl`, so it picks up the deep link with no further change.)
- [ ] Run `npm run lint && npx tsc --noEmit` — expect no errors.
- [ ] Commit:

```bash
git add lib/utils/email.ts tests/unit/lib/utils/merchant-notification-link.test.ts
git commit -m "fix(email): deep-link merchant notification to the specific admin order (BMC-216C)"
```

---

## Task 3: Real `sendInitialShippingEmail` implementation

**Files:**
- Modify: `lib/fulfillment/shipping-email.ts` (created by BMC-216B as a stub returning `{ attempted: false, success: false }`; this task replaces the body and keeps the exported name/signature)
- Test: `tests/unit/lib/fulfillment/initial-shipping-email.test.ts` (create)

**Interfaces:**
- Consumes:
  - `getOrderCustomerEmail(order): string | null` — `@/lib/orders/customer-email`
  - `isOrderStatusTokenConfigured(): boolean`, `createOrderStatusToken(orderId, email): Promise<string | null>` — `@/lib/order-status/token`
  - `normalizeCarrier(raw: unknown): Carrier | null`, `buildTrackingUrl(carrier, trackingNumber): string | null` — `@/lib/fulfillment/tracking`
  - `recordEmailEvent(orderId, type, actor, details): Promise<string>` — `@/lib/fulfillment/service`
  - `sendShippingConfirmationEmail(data, { idempotencyKey })`, `ShippingConfirmationData` — `@/lib/utils/email`
  - `BASE_URL` — `@/lib/seo/metadata`; `Actor` — `@/lib/fulfillment/types`; `Order` — `@/lib/types/order`
- Produces:
  ```ts
  export interface InitialShippingEmailResult {
    attempted: boolean; success: boolean; error?: string; eventId?: string;
  }
  export function sendInitialShippingEmail(order: Order, actor: Actor): Promise<InitialShippingEmailResult>;
  // additive (see Contract Deviations):
  export function buildShippingConfirmationData(order: Order): Promise<ShippingConfirmationData | null>;
  ```

**Suggested agent:** opus — idempotency-key derivation, guest-vs-registered status-URL branching, and never-throw failure semantics that other tickets depend on.

- [ ] Create the failing test file `tests/unit/lib/fulfillment/initial-shipping-email.test.ts` with this content:

```ts
/**
 * BMC-216C — sendInitialShippingEmail seam.
 *
 * The ship route calls this AFTER the shipment has already committed, so the
 * contract is: never throw, never mutate order state, always record an audit
 * event for an attempted send, and use the stable `initial` idempotency key so
 * a duplicated call cannot double-send.
 *
 * D1 is never touched: the fulfillment service is mocked, the Resend transport
 * is mocked, and the pure token/tracking/email-resolution modules run for real.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { sendMock, recordEmailEventMock, shipOrderMock, updateTrackingMock } = vi.hoisted(() => ({
  sendMock: vi.fn().mockResolvedValue({ data: { id: 'email-1' }, error: null }),
  recordEmailEventMock: vi.fn().mockResolvedValue('evt-1'),
  shipOrderMock: vi.fn(),
  updateTrackingMock: vi.fn(),
}));

vi.mock('resend', () => ({
  Resend: class {
    emails = { send: sendMock };
  },
}));

vi.mock('@/lib/fulfillment/service', () => ({
  recordEmailEvent: recordEmailEventMock,
  shipOrder: shipOrderMock,
  updateTracking: updateTrackingMock,
  listOrderEvents: vi.fn().mockResolvedValue([]),
}));

import { sendInitialShippingEmail } from '@/lib/fulfillment/shipping-email';
import type { Order } from '@/lib/types/order';
import type { Actor } from '@/lib/fulfillment/types';

type TestOrder = Order & { shipping_carrier?: string | null };

const ACTOR: Actor = { type: 'admin', id: 'user_admin_1' };

function baseOrder(overrides: Partial<TestOrder> = {}): TestOrder {
  return {
    id: 'ORD-1',
    status: 'shipped',
    payment_status: 'paid',
    currency_code: 'USD',
    total_amount: { amount: 2500, currency: 'USD', precision: 2 },
    items: [
      {
        product_id: 'p1',
        sku: 'SKU-1',
        quantity: 2,
        unit_price: { amount: 1250, currency: 'USD', precision: 2 },
        total_price: { amount: 2500, currency: 'USD', precision: 2 },
        product_name: 'Morning Blend',
      },
    ],
    shipping_address: {
      line1: '1 Tea Lane',
      city: 'Denver',
      region: 'CO',
      postal_code: '80202',
      country: 'US',
      recipient: 'Ada Lovelace',
      email: 'ada@example.com',
    },
    extensions: {},
    shipping_carrier: 'ups',
    tracking_number: '1Z999AA10123456784',
    ...overrides,
  } as unknown as TestOrder;
}

function sentPayload(): { html: string; to: string[] } {
  return sendMock.mock.calls.at(-1)?.[0];
}

function sentKey(): string | undefined {
  return sendMock.mock.calls.at(-1)?.[1]?.idempotencyKey;
}

beforeEach(() => {
  vi.clearAllMocks();
  sendMock.mockResolvedValue({ data: { id: 'email-1' }, error: null });
  recordEmailEventMock.mockResolvedValue('evt-1');
  process.env.ORDER_STATUS_SECRET = 'unit-test-order-status-secret';
});

afterEach(() => {
  delete process.env.ORDER_STATUS_SECRET;
});

describe('sendInitialShippingEmail', () => {
  it('sends with the stable initial idempotency key and records shipping_email_sent', async () => {
    const res = await sendInitialShippingEmail(baseOrder(), ACTOR);

    expect(res).toEqual({ attempted: true, success: true, eventId: 'evt-1' });
    expect(sentKey()).toBe('shipping-confirmation/ORD-1/initial');
    expect(sentPayload().to).toEqual(['ada@example.com']);
    expect(recordEmailEventMock).toHaveBeenCalledWith(
      'ORD-1',
      'shipping_email_sent',
      ACTOR,
      { idempotencyKey: 'shipping-confirmation/ORD-1/initial' },
    );
  });

  it('uses the same key on a second call (stable initial key)', async () => {
    await sendInitialShippingEmail(baseOrder(), ACTOR);
    const first = sentKey();
    await sendInitialShippingEmail(baseOrder(), ACTOR);
    const second = sentKey();

    expect(first).toBe('shipping-confirmation/ORD-1/initial');
    expect(second).toBe(first);
  });

  it('links a registered customer to their account order page', async () => {
    await sendInitialShippingEmail(baseOrder({ customer_id: 'user_42' }), ACTOR);

    expect(sentPayload().html).toContain('/account/orders/ORD-1');
    expect(sentPayload().html).not.toContain('/order-status/');
  });

  it('links a guest customer to a signed order-status URL', async () => {
    await sendInitialShippingEmail(baseOrder({ customer_id: undefined }), ACTOR);

    const html = sentPayload().html;
    expect(html).toContain('/order-status/ORD-1?token=');
    expect(html).not.toContain('/account/orders/');
  });

  it('still sends, without a status button, when ORDER_STATUS_SECRET is unset', async () => {
    delete process.env.ORDER_STATUS_SECRET;

    const res = await sendInitialShippingEmail(baseOrder({ customer_id: undefined }), ACTOR);

    expect(res.attempted).toBe(true);
    expect(res.success).toBe(true);
    expect(sentPayload().html).not.toContain('View your order');
  });

  it('renders a derived UPS tracking link, never a stored one', async () => {
    await sendInitialShippingEmail(baseOrder(), ACTOR);

    const html = sentPayload().html;
    expect(html).toContain('ups.com');
    expect(html).toContain('1Z999AA10123456784');
  });

  it('sends an untracked shipment with no tracking block', async () => {
    await sendInitialShippingEmail(
      baseOrder({ shipping_carrier: null, tracking_number: undefined }),
      ACTOR,
    );

    const html = sentPayload().html;
    expect(html).toContain('Your order has shipped');
    expect(html).not.toContain('Track with');
  });

  it('does not attempt a send when no customer email resolves', async () => {
    const res = await sendInitialShippingEmail(
      baseOrder({
        extensions: {},
        shipping_address: {
          line1: '1 Tea Lane',
          city: 'Denver',
          region: 'CO',
          postal_code: '80202',
          country: 'US',
          recipient: 'Ada Lovelace',
        },
      } as Partial<TestOrder>),
      ACTOR,
    );

    expect(res).toEqual({ attempted: false, success: false });
    expect(sendMock).not.toHaveBeenCalled();
    expect(recordEmailEventMock).not.toHaveBeenCalled();
  });

  it('sends no email for a processing order (no processing emails)', async () => {
    const res = await sendInitialShippingEmail(baseOrder({ status: 'processing' }), ACTOR);

    expect(res).toEqual({ attempted: false, success: false });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('sends no email for a delivered order (no manual delivered emails)', async () => {
    const res = await sendInitialShippingEmail(baseOrder({ status: 'delivered' }), ACTOR);

    expect(res).toEqual({ attempted: false, success: false });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('records shipping_email_failed and reports failure when the send fails', async () => {
    sendMock.mockResolvedValueOnce({ data: null, error: { message: 'domain not verified' } });
    recordEmailEventMock.mockResolvedValueOnce('evt-fail-1');

    const res = await sendInitialShippingEmail(baseOrder(), ACTOR);

    expect(res).toEqual({
      attempted: true,
      success: false,
      error: 'domain not verified',
      eventId: 'evt-fail-1',
    });
    expect(recordEmailEventMock).toHaveBeenCalledWith(
      'ORD-1',
      'shipping_email_failed',
      ACTOR,
      { idempotencyKey: 'shipping-confirmation/ORD-1/initial', error: 'domain not verified' },
    );
  });

  it('a failed send never reverts the shipment', async () => {
    sendMock.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });

    await sendInitialShippingEmail(baseOrder(), ACTOR);

    expect(shipOrderMock).not.toHaveBeenCalled();
    expect(updateTrackingMock).not.toHaveBeenCalled();
    // The only write is the append-only audit event.
    expect(recordEmailEventMock).toHaveBeenCalledTimes(1);
    expect(recordEmailEventMock.mock.calls[0][1]).toBe('shipping_email_failed');
  });

  it('never throws when the audit write itself fails', async () => {
    recordEmailEventMock.mockRejectedValueOnce(new Error('d1 unavailable'));

    const res = await sendInitialShippingEmail(baseOrder(), ACTOR);

    expect(res.attempted).toBe(true);
    expect(res.success).toBe(false);
    expect(res.error).toBe('d1 unavailable');
  });

  it('never throws when the transport throws', async () => {
    sendMock.mockRejectedValueOnce(new Error('network down'));

    const res = await sendInitialShippingEmail(baseOrder(), ACTOR);

    expect(res.attempted).toBe(true);
    expect(res.success).toBe(false);
  });
});
```

- [ ] Run `npx vitest run tests/unit/lib/fulfillment/initial-shipping-email.test.ts` — expect failures: the stub returns `{ attempted: false, success: false }` for every case, so every "sends" assertion fails.
- [ ] Replace the entire contents of `lib/fulfillment/shipping-email.ts` with:

```ts
/**
 * Shipping-email orchestration (BMC-216C).
 *
 * Sits between the fulfillment service (which owns order state) and the email
 * transformer in lib/utils/email.ts (which owns rendering). Its whole job is
 * to turn a shipped Order into a ShippingConfirmationData, send it under a
 * deterministic idempotency key, and append the resulting audit event.
 *
 * CONTRACT: this is a BEST-EFFORT SIDE EFFECT called AFTER the shipment has
 * already committed. It never throws and never writes order state — an email
 * failure must leave the order shipped, visible, and retryable, not roll a
 * customer's fulfilled order backwards.
 */

import type { Order } from '@/lib/types/order';
import type { Actor } from './types';
import { normalizeCarrier, buildTrackingUrl } from './tracking';
import { recordEmailEvent } from './service';
import { getOrderCustomerEmail } from '@/lib/orders/customer-email';
import { createOrderStatusToken, isOrderStatusTokenConfigured } from '@/lib/order-status/token';
import { sendShippingConfirmationEmail, type ShippingConfirmationData } from '@/lib/utils/email';
import { BASE_URL } from '@/lib/seo/metadata';

export interface InitialShippingEmailResult {
  attempted: boolean;
  success: boolean;
  error?: string;
  eventId?: string;
}

/** Matches the template's own cap; keeps the payload a preview, not a manifest. */
const MAX_PREVIEW_ITEMS = 5;

/**
 * Build the customer-facing shipping payload from a persisted order.
 *
 * Returns null when no customer email resolves — with nobody to send to there
 * is nothing to attempt, and (per BMC-216A) a guest status token bound to an
 * empty address would verify for any email-less order.
 *
 * Exported because the admin retry/resend route builds the identical payload;
 * duplicating this derivation is how a resent email drifts from the original.
 */
export async function buildShippingConfirmationData(
  order: Order
): Promise<ShippingConfirmationData | null> {
  const customerEmail = getOrderCustomerEmail(order);
  if (!customerEmail) return null;

  const orderId = order.id || '';

  // shipping_carrier is the server-owned column (migration 0022). Read through
  // a widened type so this compiles whether or not lib/types/order.ts declares
  // it yet. Stored values are already normalized, so the STRICT normalizer is
  // correct here: anything unrecognized is treated as no carrier rather than
  // silently downgraded.
  const storedCarrier = (order as Order & { shipping_carrier?: string | null }).shipping_carrier;
  const carrier = normalizeCarrier(storedCarrier ?? null);

  const trackingNumber = order.tracking_number?.trim() || null;
  // Derived at the boundary — never read a stored customer-facing URL.
  const trackingUrl = buildTrackingUrl(carrier, trackingNumber);

  let orderStatusUrl: string | null = null;
  if (order.customer_id) {
    orderStatusUrl = `${BASE_URL}/account/orders/${encodeURIComponent(orderId)}`;
  } else if (isOrderStatusTokenConfigured()) {
    const token = await createOrderStatusToken(orderId, customerEmail);
    orderStatusUrl = token
      ? `${BASE_URL}/order-status/${encodeURIComponent(orderId)}?token=${encodeURIComponent(token)}`
      : null;
  }

  const shippingAddress = order.shipping_address as { recipient?: unknown } | undefined;
  const recipient =
    typeof shippingAddress?.recipient === 'string' && shippingAddress.recipient.trim()
      ? shippingAddress.recipient.trim()
      : null;

  return {
    orderNumber: orderId,
    customerName: recipient,
    customerEmail,
    items: (order.items ?? []).slice(0, MAX_PREVIEW_ITEMS).map((item) => ({
      name: item.product_name,
      quantity: item.quantity,
    })),
    carrier,
    trackingNumber,
    trackingUrl,
    orderStatusUrl,
  };
}

/** Deterministic key for the one automatic send per order. */
export function initialShippingEmailKey(orderId: string): string {
  return `shipping-confirmation/${orderId}/initial`;
}

/**
 * Send the single automatic shipping confirmation for a freshly shipped order
 * and record the outcome in the fulfillment audit trail.
 *
 * Returns `{ attempted: false, success: false }` — with no audit event — when
 * there is nothing to attempt: a non-shipped order (belt-and-braces against a
 * `processing`/`delivered` caller; product decision 7 forbids those emails) or
 * an order with no resolvable customer email.
 */
export async function sendInitialShippingEmail(
  order: Order,
  actor: Actor
): Promise<InitialShippingEmailResult> {
  let attempted = false;
  const orderId = order.id || '';
  const idempotencyKey = initialShippingEmailKey(orderId);

  try {
    if (order.status !== 'shipped') {
      console.warn(
        `[shipping-email] order ${orderId} is ${order.status}, not shipped; no email sent`
      );
      return { attempted: false, success: false };
    }

    const data = await buildShippingConfirmationData(order);
    if (!data) {
      console.warn(`[shipping-email] order ${orderId} has no customer email; no email sent`);
      return { attempted: false, success: false };
    }

    attempted = true;
    const result = await sendShippingConfirmationEmail(data, { idempotencyKey });

    if (result.success) {
      const eventId = await recordEmailEvent(orderId, 'shipping_email_sent', actor, {
        idempotencyKey,
      });
      return { attempted: true, success: true, eventId };
    }

    const eventId = await recordEmailEvent(orderId, 'shipping_email_failed', actor, {
      idempotencyKey,
      error: result.error,
    });
    return { attempted: true, success: false, error: result.error, eventId };
  } catch (error) {
    // Swallow by contract: the shipment is already committed and must stay so.
    console.error(`[shipping-email] initial send failed for ${orderId}:`, error);
    return {
      attempted,
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
```

- [ ] Run `npx vitest run tests/unit/lib/fulfillment/initial-shipping-email.test.ts` — expect all 14 tests to pass.
- [ ] Verify the ship route wiring is unchanged: run `grep -n "sendInitialShippingEmail" app/api/admin/orders/\[id\]/ship/route.ts` and confirm ticket B's call site still compiles against the same signature (no edit expected).
- [ ] Run `npm run lint && npx tsc --noEmit` — expect no errors.
- [ ] Commit:

```bash
git add lib/fulfillment/shipping-email.ts tests/unit/lib/fulfillment/initial-shipping-email.test.ts
git commit -m "feat(fulfillment): send the initial shipping confirmation and audit its outcome (BMC-216C)"
```

---

## Task 4: Retry/resend route

**Files:**
- Create: `app/api/admin/orders/[id]/shipping-email/route.ts`
- Test: `tests/unit/app/api/admin-shipping-email-route.test.ts` (create)

**Interfaces:**
- Consumes: `checkAdminPermissions(request): Promise<AdminAuthResult>` — `@/lib/auth/admin-middleware`; `getOrderById(id): Promise<Order | null>` — `@/lib/models/mach/orders`; `listOrderEvents(orderId)`, `recordEmailEvent(orderId, type, actor, details)` — `@/lib/fulfillment/service`; `buildShippingConfirmationData(order)`, `initialShippingEmailKey(orderId)` — `@/lib/fulfillment/shipping-email`; `sendShippingConfirmationEmail(data, { idempotencyKey })` — `@/lib/utils/email`; `Actor` — `@/lib/fulfillment/types`
- Produces: `POST /api/admin/orders/[id]/shipping-email` — request `{ "mode": "retry" | "resend" }`; `200 { "email": { "success": boolean, "error"?: string }, "eventId": string }`; `400 { "error" }`; `401 { "error" }`; `404 { "error" }`; `409 { "code": "wrong_mode" }` / `409 { "code": "not_shipped", "status": string }`

**Suggested agent:** opus — retry-vs-resend history semantics and idempotency-key derivation are the correctness core of this ticket.

- [ ] Create the failing test file `tests/unit/app/api/admin-shipping-email-route.test.ts` with this content:

```ts
/**
 * BMC-216C — POST /api/admin/orders/[id]/shipping-email.
 *
 * The contract this pins:
 *  - retry is legal ONLY when nothing was ever sent, and reuses the stable
 *    `initial` key so a retry cannot double-send within Resend's window;
 *  - resend is legal ONLY after a recorded successful send, and mints a fresh
 *    key + a distinct `shipping_email_resent` event so the audit history can
 *    tell "the first one failed" from "the operator sent it again";
 *  - a failed send is HTTP 200 with success:false (the call worked, the send
 *    did not) plus a shipping_email_failed event — never a 5xx, and never a
 *    change to order state.
 *
 * D1 is never touched: the orders model and fulfillment service are mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const {
  sendMock,
  checkAdminPermissionsMock,
  getOrderByIdMock,
  listOrderEventsMock,
  recordEmailEventMock,
} = vi.hoisted(() => ({
  sendMock: vi.fn().mockResolvedValue({ data: { id: 'email-1' }, error: null }),
  checkAdminPermissionsMock: vi.fn().mockResolvedValue({ success: true, userId: 'user_admin_1' }),
  getOrderByIdMock: vi.fn(),
  listOrderEventsMock: vi.fn().mockResolvedValue([]),
  recordEmailEventMock: vi.fn().mockResolvedValue('evt-new'),
}));

vi.mock('resend', () => ({
  Resend: class {
    emails = { send: sendMock };
  },
}));

vi.mock('@/lib/auth/admin-middleware', () => ({
  checkAdminPermissions: checkAdminPermissionsMock,
}));

vi.mock('@/lib/models/mach/orders', () => ({
  getOrderById: getOrderByIdMock,
}));

vi.mock('@/lib/fulfillment/service', () => ({
  listOrderEvents: listOrderEventsMock,
  recordEmailEvent: recordEmailEventMock,
}));

import { POST } from '@/app/api/admin/orders/[id]/shipping-email/route';

function shippedOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ORD-1',
    status: 'shipped',
    payment_status: 'paid',
    currency_code: 'USD',
    total_amount: { amount: 2500, currency: 'USD', precision: 2 },
    items: [
      {
        product_id: 'p1',
        sku: 'SKU-1',
        quantity: 2,
        unit_price: { amount: 1250, currency: 'USD', precision: 2 },
        total_price: { amount: 2500, currency: 'USD', precision: 2 },
        product_name: 'Morning Blend',
      },
    ],
    shipping_address: {
      line1: '1 Tea Lane',
      city: 'Denver',
      region: 'CO',
      postal_code: '80202',
      country: 'US',
      recipient: 'Ada Lovelace',
      email: 'ada@example.com',
    },
    extensions: {},
    shipping_carrier: 'ups',
    tracking_number: '1Z999AA10123456784',
    ...overrides,
  };
}

function sentEvent(id = 'evt-sent-1') {
  return {
    id,
    order_id: 'ORD-1',
    event_type: 'shipping_email_sent',
    actor_type: 'admin',
    actor_id: 'user_admin_1',
    from_status: null,
    to_status: null,
    details: { idempotencyKey: 'shipping-confirmation/ORD-1/initial' },
    created_at: '2026-07-30T12:00:00.000Z',
  };
}

function post(mode: unknown, id = 'ORD-1') {
  const request = new NextRequest(
    `https://www.beauteas.com/api/admin/orders/${id}/shipping-email`,
    { method: 'POST', body: JSON.stringify({ mode }) },
  );
  return POST(request, { params: Promise.resolve({ id }) });
}

function sentKey(): string | undefined {
  return sendMock.mock.calls.at(-1)?.[1]?.idempotencyKey;
}

beforeEach(() => {
  vi.clearAllMocks();
  sendMock.mockResolvedValue({ data: { id: 'email-1' }, error: null });
  checkAdminPermissionsMock.mockResolvedValue({ success: true, userId: 'user_admin_1' });
  getOrderByIdMock.mockResolvedValue(shippedOrder());
  listOrderEventsMock.mockResolvedValue([]);
  recordEmailEventMock.mockResolvedValue('evt-new');
  process.env.ORDER_STATUS_SECRET = 'unit-test-order-status-secret';
});

describe('POST /api/admin/orders/[id]/shipping-email', () => {
  it('rejects an unauthenticated caller with 401 and sends nothing', async () => {
    checkAdminPermissionsMock.mockResolvedValueOnce({ success: false, error: 'Auth required' });

    const res = await post('retry');

    expect(res.status).toBe(401);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('rejects an unknown mode with 400', async () => {
    const res = await post('blast');

    expect(res.status).toBe(400);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('returns 404 for a missing order', async () => {
    getOrderByIdMock.mockResolvedValueOnce(null);

    const res = await post('retry');

    expect(res.status).toBe(404);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('returns 409 not_shipped for a processing order', async () => {
    getOrderByIdMock.mockResolvedValueOnce(shippedOrder({ status: 'processing' }));

    const res = await post('retry');

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ code: 'not_shipped', status: 'processing' });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('retry with no prior send reuses the initial key and records shipping_email_sent', async () => {
    const res = await post('retry');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ email: { success: true }, eventId: 'evt-new' });
    expect(sentKey()).toBe('shipping-confirmation/ORD-1/initial');
    expect(recordEmailEventMock).toHaveBeenCalledWith(
      'ORD-1',
      'shipping_email_sent',
      { type: 'admin', id: 'user_admin_1' },
      { idempotencyKey: 'shipping-confirmation/ORD-1/initial' },
    );
  });

  it('retry after a successful send is a 409 wrong_mode', async () => {
    listOrderEventsMock.mockResolvedValueOnce([sentEvent()]);

    const res = await post('retry');

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ code: 'wrong_mode' });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('resend without a prior send is a 409 wrong_mode', async () => {
    const res = await post('resend');

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ code: 'wrong_mode' });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('resend after a successful send mints a unique key and records shipping_email_resent', async () => {
    listOrderEventsMock.mockResolvedValue([sentEvent()]);

    const res = await post('resend');
    expect(res.status).toBe(200);
    const firstKey = sentKey();

    expect(firstKey).toMatch(/^shipping-confirmation\/ORD-1\/resend\/.+/);
    expect(recordEmailEventMock).toHaveBeenCalledWith(
      'ORD-1',
      'shipping_email_resent',
      { type: 'admin', id: 'user_admin_1' },
      { idempotencyKey: firstKey, resendOfEventId: 'evt-sent-1' },
    );

    await post('resend');
    const secondKey = sentKey();
    expect(secondKey).toMatch(/^shipping-confirmation\/ORD-1\/resend\/.+/);
    expect(secondKey).not.toBe(firstKey);
  });

  it('a failed send is 200 with success:false and a shipping_email_failed event', async () => {
    sendMock.mockResolvedValueOnce({ data: null, error: { message: 'domain not verified' } });
    recordEmailEventMock.mockResolvedValueOnce('evt-fail-1');

    const res = await post('retry');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      email: { success: false, error: 'domain not verified' },
      eventId: 'evt-fail-1',
    });
    expect(recordEmailEventMock).toHaveBeenCalledWith(
      'ORD-1',
      'shipping_email_failed',
      { type: 'admin', id: 'user_admin_1' },
      { idempotencyKey: 'shipping-confirmation/ORD-1/initial', error: 'domain not verified' },
    );
  });

  it('records a failed event when the order has no customer email', async () => {
    getOrderByIdMock.mockResolvedValueOnce(
      shippedOrder({
        extensions: {},
        shipping_address: {
          line1: '1 Tea Lane',
          city: 'Denver',
          region: 'CO',
          postal_code: '80202',
          country: 'US',
          recipient: 'Ada Lovelace',
        },
      }),
    );
    recordEmailEventMock.mockResolvedValueOnce('evt-fail-2');

    const res = await post('retry');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      email: { success: false, error: 'no_customer_email' },
      eventId: 'evt-fail-2',
    });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('attributes the audit event to the service token identity', async () => {
    checkAdminPermissionsMock.mockResolvedValueOnce({
      success: true,
      userId: 'admin-service',
      isServiceToken: true,
    });

    await post('retry');

    expect(recordEmailEventMock).toHaveBeenCalledWith(
      'ORD-1',
      'shipping_email_sent',
      { type: 'service', id: 'api-token' },
      { idempotencyKey: 'shipping-confirmation/ORD-1/initial' },
    );
  });
});
```

- [ ] Run `npx vitest run tests/unit/app/api/admin-shipping-email-route.test.ts` — expect failure: `Failed to resolve import "@/app/api/admin/orders/[id]/shipping-email/route"`.
- [ ] Create `app/api/admin/orders/[id]/shipping-email/route.ts` with:

```ts
/**
 * POST /api/admin/orders/[id]/shipping-email — retry or resend the shipping
 * confirmation (BMC-216C).
 *
 * Two distinct operator intents, deliberately NOT collapsed into one button:
 *
 *   retry  — the automatic send failed and nothing ever reached the customer.
 *            Reuses the stable `initial` idempotency key, so if the earlier
 *            attempt actually did land at Resend (failure reported after the
 *            handoff) the provider dedupes instead of double-sending.
 *   resend — a send succeeded and the operator deliberately wants another
 *            copy. Mints a fresh key (a reused key would be silently swallowed
 *            by Resend's 24h dedupe window) and records a distinct
 *            `shipping_email_resent` event so the audit history tells the two
 *            apart.
 *
 * Mode is checked against the recorded event history rather than trusted from
 * the client: the caller cannot decide whether a customer has already been
 * emailed.
 *
 * A failed SEND is HTTP 200 with `email.success === false` — the API call did
 * its job; delivery is a separate outcome the admin UI surfaces as a warning.
 * Nothing here touches order state: a shipped order stays shipped.
 */
import { NextRequest, NextResponse } from 'next/server';
import { checkAdminPermissions, type AdminAuthResult } from '@/lib/auth/admin-middleware';
import { getOrderById } from '@/lib/models/mach/orders';
import { listOrderEvents, recordEmailEvent } from '@/lib/fulfillment/service';
import {
  buildShippingConfirmationData,
  initialShippingEmailKey,
} from '@/lib/fulfillment/shipping-email';
import { sendShippingConfirmationEmail } from '@/lib/utils/email';
import type { Actor } from '@/lib/fulfillment/types';

type Mode = 'retry' | 'resend';

/**
 * ADMIN_VECTORIZE_TOKEN callers are automation, not a person — record them as
 * a service actor so the audit trail never implies a human clicked resend.
 */
function actorFrom(auth: AdminAuthResult): Actor {
  if (auth.isServiceToken) return { type: 'service', id: 'api-token' };
  return { type: 'admin', id: auth.userId ?? null };
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await checkAdminPermissions(request);
  if (!auth.success) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const mode = (body as { mode?: unknown } | null)?.mode;
  if (mode !== 'retry' && mode !== 'resend') {
    return NextResponse.json(
      { error: 'mode must be "retry" or "resend"' },
      { status: 400 }
    );
  }

  try {
    const order = await getOrderById(id);
    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    if (order.status !== 'shipped') {
      return NextResponse.json(
        { code: 'not_shipped', status: order.status },
        { status: 409 }
      );
    }

    // History, not the client, decides which mode is legal.
    const events = await listOrderEvents(id);
    const priorSent = events.find((event) => event.event_type === 'shipping_email_sent');
    if (mode === 'retry' && priorSent) {
      return NextResponse.json({ code: 'wrong_mode' }, { status: 409 });
    }
    if (mode === 'resend' && !priorSent) {
      return NextResponse.json({ code: 'wrong_mode' }, { status: 409 });
    }

    const resendEventId = mode === 'resend' ? crypto.randomUUID() : null;
    const idempotencyKey =
      mode === 'resend'
        ? `shipping-confirmation/${id}/resend/${resendEventId}`
        : initialShippingEmailKey(id);

    const actor = actorFrom(auth);

    const data = await buildShippingConfirmationData(order);
    if (!data) {
      // Nothing to send to. Still auditable: the operator pressed the button
      // and no email went out, which is exactly what the timeline must show.
      const eventId = await recordEmailEvent(id, 'shipping_email_failed', actor, {
        idempotencyKey,
        error: 'no_customer_email',
      });
      return NextResponse.json(
        { email: { success: false, error: 'no_customer_email' }, eventId },
        { status: 200 }
      );
    }

    const result = await sendShippingConfirmationEmail(data, { idempotencyKey });

    if (!result.success) {
      const eventId = await recordEmailEvent(id, 'shipping_email_failed', actor, {
        idempotencyKey,
        error: result.error,
      });
      return NextResponse.json(
        { email: { success: false, error: result.error }, eventId },
        { status: 200 }
      );
    }

    const eventId =
      mode === 'resend'
        ? await recordEmailEvent(id, 'shipping_email_resent', actor, {
            idempotencyKey,
            resendOfEventId: priorSent?.id,
          })
        : await recordEmailEvent(id, 'shipping_email_sent', actor, { idempotencyKey });

    return NextResponse.json({ email: { success: true }, eventId }, { status: 200 });
  } catch (error) {
    console.error(`[shipping-email-route] failed for order ${id}:`, error);
    return NextResponse.json({ error: 'Failed to send shipping email' }, { status: 500 });
  }
}
```

- [ ] Run `npx vitest run tests/unit/app/api/admin-shipping-email-route.test.ts` — expect all 11 tests to pass. If the `priorSent` accessors fail to typecheck, reconcile them with the `OrderEventRow` field names recorded in Task 0 (`event_type` / `id`) and re-run.
- [ ] Run `npm run lint && npx tsc --noEmit` — expect no errors.
- [ ] Commit:

```bash
git add "app/api/admin/orders/[id]/shipping-email/route.ts" tests/unit/app/api/admin-shipping-email-route.test.ts
git commit -m "feat(api): admin shipping-email retry/resend route with history-checked idempotency keys (BMC-216C)"
```

---

## Task 5: Full-suite verification pass

**Files:**
- Test: no new files — runs the complete unit suite

**Interfaces:**
- Consumes: everything produced by Tasks 1–4

**Suggested agent:** haiku — mechanical gate execution and reporting.

- [ ] Run `npm test` (i.e. `vitest run`, which collects only `tests/unit/**/*.test.{ts,tsx}`) — expect the whole suite green, including the four new files.
- [ ] Run `npm run lint` — expect no errors or warnings introduced by this ticket.
- [ ] Run `npx tsc --noEmit` — expect no errors.
- [ ] If any pre-existing test broke, fix the regression (do NOT edit the assertion to match new behavior without confirming the behavior change is intended by the spec).
- [ ] Commit only if a fix was required:

```bash
git add -A
git commit -m "test(fulfillment): fix regressions surfaced by the shipping email suite (BMC-216C)"
```

---

## Verification

Run all three gates from the repo root and confirm the actual output before claiming completion:

```bash
npm run lint
npx tsc --noEmit
npm test          # vitest run — tests/unit/**/*.test.{ts,tsx} only (what CI gates on)
```

Acceptance criteria from the spec's BMC-216C section, and where each is proven:

| Criterion | Proof |
|---|---|
| The initial shipment produces at most one automatic email | `initial-shipping-email.test.ts` — "sends with the stable initial idempotency key", "uses the same key on a second call" (provider-side dedupe on a fixed key) |
| Shipping without tracking sends a valid email without an empty tracking block | `shipping-confirmation-email.test.ts` — "renders an untracked shipment…"; `initial-shipping-email.test.ts` — "sends an untracked shipment with no tracking block" |
| Email failure does not revert shipment | `initial-shipping-email.test.ts` — "a failed send never reverts the shipment", "never throws when the audit write itself fails" |
| Retry and intentional resend are distinguishable in the audit history | `admin-shipping-email-route.test.ts` — `shipping_email_sent` vs `shipping_email_resent` events, `wrong_mode` 409s both directions, unique resend keys |
| No `processing` or manual `delivered` email is sent | `initial-shipping-email.test.ts` — "sends no email for a processing order", "sends no email for a delivered order"; `admin-shipping-email-route.test.ts` — 409 `not_shipped` |
| All customer/item/carrier/tracking strings escaped | `shipping-confirmation-email.test.ts` — "escapes customer, item, and tracking content" |
| Merchant notification deep-links to the order | `merchant-notification-link.test.ts` |

Manual smoke checks (deferred to BMC-216G, not gates for this ticket): force a Resend failure on a dev order and confirm the order stays `shipped`, the admin timeline shows `shipping_email_failed`, and **Retry email** succeeds with the same key.

## Contract Deviations

None of the following renames or changes a name, type, or wire shape pinned by
`docs/superpowers/plans/2026-07-30-bmc-216-interfaces.md`. They are additive
clarifications where the contract was silent; each is called out so a reviewer
can reject it rather than discover it.

1. **Additive exports in `lib/fulfillment/shipping-email.ts`:**
   `buildShippingConfirmationData(order: Order): Promise<ShippingConfirmationData | null>`
   and `initialShippingEmailKey(orderId: string): string`. The contract pins
   only `sendInitialShippingEmail` + `InitialShippingEmailResult` for this
   file. The retry/resend route must build the *identical* payload and the
   *identical* initial key; duplicating that derivation in the route is how a
   resent email drifts from the original. `sendInitialShippingEmail`'s exported
   name, parameters, and result shape are unchanged.

2. **Resend event id vs. audit row id.** The contract says resend "mints a new
   event id and `resend/<event-id>` key". `recordEmailEvent` generates the
   audit row's `id` internally and returns it *after* the send, but the key is
   needed *before* the send — so the route mints a UUID for the key and passes
   `{ idempotencyKey, resendOfEventId: <prior shipping_email_sent id> }` as the
   event details. The key remains unique per resend (the acceptance criterion),
   the stored `details.idempotencyKey` ties the row to the send, and
   `recordEmailEvent`'s signature is untouched. The alternative — adding an
   `eventId` parameter to `recordEmailEvent` — would change a ticket-B
   signature and was rejected.

3. **Non-shipped guard inside `sendInitialShippingEmail`.** Returns
   `{ attempted: false, success: false }` without sending when
   `order.status !== "shipped"`. The contract does not mention it; it is what
   makes "no `processing` or manual `delivered` email" a unit-testable property
   of the seam itself rather than a property of its one caller.

4. **`order.shipping_carrier` is read through
   `Order & { shipping_carrier?: string | null }`.** `lib/types/order.ts` does
   not declare the field today; ticket A may or may not have added it. The
   widened read compiles either way and needs no edit when A's type lands.

5. **No-customer-email on retry/resend → `200` with
   `email.success: false, error: "no_customer_email"` plus a
   `shipping_email_failed` event.** The contract specifies `200`-with-failure
   only for a failed *send*. Treating "nobody to send to" the same way keeps
   the operator's button press auditable and avoids inventing a new error code
   the admin UI would have to special-case.

6. **`OrderEventRow` field names assumed snake_case** (`id`, `event_type`),
   matching the Drizzle table in the contract. Task 0 verifies this against the
   merged ticket-B code; if B emitted camelCase, Task 4's two accessors change
   accordingly (no contract change either way — the field names are internal to
   the service layer, and the `GET /events` wire shape already maps to
   camelCase at its own boundary).
