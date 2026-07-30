# BMC-216F: Legacy Route Hardening and Regression Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lock down `PUT /api/orders` to a `notes`/`external_references`/`extensions` allowlist with explicit endpoint-naming 400s, delete its email-on-status-change path, strip client `carrier`/`trackingUrl` in `mergeExtensions`, fully escape the legacy status-update email template (removing the stored-`trackingUrl` link block), and prove with regression tests that no alternate API can set fulfillment fields.

**Architecture:** All new validation lives in the existing pure-guard module `lib/utils/order-update-guards.ts` (dependency-free, directly unit-testable); the route handler in `app/api/orders/route.ts` becomes a thin metadata-only updater that keeps every existing protection (payment-status silent drop, refund-ledger merge, corrupt-extensions fail-closed). The legacy email template in `lib/utils/email.ts` stays alive for the refund route's cancellation/refund emails but every interpolation is escaped and the tracking link is gone. Tests are unit-style under `tests/unit/**` with the model/DB layer mocked (the established `orders-put-*.test.ts` pattern) so CI actually gates them.

**Tech Stack:** Next.js 15 App Router route handlers, Drizzle ORM on D1 (mocked in tests), Vitest 4 (jsdom, `vi.mock`), Resend (mocked via the `subscription-created-email.test.ts` pattern).

**Depends on:** BMC-216B (ship endpoint exists — the new 400 messages name `POST /api/admin/orders/{id}/ship` and `PATCH /api/admin/orders/{id}/tracking`, which must be real), BMC-216D (admin UI no longer calls PUT for shipment — `app/admin/orders/page.tsx:171-174` still PUTs `status`/`tracking_number` today and would break the moment this lands) — **deploy after both. Do NOT touch admin UI files in this ticket; ticket D owns them.**

**Interface contract:** docs/superpowers/plans/2026-07-30-bmc-216-interfaces.md (binding)

## Global Constraints

