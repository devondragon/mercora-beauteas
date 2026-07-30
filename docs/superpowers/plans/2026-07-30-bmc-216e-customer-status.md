# BMC-216E: Customer Status and Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a registered customer see shipment/tracking on their order page, and let a guest see a minimal, token-gated order-status page at `/order-status/<id>?token=…` that leaks nothing beyond order number, date, status, shipment, and item names/quantities.

**Architecture:** The registered page keeps its existing Clerk ownership check and gains a shipment card driven by the `orders.shipping_carrier` + `tracking_number` columns, with the carrier link derived at render time via `buildTrackingUrl` (never a stored URL). The guest page is a fail-closed server component: rate-limit by IP → load order → resolve the customer email → verify the HMAC bearer token → render. Every failure funnels into `notFound()`, so the page is never an existence oracle. What the guest page may show is defined once, in a pure allowlist projection (`buildGuestOrderProjection`), so "does this leak an address?" is a unit-testable property of a pure function rather than a property of JSX.

**Tech Stack:** Next.js 15 App Router server components, Clerk (`auth()`), Drizzle/D1 read via `getOrderById`, Cloudflare `PUBLIC_RATE_LIMITER` via `enforceRateLimit`, Web Crypto HMAC token from ticket A, Vitest (jsdom, `tests/unit/**`).

**Depends on:** BMC-216A (token, helpers, schema). Runs in parallel with C/D.

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

**Ticket-E-specific constraints:**

- The guest page must NOT render: totals or any `Money`, shipping/billing address, payment method or PaymentIntent id, notes, `extensions`, audit events, or refund-ledger data.
- Every guest-page failure path returns `notFound()` — never a distinguishable error, redirect, or 4xx variant.
- Carrier comes from the `orders.shipping_carrier` **column only**. Never read `extensions.carrier` or `extensions.trackingUrl`.
- `carrier === "other"` → show the tracking number with **no** link (`buildTrackingUrl` already returns `null`).
- The shipment card is hidden entirely when `shipped_at` is null; only the status line renders.

---

### Task 1: Surface `shipping_carrier` on the order read model

Ticket A adds the `orders.shipping_carrier` column (migration `0022`). Ticket E is the first *reader* of it through the `Order` object, so before anything else confirm the column is actually plumbed through Drizzle → `hydrateOrder` → the `Order` type. If A already did it, this task is a 30-second no-op verification.

**Files:**
- Modify: `lib/db/schema/order.ts` (orders table, after `tracking_number` ~:50)
- Modify: `lib/types/order.ts` (`Order` interface, tracking/fulfillment block ~:64-67)
- Modify: `lib/models/mach/orders.ts` (`hydrateOrder` ~:451)

**Interfaces:**
- Produces: `Order.shipping_carrier?: string` (raw stored value; normalized by callers via `normalizeLegacyCarrier`)
- Consumes: nothing

**Suggested agent:** haiku — mechanical three-line plumbing verified by `tsc`, no logic.

- [ ] Check current state: `grep -n "shipping_carrier" lib/db/schema/order.ts lib/types/order.ts lib/models/mach/orders.ts`. If all three already have it (ticket A did the plumbing), skip to the last step of this task.
- [ ] If missing from the Drizzle table, add to `lib/db/schema/order.ts` immediately after the `tracking_number: text("tracking_number"),` line:
  ```ts
  // Typed carrier for the one V1 shipment: "ups" | "fedex" | "other" (BMC-216).
  // Normalized on write; readers pass it through normalizeLegacyCarrier anyway
  // so a legacy row that escaped the 0022 backfill still renders sanely.
  shipping_carrier: text("shipping_carrier"),
  ```
- [ ] If missing from the `Order` interface, add to `lib/types/order.ts` in the "Tracking and fulfillment" block, directly above `tracking_number?: string;`:
  ```ts
  shipping_carrier?: string; // "ups" | "fedex" | "other" (BMC-216)
  ```
- [ ] If missing from `hydrateOrder` in `lib/models/mach/orders.ts`, add directly above the `tracking_number:` line:
  ```ts
    shipping_carrier: orderRecord.shipping_carrier ?? undefined,
  ```
- [ ] Run `npx tsc --noEmit` — expect zero errors. (If it reports `shipping_carrier` does not exist on the Drizzle row type, migration `0022` / ticket A has not landed — stop and escalate; E cannot proceed without it.)
- [ ] Commit only if something changed:
  ```bash
  git add lib/db/schema/order.ts lib/types/order.ts lib/models/mach/orders.ts
  git commit -m "feat(orders): surface shipping_carrier on the order read model (BMC-216E)"
  ```

---

### Task 2: `getClientIpFromHeaders` for server components

`enforceRateLimit` is keyed by client IP via `getClientIp(req)`, but a server component has no `Request` — only `headers()` from `next/headers`. Add a header-bag flavour so the guest page keys its limit exactly like `/api/tax` and `/api/validate-discount` do, with one implementation of the CF-Connecting-IP → x-forwarded-for precedence.

**Files:**
- Modify: `lib/rate-limit.ts` (`getClientIp` ~:35-46)
- Test: `tests/unit/lib/rate-limit.test.ts` (append to the existing `getClientIp` describe block)

**Interfaces:**
- Produces: `getClientIpFromHeaders(headers: { get(name: string): string | null }): string`
- Consumes: nothing. `getClientIp(req: Request)` keeps its exact existing signature and delegates.

**Suggested agent:** haiku — a six-line pure helper with an existing test file to extend.

- [ ] Add this describe block to the end of `tests/unit/lib/rate-limit.test.ts`:
  ```ts
  describe('getClientIpFromHeaders (server components — no Request object)', () => {
    it('prefers CF-Connecting-IP over x-forwarded-for', () => {
      const h = new Headers({ 'CF-Connecting-IP': '1.2.3.4', 'x-forwarded-for': '9.9.9.9' });
      expect(getClientIpFromHeaders(h)).toBe('1.2.3.4');
    });

    it('falls back to the first x-forwarded-for entry', () => {
      expect(getClientIpFromHeaders(new Headers({ 'x-forwarded-for': '5.6.7.8, 9.9.9.9' }))).toBe('5.6.7.8');
    });

    it('returns "unknown" when no client IP header is present', () => {
      expect(getClientIpFromHeaders(new Headers())).toBe('unknown');
    });

    it('agrees with getClientIp for the same headers', () => {
      const headers = { 'CF-Connecting-IP': '4.3.2.1' };
      expect(getClientIpFromHeaders(new Headers(headers))).toBe(getClientIp(reqWith(headers)));
    });
  });
  ```