- Tests live under `tests/unit/**` only (CI runs nothing else). Mock the model layer with `vi.mock("@/lib/models/…")` — unit tests must not touch Cloudflare bindings.
- `npm run lint` and `npx tsc --noEmit` must pass before every commit claim.
- Money: all monetary display/serialization through `lib/money` — never raw `*100`/`/100`.
- D1: `db.batch()` for atomic writes; no `db.transaction()`.
- Files kebab-case; components PascalCase; `@/*` path alias.
- Pure modules (`lib/fulfillment/tracking.ts`, `transitions.ts`, `lib/order-status/token.ts`, `lib/orders/customer-email.ts`) must import nothing from D1/Next/Clerk/Resend. (This ticket's guard module `lib/utils/order-update-guards.ts` follows the same rule.)
- Migration files: next free numbers `0022`, `0023`. Never renumber existing migrations. D1 LIKE patterns are capped at 50 chars — use `json_extract`, not long LIKE guards. (No migrations in this ticket.)
- `ORDER_STATUS_SECRET` typing is hand-added to `cloudflare-env.d.ts` — never regenerate that file wholesale. (Not touched by this ticket.)

---

## Verified line anchors (checked 2026-07-30)

| File | What | Where |
|---|---|---|
| `app/api/orders/route.ts` | PUT handler | :524–672 |
| | body destructure | :534 |
| | `status is required` check (to delete) | :543–548 |
| | `validatePutOrderStatus` call (to delete) | :557–560 |
| | payment_status silent-drop guard (PRESERVE) | :575–592 |
| | `mergeExtensions` block (PRESERVE) | :594–611 |
| | `updateData` incl. verbatim `shipped_at`/`delivered_at` writes | :616–626 |
| | email-on-status-change block (DELETE) | :634–644 |
| | status-referencing audit `console.log` | :646–654 |
| | `transformOrderForEmail` (dead after email-block deletion — DELETE) | :748–793 |
| | unused-after-this-ticket imports `updateOrderStatus`/`updateOrderShipping` | :18–19 |
| | `sendOrderStatusUpdateEmail` import (PUT-only usage — DELETE) | :23 |
| `lib/utils/order-update-guards.ts` | `validatePutOrderStatus` (superseded — DELETE in Task 3) | :63–84 |
| | `mergeExtensions` (payment_intent_id re-pin :176–182; corrupt-JSON fail-closed :152–165 — both PRESERVE) | :146–185 |
| `lib/utils/email.ts` | `generateOrderStatusUpdateHTML` | :248–427 |
| | raw `carrier` / `trackingNumber` / `trackingUrl` link block | :284 / :285 / :286–290 |
| | raw `cancellationReason` | :312 |
| | raw item `alt`/`src`/name | :345, :348 |
| | raw `customerName` | :377 |
| | raw `orderNumber` / `status` | :382–383 |
| | raw `notes` | :388 |
| | raw shipping address | :410–412 |
| | `escapeHtml` — **a hoisted `function` declaration at :515**, so it is already callable from :248; no move/conversion needed | :515–522 |
| `app/api/orders/refund/route.ts` | `sendOrderStatusUpdateEmail` call (keeps template alive) | :455 |
| | `buildRefundStatusEmail` still passes `trackingUrl: extensions.trackingUrl` (fine — template will simply ignore it) | :571–574 |
| `lib/types/order.ts` | `UpdateOrderRequest` (narrow to allowlist; only referenced by `app/api/orders/route.ts`) | :101–111 |

**Existing tests that must be UPDATED (not deleted):**

- `tests/unit/lib/utils/order-update-guards.test.ts` — `validatePutOrderStatus` describes replaced by `validatePutOrderBody` describes (Task 1/3); several `mergeExtensions` tests use `carrier` as the "innocent client key" and assert it applies — after Task 2 the client's `carrier` is stripped.
- `tests/unit/app/api/orders-put-transition-guard.test.ts` — `refunded`/`cancelled` expectations move 422→400; the "still allows shipped" test and every body carrying `status: 'shipped'` must be reworked to metadata-only bodies.
- `tests/unit/app/api/orders-put-payment-status.test.ts` — both tests send `status`/`tracking_number` which now 400; rework to `notes`-based bodies while keeping the payment_status-dropped assertion.

**Existing regression suites that must stay green untouched:** `tests/unit/app/api/webhooks-stripe-charge-verification.test.ts` + `webhooks-stripe-dedup.test.ts` (payment promotion → `processing`), `tests/unit/app/api/orders-refund-idempotency.test.ts` (refund route owns cancelled/refunded; ledger not overwritable), `tests/unit/lib/services/inventory-adjustment.test.ts` (restock idempotency), `tests/unit/lib/services/order-finalization.test.ts` (inventory decrements at payment).

---

### Task 1: Pure PUT-body allowlist guard (`validatePutOrderBody`)

**Files:**
- Modify: `lib/utils/order-update-guards.ts` (add below `validatePutOrderStatus` at :84; do NOT delete `validatePutOrderStatus` yet — the route still imports it until Task 3)
- Test: `tests/unit/lib/utils/order-update-guards.test.ts` (append new describe)

**Interfaces:**
- Consumes: nothing (pure).
- Produces: `validatePutOrderBody(body): { ok: true } | { ok: false; error: string; status: number }` and `PUT_UPDATABLE_FIELDS` — consumed by Task 3's route rework. (Internal to ticket F; not a cross-ticket contract name.)

**Suggested agent:** opus — this is the security allowlist itself; the rejected-field set and messages are the contract surface.

- [ ] **Step 1.1** — Write the failing test. Append to `tests/unit/lib/utils/order-update-guards.test.ts` (import line becomes `import { validatePutOrderStatus, mergeExtensions, validatePutOrderBody } from '@/lib/utils/order-update-guards';`):

```ts
describe('validatePutOrderBody — PUT /api/orders allowlist (BMC-216F)', () => {
  it('rejects "status" with 400 naming the ship and refund endpoints', () => {
    const r = validatePutOrderBody({ orderId: 'O-1', status: 'shipped' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(400);
      expect(r.error).toContain('POST /api/admin/orders/{id}/ship');
      expect(r.error).toContain('POST /api/orders/refund');
    }
  });

  it('rejects "tracking_number" with 400 naming the ship/tracking endpoints', () => {
    const r = validatePutOrderBody({ orderId: 'O-1', tracking_number: '1Z999' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(400);
      expect(r.error).toContain('PATCH /api/admin/orders/{id}/tracking');
    }
  });

  it.each(['shipped_at', 'delivered_at'])(
    'rejects client timestamp "%s" with 400 (server-owned)',
    (field) => {
      const r = validatePutOrderBody({ orderId: 'O-1', [field]: '2026-07-30T00:00:00Z' });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.status).toBe(400);
        expect(r.error).toContain(field);
      }
    }
  );

  it('rejects "shipping_method" with 400', () => {
    const r = validatePutOrderBody({ orderId: 'O-1', shipping_method: 'express' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
  });

  it.each(['trackingUrl', 'tracking_url'])(
    'rejects any tracking URL key ("%s") with 400',
    (field) => {
      const r = validatePutOrderBody({ orderId: 'O-1', [field]: 'https://evil.example/x' });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.status).toBe(400);
        expect(r.error).toMatch(/tracking url/i);
      }
    }
  );

  it('rejects a rejected key even when its value is null (presence is the offense)', () => {
    const r = validatePutOrderBody({ orderId: 'O-1', status: null, notes: 'x' });
    expect(r.ok).toBe(false);
  });

  it('accepts notes-only, external_references-only, and extensions-only bodies', () => {
    expect(validatePutOrderBody({ orderId: 'O-1', notes: 'hold at door' }).ok).toBe(true);
    expect(validatePutOrderBody({ orderId: 'O-1', external_references: { erp: 'X-1' } }).ok).toBe(true);
    expect(validatePutOrderBody({ orderId: 'O-1', extensions: { gift_note: 'hi' } }).ok).toBe(true);
  });

  it('does NOT reject payment_status here (route preserves the BMC-140 silent drop)', () => {
    expect(validatePutOrderBody({ orderId: 'O-1', payment_status: 'paid', notes: 'x' }).ok).toBe(true);
  });

  it('rejects a body with no updatable fields with 400', () => {
    const r = validatePutOrderBody({ orderId: 'O-1' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(400);
      expect(r.error).toMatch(/notes, external_references, extensions/);
    }
  });
});
```

- [ ] **Step 1.2** — Run: `npx vitest run tests/unit/lib/utils/order-update-guards.test.ts`. Expect FAIL: `validatePutOrderBody` is not exported (import/undefined error).
- [ ] **Step 1.3** — Implement. Append to `lib/utils/order-update-guards.ts` after `validatePutOrderStatus` (line 84):

```ts
/**
 * BMC-216F: PUT /api/orders allowlist.
 *
 * After BMC-216 every lifecycle transition has a dedicated owner — the Stripe
 * webhook (pending → processing), POST /api/admin/orders/{id}/ship
 * (processing → shipped), and POST /api/orders/refund (→ cancelled/refunded).
 * Nothing legitimate is left for a generic status/fulfillment write, so this
 * route accepts ONLY order metadata: `notes`, `external_references`, and the
 * (further restricted, merged) `extensions`. Every fulfillment field is
 * rejected with a 400 whose message names the correct endpoint.
 *
 * `payment_status` is deliberately NOT in the rejected map: the route keeps
 * the BMC-140 behavior of logging + silently dropping it (changing that to a
 * 400 would break existing webhook/automation callers that harmlessly echo it).
 */
export const PUT_UPDATABLE_FIELDS = ['notes', 'external_references', 'extensions'] as const;

const SHIP_ENDPOINT = 'POST /api/admin/orders/{id}/ship';
const TRACKING_ENDPOINT = 'PATCH /api/admin/orders/{id}/tracking';
const REFUND_ENDPOINT = 'POST /api/orders/refund';

const PUT_REJECTED_FIELD_MESSAGES: Record<string, string> = {
  status:
    `"status" cannot be set via PUT /api/orders. Shipments are created via ` +
    `${SHIP_ENDPOINT}; cancellations and refunds go through ${REFUND_ENDPOINT}, ` +
    `which issues the Stripe refund and updates payment_status atomically.`,
  tracking_number:
    `"tracking_number" cannot be set via PUT /api/orders. Use ${SHIP_ENDPOINT} ` +
    `to create a shipment, or ${TRACKING_ENDPOINT} to correct tracking on a ` +
    `shipped order.`,
  shipped_at:
    `"shipped_at" cannot be set via PUT /api/orders — shipment timestamps are ` +
    `server-owned. Use ${SHIP_ENDPOINT}.`,
  delivered_at:
    `"delivered_at" cannot be set via PUT /api/orders — delivery timestamps are ` +
    `server-owned.`,
  shipping_method:
    `"shipping_method" cannot be changed via PUT /api/orders. Carrier changes ` +
    `go through ${SHIP_ENDPOINT} or ${TRACKING_ENDPOINT}.`,
  trackingUrl:
    `Tracking URL fields cannot be set via PUT /api/orders — tracking URLs are ` +
    `derived server-side from carrier + tracking number. Use ${SHIP_ENDPOINT} ` +
    `or ${TRACKING_ENDPOINT}.`,
  tracking_url:
    `Tracking URL fields cannot be set via PUT /api/orders — tracking URLs are ` +
    `derived server-side from carrier + tracking number. Use ${SHIP_ENDPOINT} ` +
    `or ${TRACKING_ENDPOINT}.`,
};

/**
 * Validates a PUT /api/orders body against the allowlist. Key PRESENCE (not
 * truthiness) is what rejects — `{ status: null }` is still an attempt to
 * touch a rejected field. Returns a discriminated result (never throws).
 */
export function validatePutOrderBody(
  body: Record<string, unknown>
): { ok: true } | { ok: false; error: string; status: number } {
  for (const [field, message] of Object.entries(PUT_REJECTED_FIELD_MESSAGES)) {
    if (field in body) {
      return { ok: false, error: message, status: 400 };
    }
  }
  const hasUpdatable = PUT_UPDATABLE_FIELDS.some((f) => body[f] !== undefined);
  if (!hasUpdatable) {
    return {
      ok: false,
      error:
        'No updatable fields provided. PUT /api/orders accepts only: ' +
        'notes, external_references, extensions.',
      status: 400,
    };
  }
  return { ok: true };
}
```

- [ ] **Step 1.4** — Run: `npx vitest run tests/unit/lib/utils/order-update-guards.test.ts`. Expect PASS (all existing describes still green — nothing existing was touched).
- [ ] **Step 1.5** — Gates + commit:

```bash
npm run lint && npx tsc --noEmit
git add lib/utils/order-update-guards.ts tests/unit/lib/utils/order-update-guards.test.ts
git commit -m "feat(orders): add validatePutOrderBody allowlist guard for PUT /api/orders (BMC-216F)"
```

---

### Task 2: `mergeExtensions` strips client `carrier` and `trackingUrl`

**Files:**
- Modify: `lib/utils/order-update-guards.ts` (:167–184, the merge body — the payment_intent_id re-pin at :176–182 and the corrupt-stored fail-closed at :152–165 must survive unchanged)
- Test: `tests/unit/lib/utils/order-update-guards.test.ts` (new describe + update the existing tests that use `carrier` as an innocent client key)

**Interfaces:**
- Consumes: nothing (pure).
- Produces: same `mergeExtensions` signature (contract: "mergeExtensions additionally strips client-supplied `carrier` and `trackingUrl` keys (server-owned)"). Stored `carrier`/`trackingUrl` values MUST survive — legacy orders keep their extensions data; only the CLIENT overlay is stripped.

**Suggested agent:** sonnet — small, mechanical, but security-relevant merge-semantics change.

- [ ] **Step 2.1** — Write the failing test. Append to `tests/unit/lib/utils/order-update-guards.test.ts`:

```ts
describe('mergeExtensions — client carrier/trackingUrl stripping (BMC-216F)', () => {
  it('strips a client-supplied carrier while keeping the stored carrier', () => {
    const out = merged(
      { carrier: 'AttackerExpress', gift_note: 'hi' },
      { payment_intent_id: 'pi_real_123', carrier: 'ups' }
    );
    expect(out.carrier).toBe('ups');       // stored survives
    expect(out.gift_note).toBe('hi');      // innocent client key applies
  });

  it('strips a client-supplied carrier when the order has none stored', () => {
    const out = merged({ carrier: 'AttackerExpress' }, { payment_intent_id: 'pi_real_123' });
    expect(out).not.toHaveProperty('carrier');
  });

  it('strips a client-supplied trackingUrl (server-derived only) while keeping a stored one', () => {
    const out = merged(
      { trackingUrl: 'https://evil.example/phish' },
      { payment_intent_id: 'pi_real_123', trackingUrl: 'https://www.ups.com/track?tracknum=1Z' }
    );
    expect(out.trackingUrl).toBe('https://www.ups.com/track?tracknum=1Z');
  });

  it('strips a client trackingUrl when none is stored', () => {
    const out = merged({ trackingUrl: 'https://evil.example/phish', note: 'x' }, {});
    expect(out).not.toHaveProperty('trackingUrl');
    expect(out.note).toBe('x');
  });

  it('strips carrier/trackingUrl arriving as a client JSON string too', () => {
    const out = merged(
      JSON.stringify({ carrier: 'AttackerExpress', trackingUrl: 'https://evil.example', note: 'x' }),
      { carrier: 'fedex' }
    );
    expect(out.carrier).toBe('fedex');
    expect(out).not.toHaveProperty('trackingUrl');
    expect(out.note).toBe('x');
  });
});
```

- [ ] **Step 2.2** — Run: `npx vitest run tests/unit/lib/utils/order-update-guards.test.ts`. Expect FAIL: new describe fails (client carrier currently overlays), AND note which pre-existing tests fail once the impl lands — they are updated in Step 2.4.
- [ ] **Step 2.3** — Implement. In `mergeExtensions` (`lib/utils/order-update-guards.ts`), replace lines 167–173:

```ts
  const parsedIncoming = parseExtensionsInput(incoming);
  const incomingObj = parsedIncoming.ok ? parsedIncoming.value : {};
  const stored = parsedCurrent.value;

  // Start from the stored keys, overlay the client's keys. Server-owned keys
  // the client did NOT send (refunds, restockedLineKeys, email, …) survive.
  const merged: Record<string, unknown> = { ...stored, ...incomingObj };
```

with:

```ts
  const parsedIncoming = parseExtensionsInput(incoming);
  const incomingObj = parsedIncoming.ok ? parsedIncoming.value : {};
  const stored = parsedCurrent.value;

  // BMC-216F: `carrier` and `trackingUrl` are server-owned fulfillment keys
  // (written only by the shipment service / legacy backfill; trackingUrl is
  // always DERIVED from carrier + tracking number, never stored from a
  // client). Strip them from the client overlay before merging so a PUT can
  // neither plant a phishing trackingUrl nor rewrite the shipped carrier —
  // the STORED values survive untouched for legacy orders.
  const {
    carrier: _clientCarrier,
    trackingUrl: _clientTrackingUrl,
    ...clientKeys
  } = incomingObj;

  // Start from the stored keys, overlay the client's remaining keys.
  // Server-owned keys the client did NOT send (refunds, restockedLineKeys,
  // email, carrier, trackingUrl, …) survive.
  const merged: Record<string, unknown> = { ...stored, ...clientKeys };
```

(Leave the `payment_intent_id` re-pin block at :176–182 exactly as-is below this.)

- [ ] **Step 2.4** — Update the pre-existing guard tests that relied on client `carrier` applying (same file):
  - `'restores the stored PI id when the client tries to rebind it'` (:101): change the client body to `{ payment_intent_id: 'pi_attacker', gift_note: 'x' }` and the assertion to `expect(out.gift_note).toBe('x');` (drop `expect(out.carrier).toBe('UPS')`).
  - `'restores the stored PI id when the client drops it via a wholesale overwrite'` (:111): client sends `{ carrier: 'FedEx' }` over stored `{ payment_intent_id: 'pi_real_123', carrier: 'UPS' }` — change the carrier assertion to `expect(out.carrier).toBe('UPS');` (stored survives, client stripped) and add a comment noting BMC-216F stripping.
  - `'parses a client extensions JSON string'` (:149): client sends `carrier: 'DHL'` — change assertion to `expect(out).not.toHaveProperty('carrier');`.
  - `'preserves the stored refunds[] ledger when the client sends only carrier'` (:173): rename to `'preserves the stored refunds[] ledger on a metadata-only client overlay'`, change client payload to `{ gift_note: 'x' }`, replace `expect(out.carrier).toBe('X')` with `expect(out.gift_note).toBe('x')` (keep all four server-owned-key assertions).
  - `'preserves stored refunds[] when parsing a stored JSON string'` (:207): change client payload `{ carrier: 'X' }` → `{ gift_note: 'x' }` and the assertion accordingly.
  - `'strips a client-introduced PI id when stored extensions has no PI id'` (:134): unchanged — it asserts the STORED `carrier: 'UPS'` survives, which is still true.
  - Corrupt-stored tests (:219, :227) keep `{ carrier: 'X' }` as incoming — they assert the error path, unaffected.
- [ ] **Step 2.5** — Run: `npx vitest run tests/unit/lib/utils/order-update-guards.test.ts`. Expect PASS (whole file).
- [ ] **Step 2.6** — Gates + commit:

```bash
npm run lint && npx tsc --noEmit
git add lib/utils/order-update-guards.ts tests/unit/lib/utils/order-update-guards.test.ts
git commit -m "feat(orders): strip client carrier/trackingUrl in mergeExtensions (BMC-216F)"
```

---

### Task 3: PUT route rework — allowlist wiring, email-block deletion, dead-code removal

**Files:**
- Modify: `app/api/orders/route.ts` (imports :14–34; PUT handler :524–672; delete `transformOrderForEmail` :748–793)
- Modify: `lib/types/order.ts` (:101–111 — narrow `UpdateOrderRequest`; only `app/api/orders/route.ts` references it, verified by grep)
- Modify: `lib/utils/order-update-guards.ts` (:49–84 — delete now-dead `validatePutOrderStatus` and the `REFUND_OWNED_STATUSES`/`VALID_ORDER_STATUSES` constants IF nothing else imports them; keep any constant that another module imports)
- Create: `tests/unit/app/api/orders-put-allowlist.test.ts`
- Test (update): `tests/unit/app/api/orders-put-transition-guard.test.ts`, `tests/unit/app/api/orders-put-payment-status.test.ts`, `tests/unit/lib/utils/order-update-guards.test.ts` (remove `validatePutOrderStatus` describes)

**Interfaces:**
- Consumes: `validatePutOrderBody`, `mergeExtensions` (Tasks 1–2).
- Produces: the contract's Ticket-F wire behavior — `PUT /api/orders` accepts only `notes`, `external_references`, `extensions` (merged); rejects `status`/`tracking_number`/`shipped_at`/`delivered_at`/`shipping_method`/any tracking URL with 400 naming the correct endpoint; email-on-status-change deleted; payment-status drop, refund-ledger merge, and 404/auth behavior preserved.

**Suggested agent:** opus — this is the security-critical allowlist rework; the diff must delete exactly the right things while preserving four distinct existing protections.

- [ ] **Step 3.1** — Write the failing attack tests. Create `tests/unit/app/api/orders-put-allowlist.test.ts` (mock scaffolding copied verbatim from `orders-put-transition-guard.test.ts` — same `vi.mock` set, `makeSelectChain`/`makeUpdateChain`, `existingOrderRow`, `putRequest`):

```ts
/**
 * BMC-216F — PUT /api/orders is reduced to an explicit metadata allowlist.
 * Every lifecycle/fulfillment field is rejected with a 400 naming the correct
 * endpoint; each rejection is the ATTACK (a client trying to set fulfillment
 * state through the legacy generic path). Also pins: no email is ever sent
 * from this route anymore, and the extensions merge protections survive.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@clerk/nextjs/server', () => ({
  auth: vi.fn().mockResolvedValue({ userId: null }),
  currentUser: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/auth/unified-auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/unified-auth')>(
    '@/lib/auth/unified-auth'
  );
  return {
    ...actual,
    authenticateRequest: vi.fn().mockResolvedValue({
      success: true,
      tokenInfo: { id: 1, tokenName: 'automation-token', permissions: ['orders:update_status'], lastUsedAt: null },
    }),
  };
});

vi.mock('@/lib/stripe', () => ({ retrievePaymentIntent: vi.fn() }));

vi.mock('@/lib/utils/email', () => ({
  sendOrderConfirmationEmail: vi.fn().mockResolvedValue({ success: true, id: 'email_1' }),
  sendOrderStatusUpdateEmail: vi.fn().mockResolvedValue({ success: true, id: 'email_2' }),
}));

vi.mock('@/lib/models/mach/customer', () => ({
  getCustomer: vi.fn(),
  createCustomer: vi.fn(),
}));

vi.mock('@/lib/services/gift-card-fulfillment', () => ({
  processGiftCardsForOrder: vi.fn(),
  orderInvolvesGiftCards: vi.fn().mockReturnValue(false),
}));

vi.mock('@/lib/models/mach/orders', () => ({
  getOrdersByCustomer: vi.fn(),
  getOrderById: vi.fn(),
  createOrder: vi.fn(),
  updateOrderStatus: vi.fn(),
  updateOrderShipping: vi.fn(),
}));

vi.mock('@/lib/models/order', () => ({
  getOrdersByCustomerId: vi.fn(),
  insertOrder: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ getDbAsync: vi.fn() }));

import { NextRequest } from 'next/server';
import { PUT } from '@/app/api/orders/route';
import { getDbAsync } from '@/lib/db';
import { sendOrderStatusUpdateEmail } from '@/lib/utils/email';

function makeSelectChain(resolvedRows: any[]) {
  return {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(resolvedRows),
  };
}
function makeUpdateChain(resolvedRows: any[]) {
  return {
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue(resolvedRows),
  };
}

const existingOrderRow = {
  id: 'WEB-TEST-1000',
  customer_id: 'user_1',
  status: 'processing',
  total_amount: { amount: 2500, currency: 'USD' },
  currency_code: 'USD',
  shipping_address: null,
  billing_address: null,
  items: [],
  shipping_method: null,
  payment_method: null,
  payment_status: 'paid',
  tracking_number: null,
  shipped_at: null,
  delivered_at: null,
  notes: null,
  external_references: null,
  extensions: {
    payment_intent_id: 'pi_real_123',
    carrier: 'ups',
    refunds: [{ amount: 500 }],
    email: 'customer@example.com',
  },
  created_at: '2026-07-01T00:00:00.000Z',
  updated_at: '2026-07-01T00:00:00.000Z',
};

const url = 'http://localhost/api/orders';
function putRequest(body: unknown) {
  return new NextRequest(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function wireDb(rows: any[] = [existingOrderRow], updated: any[] = [existingOrderRow]) {
  const selectChain = makeSelectChain(rows);
  const updateChain = makeUpdateChain(updated);
  vi.mocked(getDbAsync).mockResolvedValue({
    select: vi.fn().mockReturnValue(selectChain),
    update: vi.fn().mockReturnValue(updateChain),
  } as any);
  return { selectChain, updateChain };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PUT /api/orders fulfillment-field rejection (BMC-216F)', () => {
  it('rejects a status write with 400 naming the ship endpoint, no DB write, no email', async () => {
    const { updateChain } = wireDb();
    const res = await PUT(putRequest({ orderId: 'WEB-TEST-1000', status: 'shipped' }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('POST /api/admin/orders/{id}/ship');
    expect(updateChain.set).not.toHaveBeenCalled();
    expect(sendOrderStatusUpdateEmail).not.toHaveBeenCalled();
  });

  it('rejects a tracking_number write with 400 naming the tracking endpoint', async () => {
    const { updateChain } = wireDb();
    const res = await PUT(putRequest({ orderId: 'WEB-TEST-1000', tracking_number: '1Z999' }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('PATCH /api/admin/orders/{id}/tracking');
    expect(updateChain.set).not.toHaveBeenCalled();
  });

  it.each([
    ['shipped_at', '2026-07-30T12:00:00Z'],
    ['delivered_at', '2026-07-30T12:00:00Z'],
    ['shipping_method', 'overnight'],
    ['trackingUrl', 'https://evil.example/x'],
    ['tracking_url', 'https://evil.example/x'],
  ])('rejects client-supplied %s with 400 and no DB write', async (field, value) => {
    const { updateChain } = wireDb();
    const res = await PUT(putRequest({ orderId: 'WEB-TEST-1000', [field]: value }));
    expect(res.status).toBe(400);
    expect(updateChain.set).not.toHaveBeenCalled();
  });

  it('rejects refund-owned statuses with 400 whose message names the refund endpoint', async () => {
    const { updateChain } = wireDb();
    for (const status of ['cancelled', 'refunded']) {
      const res = await PUT(putRequest({ orderId: 'WEB-TEST-1000', status }));
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain('POST /api/orders/refund');
    }
    expect(updateChain.set).not.toHaveBeenCalled();
  });
});

describe('PUT /api/orders allowlisted metadata updates (BMC-216F)', () => {
  it('updates notes without sending any email and without touching fulfillment columns', async () => {
    const { updateChain } = wireDb(
      [existingOrderRow],
      [{ ...existingOrderRow, notes: 'leave at side door' }]
    );
    const res = await PUT(putRequest({ orderId: 'WEB-TEST-1000', notes: 'leave at side door' }));
    expect(res.status).toBe(200);
    const setArg = updateChain.set.mock.calls[0][0];
    expect(setArg.notes).toBe('leave at side door');
    expect(setArg).not.toHaveProperty('status');
    expect(setArg).not.toHaveProperty('tracking_number');
    expect(setArg).not.toHaveProperty('shipped_at');
    expect(setArg).not.toHaveProperty('delivered_at');
    expect(setArg).not.toHaveProperty('shipping_method');
    expect(sendOrderStatusUpdateEmail).not.toHaveBeenCalled();
  });

  it('merged extensions keep the refund ledger + PI pin and drop client carrier/trackingUrl', async () => {
    const { updateChain } = wireDb();
    const res = await PUT(
      putRequest({
        orderId: 'WEB-TEST-1000',
        extensions: {
          payment_intent_id: 'pi_attacker',
          carrier: 'AttackerExpress',
          trackingUrl: 'https://evil.example/phish',
          gift_note: 'happy birthday',
        },
      })
    );
    expect(res.status).toBe(200);
    const setArg = updateChain.set.mock.calls[0][0];
    expect(setArg.extensions.payment_intent_id).toBe('pi_real_123');
    expect(setArg.extensions.refunds).toEqual([{ amount: 500 }]);
    expect(setArg.extensions.email).toBe('customer@example.com');
    expect(setArg.extensions.carrier).toBe('ups');                       // stored survives
    expect(setArg.extensions).not.toHaveProperty('trackingUrl');         // client value stripped
    expect(setArg.extensions.gift_note).toBe('happy birthday');
  });

  it('still rejects (422) when stored extensions are corrupt (fail-closed preserved)', async () => {
    const { updateChain } = wireDb([{ ...existingOrderRow, extensions: '{ not valid json' }]);
    const res = await PUT(
      putRequest({ orderId: 'WEB-TEST-1000', extensions: { gift_note: 'x' } })
    );
    expect(res.status).toBe(422);
    expect(updateChain.set).not.toHaveBeenCalled();
  });

  it('rejects an empty update (orderId only) with 400', async () => {
    const { updateChain } = wireDb();
    const res = await PUT(putRequest({ orderId: 'WEB-TEST-1000' }));
    expect(res.status).toBe(400);
    expect(updateChain.set).not.toHaveBeenCalled();
  });

  it('still 404s an unknown order', async () => {
    const { updateChain } = wireDb([]);
    const res = await PUT(putRequest({ orderId: 'NOPE', notes: 'x' }));
    expect(res.status).toBe(404);
    expect(updateChain.set).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3.2** — Run: `npx vitest run tests/unit/app/api/orders-put-allowlist.test.ts`. Expect FAIL: status write currently returns 200 (or the old messages), `shipped_at`/`delivered_at` are written verbatim, notes-only currently 400s on the `status is required` check.
- [ ] **Step 3.3** — Implement the route. In `app/api/orders/route.ts`:

  1. Imports: delete `updateOrderStatus, updateOrderShipping` from the `@/lib/models/mach/orders` import (:18–19 — keep `getOrdersByCustomer, getOrderById, createOrder`); delete `import { sendOrderStatusUpdateEmail } from "@/lib/utils/email";` (:23 — its only use was the deleted email block); change the guards import (:34) to `import { validatePutOrderBody, mergeExtensions } from "@/lib/utils/order-update-guards";`.
  2. Replace the PUT handler body from the `const body = ...` line (:532) through the audit `console.log` (:654) with:

```ts
    const body = await request.json() as UpdateOrderRequest & Record<string, unknown>;

    const orderId = (body as any).orderId;
    if (!orderId) {
      return NextResponse.json({
        error: 'Validation failed',
        details: ['orderId is required in the request body']
      }, { status: 400 });
    }

    // SECURITY (BMC-216F): this route is an explicit metadata allowlist. Every
    // lifecycle transition now has a dedicated, verified owner — the Stripe
    // webhook (pending → processing), POST /api/admin/orders/{id}/ship
    // (processing → shipped), and POST /api/orders/refund (→ cancelled /
    // refunded, which issues the Stripe refund atomically). Nothing legitimate
    // is left for a generic status/fulfillment write, so status,
    // tracking_number, shipped_at, delivered_at, shipping_method, and any
    // tracking URL are rejected with a 400 naming the correct endpoint.
    const bodyCheck = validatePutOrderBody(body as Record<string, unknown>);
    if (!bodyCheck.ok) {
      return NextResponse.json({ error: bodyCheck.error }, { status: bodyCheck.status });
    }

    const { notes, external_references, extensions } = body;

    const db = await getDbAsync();

    // Check if order exists
    const existingOrder = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
    if (existingOrder.length === 0) {
      return NextResponse.json({
        error: 'Order not found'
      }, { status: 404 });
    }

    const currentOrder = existingOrder[0];

    // SECURITY (BMC-140): payment_status is intentionally NOT accepted from this
    // client-driven PUT. A caller holding only ORDERS_UPDATE (e.g. a webhook/
    // automation token) could otherwise flip an unpaid order to 'paid' (or
    // 'refunded') with zero Stripe verification. payment_status has exactly
    // three legitimate writers, each of which verifies against Stripe first and
    // none of which is client-controllable:
    //   - order creation (POST /api/orders) via retrievePaymentIntent
    //   - the Stripe webhook's markOrderPaid()
    //   - the refund route (/api/orders/refund), which only sets payment_status
    //     after actually creating a Stripe refund
    // Any client-supplied payment_status is logged and silently dropped rather
    // than applied (kept as a drop, not a 400, so existing automation callers
    // that harmlessly echo the field keep working — BMC-216F).
    if (body.payment_status) {
      console.warn(
        `Order ${orderId}: ignoring client-supplied payment_status="${body.payment_status}" on PUT ` +
          `(payment_status can only be set via verified payment or the /refund route)`
      );
    }

    // SECURITY (BMC-158): the `extensions` JSON column holds server-owned keys
    // the client must not clobber — `payment_intent_id` (the binding the refund
    // route trusts to locate the PaymentIntent it refunds) and `refunds[]` (the
    // ledger computeRefundedTotal sums for the over-refund guard), plus
    // restockedLineKeys / email / etc. A wholesale `extensions` overwrite here
    // could rebind/drop the PI (refund fraud) or wipe the refunds ledger
    // (resetting the over-refund guard → double refund). mergeExtensions MERGES
    // the client's keys over the stored ones, re-pins payment_intent_id, and
    // (BMC-216F) strips client-supplied carrier/trackingUrl; it fails safe
    // (rejects) if the stored extensions are corrupt rather than persisting a
    // stripped object.
    let mergedExtensions: Record<string, unknown> | undefined;
    if (extensions !== undefined) {
      const mergeResult = mergeExtensions(extensions, currentOrder.extensions);
      if (!mergeResult.ok) {
        return NextResponse.json({ error: mergeResult.error }, { status: mergeResult.status });
      }
      mergedExtensions = mergeResult.extensions;
    }

    // Build update data (metadata only — BMC-216F).
    // external_references / extensions are `mode: "json"` columns — pass the RAW
    // objects and let Drizzle serialize; a manual JSON.stringify double-encodes.
    const updateData: any = {
      ...(notes && { notes }),
      ...(external_references && { external_references }),
      ...(mergedExtensions !== undefined && { extensions: mergedExtensions }),
      updated_at: new Date().toISOString()
    };

    // Update the order. No email is sent from this route: with no status writes
    // possible there is no status change to announce (product decision 7 —
    // BMC-216F deleted the email-on-status-change block rather than guarding it).
    const [updatedOrder] = await db.update(orders)
      .set(updateData)
      .where(eq(orders.id, orderId))
      .returning();

    console.log('Order metadata update:', {
      orderId,
      fields: Object.keys(updateData).filter((k) => k !== 'updated_at'),
      updatedBy: authResult.tokenInfo?.tokenName || 'unknown',
      timestamp: new Date().toISOString(),
    });
```

  (The `response` build + `catch` block at :656–672 stay exactly as they are.)
  3. Delete the now-dead `transformOrderForEmail` function (:748–793) — its only caller was the deleted email block. The refund route has its own independent `buildRefundStatusEmail` copy.
  4. In `lib/types/order.ts`, replace `UpdateOrderRequest` (:101–111) with:

```ts
// Order update request interface — PUT /api/orders metadata allowlist
// (BMC-216F). Fulfillment fields (status, tracking_number, shipped_at,
// delivered_at, shipping_method, tracking URLs) are rejected by the route
// with a 400 naming the dedicated endpoint; they are deliberately absent
// here so no caller type-checks against sending them.
export interface UpdateOrderRequest {
  orderId?: string;
  notes?: string;
  external_references?: Record<string, any>;
  extensions?: Record<string, any>;
}
```

  5. In `lib/utils/order-update-guards.ts`, delete `validatePutOrderStatus` (:63–84). Before deleting `VALID_ORDER_STATUSES`/`REFUND_OWNED_STATUSES` (:39–53), run `grep -rn "VALID_ORDER_STATUSES\|REFUND_OWNED_STATUSES" app lib tests --include="*.ts" --include="*.tsx"` — delete each constant only if its sole remaining references are the deleted function and its deleted tests; otherwise keep it exported.
- [ ] **Step 3.4** — Update the three existing test files:
  - `tests/unit/lib/utils/order-update-guards.test.ts`: delete the `describe('validatePutOrderStatus', …)` block (:31–98) and remove `validatePutOrderStatus` from the import (Task 1's `validatePutOrderBody` describes are its replacement — the refund-endpoint-naming assertion lives there).
  - `tests/unit/app/api/orders-put-transition-guard.test.ts`:
    - Both refund-owned tests (:127, :143): expect `400` instead of `422`; keep the no-DB-write assertion; change the message assertion to `expect(body.error).toContain('POST /api/orders/refund');`.
    - Replace `'still allows a normal fulfillment status (shipped)'` (:157) with a notes-only success test (`putRequest({ orderId: 'WEB-TEST-1000', notes: 'metadata still updates' })` → 200, `setArg.notes` set, `setArg` has no `status` property).
    - PI-pinning tests (:174, :197): drop `status: 'shipped'` from the bodies (metadata-only PUTs now); in the first, change `expect(setArg.extensions.carrier).toBe('FedEx')` to `expect(setArg.extensions.carrier).toBe('UPS')` (client carrier stripped, stored `'UPS'` survives — `existingOrderRow.extensions.carrier` is `'UPS'` in this file).
    - Refunds-ledger tests (:233, :260, :280): drop `status: 'shipped'` from bodies; in :233 change the client payload to `{ gift_note: 'x' }` and assert `setArg.extensions.gift_note` instead of `carrier`; in :260 use `{ orderId, notes: 'packed' }` and additionally assert `setArg.notes === 'packed'`; in :280 use `extensions: { gift_note: 'x' }`.
  - `tests/unit/app/api/orders-put-payment-status.test.ts`:
    - Test 1 (:146): body → `{ orderId: 'WEB-TEST-1000', notes: 'metadata update', payment_status: 'paid' }`; keep `expect(setArg).not.toHaveProperty('payment_status')`; replace the `setArg.status` assertion with `expect(setArg.notes).toBe('metadata update');`.
    - Test 2 (:171): rename to `'still applies a normal metadata update and returns the wire order'`; body → `{ orderId: 'WEB-TEST-1000', notes: 'gift wrap', external_references: { erp: 'X-1' } }`; update chain resolves `[{ ...existingOrderRow, notes: 'gift wrap' }]`; assert 200, `setArg.notes === 'gift wrap'`, `setArg.external_references` set, no `payment_status`, and the response `body.data` exists.
- [ ] **Step 3.5** — Run: `npx vitest run tests/unit/app/api/orders-put-allowlist.test.ts tests/unit/app/api/orders-put-transition-guard.test.ts tests/unit/app/api/orders-put-payment-status.test.ts tests/unit/lib/utils/order-update-guards.test.ts`. Expect PASS (all four files).
- [ ] **Step 3.6** — Gates + commit:

```bash
npm run lint && npx tsc --noEmit
git add app/api/orders/route.ts lib/types/order.ts lib/utils/order-update-guards.ts \
  tests/unit/app/api/orders-put-allowlist.test.ts \
  tests/unit/app/api/orders-put-transition-guard.test.ts \
  tests/unit/app/api/orders-put-payment-status.test.ts \
  tests/unit/lib/utils/order-update-guards.test.ts
git commit -m "feat(orders): reduce PUT /api/orders to metadata allowlist, delete status-change email path (BMC-216F)"
```

---

### Task 4: Escape the legacy status-update email template, remove the trackingUrl link block

**Files:**
- Modify: `lib/utils/email.ts` (`generateOrderStatusUpdateHTML` :248–427; `escapeHtml` at :515 is a **hoisted `function` declaration** — verified — so it is callable from :248 with no move or conversion required)
- Create: `tests/unit/lib/utils/order-status-email-escaping.test.ts`

**Interfaces:**
- Consumes: existing `escapeHtml(value = ''): string` (:515), `OrderStatusUpdateData` (:59).
- Produces: same `sendOrderStatusUpdateEmail`/`OrderStatusUpdateData` signatures — the refund route (`app/api/orders/refund/route.ts:455`, `:571-574`) keeps calling it with `trackingUrl` in the data; the template simply no longer renders a link. Keep the `trackingUrl?: string` field on `OrderStatusUpdateData` (removing it would break the refund route's `buildRefundStatusEmail`) but add a doc comment that the template ignores it as of BMC-216F.

**Suggested agent:** sonnet — mechanical wrap-in-escapeHtml work, but security-relevant output encoding, so sonnet minimum (not haiku).

- [ ] **Step 4.1** — Write the failing test. Create `tests/unit/lib/utils/order-status-email-escaping.test.ts` (Resend transport mocked via the established `subscription-created-email.test.ts` pattern):

```ts
/**
 * BMC-216F — the legacy order-status email template must escape every
 * interpolated value and must no longer emit the stored trackingUrl as a
 * link. The refund route keeps this template alive for cancellation/refund
 * emails, so the refunded shape must still render.
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

import { sendOrderStatusUpdateEmail, type OrderStatusUpdateData } from '@/lib/utils/email';

const XSS = '<script>alert(1)</script>';

function baseData(overrides: Partial<OrderStatusUpdateData> = {}): OrderStatusUpdateData {
  return {
    orderNumber: 'WEB-1',
    customerName: 'Ada',
    customerEmail: 'ada@example.com',
    status: 'shipped',
    items: [{ productId: 'p1', name: 'Morning Blend', price: 1250, quantity: 1 }],
    shippingAddress: {
      street: '1 Tea Ln',
      city: 'Denver',
      state: 'CO',
      zipCode: '80202',
      country: 'US',
    },
    ...overrides,
  };
}

async function renderedHtml(data: OrderStatusUpdateData): Promise<string> {
  sendMock.mockClear();
  const result = await sendOrderStatusUpdateEmail(data);
  expect(result.success).toBe(true);
  return sendMock.mock.calls[0][0].html as string;
}

beforeEach(() => {
  sendMock.mockClear();
});

describe('generateOrderStatusUpdateHTML escaping (BMC-216F)', () => {
  it('escapes a <script>-bearing customer name', async () => {
    const html = await renderedHtml(baseData({ customerName: XSS }));
    expect(html).not.toContain(XSS);
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('escapes a <script>-bearing tracking number and carrier', async () => {
    const html = await renderedHtml(
      baseData({ carrier: `UPS${XSS}`, trackingNumber: `1Z${XSS}` })
    );
    expect(html).not.toContain(XSS);
    expect(html).toContain('&lt;script&gt;');
  });

  it('never renders the stored trackingUrl — no link, no raw value', async () => {
    const html = await renderedHtml(
      baseData({
        carrier: 'ups',
        trackingNumber: '1Z999',
        trackingUrl: 'https://evil.example/phish"><script>alert(1)</script>',
      })
    );
    expect(html).not.toContain('evil.example');
    expect(html).not.toContain('Track Your Package');
  });

  it('escapes notes, item names, and shipping address fields', async () => {
    const html = await renderedHtml(
      baseData({
        notes: `note ${XSS}`,
        items: [{ productId: 'p1', name: `Tea ${XSS}`, price: 1250, quantity: 1 }],
        shippingAddress: {
          street: `1 ${XSS} Ln`,
          city: `Denver${XSS}`,
          state: 'CO',
          zipCode: '80202',
          country: 'US',
        },
      })
    );
    expect(html).not.toContain(XSS);
  });

  it('escapes the cancellation reason on the cancelled template', async () => {
    const html = await renderedHtml(
      baseData({ status: 'cancelled', cancellationReason: `oops ${XSS}` })
    );
    expect(html).not.toContain(XSS);
    expect(html).toContain('&lt;script&gt;');
  });

  it('the refund-route shape still renders (template stays alive for refund emails)', async () => {
    const html = await renderedHtml(
      baseData({
        status: 'refunded',
        refundAmount: '$25.00',
        orderCancelled: true,
        trackingUrl: 'https://www.ups.com/track?tracknum=1Z', // refund route still passes it
      })
    );
    expect(html).toContain('$25.00');
    expect(html).toContain('will not be shipped');
    expect(html).not.toContain('ups.com/track'); // ignored, not rendered
  });
});
```

- [ ] **Step 4.2** — Run: `npx vitest run tests/unit/lib/utils/order-status-email-escaping.test.ts`. Expect FAIL: raw `<script>` present in html; `Track Your Package` link rendered.
- [ ] **Step 4.3** — Implement in `lib/utils/email.ts`, inside `generateOrderStatusUpdateHTML` (all edits wrap existing interpolations with the existing `escapeHtml`; no signature changes):
  - `:284` → `<strong>Carrier:</strong> ${escapeHtml(orderData.carrier)}`
  - `:285` → `<strong>Tracking Number:</strong> ${escapeHtml(orderData.trackingNumber)}`
  - `:286–290` → **delete the entire `${orderData.trackingUrl ? … : ''}` link block** (the `<a href>` and its ternary). Do not replace it with anything — tracking links are the new shipping email's job (ticket C), derived via `buildTrackingUrl`, never stored.
  - `:312` → `<strong>Reason:</strong> ${escapeHtml(orderData.cancellationReason)}`
  - `:326` → `<strong>Refund amount:</strong> ${escapeHtml(orderData.refundAmount)}`
  - `:345` (both attrs) → `<img src="${escapeHtml(absoluteImageUrl)}" alt="${escapeHtml(item.name)}" …`
  - `:348` → `…margin: 0 0 2px;">${escapeHtml(item.name)}</div>`
  - `:377` → `Hi ${escapeHtml(orderData.customerName)},`
  - `:382` → `Order #${escapeHtml(orderData.orderNumber)}`
  - `:383` → `…font-weight: bold;">${escapeHtml(orderData.status.charAt(0).toUpperCase() + orderData.status.slice(1))}</span>`
  - `:388` → `<strong>Note:</strong> ${escapeHtml(orderData.notes)}`
  - `:410–412` → escape all five address interpolations: `${escapeHtml(orderData.shippingAddress.street)}`, `${escapeHtml(orderData.shippingAddress.city)}, ${escapeHtml(orderData.shippingAddress.state)} ${escapeHtml(orderData.shippingAddress.zipCode)}`, `${escapeHtml(orderData.shippingAddress.country)}`
  - On the `OrderStatusUpdateData` interface (:66), amend the `trackingUrl` doc: `/** @deprecated BMC-216F: no longer rendered — the template does not emit stored tracking URLs. Kept only because the refund route still populates it. */`
  - Note: `statusColor`/`statusMessage`/`statusContent` scaffolding and item `quantity` (a number) are server-constants/numerics — leave them. `escapeHtml` has a `= ''` default so `undefined` inputs inside existing truthiness ternaries are safe.
- [ ] **Step 4.4** — Run: `npx vitest run tests/unit/lib/utils/order-status-email-escaping.test.ts`. Expect PASS.
- [ ] **Step 4.5** — Confirm the refund route needs no change: `grep -n "trackingUrl\|sendOrderStatusUpdateEmail" app/api/orders/refund/route.ts` — it may still pass `trackingUrl` in data (:571–574); the template now ignores it. No edit there.
- [ ] **Step 4.6** — Gates + commit:

```bash
npm run lint && npx tsc --noEmit
git add lib/utils/email.ts tests/unit/lib/utils/order-status-email-escaping.test.ts
git commit -m "fix(email): escape legacy order-status template and drop stored trackingUrl link (BMC-216F)"
```

---

### Task 5: Regression coverage — tracking-field reads and money-path invariants

**Files:**
- Create: `tests/unit/lib/utils/order-wire-tracking.test.ts`
- Create: `tests/unit/lib/mcp/order-status-tracking.test.ts`
- Test (verify unchanged): `tests/unit/app/api/webhooks-stripe-charge-verification.test.ts`, `tests/unit/app/api/webhooks-stripe-dedup.test.ts`, `tests/unit/app/api/orders-refund-idempotency.test.ts`, `tests/unit/lib/services/inventory-adjustment.test.ts`, `tests/unit/lib/services/order-finalization.test.ts`

**Interfaces:**
- Consumes: `toWireOrder` (`lib/utils/order-wire.ts:36` — shared projection for `GET /api/orders`, `GET /api/orders/[id]`, and PUT responses), `getOrderStatus` (`lib/mcp/tools/order.ts:485`).
- Produces: pinned guarantees that customer and MCP order READS retain `tracking_number`/`shipped_at`/`delivered_at` after the write path is locked down, and that the existing money-path invariants still hold.

**Suggested agent:** sonnet — test authoring against verified read paths; the heavy part (mock inventory) is spelled out below.

- [ ] **Step 5.1** — Failing test 1 (pure). Create `tests/unit/lib/utils/order-wire-tracking.test.ts`:

```ts
/**
 * BMC-216F regression — locking down the WRITE path must not strip tracking
 * fields from the READ path. toWireOrder is the shared projection for
 * GET /api/orders, GET /api/orders/[id], and the PUT response, so pinning it
 * pins every customer-facing order read.
 */
import { describe, it, expect } from 'vitest';
import { toWireOrder } from '@/lib/utils/order-wire';
import type { Order } from '@/lib/types/order';

describe('toWireOrder retains fulfillment fields (BMC-216F)', () => {
  it('passes tracking_number, shipped_at, delivered_at and shipping_method through to the wire', () => {
    const order: Order = {
      id: 'WEB-1',
      status: 'shipped',
      total_amount: { amount: 2500, currency: 'USD' },
      currency_code: 'USD',
      items: [],
      payment_status: 'paid',
      shipping_method: 'standard',
      tracking_number: '1Z999AA10123456784',
      shipped_at: '2026-07-30T12:00:00.000Z',
      delivered_at: '2026-07-31T12:00:00.000Z',
    } as Order;

    const wire = toWireOrder(order);
    expect(wire.tracking_number).toBe('1Z999AA10123456784');
    expect(wire.shipped_at).toBe('2026-07-30T12:00:00.000Z');
    expect(wire.delivered_at).toBe('2026-07-31T12:00:00.000Z');
    expect(wire.shipping_method).toBe('standard');
  });
});
```

  Run: `npx vitest run tests/unit/lib/utils/order-wire-tracking.test.ts`. This should PASS immediately (`toWireOrder` spreads the order — verified at `lib/utils/order-wire.ts:36-46`); it exists to FAIL if anyone later "tightens" the projection. If the `Order` type shape makes `total_amount` object-literal assignment fail `tsc`, build it with `Money.fromMinor(2500, 'USD').toJSON()` from `@/lib/money`.
- [ ] **Step 5.2** — Failing test 2 (MCP read). Create `tests/unit/lib/mcp/order-status-tracking.test.ts`. `lib/mcp/tools/order.ts` pulls heavy deps at module scope, so mock each (model layer only — no Cloudflare bindings):

```ts
/**
 * BMC-216F regression — MCP get_order_status must keep returning
 * tracking_number after the legacy write path is locked down (agents read
 * tracking through this tool; lib/mcp/tools/order.ts:529).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/models/mach/orders', () => ({
  createOrderPaid: vi.fn(),
  getOrderByPaymentIntentId: vi.fn(),
}));
vi.mock('@/lib/services/inventory-adjustment', () => ({
  decrementStockForOrder: vi.fn(),
  flagOversoldForReview: vi.fn(),
}));
vi.mock('@/lib/mcp/session', () => ({ requireOwnedSession: vi.fn() }));
vi.mock('@/lib/mcp/context', () => ({ enhanceUserContext: vi.fn() }));
vi.mock('@/lib/stripe', () => ({ retrievePaymentIntent: vi.fn() }));
vi.mock('@/lib/services/order-pricing', () => ({
  verifyOrderChargeSufficient: vi.fn(),
  AMOUNT_TOLERANCE_CENTS: 50,
  MAX_ORDER_LINE_ITEMS: 50,
  canonicalizeOrderItemsDisplay: vi.fn(),
  canonicalizeOrderItemsPricing: vi.fn(),
  computeOrderTotals: vi.fn(),
}));
vi.mock('@/lib/mcp/order-delivery', () => ({
  getOwnedOrder: vi.fn(),
  describeOrderDelivery: vi.fn().mockReturnValue('3-5 business days'),
}));

import { getOrderStatus } from '@/lib/mcp/tools/order';
import { getOwnedOrder } from '@/lib/mcp/order-delivery';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('MCP get_order_status retains tracking fields (BMC-216F)', () => {
  it('returns the stored tracking_number for an owned shipped order', async () => {
    vi.mocked(getOwnedOrder).mockResolvedValue({
      id: 'MCP-pi_1',
      status: 'shipped',
      total_amount: { amount: 2500, currency: 'USD' },
      currency_code: 'USD',
      items: [],
      payment_status: 'paid',
      tracking_number: '1Z999AA10123456784',
      shipping_address: null,
      shipping_method: 'standard',
    } as any);

    const res = await getOrderStatus('MCP-pi_1', 'agent-1');
    expect(res.success).toBe(true);
    expect(res.data.status).toBe('shipped');
    expect(res.data.tracking_number).toBe('1Z999AA10123456784');
  });

  it('omits tracking_number when none is stored (no fabricated tracking)', async () => {
    vi.mocked(getOwnedOrder).mockResolvedValue({
      id: 'MCP-pi_2',
      status: 'processing',
      total_amount: { amount: 2500, currency: 'USD' },
      currency_code: 'USD',
      items: [],
      payment_status: 'paid',
      tracking_number: null,
      shipping_address: null,
    } as any);

    const res = await getOrderStatus('MCP-pi_2', 'agent-1');
    expect(res.success).toBe(true);
    expect(res.data.tracking_number).toBeUndefined();
  });
});
```

  Run: `npx vitest run tests/unit/lib/mcp/order-status-tracking.test.ts`. If a mocked-module list is incomplete (module-scope import explodes), add the missing `vi.mock` with `vi.fn()` stubs — do NOT let the test touch `getDbAsync`. If `toWireMoney(order.total_amount)` rejects the object shape, switch the fixture's `total_amount` to `2500` (cents) to match how `getOwnedOrder` hydrates — check `lib/mcp/order-delivery.ts` for the actual hydrated shape and mirror it.
- [ ] **Step 5.3** — Run the untouched regression suites and confirm green (these ARE the spec's "payment promotion → processing", "refund route owns cancelled/refunded", "refund ledger cannot be overwritten", "restocking idempotent", "inventory decrements at payment" coverage — they must pass with zero edits, proving Task 3 preserved those paths):

```bash
npx vitest run tests/unit/app/api/webhooks-stripe-charge-verification.test.ts \
  tests/unit/app/api/webhooks-stripe-dedup.test.ts \
  tests/unit/app/api/orders-refund-idempotency.test.ts \
  tests/unit/lib/services/inventory-adjustment.test.ts \
  tests/unit/lib/services/order-finalization.test.ts
```

  Expect PASS with no modifications. If any fails, that is a Task 3 regression — fix the route, never the regression test.
- [ ] **Step 5.4** — Gates + commit:

```bash
npm run lint && npx tsc --noEmit
git add tests/unit/lib/utils/order-wire-tracking.test.ts tests/unit/lib/mcp/order-status-tracking.test.ts
git commit -m "test(orders): pin tracking-field reads and money-path regressions (BMC-216F)"
```

---

### Task 6: Bypass-surface verification — no alternate API can set fulfillment fields

**Files:**
- Modify: `lib/models/mach/orders.ts` (:239 `updateOrderStatus`, :336 `updateOrderShipping` — deprecation doc comments only; do not delete mid-flight while tickets B–E are in progress)
- No new test files — this task is grep-verified enumeration plus one comment change; the write-path tests already exist (Task 3) or are documented below.

**Interfaces:**
- Consumes: the full order-mutation surface of the repo.
- Produces: the acceptance-criteria evidence for "No alternate API can bypass the shipment service."

**Suggested agent:** opus — this is the bypass-surface enumeration; it requires judging whether each writer constitutes a fulfillment-field vector.

**Enumerated mutation surfaces (verified by grep 2026-07-30 — re-verify in Step 6.1):**

| # | Surface | Fulfillment-field exposure | Coverage |
|---|---|---|---|
| 1 | `PUT /api/orders` (`app/api/orders/route.ts:524`) | WAS the vector — wrote `status`/`tracking_number`/`shipped_at`/`delivered_at`/`shipping_method` verbatim | **Closed by Task 3; tested in `orders-put-allowlist.test.ts`** |
| 2 | `POST /api/orders` (`app/api/orders/route.ts:405` insert) | None: the `machOrder` literal (:381–399) contains no `tracking_number`/`shipped_at`/`delivered_at`; `status`/`payment_status` hardcoded `'pending'`. `shipping_method` at creation is the customer's checkout choice, not fulfillment state | Documented verification (Step 6.1 grep) |
| 3 | `POST /api/orders/refund` (`app/api/orders/refund/route.ts:231,385,528`) | Writes `status` → cancelled/refunded ONLY after a verified Stripe refund; never tracking fields | Existing `orders-refund-idempotency.test.ts` (Task 5.3) |
| 4 | Stripe webhook (`app/api/webhooks/stripe/route.ts`, `markOrderPaid` via `lib/models/mach/orders.ts`) | `pending → processing` + `payment_status` only | Existing `webhooks-stripe-*.test.ts` (Task 5.3) |
| 5 | MCP `place_order` (`lib/mcp/tools/order.ts:80`, REST `app/api/mcp/tools/order/place`) | Creates orders pending → verified-paid path; no tracking fields in `orderData` | Documented verification (Step 6.1 grep) |
| 6 | MCP `get_order_status` / `order/track` / `order/status` REST routes | Read-only | `order-status-tracking.test.ts` (Task 5.2) |
| 7 | `GET /api/orders/[id]` | Read-only (GET is the only export — verified) | Documented verification |
| 8 | `lib/models/mach/orders.ts` `updateOrderStatus` (:239) / `updateOrderShipping` (:336) | CAN write tracking/timestamps, but after Task 3 has **zero callers** (the only importer was `app/api/orders/route.ts:18-19`, removed) | Step 6.2 deprecation comments + Step 6.1 zero-caller grep |
| 9 | `/api/admin/*` | No order endpoints exist today; tickets B/D add the sanctioned ship/tracking/events/list routes | Out of scope (B/D plans own their tests) |

- [ ] **Step 6.1** — Re-run the enumeration greps and confirm the table above still holds (any NEW hit is a finding that must be closed or escalated before this ticket ships):

```bash
# Every direct writer to the orders table (expect ONLY: orders/route.ts POST insert + PUT metadata update,
# refund/route.ts x3, lib/models/mach/orders.ts internals):
grep -rn "update(orders)\|insert(orders)" app lib --include="*.ts" | grep -v tests

# Zero remaining callers of the legacy model shipping writers (expect matches ONLY inside lib/models/mach/orders.ts;
# app/admin/orders/page.tsx has an unrelated local function of the same name — ticket D deletes it):
grep -rn "updateOrderShipping\|updateOrderStatus" app lib components --include="*.ts" --include="*.tsx" | grep -v "lib/models/mach/orders.ts" | grep -v tests

# No route outside the PUT handler accepts client tracking/timestamp fields into a DB write
# (review each hit — reads/renders are fine, writes are findings):
grep -rn "tracking_number\|shipped_at\|delivered_at" app/api --include="*.ts" | grep -v tests
```

- [ ] **Step 6.2** — Add deprecation doc comments in `lib/models/mach/orders.ts` on `updateOrderStatus` (:239) and `updateOrderShipping` (:336):

```ts
/**
 * @deprecated BMC-216F: DO NOT WIRE THIS INTO ANY ROUTE. Generic status /
 * shipping writes bypass the fulfillment state machine. Shipments go through
 * lib/fulfillment/service.ts (shipOrder / updateTracking — BMC-216B), which
 * owns CAS-guarded transitions, server timestamps, and audit events. This
 * function is retained only until the BMC-216 rollout completes, then deleted.
 */
```

- [ ] **Step 6.3** — Full-suite gates + commit:

```bash
npm run lint && npx tsc --noEmit && npm test
git add lib/models/mach/orders.ts
git commit -m "chore(orders): deprecate legacy model shipping writers after bypass-surface audit (BMC-216F)"
```

---

## Verification

Run all three CI gates from the repo root; every one must pass before the ticket is called done:

- [ ] `npm run lint` — clean (ESLint `next/core-web-vitals`).
- [ ] `npx tsc --noEmit` — clean (the `UpdateOrderRequest` narrowing must not break any caller; only `app/api/orders/route.ts` references it — verified. `app/admin/orders/page.tsx` uses its own `Partial<Order>` and is ticket D's problem).
- [ ] `npm test` (= `vitest run`, collects `tests/unit/**/*.test.{ts,tsx}` per `vitest.config.ts:15`) — full unit suite green, including:
  - `tests/unit/lib/utils/order-update-guards.test.ts` (allowlist guard + merge stripping)
  - `tests/unit/app/api/orders-put-allowlist.test.ts` (the attacks: status/tracking/timestamps/URLs → 400; no email; merge protections)
  - `tests/unit/app/api/orders-put-transition-guard.test.ts` + `orders-put-payment-status.test.ts` (updated)
  - `tests/unit/lib/utils/order-status-email-escaping.test.ts` (`<script>`-bearing values escaped; no trackingUrl link)
  - `tests/unit/lib/utils/order-wire-tracking.test.ts` + `tests/unit/lib/mcp/order-status-tracking.test.ts` (reads retain tracking)
  - The five untouched regression suites from Task 5.3 (payment promotion, refund ownership, ledger, restock idempotency, inventory decrement).
- [ ] Deploy-order sanity: this branch must not be deployed to any environment before BMC-216B and BMC-216D are live there (the admin UI's `app/admin/orders/page.tsx:173-174` still PUTs `status`/`tracking_number` until D lands, and the 400 messages name endpoints B creates).

## Contract Deviations

None. Three interpretation notes recorded for the reviewer (all within contract wording, not renames):

1. **Refund-owned statuses now 400, not 422.** The pre-existing `validatePutOrderStatus` returned 422 for `cancelled`/`refunded`. The Ticket-F contract says `status` (all values) "rejects with 400 (message naming the correct endpoint)" — so the 422 path is superseded; the 400 message still names `POST /api/orders/refund`, preserving the guard's intent. (`mergeExtensions`' corrupt-stored 422 is unchanged.)
2. **"Any tracking URL"** is implemented as rejecting both `trackingUrl` and `tracking_url` top-level body keys, plus stripping `trackingUrl` from the client `extensions` overlay in `mergeExtensions` (per contract).
3. **`payment_status` stays a logged silent drop** (BMC-140 behavior), not a 400 — it is absent from the contract's rejected-field list, and the spec requires existing payment-status protections "remain intact."