- [ ] Update the import line in that file to `import { getClientIp, getClientIpFromHeaders, enforceRateLimit } from '@/lib/rate-limit';`
- [ ] Run `npx vitest run tests/unit/lib/rate-limit.test.ts` — expect failure: `getClientIpFromHeaders is not a function` (4 failing tests).
- [ ] Replace the body of `getClientIp` in `lib/rate-limit.ts` with a delegation and add the new export directly above it:
  ```ts
  /**
   * Best-effort client IP from a bare header bag. Server components have no
   * `Request` — `headers()` from `next/headers` hands back a Headers-like object
   * — so this is the flavour the guest order-status page (BMC-216E) uses. Same
   * precedence and same "unknown" bucket as {@link getClientIp}.
   */
  export function getClientIpFromHeaders(headers: { get(name: string): string | null }): string {
    const cfIp = headers.get("CF-Connecting-IP");
    if (cfIp) return cfIp.trim();

    const forwarded = headers.get("x-forwarded-for");
    if (forwarded) {
      const first = forwarded.split(",")[0]?.trim();
      if (first) return first;
    }

    return "unknown";
  }

  /**
   * Best-effort client IP for use as a rate-limit key. Cloudflare sets
   * `CF-Connecting-IP` on every request at the edge; the `x-forwarded-for`
   * fallback covers non-CF/local runs. Returns `"unknown"` when neither is
   * present, which buckets all such callers into one shared limit — a safe,
   * conservative default (it can only over-throttle, never under-throttle).
   */
  export function getClientIp(req: Request): string {
    return getClientIpFromHeaders(req.headers);
  }
  ```
- [ ] Run `npx vitest run tests/unit/lib/rate-limit.test.ts` — expect all tests green (the pre-existing `getClientIp` tests must still pass; they pin the delegation).
- [ ] Run `npm run lint && npx tsc --noEmit` — expect clean.
- [ ] Commit:
  ```bash
  git add lib/rate-limit.ts tests/unit/lib/rate-limit.test.ts
  git commit -m "feat(rate-limit): add getClientIpFromHeaders for server components (BMC-216E)"
  ```

---

### Task 3: Carrier display labels + the guest projection allowlist

`buildGuestOrderProjection` is the security boundary of this ticket: the guest page renders **only** from its return value, so the projection type *is* the allowlist. Tests assert forbidden fields are structurally absent (key-set equality + `not.toHaveProperty` + a serialized-output scan), not merely "not displayed".

**Files:**
- Modify: `lib/fulfillment/types.ts` (append `CARRIER_LABELS`; ticket-A-owned file)
- Create: `lib/order-status/guest-projection.ts`
- Test: `tests/unit/lib/order-status/guest-projection.test.ts`

**Interfaces:**
- Consumes: `normalizeLegacyCarrier(raw: unknown): Carrier | null`, `buildTrackingUrl(carrier: Carrier | null, trackingNumber: string | null): string | null` (both `lib/fulfillment/tracking.ts`), `Carrier` (`lib/fulfillment/types.ts`)
- Produces:
  ```ts
  export const CARRIER_LABELS: Record<Carrier, string>; // in lib/fulfillment/types.ts
  export interface GuestOrderProjectionItem { name: string; quantity: number }
  export interface GuestOrderProjection {
    orderNumber: string;
    placedAt: string | null;
    status: string;
    shippedAt: string | null;
    carrier: Carrier | null;
    carrierLabel: string | null;
    trackingNumber: string | null;
    trackingUrl: string | null;
    items: GuestOrderProjectionItem[];
  }
  export interface GuestProjectionOrder { /* structural input, see impl */ }
  export function buildGuestOrderProjection(order: GuestProjectionOrder): GuestOrderProjection;
  ```

**Suggested agent:** opus — this function defines what a bearer token exposes; the field list is a security decision, not a formatting one.

- [ ] Create `tests/unit/lib/order-status/guest-projection.test.ts` with the full allowlist suite:
  ```ts
  /**
   * BMC-216E — the guest order-status projection IS the allowlist.
   *
   * A guest reaches /order-status/<id> with a bearer token in a URL that lands in
   * browser history, shared screenshots, and (absent our no-referrer policy) the
   * Referer header of an outbound carrier link. So the projection must expose the
   * bare minimum: order number, dates, status, shipment, item names + quantities.
   * These tests assert the forbidden fields are STRUCTURALLY ABSENT — a future
   * "just add the total" edit fails here, not in a code review.
   */
  import { describe, it, expect } from 'vitest';
  import { buildGuestOrderProjection } from '@/lib/order-status/guest-projection';

  const EXPECTED_KEYS = [
    'carrier',
    'carrierLabel',
    'items',
    'orderNumber',
    'placedAt',
    'shippedAt',
    'status',
    'trackingNumber',
    'trackingUrl',
  ];

  // Deliberately rich: every field here that is NOT in EXPECTED_KEYS is something
  // the projection must drop.
  const fullOrder = {
    id: 'WEB-GUEST-1753900000000',
    customer_id: null,
    status: 'shipped',
    payment_status: 'paid',
    payment_method: 'stripe',
    total_amount: { amount: 4200, currency: 'USD' },
    currency_code: 'USD',
    shipping_address: {
      line1: '1 Secret St',
      city: 'Portland',
      region: 'OR',
      postal_code: '97201',
      country: 'US',
      email: 'guest@example.com',
    },
    billing_address: { line1: '1 Secret St', city: 'Portland' },
    items: [
      { product_id: 'p1', sku: 'MB-1', product_name: 'Morning Blend', quantity: 2, unit_price: { amount: 2100, currency: 'USD' }, total_price: { amount: 4200, currency: 'USD' } },
      { product_id: 'p2', sku: 'EB-1', product_name: 'Evening Blend', quantity: 1, unit_price: { amount: 2100, currency: 'USD' }, total_price: { amount: 2100, currency: 'USD' } },
    ],
    shipping_method: 'standard',
    notes: 'INTERNAL: customer called about a refund',
    external_references: { payment_intent_id: 'pi_secret_123' },
    extensions: { email: 'guest@example.com', refundLedger: [{ amount: 100 }], carrier: 'USPS' },
    shipping_carrier: 'ups',
    tracking_number: '1Z999AA10123456784',
    shipped_at: '2026-07-28T18:00:00.000Z',
    delivered_at: null,
    created_at: '2026-07-25T12:00:00.000Z',
    updated_at: '2026-07-28T18:00:00.000Z',
  };

  describe('buildGuestOrderProjection — allowlist', () => {
    it('exposes exactly the allowed keys and nothing else', () => {
      const view = buildGuestOrderProjection(fullOrder);
      expect(Object.keys(view).sort()).toEqual(EXPECTED_KEYS);
    });

    it('omits addresses, totals, payment data, notes and extensions structurally', () => {
      const view = buildGuestOrderProjection(fullOrder) as Record<string, unknown>;
      for (const forbidden of [
        'shipping_address',
        'billing_address',
        'total_amount',
        'currency_code',
        'payment_method',
        'payment_status',
        'notes',
        'extensions',
        'external_references',
        'customer_id',
        'shipping_method',
      ]) {
        expect(view).not.toHaveProperty(forbidden);
      }
    });

    it('leaks no forbidden VALUES through the serialized projection', () => {
      const serialized = JSON.stringify(buildGuestOrderProjection(fullOrder));
      for (const secret of ['Secret St', 'Portland', '97201', 'guest@example.com', 'pi_secret_123', 'INTERNAL', 'refundLedger', '4200', 'MB-1']) {
        expect(serialized).not.toContain(secret);
      }
    });

    it('projects items down to name + quantity only', () => {
      const view = buildGuestOrderProjection(fullOrder);
      expect(view.items).toEqual([
        { name: 'Morning Blend', quantity: 2 },
        { name: 'Evening Blend', quantity: 1 },
      ]);
      expect(Object.keys(view.items[0]).sort()).toEqual(['name', 'quantity']);
    });
  });

  describe('buildGuestOrderProjection — shipment fields', () => {
    it('derives a UPS tracking link from the shipping_carrier column', () => {
      const view = buildGuestOrderProjection(fullOrder);
      expect(view.carrier).toBe('ups');
      expect(view.carrierLabel).toBe('UPS');
      expect(view.trackingNumber).toBe('1Z999AA10123456784');
      expect(view.trackingUrl).toContain('ups.com');
      expect(view.trackingUrl).toContain('1Z999AA10123456784');
    });

    it('derives a FedEx tracking link', () => {
      const view = buildGuestOrderProjection({ ...fullOrder, shipping_carrier: 'fedex', tracking_number: '794611131' });
      expect(view.carrierLabel).toBe('FedEx');
      expect(view.trackingUrl).toContain('fedex.com');
    });

    it('shows an "other" carrier tracking number with NO link', () => {
      const view = buildGuestOrderProjection({ ...fullOrder, shipping_carrier: 'other', tracking_number: 'DHL-123' });
      expect(view.carrier).toBe('other');
      expect(view.carrierLabel).toBe('Other');
      expect(view.trackingNumber).toBe('DHL-123');
      expect(view.trackingUrl).toBeNull();
    });

    it('normalizes a legacy carrier value that escaped the 0022 backfill', () => {
      const view = buildGuestOrderProjection({ ...fullOrder, shipping_carrier: 'UPS Ground' });
      expect(view.carrier).toBe('other');
      expect(view.trackingUrl).toBeNull();
    });

    it('never reads extensions.carrier or extensions.trackingUrl', () => {
      const view = buildGuestOrderProjection({
        ...fullOrder,
        shipping_carrier: null,
        extensions: { carrier: 'ups', trackingUrl: 'https://evil.example.com/track' },
      });
      expect(view.carrier).toBeNull();
      expect(view.carrierLabel).toBeNull();
      expect(view.trackingUrl).toBeNull();
    });

    it('returns null shipment fields for an order that never shipped', () => {
      const view = buildGuestOrderProjection({
        ...fullOrder,
        status: 'processing',
        shipping_carrier: null,
        tracking_number: null,
        shipped_at: null,
      });
      expect(view.shippedAt).toBeNull();
      expect(view.carrier).toBeNull();
      expect(view.trackingNumber).toBeNull();
      expect(view.trackingUrl).toBeNull();
      expect(view.status).toBe('processing');
    });

    it('tolerates a sparse order row without throwing', () => {
      const view = buildGuestOrderProjection({ status: 'pending' });
      expect(view.orderNumber).toBe('');
      expect(view.placedAt).toBeNull();
      expect(view.items).toEqual([]);
    });
  });
  ```
- [ ] Run `npx vitest run tests/unit/lib/order-status/guest-projection.test.ts` — expect failure: cannot resolve `@/lib/order-status/guest-projection`.
- [ ] Append the carrier label map to `lib/fulfillment/types.ts` (if ticket D already added an equivalent map, reuse it and skip this step):
  ```ts
  /** Customer- and admin-facing display names for the typed carriers (BMC-216). */
  export const CARRIER_LABELS: Record<Carrier, string> = {
    ups: "UPS",
    fedex: "FedEx",
    other: "Other",
  };
  ```
- [ ] Create `lib/order-status/guest-projection.ts` with the complete implementation:
  ```ts
  /**
   * === Guest order-status projection (BMC-216E) ===
   *
   * THE ALLOWLIST for what a `/order-status/<id>?token=…` bearer token exposes.
   * The guest page renders from this object and nothing else, so "could a guest
   * link leak the shipping address?" is a property of this pure function — see
   * tests/unit/lib/order-status/guest-projection.test.ts, which asserts the
   * forbidden fields are structurally absent rather than merely unrendered.
   *
   * Deliberately excluded (spec "Customer Order Status → Guest Customers"):
   * totals/Money, shipping + billing address, payment method / PaymentIntent id,
   * internal notes, extensions, admin audit history, refund ledger.
   *
   * Carrier is read from the `orders.shipping_carrier` COLUMN only. The legacy
   * `extensions.carrier` / `extensions.trackingUrl` keys are never consulted:
   * migration 0022 backfilled the column, and a client-persisted tracking URL is
   * exactly the arbitrary-redirect vector the typed carrier boundary removes.
   * Pure module — no D1/Next/Clerk/Resend imports.
   */
  import { buildTrackingUrl, normalizeLegacyCarrier } from "@/lib/fulfillment/tracking";
  import { CARRIER_LABELS, type Carrier } from "@/lib/fulfillment/types";

  export interface GuestOrderProjectionItem {
    name: string;
    quantity: number;
  }

  export interface GuestOrderProjection {
    orderNumber: string;
    placedAt: string | null;
    status: string;
    shippedAt: string | null;
    carrier: Carrier | null;
    carrierLabel: string | null;
    trackingNumber: string | null;
    trackingUrl: string | null;
    items: GuestOrderProjectionItem[];
  }

  /**
   * Structural input shape — an `Order` satisfies it, but typing the parameter
   * structurally keeps this module free of the model layer AND makes the test
   * fixtures honest (they can carry every forbidden field an Order carries).
   */
  export interface GuestProjectionOrder {
    id?: string | null;
    created_at?: string | null;
    status: string;
    shipped_at?: string | null;
    shipping_carrier?: string | null;
    tracking_number?: string | null;
    items?: Array<{ product_name?: string; quantity?: number }> | null;
    // Anything else on the row is intentionally ignored.
    [key: string]: unknown;
  }

  export function buildGuestOrderProjection(order: GuestProjectionOrder): GuestOrderProjection {
    const carrier = normalizeLegacyCarrier(order.shipping_carrier ?? null);
    const trackingNumber = order.tracking_number ?? null;
    const items = Array.isArray(order.items) ? order.items : [];

    return {
      orderNumber: order.id ?? "",
      placedAt: order.created_at ?? null,
      status: order.status,
      shippedAt: order.shipped_at ?? null,
      carrier,
      carrierLabel: carrier ? CARRIER_LABELS[carrier] : null,
      trackingNumber,
      trackingUrl: buildTrackingUrl(carrier, trackingNumber),
      items: items.map((item) => ({
        name: typeof item?.product_name === "string" ? item.product_name : "Item",
        quantity: typeof item?.quantity === "number" ? item.quantity : 1,
      })),
    };
  }
  ```
- [ ] Run `npx vitest run tests/unit/lib/order-status/guest-projection.test.ts` — expect all tests green.
- [ ] Run `npm run lint && npx tsc --noEmit` — expect clean.
- [ ] Commit:
  ```bash
  git add lib/fulfillment/types.ts lib/order-status/guest-projection.ts tests/unit/lib/order-status/guest-projection.test.ts
  git commit -m "feat(order-status): add the guest order projection allowlist (BMC-216E)"
  ```

---

### Task 4: Signed guest order-status page

The fail-closed flow, in this exact order: rate-limit → token present → load order → resolve email → verify token → render projection. Any failure calls `notFound()` so a stranger cannot distinguish "no such order", "order has no email", "wrong token", and "you are being throttled".

**Files:**
- Create: `app/order-status/[id]/page.tsx`
- Test: `tests/unit/app/order-status-page.test.ts`

**Interfaces:**
- Consumes: `getOrderById(orderId: string): Promise<Order | null>` (`@/lib/models/mach/orders`); `getOrderCustomerEmail(order): string | null` (`@/lib/orders/customer-email`); `verifyOrderStatusToken(token: string, orderId: string, email: string): Promise<boolean>` (`@/lib/order-status/token`); `buildGuestOrderProjection` (Task 3); `enforceRateLimit("PUBLIC_RATE_LIMITER", key)` + `getClientIpFromHeaders` (Task 2); `formatDate` (`@/lib/utils/account`)
- Produces: route `${BASE_URL}/order-status/<orderId>?token=<token>` (the URL shape ticket C's shipping email builds), with `robots: { index: false, follow: false, nocache: true }` and `referrer: "no-referrer"` metadata

**Suggested agent:** opus — a fail-closed auth flow where an early-return ordering mistake becomes a data-leak or an existence oracle.

- [ ] Create `tests/unit/app/order-status-page.test.ts` with the page-level behaviour suite:
  ```ts
  /**
   * BMC-216E — page-level contract for the signed guest order-status page.
   *
   * Token round-trip/tampering primitives are covered by ticket A's token tests;
   * this file pins the PAGE: that every failure funnels into notFound() (no
   * existence oracle), that the order is not even loaded before the cheap checks
   * pass, and that a VALID token renders only the minimal projection — no
   * address, total, payment reference, or internal note anywhere in the tree.
   *
   * jsdom unit env: the model layer and the rate limiter are mocked, so nothing
   * here touches a Cloudflare binding. The real token module is used (pure Web
   * Crypto) so the page's verify wiring is exercised, not stubbed.
   */
  import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

  vi.mock('@/lib/models/mach/orders', () => ({ getOrderById: vi.fn() }));

  vi.mock('@/lib/rate-limit', () => ({
    enforceRateLimit: vi.fn().mockResolvedValue(null),
    getClientIpFromHeaders: vi.fn().mockReturnValue('1.2.3.4'),
  }));

  vi.mock('next/headers', () => ({
    headers: vi.fn().mockResolvedValue(new Headers({ 'CF-Connecting-IP': '1.2.3.4' })),
  }));

  vi.mock('next/navigation', () => ({
    notFound: () => {
      throw new Error('NEXT_NOT_FOUND');
    },
  }));

  import OrderStatusPage from '@/app/order-status/[id]/page';
  import { getOrderById } from '@/lib/models/mach/orders';
  import { enforceRateLimit } from '@/lib/rate-limit';
  import { createOrderStatusToken } from '@/lib/order-status/token';

  const ORDER_ID = 'WEB-GUEST-1753900000000';
  const EMAIL = 'guest@example.com';

  const shippedOrder = {
    id: ORDER_ID,
    customer_id: undefined,
    status: 'shipped',
    payment_status: 'paid',
    payment_method: 'stripe',
    total_amount: { amount: 4200, currency: 'USD' },
    currency_code: 'USD',
    shipping_address: {
      line1: '1 Secret St',
      city: 'Portland',
      region: 'OR',
      postal_code: '97201',
      country: 'US',
    },
    billing_address: { line1: '1 Secret St' },
    items: [
      { product_id: 'p1', sku: 'MB-1', product_name: 'Morning Blend', quantity: 2, unit_price: { amount: 2100, currency: 'USD' }, total_price: { amount: 4200, currency: 'USD' } },
    ],
    shipping_method: 'standard',
    notes: 'INTERNAL: fragile',
    external_references: { payment_intent_id: 'pi_secret_123' },
    extensions: { email: EMAIL },
    shipping_carrier: 'ups',
    tracking_number: '1Z999AA10123456784',
    shipped_at: '2026-07-28T18:00:00.000Z',
    delivered_at: null,
    created_at: '2026-07-25T12:00:00.000Z',
    updated_at: '2026-07-28T18:00:00.000Z',
  } as never;

  /** Walk a returned React element tree and collect every rendered string/number. */
  function collectText(node: unknown, out: string[] = []): string[] {
    if (node === null || node === undefined || typeof node === 'boolean') return out;
    if (typeof node === 'string' || typeof node === 'number') {
      out.push(String(node));
      return out;
    }
    if (Array.isArray(node)) {
      for (const child of node) collectText(child, out);
      return out;
    }
    if (typeof node === 'object') {
      const props = (node as { props?: Record<string, unknown> }).props;
      if (props) for (const value of Object.values(props)) collectText(value, out);
    }
    return out;
  }

  function renderPage(token?: string, id = ORDER_ID) {
    return OrderStatusPage({
      params: Promise.resolve({ id }),
      searchParams: Promise.resolve(token === undefined ? {} : { token }),
    });
  }

  async function validToken(orderId = ORDER_ID, email = EMAIL): Promise<string> {
    const token = await createOrderStatusToken(orderId, email);
    if (!token) throw new Error('token creation failed — is ORDER_STATUS_SECRET set?');
    return token;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ORDER_STATUS_SECRET = 'page-test-secret';
    vi.mocked(enforceRateLimit).mockResolvedValue(null);
    vi.mocked(getOrderById).mockResolvedValue(shippedOrder);
  });

  afterEach(() => {
    delete process.env.ORDER_STATUS_SECRET;
  });

  describe('guest order-status page — fail-closed flow', () => {
    it('404s when no token is supplied, without loading the order', async () => {
      await expect(renderPage()).rejects.toThrow('NEXT_NOT_FOUND');
      expect(getOrderById).not.toHaveBeenCalled();
    });

    it('404s when the caller is rate limited, without loading the order', async () => {
      vi.mocked(enforceRateLimit).mockResolvedValue({ status: 429 } as never);
      await expect(renderPage(await validToken())).rejects.toThrow('NEXT_NOT_FOUND');
      expect(getOrderById).not.toHaveBeenCalled();
    });

    it('rate limits on PUBLIC_RATE_LIMITER keyed by client IP', async () => {
      await renderPage(await validToken());
      expect(enforceRateLimit).toHaveBeenCalledWith('PUBLIC_RATE_LIMITER', 'order-status:1.2.3.4');
    });

    it('404s for an unknown order id', async () => {
      vi.mocked(getOrderById).mockResolvedValue(null);
      await expect(renderPage(await validToken())).rejects.toThrow('NEXT_NOT_FOUND');
    });

    it('404s when the order has no resolvable customer email', async () => {
      vi.mocked(getOrderById).mockResolvedValue({
        ...(shippedOrder as object),
        extensions: {},
        shipping_address: { line1: '1 Secret St' },
      } as never);
      await expect(renderPage(await validToken())).rejects.toThrow('NEXT_NOT_FOUND');
    });

    it('404s for a tampered token', async () => {
      const token = await validToken();
      const tampered = token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A');
      await expect(renderPage(tampered)).rejects.toThrow('NEXT_NOT_FOUND');
    });

    it('404s for a repeated ?token= param (array value)', async () => {
      const token = await validToken();
      await expect(
        OrderStatusPage({
          params: Promise.resolve({ id: ORDER_ID }),
          searchParams: Promise.resolve({ token: [token, token] as never }),
        }),
      ).rejects.toThrow('NEXT_NOT_FOUND');
    });

    it('404s when ORDER_STATUS_SECRET is unset (fail closed)', async () => {
      const token = await validToken();
      delete process.env.ORDER_STATUS_SECRET;
      await expect(renderPage(token)).rejects.toThrow('NEXT_NOT_FOUND');
    });
  });

  describe('guest order-status page — valid token renders the minimal projection', () => {
    it('renders order number, status, shipment and item names', async () => {
      const text = collectText(await renderPage(await validToken())).join(' ');

      expect(text).toContain(ORDER_ID);
      expect(text).toContain('shipped');
      expect(text).toContain('Morning Blend');
      expect(text).toContain('1Z999AA10123456784');
      expect(text).toContain('UPS');
      expect(text).toContain('https://www.ups.com/track');
    });

    it('renders NOTHING outside the allowlist', async () => {
      const text = collectText(await renderPage(await validToken())).join(' ');

      for (const forbidden of [
        'Secret St',
        'Portland',
        '97201',
        'pi_secret_123',
        'INTERNAL',
        EMAIL,
        '$42.00',
        '4200',
        'stripe',
      ]) {
        expect(text).not.toContain(forbidden);
      }
    });

    it('omits the shipment block for an order that has not shipped', async () => {
      vi.mocked(getOrderById).mockResolvedValue({
        ...(shippedOrder as object),
        status: 'processing',
        shipping_carrier: null,
        tracking_number: null,
        shipped_at: null,
      } as never);

      const text = collectText(await renderPage(await validToken())).join(' ');

      expect(text).toContain('processing');
      expect(text).not.toContain('Shipment');
      expect(text).not.toContain('Track your package');
    });

    it('shows an "other" carrier tracking number with no carrier link', async () => {
      vi.mocked(getOrderById).mockResolvedValue({
        ...(shippedOrder as object),
        shipping_carrier: 'other',
        tracking_number: 'DHL-123',
      } as never);

      const text = collectText(await renderPage(await validToken())).join(' ');

      expect(text).toContain('DHL-123');
      expect(text).not.toContain('Track your package');
      expect(text).not.toContain('ups.com');
      expect(text).not.toContain('fedex.com');
    });
  });

  describe('guest order-status page — metadata hardening', () => {
    it('is noindex and no-referrer so the bearer token never leaks', async () => {
      const { metadata } = await import('@/app/order-status/[id]/page');
      expect(metadata.robots).toMatchObject({ index: false, follow: false });
      expect(metadata.referrer).toBe('no-referrer');
    });
  });
  ```
- [ ] Run `npx vitest run tests/unit/app/order-status-page.test.ts` — expect failure: cannot resolve `@/app/order-status/[id]/page`.
- [ ] Create `app/order-status/[id]/page.tsx` with the complete implementation:
  ```tsx
  /**
   * === Guest Order Status (BMC-216E) ===
   *
   * Guest checkout leaves customers with no account to log into, so the shipping
   * email links here with an HMAC bearer token:
   *
   *   ${BASE_URL}/order-status/<orderId>?token=<token>
   *
   * The token is a signature over `order-status:v1:<orderId>:<email>` — it carries
   * no payload, so the page must re-derive the email from the order and verify
   * against it (lib/order-status/token.ts).
   *
   * FAIL-CLOSED FLOW — the order matters:
   *   1. rate limit by client IP (PUBLIC_RATE_LIMITER, BMC-180 convention)
   *   2. token present in the query
   *   3. order exists
   *   4. the order resolves to a customer email
   *   5. the signature verifies for THIS order + THIS email
   * Every failure returns notFound(). Identical outcomes for "no such order",
   * "no email on file", "wrong token", and "throttled" mean a stranger cannot use
   * the (enumerable) order id as an existence oracle. Steps 1–2 run before the D1
   * read so an unauthenticated flood cannot turn into database load.
   *
   * The rendered page is built ONLY from buildGuestOrderProjection — see that
   * module for the allowlist. Metadata is noindex + no-referrer so the token in
   * this URL is not indexed and is not forwarded in the Referer header when the
   * customer clicks through to the carrier's site.
   */
  import type { Metadata } from "next";
  import Link from "next/link";
  import { headers } from "next/headers";
  import { notFound } from "next/navigation";
  import { getOrderById } from "@/lib/models/mach/orders";
  import { getOrderCustomerEmail } from "@/lib/orders/customer-email";
  import { verifyOrderStatusToken } from "@/lib/order-status/token";
  import { buildGuestOrderProjection } from "@/lib/order-status/guest-projection";
  import { enforceRateLimit, getClientIpFromHeaders } from "@/lib/rate-limit";
  import { formatDate } from "@/lib/utils/account";

  export const metadata: Metadata = {
    title: "Order Status - BeauTeas",
    // noindex: the URL contains a bearer token. no-referrer: the outbound carrier
    // link must not forward that token in the Referer header.
    robots: { index: false, follow: false, nocache: true },
    referrer: "no-referrer",
  };

  export default async function GuestOrderStatusPage({
    params,
    searchParams,
  }: {
    params: Promise<{ id: string }>;
    searchParams: Promise<{ token?: string | string[] }>;
  }) {
    const [{ id }, query] = await Promise.all([params, searchParams]);

    const limited = await enforceRateLimit(
      "PUBLIC_RATE_LIMITER",
      `order-status:${getClientIpFromHeaders(await headers())}`,
    );
    if (limited) notFound();

    // A repeated ?token= yields an array; treat anything but a single string as absent.
    const token = typeof query.token === "string" ? query.token : null;
    if (!token) notFound();

    const order = await getOrderById(id);
    if (!order) notFound();

    const email = getOrderCustomerEmail(order);
    if (!email) notFound();

    const verified = await verifyOrderStatusToken(token, id, email);
    if (!verified) notFound();

    const view = buildGuestOrderProjection(order);

    return (
      <main className="min-h-screen px-4 py-12">
        <div className="mx-auto w-full max-w-2xl">
          <p className="text-sm text-text-secondary">BeauTeas order status</p>
          <h1 className="text-2xl font-bold text-text-primary mt-1 break-all">
            Order {view.orderNumber}
          </h1>
          <p className="text-sm text-text-secondary mt-1">Placed {formatDate(view.placedAt)}</p>

          <div className="bg-white border border-border-default rounded-lg p-5 mt-6">
            <h2 className="text-sm font-medium text-text-secondary mb-2">Status</h2>
            <p className="text-lg font-semibold text-text-primary capitalize">
              {view.status.replace(/_/g, " ")}
            </p>
          </div>

          {view.shippedAt && (
            <div className="bg-white border border-border-default rounded-lg p-5 mt-4">
              <h2 className="text-sm font-medium text-text-secondary mb-3">Shipment</h2>
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between gap-4">
                  <dt className="text-text-secondary">Shipped</dt>
                  <dd className="text-text-primary">{formatDate(view.shippedAt)}</dd>
                </div>
                {view.carrierLabel && (
                  <div className="flex justify-between gap-4">
                    <dt className="text-text-secondary">Carrier</dt>
                    <dd className="text-text-primary">{view.carrierLabel}</dd>
                  </div>
                )}
                {view.trackingNumber && (
                  <div className="flex justify-between gap-4">
                    <dt className="text-text-secondary">Tracking number</dt>
                    <dd className="text-text-primary font-mono break-all">{view.trackingNumber}</dd>
                  </div>
                )}
              </dl>
              {view.trackingUrl && (
                <a
                  href={view.trackingUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-center mt-4 text-sm font-medium text-primary-700 underline hover:text-primary-900"
                >
                  Track your package
                </a>
              )}
            </div>
          )}

          <div className="bg-white border border-border-default rounded-lg p-5 mt-4">
            <h2 className="text-sm font-medium text-text-secondary mb-3">Items</h2>
            <ul className="space-y-2">
              {view.items.map((item, i) => (
                <li key={i} className="flex justify-between gap-4 text-sm">
                  <span className="text-text-primary">{item.name}</span>
                  <span className="text-text-secondary">Qty: {item.quantity}</span>
                </li>
              ))}
            </ul>
          </div>

          <p className="text-sm text-text-secondary mt-6">
            Questions about this order?{" "}
            <Link href="/contact" className="text-primary-700 underline hover:text-primary-900">
              Contact us
            </Link>
            .
          </p>
        </div>
      </main>
    );
  }
  ```
- [ ] Run `npx vitest run tests/unit/app/order-status-page.test.ts` — expect all tests green.
- [ ] Run `npm run lint && npx tsc --noEmit` — expect clean.
- [ ] Commit:
  ```bash
  git add app/order-status tests/unit/app/order-status-page.test.ts
  git commit -m "feat(order-status): add the signed guest order-status page (BMC-216E)"
  ```

---

### Task 5: Registered-account shipment card

The account order page currently renders no tracking at all. Add a shipment card between the status timeline and the items list. The Clerk ownership check (`order.customer_id !== userId → notFound()`) is untouched — the new tests pin it so a future edit to this file cannot silently weaken it.

**Files:**
- Modify: `app/account/orders/[id]/page.tsx` (imports ~:1-8; derived values after `const items = …` ~:78; new card inserted after the status card ~:98-101)
- Test: `tests/unit/app/account-order-detail.test.ts`

**Interfaces:**
- Consumes: `normalizeLegacyCarrier`, `buildTrackingUrl` (`@/lib/fulfillment/tracking`), `CARRIER_LABELS` (`@/lib/fulfillment/types`), `Order.shipping_carrier` (Task 1)
- Produces: nothing new (page-local rendering)

**Suggested agent:** sonnet — additive JSX against an established page, with the ownership guard as a regression fence.

- [ ] Create `tests/unit/app/account-order-detail.test.ts`:
  ```ts
  /**
   * BMC-216E — registered-customer order detail: ownership + shipment card.
   *
   * The ownership guard predates this ticket; these tests fence it so the new
   * shipment card cannot be the edit that weakens it. The shipment assertions pin
   * the three states that matter: linkable carrier, "other" carrier (number, no
   * link), and never-shipped (no card at all — only the status line).
   */
  import { describe, it, expect, vi, beforeEach } from 'vitest';

  vi.mock('@clerk/nextjs/server', () => ({ auth: vi.fn() }));
  vi.mock('@/lib/models/mach/orders', () => ({ getOrderById: vi.fn() }));
  vi.mock('next/navigation', () => ({
    notFound: () => {
      throw new Error('NEXT_NOT_FOUND');
    },
  }));

  import OrderDetailPage from '@/app/account/orders/[id]/page';
  import { auth } from '@clerk/nextjs/server';
  import { getOrderById } from '@/lib/models/mach/orders';

  const ORDER_ID = 'WEB-user_owner-1753900000000';
  const OWNER = 'user_owner';

  const shippedOrder = {
    id: ORDER_ID,
    customer_id: OWNER,
    status: 'shipped',
    payment_status: 'paid',
    payment_method: 'stripe',
    total_amount: { amount: 4200, currency: 'USD' },
    currency_code: 'USD',
    shipping_address: { line1: '1 Main St', city: 'Portland', region: 'OR', postal_code: '97201', country: 'US' },
    items: [
      { product_id: 'p1', sku: 'MB-1', product_name: 'Morning Blend', quantity: 2, unit_price: { amount: 2100, currency: 'USD' }, total_price: { amount: 4200, currency: 'USD' } },
    ],
    shipping_carrier: 'ups',
    tracking_number: '1Z999AA10123456784',
    shipped_at: '2026-07-28T18:00:00.000Z',
    created_at: '2026-07-25T12:00:00.000Z',
  } as never;

  function collectText(node: unknown, out: string[] = []): string[] {
    if (node === null || node === undefined || typeof node === 'boolean') return out;
    if (typeof node === 'string' || typeof node === 'number') {
      out.push(String(node));
      return out;
    }
    if (Array.isArray(node)) {
      for (const child of node) collectText(child, out);
      return out;
    }
    if (typeof node === 'object') {
      const props = (node as { props?: Record<string, unknown> }).props;
      if (props) for (const value of Object.values(props)) collectText(value, out);
    }
    return out;
  }

  function renderPage() {
    return OrderDetailPage({ params: Promise.resolve({ id: ORDER_ID }) });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue({ userId: OWNER } as never);
    vi.mocked(getOrderById).mockResolvedValue(shippedOrder);
  });

  describe('account order detail — ownership', () => {
    it('404s for an anonymous visitor', async () => {
      vi.mocked(auth).mockResolvedValue({ userId: null } as never);
      await expect(renderPage()).rejects.toThrow('NEXT_NOT_FOUND');
    });

    it('404s for a signed-in non-owner', async () => {
      vi.mocked(auth).mockResolvedValue({ userId: 'user_other' } as never);
      await expect(renderPage()).rejects.toThrow('NEXT_NOT_FOUND');
    });

    it('404s for a missing order', async () => {
      vi.mocked(getOrderById).mockResolvedValue(null);
      await expect(renderPage()).rejects.toThrow('NEXT_NOT_FOUND');
    });
  });

  describe('account order detail — shipment card', () => {
    it('shows shipped date, carrier, tracking number and a carrier link', async () => {
      const text = collectText(await renderPage()).join(' ');

      expect(text).toContain('Shipment');
      expect(text).toContain('UPS');
      expect(text).toContain('1Z999AA10123456784');
      expect(text).toContain('https://www.ups.com/track');
      expect(text).toContain('Track your package');
    });

    it('shows an "other" carrier tracking number with no link', async () => {
      vi.mocked(getOrderById).mockResolvedValue({
        ...(shippedOrder as object),
        shipping_carrier: 'other',
        tracking_number: 'DHL-123',
      } as never);

      const text = collectText(await renderPage()).join(' ');

      expect(text).toContain('DHL-123');
      expect(text).not.toContain('Track your package');
      expect(text).not.toContain('ups.com');
    });

    it('hides the shipment card entirely for an order that never shipped', async () => {
      vi.mocked(getOrderById).mockResolvedValue({
        ...(shippedOrder as object),
        status: 'processing',
        shipping_carrier: null,
        tracking_number: null,
        shipped_at: null,
      } as never);

      const text = collectText(await renderPage()).join(' ');

      expect(text).not.toContain('Shipment');
      expect(text).not.toContain('Track your package');
      // The status line still renders.
      expect(text).toContain('processing');
    });

    it('ignores a legacy extensions.trackingUrl', async () => {
      vi.mocked(getOrderById).mockResolvedValue({
        ...(shippedOrder as object),
        shipping_carrier: null,
        extensions: { trackingUrl: 'https://evil.example.com/track' },
      } as never);

      const text = collectText(await renderPage()).join(' ');

      expect(text).not.toContain('evil.example.com');
    });
  });
  ```
- [ ] Run `npx vitest run tests/unit/app/account-order-detail.test.ts` — expect the three ownership tests to pass and all four shipment-card tests to fail (the card does not exist yet).
- [ ] Add the imports to `app/account/orders/[id]/page.tsx`, directly below the existing `import { Money } from "@/lib/money";` line:
  ```ts
  import { buildTrackingUrl, normalizeLegacyCarrier } from "@/lib/fulfillment/tracking";
  import { CARRIER_LABELS } from "@/lib/fulfillment/types";
  ```
- [ ] Add the derived shipment values in `OrderDetailPage`, directly below `const items = Array.isArray(order.items) ? order.items : [];`:
  ```ts
    // Carrier comes from the shipping_carrier COLUMN only — migration 0022
    // backfilled it, and extensions.carrier / extensions.trackingUrl are no longer
    // authoritative (a stored, client-supplied URL is an open-redirect vector).
    // normalizeLegacyCarrier is defensive for any row that escaped the backfill.
    const carrier = normalizeLegacyCarrier(order.shipping_carrier ?? null);
    const carrierLabel = carrier ? CARRIER_LABELS[carrier] : null;
    const trackingUrl = buildTrackingUrl(carrier, order.tracking_number ?? null);
  ```
- [ ] Insert the shipment card in the returned JSX, directly after the closing `</div>` of the `{/* Status timeline */}` block and before `{/* Order items */}`:
  ```tsx
        {/* Shipment — rendered only once the order has actually shipped (BMC-216E).
            Before that, the status timeline above is the whole story. */}
        {order.shipped_at && (
          <div className="bg-white border border-border-default rounded-lg p-5 mb-6">
            <h2 className="text-sm font-medium text-text-secondary mb-3">Shipment</h2>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-text-secondary">Shipped</dt>
                <dd className="text-text-primary">{formatDate(order.shipped_at)}</dd>
              </div>
              {carrierLabel && (
                <div className="flex justify-between gap-4">
                  <dt className="text-text-secondary">Carrier</dt>
                  <dd className="text-text-primary">{carrierLabel}</dd>
                </div>
              )}
              {order.tracking_number && (
                <div className="flex justify-between gap-4">
                  <dt className="text-text-secondary">Tracking number</dt>
                  <dd className="text-text-primary font-mono break-all">{order.tracking_number}</dd>
                </div>
              )}
            </dl>
            {trackingUrl && (
              <a
                href={trackingUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center mt-4 text-sm font-medium text-primary-700 underline hover:text-primary-900"
              >
                Track your package
              </a>
            )}
          </div>
        )}
  ```
- [ ] Run `npx vitest run tests/unit/app/account-order-detail.test.ts` — expect all tests green.
- [ ] Run `npm run lint && npx tsc --noEmit` — expect clean.
- [ ] Commit:
  ```bash
  git add app/account/orders/\[id\]/page.tsx tests/unit/app/account-order-detail.test.ts
  git commit -m "feat(account): show a shipment card on the order detail page (BMC-216E)"
  ```

---

## Verification

**Automated gates (all must pass before claiming completion):**

- [ ] `npm run lint` — clean.
- [ ] `npx tsc --noEmit` — zero errors.
- [ ] `npm test` — the full unit suite green, including the four files touched/added by this ticket:
  - `tests/unit/lib/rate-limit.test.ts`
  - `tests/unit/lib/order-status/guest-projection.test.ts`
  - `tests/unit/app/order-status-page.test.ts`
  - `tests/unit/app/account-order-detail.test.ts`
- [ ] `npm run build` — succeeds (catches Next 15 `PageProps` typing on the new dynamic route).

**Manual checks under `npm run preview:dev`** (the Workers runtime — plain `next dev` 500s on D1 routes and has no rate-limit binding):

- [ ] Precondition: `ORDER_STATUS_SECRET` is set in `.dev.vars` (the Workers runtime does NOT read `.env.local`). If ticket A's rollout step has not been done yet, add it now.
- [ ] Precondition: pick a local order id and put it into a shipped state:
  ```bash
  npx wrangler d1 execute beauteas-db-dev --local --env dev --command \
    "UPDATE orders SET status='shipped', shipped_at='2026-07-29T18:00:00.000Z', shipping_carrier='ups', tracking_number='1Z999AA10123456784' WHERE id='<order-id>'"
  ```
- [ ] Mint a guest token for that order (same secret as `.dev.vars`, same email the order resolves to):
  ```bash
  ORDER_STATUS_SECRET='<secret>' npx tsx -e "import('./lib/order-status/token.ts').then(async m => console.log(await m.createOrderStatusToken('<order-id>', '<customer-email>')))"
  ```
- [ ] Visit `http://localhost:8787/order-status/<order-id>?token=<token>` — expect order number, placed date, status, a Shipment block with the UPS label + tracking number + a working "Track your package" link, and item names with quantities. Expect **no** address, no total, no payment reference.
- [ ] **Forged-token 404 check:** change the last character of the token and reload — expect the site 404 page (HTTP 404, not a 200 shell). Confirm with `curl -s -o /dev/null -w '%{http_code}\n' 'http://localhost:8787/order-status/<order-id>?token=<tampered>'` → `404`.
- [ ] Visit the same URL with `?token=` removed → 404. Visit `/order-status/DOES-NOT-EXIST?token=<token>` → 404 (identical page — no existence oracle).
- [ ] View source on the valid page: expect `<meta name="robots" content="noindex, nofollow, nocache">` and `<meta name="referrer" content="no-referrer">`.
- [ ] Sign in as the order's owner and visit `http://localhost:8787/account/orders/<order-id>` — expect the new Shipment card with the same carrier/tracking data and a working carrier link.
- [ ] Set that order to `shipping_carrier='other'` and reload both pages — expect the tracking number to render with **no** link.
- [ ] Set `shipped_at=NULL, status='processing'` and reload both pages — expect no Shipment card at all, status line still present.

## Contract Deviations

All three are **additive** — no contract name, signature, path, or wire shape was renamed or changed.

1. **`lib/rate-limit.ts` gains `getClientIpFromHeaders(headers)`** (Task 2). The contract mandates "rate-limit by IP via `enforceRateLimit` + `PUBLIC_RATE_LIMITER`" but the existing key helper takes a `Request`, which a server component does not have. `getClientIp(req: Request)` keeps its exact signature and now delegates, so all existing call sites (`/api/tax`, `/api/validate-discount`, …) are unchanged and the IP precedence has one implementation. Rate-limit key: `order-status:<ip>`.
2. **`lib/order-status/guest-projection.ts` is a new E-owned file** not listed in the contract's "New files and owners" table (which lists only `app/order-status/[id]/page.tsx` for E). It exists because the guest allowlist must be unit-testable as a pure function rather than asserted against JSX.
3. **`CARRIER_LABELS: Record<Carrier, string>` is appended to the A-owned `lib/fulfillment/types.ts`** rather than duplicated in three places. That file's stated responsibility is "Carrier/event/actor types and constants", and ticket D's admin queue needs the same map. If D lands an equivalent map first, reuse theirs (trivial merge conflict at worst).

**Assumption flagged for the implementer:** Task 1 assumes ticket A added `orders.shipping_carrier` via migration `0022` and the Drizzle table definition. If the column exists in SQL but is not surfaced through `hydrateOrder`/the `Order` type, Task 1 adds it; if migration `0022` itself has not landed, **stop and escalate** — E cannot read a column that does not exist.
