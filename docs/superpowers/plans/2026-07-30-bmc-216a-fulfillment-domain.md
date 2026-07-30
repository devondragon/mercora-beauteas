# BMC-216A: Fulfillment Domain and Data Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the dependency-free fulfillment domain (carrier/event types, tracking normalization + URL building, ship/tracking transition matrix, shared customer-email resolver, guest order-status HMAC token) and the two D1 migrations plus Drizzle/TS schema changes (`orders.shipping_carrier`, `order_events`) that every later BMC-216 ticket builds on.

**Architecture:** Five pure modules under `lib/fulfillment/`, `lib/orders/`, and `lib/order-status/` that import nothing from D1, Next.js, Clerk, or Resend — they are the only place carrier/tracking/transition rules exist, and they are unit-testable in the plain Vitest (jsdom) pool CI actually runs. Two hand-written Wrangler migrations add the `orders.shipping_carrier` column (backfilled from `json_extract(extensions, '$.carrier')` with a narrow `shipping_method` fallback) and the append-only `order_events` audit table, mirrored in the Drizzle schema so ticket B can write through `getDbAsync()`. The guest token module is a byte-for-byte structural mirror of `lib/email/unsubscribe-token.ts` (fail-closed `getSecret`, length bound before any crypto, base64url helpers, constant-time compare, Web Crypto HMAC-SHA256) and signs a versioned scope only — no email or address payload travels inside the token.

**Tech Stack:** TypeScript (strict), Drizzle ORM `^0.45.2` (`drizzle-orm/sqlite-core`), Wrangler D1 raw SQL migrations, Web Crypto (`crypto.subtle`), Vitest (`vitest.config.ts`, jsdom, `tests/unit/**`).

**Depends on:** none (first ticket)

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

---

### Task 1: Carrier, event, and actor types

**Files:**
- Create: `lib/fulfillment/types.ts`
- Test: `tests/unit/lib/fulfillment/types.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `CARRIERS`, `Carrier`, `ORDER_EVENT_TYPES`, `OrderEventType`, `ActorType`, `Actor`, `ShipmentInput` — exactly as pinned in the contract's `lib/fulfillment/types.ts` section.

**Suggested agent:** haiku — pure constant/type declarations with no branching logic.

**Steps:**

- [ ] Write the failing test at `tests/unit/lib/fulfillment/types.test.ts`:

```ts
// tests/unit/lib/fulfillment/types.test.ts
//
// Pins the fulfillment vocabulary (BMC-216A). These constants are the contract
// between the migration backfill, the transition matrix, the audit table, and
// the admin UI — a silent rename or reordering breaks all of them at once.

import { describe, it, expect } from 'vitest';
import {
  CARRIERS,
  ORDER_EVENT_TYPES,
  type Carrier,
  type OrderEventType,
  type ActorType,
  type Actor,
  type ShipmentInput,
} from '@/lib/fulfillment/types';

describe('fulfillment types', () => {
  it('exposes exactly the three application carriers', () => {
    expect(CARRIERS).toEqual(['ups', 'fedex', 'other']);
  });

  it('exposes exactly the five initial order event types', () => {
    expect(ORDER_EVENT_TYPES).toEqual([
      'shipment_created',
      'tracking_updated',
      'shipping_email_sent',
      'shipping_email_failed',
      'shipping_email_resent',
    ]);
  });

  it('types derive from the constant arrays', () => {
    const carrier: Carrier = 'ups';
    const eventType: OrderEventType = 'shipment_created';
    const actorType: ActorType = 'admin';
    expect(CARRIERS).toContain(carrier);
    expect(ORDER_EVENT_TYPES).toContain(eventType);
    expect(['admin', 'service', 'system']).toContain(actorType);
  });

  it('models an admin actor, a service actor, and a system actor', () => {
    const admin: Actor = { type: 'admin', id: 'user_123' };
    const service: Actor = { type: 'service', id: 'api-token' };
    const system: Actor = { type: 'system', id: null };
    expect([admin.type, service.type, system.type]).toEqual(['admin', 'service', 'system']);
    expect(system.id).toBeNull();
  });

  it('models tracked and untracked shipment input', () => {
    const untracked: ShipmentInput = { carrier: null, trackingNumber: null };
    const tracked: ShipmentInput = { carrier: 'fedex', trackingNumber: '123456789012' };
    expect(untracked.carrier).toBeNull();
    expect(tracked.trackingNumber).toBe('123456789012');
  });
});
```

- [ ] Run it and confirm it fails: `npx vitest run tests/unit/lib/fulfillment/types.test.ts` — expect a resolve error (`Failed to load url @/lib/fulfillment/types`) because the module does not exist yet.

- [ ] Create `lib/fulfillment/types.ts`:

```ts
// lib/fulfillment/types.ts
//
// Shared fulfillment vocabulary (BMC-216). Pure declarations — no D1, Next,
// Clerk, or Resend imports, so every other fulfillment module (including the
// migration-mirroring tracking rules) can depend on this from any runtime.

/**
 * Application-level carrier values. `other` means "we recorded a carrier we
 * cannot deep-link" — it renders as a bare tracking number with no link.
 */
export const CARRIERS = ["ups", "fedex", "other"] as const;
export type Carrier = (typeof CARRIERS)[number];

/** Fulfillment audit event types written to `order_events`. */
export const ORDER_EVENT_TYPES = [
  "shipment_created",
  "tracking_updated",
  "shipping_email_sent",
  "shipping_email_failed",
  "shipping_email_resent",
] as const;
export type OrderEventType = (typeof ORDER_EVENT_TYPES)[number];

export type ActorType = "admin" | "service" | "system";

export interface Actor {
  type: ActorType;
  /** Clerk user ID, "api-token" for ADMIN_VECTORIZE_TOKEN, null for system. */
  id: string | null;
}

/** Normalized, already-validated shipment payload. */
export interface ShipmentInput {
  carrier: Carrier | null;
  /** Sanitized tracking number; null means an untracked shipment. */
  trackingNumber: string | null;
}
```

- [ ] Run it to pass: `npx vitest run tests/unit/lib/fulfillment/types.test.ts` — expect 5 passing tests.
- [ ] Run `npx tsc --noEmit` and confirm it exits 0.
- [ ] Commit:

```bash
git add lib/fulfillment/types.ts tests/unit/lib/fulfillment/types.test.ts
git commit -m "feat(fulfillment): add carrier, event, and actor types (BMC-216A)"
```

---

### Task 2: Pure tracking normalization and carrier URL building

**Files:**
- Create: `lib/fulfillment/tracking.ts`
- Test: `tests/unit/lib/fulfillment/tracking.test.ts`

**Interfaces:**
- Consumes: `CARRIERS`, `Carrier` from `@/lib/fulfillment/types` (Task 1).
- Produces:
  - `export const MAX_TRACKING_LENGTH = 100;`
  - `export function normalizeCarrier(raw: unknown): Carrier | null;`
  - `export function normalizeLegacyCarrier(raw: unknown): Carrier | null;`
  - `export function sanitizeTrackingNumber(raw: unknown): string | null;`
  - `export function buildTrackingUrl(carrier: Carrier | null, trackingNumber: string | null): string | null;`

**Suggested agent:** sonnet — untrusted-input sanitization and URL construction; the normalization rules must stay in lockstep with the SQL backfill in Task 6.

**Steps:**

- [ ] Write the failing test at `tests/unit/lib/fulfillment/tracking.test.ts`:

```ts
// tests/unit/lib/fulfillment/tracking.test.ts
//
// Carrier normalization + tracking sanitization + carrier deep links (BMC-216A).
// These rules are mirrored by the SQL backfill in migrations/0022 — keep the two
// in sync. Tracking values are customer-visible and end up in an href, so
// encoding and control-character handling are load-bearing, not cosmetic.

import { describe, it, expect } from 'vitest';
import {
  MAX_TRACKING_LENGTH,
  normalizeCarrier,
  normalizeLegacyCarrier,
  sanitizeTrackingNumber,
  buildTrackingUrl,
} from '@/lib/fulfillment/tracking';

describe('normalizeCarrier (strict API input)', () => {
  it('accepts the three carriers case-insensitively', () => {
    expect(normalizeCarrier('ups')).toBe('ups');
    expect(normalizeCarrier('UPS')).toBe('ups');
    expect(normalizeCarrier(' FedEx ')).toBe('fedex');
    expect(normalizeCarrier('Other')).toBe('other');
  });

  it('rejects anything that is not an exact carrier code', () => {
    expect(normalizeCarrier('usps')).toBeNull();
    expect(normalizeCarrier('UPS Ground')).toBeNull();
    expect(normalizeCarrier('')).toBeNull();
    expect(normalizeCarrier(null)).toBeNull();
    expect(normalizeCarrier(undefined)).toBeNull();
    expect(normalizeCarrier(42)).toBeNull();
    expect(normalizeCarrier({ carrier: 'ups' })).toBeNull();
  });
});

describe('normalizeLegacyCarrier (lenient legacy/backfill)', () => {
  it('maps UPS variants to ups', () => {
    expect(normalizeLegacyCarrier('UPS')).toBe('ups');
    expect(normalizeLegacyCarrier('  ups ground ')).toBe('ups');
    expect(normalizeLegacyCarrier('U.P.S.')).toBe('ups');
    expect(normalizeLegacyCarrier('UPS 2nd Day Air')).toBe('ups');
    expect(normalizeLegacyCarrier('United Parcel Service')).toBe('ups');
  });

  it('maps FedEx variants to fedex', () => {
    expect(normalizeLegacyCarrier('FedEx')).toBe('fedex');
    expect(normalizeLegacyCarrier('fed-ex')).toBe('fedex');
    expect(normalizeLegacyCarrier('FedEx Home Delivery')).toBe('fedex');
    expect(normalizeLegacyCarrier('Federal Express')).toBe('fedex');
  });

  it('maps any other non-empty value to other', () => {
    expect(normalizeLegacyCarrier('USPS')).toBe('other');
    expect(normalizeLegacyCarrier('DHL Express')).toBe('other');
    expect(normalizeLegacyCarrier('some free text')).toBe('other');
    expect(normalizeLegacyCarrier('other')).toBe('other');
  });

  it('maps empty, whitespace, and non-strings to null', () => {
    expect(normalizeLegacyCarrier('')).toBeNull();
    expect(normalizeLegacyCarrier('   ')).toBeNull();
    expect(normalizeLegacyCarrier(null)).toBeNull();
    expect(normalizeLegacyCarrier(undefined)).toBeNull();
    expect(normalizeLegacyCarrier(7)).toBeNull();
  });
});

describe('sanitizeTrackingNumber', () => {
  it('trims and returns a plausible tracking number', () => {
    expect(sanitizeTrackingNumber('  1Z999AA10123456784  ')).toBe('1Z999AA10123456784');
  });

  it('strips control characters', () => {
    expect(sanitizeTrackingNumber('1Z999\u0000AA1\u001F0123\u007F456784')).toBe('1Z999AA10123456784');
    expect(sanitizeTrackingNumber('1Z999\nAA1\r0123456784')).toBe('1Z999AA10123456784');
  });

  it('returns null for empty, whitespace-only, control-only, and non-string input', () => {
    expect(sanitizeTrackingNumber('')).toBeNull();
    expect(sanitizeTrackingNumber('    ')).toBeNull();
    expect(sanitizeTrackingNumber('\u0000\u0001')).toBeNull();
    expect(sanitizeTrackingNumber(null)).toBeNull();
    expect(sanitizeTrackingNumber(undefined)).toBeNull();
    expect(sanitizeTrackingNumber(1234567890)).toBeNull();
  });

  it('rejects rather than truncates over-length input', () => {
    expect(MAX_TRACKING_LENGTH).toBe(100);
    expect(sanitizeTrackingNumber('A'.repeat(MAX_TRACKING_LENGTH))).toBe('A'.repeat(MAX_TRACKING_LENGTH));
    expect(sanitizeTrackingNumber('A'.repeat(MAX_TRACKING_LENGTH + 1))).toBeNull();
  });
});

describe('buildTrackingUrl', () => {
  it('builds a UPS link', () => {
    expect(buildTrackingUrl('ups', '1Z999AA10123456784')).toBe(
      'https://www.ups.com/track?loc=en_US&tracknum=1Z999AA10123456784',
    );
  });

  it('builds a FedEx link', () => {
    expect(buildTrackingUrl('fedex', '123456789012')).toBe(
      'https://www.fedex.com/fedextrack/?trknbr=123456789012',
    );
  });

  it('URL-encodes the tracking value so it cannot break out of the query string', () => {
    expect(buildTrackingUrl('ups', 'a b&c=d#e')).toBe(
      'https://www.ups.com/track?loc=en_US&tracknum=a%20b%26c%3Dd%23e',
    );
    expect(buildTrackingUrl('fedex', '"><script>')).toBe(
      'https://www.fedex.com/fedextrack/?trknbr=%22%3E%3Cscript%3E',
    );
  });

  it('returns null when there is no link to build (never a search-engine URL)', () => {
    expect(buildTrackingUrl('other', '123456789012')).toBeNull();
    expect(buildTrackingUrl(null, '123456789012')).toBeNull();
    expect(buildTrackingUrl('ups', null)).toBeNull();
    expect(buildTrackingUrl(null, null)).toBeNull();
  });
});
```

- [ ] Run it and confirm it fails: `npx vitest run tests/unit/lib/fulfillment/tracking.test.ts` — expect a resolve error (`Failed to load url @/lib/fulfillment/tracking`).

- [ ] Create `lib/fulfillment/tracking.ts`:

```ts
// lib/fulfillment/tracking.ts
//
// Pure carrier normalization and tracking-link construction (BMC-216).
// Imports nothing from D1/Next/Clerk/Resend so it runs in the plain Vitest pool.
//
// The tracking URL is ALWAYS derived here from (carrier, trackingNumber) — no
// customer-facing tracking URL is ever persisted or accepted from a browser.

import { CARRIERS, type Carrier } from "./types";

/**
 * Upper bound on an accepted tracking number. Real carrier numbers top out
 * around 34 characters; 100 is generous headroom that still caps what a
 * compromised admin session could push into an email and an href.
 */
export const MAX_TRACKING_LENGTH = 100;

const CARRIER_CODES: ReadonlySet<string> = new Set<string>(CARRIERS);

/**
 * Strict normalization for API input: only the exact carrier codes, case- and
 * whitespace-insensitive. "UPS Ground" is NOT accepted here — the API takes a
 * code, not free text.
 */
export function normalizeCarrier(raw: unknown): Carrier | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim().toLowerCase();
  return CARRIER_CODES.has(value) ? (value as Carrier) : null;
}

/**
 * Lowercase and drop separators so "UPS Ground", "u.p.s.", and "Fed-Ex" all
 * collapse to a comparable token. Mirrored in SQL by the nested `replace(...)`
 * chain in migrations/0022_add_shipping_carrier.sql — change both together.
 */
function compactCarrierToken(raw: string): string {
  return raw.trim().toLowerCase().replace(/[\s._-]/g, "");
}

/**
 * Lenient normalization for legacy values (the 0022 backfill and any legacy
 * display path): UPS/FedEx variants map to their code, any other non-empty
 * string becomes "other" (lossless original stays in extensions.carrier), and
 * empty/whitespace/non-string becomes null.
 */
export function normalizeLegacyCarrier(raw: unknown): Carrier | null {
  if (typeof raw !== "string") return null;
  const token = compactCarrierToken(raw);
  if (token === "") return null;
  if (token.startsWith("ups") || token.startsWith("unitedparcel")) return "ups";
  if (token.startsWith("fedex") || token.startsWith("federalexpress")) return "fedex";
  return "other";
}

/**
 * Trim, strip C0/C1 control characters and DEL, and enforce
 * MAX_TRACKING_LENGTH. Over-length input returns null — callers treat that as
 * invalid input rather than silently emailing a truncated tracking number.
 */
export function sanitizeTrackingNumber(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const stripped = raw.replace(/[\u0000-\u001F\u007F-\u009F]/g, "");
  const trimmed = stripped.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > MAX_TRACKING_LENGTH) return null;
  return trimmed;
}

/**
 * Build the carrier-owned tracking URL. Returns null for "other", a missing
 * carrier, or a missing tracking number. Deliberately never falls back to a
 * search-engine URL: that would leak the tracking value to an unrelated third
 * party and is not a carrier-owned destination.
 */
export function buildTrackingUrl(
  carrier: Carrier | null,
  trackingNumber: string | null,
): string | null {
  if (!carrier || !trackingNumber) return null;
  const encoded = encodeURIComponent(trackingNumber);
  switch (carrier) {
    case "ups":
      return `https://www.ups.com/track?loc=en_US&tracknum=${encoded}`;
    case "fedex":
      return `https://www.fedex.com/fedextrack/?trknbr=${encoded}`;
    default:
      return null;
  }
}
```

- [ ] Run it to pass: `npx vitest run tests/unit/lib/fulfillment/tracking.test.ts` — expect 12 passing tests.
- [ ] Run `npx tsc --noEmit` and confirm it exits 0.
- [ ] Commit:

```bash
git add lib/fulfillment/tracking.ts tests/unit/lib/fulfillment/tracking.test.ts
git commit -m "feat(fulfillment): add pure carrier normalization and tracking URL builder (BMC-216A)"
```

---

### Task 3: Pure transition matrix and shipment-input parsing

**Files:**
- Create: `lib/fulfillment/transitions.ts`
- Test: `tests/unit/lib/fulfillment/transitions.test.ts`

**Interfaces:**
- Consumes: `Carrier`, `ShipmentInput` (Task 1); `MAX_TRACKING_LENGTH`, `normalizeCarrier`, `normalizeLegacyCarrier`, `sanitizeTrackingNumber` (Task 2).
- Produces:
  - `export interface OrderFulfillmentSnapshot { status: string; payment_status: string | null; shipping_carrier: string | null; tracking_number: string | null; }`
  - `export function parseShipmentInput(body: unknown): { ok: true; input: ShipmentInput } | { ok: false; error: string };`
  - `export function shipmentDataEqual(a: ShipmentInput, b: ShipmentInput): boolean;`
  - `export type ShipDecision = { kind: "ship" } | { kind: "idempotent" } | { kind: "conflict" } | { kind: "not_fulfillable"; status: string; paymentStatus: string | null };`
  - `export function decideShipment(order: OrderFulfillmentSnapshot, input: ShipmentInput): ShipDecision;`
  - `export function canEditTracking(order: OrderFulfillmentSnapshot): boolean;`

**Suggested agent:** opus — this is the safety matrix that decides 201 vs 200 vs 409; the idempotent/conflict branch must compare normalized legacy values, and a wrong branch here either double-emails a customer or blocks a legitimate shipment.

**Steps:**

- [ ] Write the failing test at `tests/unit/lib/fulfillment/transitions.test.ts`:

```ts
// tests/unit/lib/fulfillment/transitions.test.ts
//
// The fulfillment transition matrix (BMC-216A). Only paid + processing orders
// can be newly shipped; an already-shipped order is either an idempotent retry
// or a conflict. This module is the single source of truth for those decisions
// and imports no D1/Next/Clerk/Resend.

import { describe, it, expect } from 'vitest';
import {
  parseShipmentInput,
  shipmentDataEqual,
  decideShipment,
  canEditTracking,
  type OrderFulfillmentSnapshot,
} from '@/lib/fulfillment/transitions';
import { MAX_TRACKING_LENGTH } from '@/lib/fulfillment/tracking';
import type { ShipmentInput } from '@/lib/fulfillment/types';

function snapshot(over: Partial<OrderFulfillmentSnapshot> = {}): OrderFulfillmentSnapshot {
  return {
    status: 'processing',
    payment_status: 'paid',
    shipping_carrier: null,
    tracking_number: null,
    ...over,
  };
}

const UNTRACKED: ShipmentInput = { carrier: null, trackingNumber: null };
const UPS: ShipmentInput = { carrier: 'ups', trackingNumber: '1Z999AA10123456784' };

describe('parseShipmentInput', () => {
  it('accepts an empty body as a valid untracked shipment', () => {
    expect(parseShipmentInput({})).toEqual({ ok: true, input: { carrier: null, trackingNumber: null } });
  });

  it('accepts explicit nulls as a valid untracked shipment', () => {
    expect(parseShipmentInput({ carrier: null, trackingNumber: null })).toEqual({
      ok: true,
      input: { carrier: null, trackingNumber: null },
    });
  });

  it('accepts a full carrier + tracking pair and sanitizes the tracking number', () => {
    expect(parseShipmentInput({ carrier: 'UPS', trackingNumber: '  1Z999AA10123456784 ' })).toEqual({
      ok: true,
      input: { carrier: 'ups', trackingNumber: '1Z999AA10123456784' },
    });
  });

  it('rejects a tracking number with no carrier', () => {
    const result = parseShipmentInput({ trackingNumber: '1Z999AA10123456784' });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/carrier/i);
  });

  it('rejects a carrier with no tracking number', () => {
    const result = parseShipmentInput({ carrier: 'ups' });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/trackingNumber/i);
  });

  it('rejects an unknown carrier', () => {
    const result = parseShipmentInput({ carrier: 'usps', trackingNumber: '9400111899223197428490' });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/carrier/i);
  });

  it('rejects tracking input that sanitizes to nothing or is over-length', () => {
    expect(parseShipmentInput({ carrier: 'ups', trackingNumber: '\u0000\u0001' }).ok).toBe(false);
    expect(
      parseShipmentInput({ carrier: 'ups', trackingNumber: 'A'.repeat(MAX_TRACKING_LENGTH + 1) }).ok,
    ).toBe(false);
  });

  it('rejects a non-object body', () => {
    expect(parseShipmentInput(null).ok).toBe(false);
    expect(parseShipmentInput('ups').ok).toBe(false);
    expect(parseShipmentInput([]).ok).toBe(false);
  });

  it('ignores unknown keys rather than trusting them', () => {
    expect(parseShipmentInput({ status: 'shipped', shipped_at: '2020-01-01', trackingUrl: 'http://evil' })).toEqual({
      ok: true,
      input: { carrier: null, trackingNumber: null },
    });
  });
});

describe('shipmentDataEqual', () => {
  it('compares tracking numbers case-insensitively and carriers exactly', () => {
    expect(shipmentDataEqual(UPS, { carrier: 'ups', trackingNumber: '1z999aa10123456784' })).toBe(true);
    expect(shipmentDataEqual(UPS, { carrier: 'fedex', trackingNumber: '1Z999AA10123456784' })).toBe(false);
    expect(shipmentDataEqual(UPS, { carrier: 'ups', trackingNumber: '1Z999AA10123456785' })).toBe(false);
  });

  it('treats two untracked shipments as equal', () => {
    expect(shipmentDataEqual(UNTRACKED, { carrier: null, trackingNumber: null })).toBe(true);
    expect(shipmentDataEqual(UNTRACKED, UPS)).toBe(false);
  });
});

describe('decideShipment', () => {
  it('ships a paid processing order', () => {
    expect(decideShipment(snapshot(), UPS)).toEqual({ kind: 'ship' });
    expect(decideShipment(snapshot(), UNTRACKED)).toEqual({ kind: 'ship' });
  });

  it('refuses a processing order that is not paid', () => {
    expect(decideShipment(snapshot({ payment_status: 'pending' }), UPS)).toEqual({
      kind: 'not_fulfillable',
      status: 'processing',
      paymentStatus: 'pending',
    });
    expect(decideShipment(snapshot({ payment_status: null }), UPS)).toEqual({
      kind: 'not_fulfillable',
      status: 'processing',
      paymentStatus: null,
    });
  });

  it('refuses pending, delivered, cancelled, and refunded orders', () => {
    for (const status of ['pending', 'delivered', 'cancelled', 'refunded']) {
      expect(decideShipment(snapshot({ status }), UPS)).toEqual({
        kind: 'not_fulfillable',
        status,
        paymentStatus: 'paid',
      });
    }
  });

  it('is idempotent for a shipped order with identical data', () => {
    const shipped = snapshot({
      status: 'shipped',
      shipping_carrier: 'ups',
      tracking_number: '1Z999AA10123456784',
    });
    expect(decideShipment(shipped, UPS)).toEqual({ kind: 'idempotent' });
    expect(decideShipment(shipped, { carrier: 'ups', trackingNumber: '1z999aa10123456784' })).toEqual({
      kind: 'idempotent',
    });
  });

  it('is idempotent for a shipped untracked order retried untracked', () => {
    expect(decideShipment(snapshot({ status: 'shipped' }), UNTRACKED)).toEqual({ kind: 'idempotent' });
  });

  it('normalizes a legacy stored carrier before comparing', () => {
    const shipped = snapshot({
      status: 'shipped',
      shipping_carrier: 'UPS Ground',
      tracking_number: '1Z999AA10123456784',
    });
    expect(decideShipment(shipped, UPS)).toEqual({ kind: 'idempotent' });
  });

  it('conflicts for a shipped order with different data', () => {
    const shipped = snapshot({
      status: 'shipped',
      shipping_carrier: 'ups',
      tracking_number: '1Z999AA10123456784',
    });
    expect(decideShipment(shipped, { carrier: 'fedex', trackingNumber: '123456789012' })).toEqual({
      kind: 'conflict',
    });
    expect(decideShipment(shipped, UNTRACKED)).toEqual({ kind: 'conflict' });
  });
});

describe('canEditTracking', () => {
  it('allows tracking correction only after shipment', () => {
    expect(canEditTracking(snapshot({ status: 'shipped' }))).toBe(true);
    expect(canEditTracking(snapshot({ status: 'processing' }))).toBe(false);
    expect(canEditTracking(snapshot({ status: 'delivered' }))).toBe(false);
    expect(canEditTracking(snapshot({ status: 'cancelled' }))).toBe(false);
    expect(canEditTracking(snapshot({ status: 'refunded' }))).toBe(false);
    expect(canEditTracking(snapshot({ status: 'pending' }))).toBe(false);
  });
});
```

- [ ] Run it and confirm it fails: `npx vitest run tests/unit/lib/fulfillment/transitions.test.ts` — expect a resolve error (`Failed to load url @/lib/fulfillment/transitions`).

- [ ] Create `lib/fulfillment/transitions.ts`:

```ts
// lib/fulfillment/transitions.ts
//
// The fulfillment transition matrix (BMC-216), kept pure so it is unit-testable
// without D1/Next/Clerk/Resend. The service layer (ticket B) performs the
// guarded D1 write; this module decides what the write SHOULD be and what a
// zero-row CAS means after a re-read.

import type { ShipmentInput } from "./types";
import {
  MAX_TRACKING_LENGTH,
  normalizeCarrier,
  normalizeLegacyCarrier,
  sanitizeTrackingNumber,
} from "./tracking";

/** The only order fields the transition rules are allowed to look at. */
export interface OrderFulfillmentSnapshot {
  status: string;
  payment_status: string | null;
  shipping_carrier: string | null;
  tracking_number: string | null;
}

/** A key counts as "supplied" only when it is present and not null/empty. */
function isSupplied(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === "string" && value.trim() === "") return false;
  return true;
}

/**
 * Parse and validate a request body into a ShipmentInput. Carrier and tracking
 * are optional as a PAIR: both absent is a valid untracked shipment, but one
 * without the other is invalid. Unknown keys (status, shipped_at, trackingUrl)
 * are ignored — those are server-owned.
 */
export function parseShipmentInput(
  body: unknown,
): { ok: true; input: ShipmentInput } | { ok: false; error: string } {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Request body must be a JSON object" };
  }

  const raw = body as Record<string, unknown>;
  const hasCarrier = isSupplied(raw.carrier);
  const hasTracking = isSupplied(raw.trackingNumber);

  if (!hasCarrier && !hasTracking) {
    return { ok: true, input: { carrier: null, trackingNumber: null } };
  }
  if (!hasCarrier) {
    return { ok: false, error: "trackingNumber requires a carrier" };
  }
  if (!hasTracking) {
    return { ok: false, error: "carrier requires a trackingNumber" };
  }

  const carrier = normalizeCarrier(raw.carrier);
  if (!carrier) {
    return { ok: false, error: "Unknown carrier; expected one of: ups, fedex, other" };
  }

  const trackingNumber = sanitizeTrackingNumber(raw.trackingNumber);
  if (!trackingNumber) {
    return {
      ok: false,
      error: `Invalid trackingNumber (1-${MAX_TRACKING_LENGTH} characters, no control characters)`,
    };
  }

  return { ok: true, input: { carrier, trackingNumber } };
}

/** Carrier compared exactly; tracking number compared case-insensitively. */
export function shipmentDataEqual(a: ShipmentInput, b: ShipmentInput): boolean {
  if (a.carrier !== b.carrier) return false;
  const at = a.trackingNumber === null ? null : a.trackingNumber.toUpperCase();
  const bt = b.trackingNumber === null ? null : b.trackingNumber.toUpperCase();
  return at === bt;
}

export type ShipDecision =
  | { kind: "ship" }
  | { kind: "idempotent" }
  | { kind: "conflict" }
  | { kind: "not_fulfillable"; status: string; paymentStatus: string | null };

/**
 * processing + paid  -> ship
 * shipped            -> idempotent (identical data) or conflict
 * everything else    -> not_fulfillable (status/paymentStatus returned so the
 *                       admin UI can say WHY rather than "409")
 *
 * The stored carrier is run through normalizeLegacyCarrier so a pre-migration
 * value like "UPS Ground" compares equal to a fresh "ups" retry.
 */
export function decideShipment(
  order: OrderFulfillmentSnapshot,
  input: ShipmentInput,
): ShipDecision {
  if (order.status === "shipped") {
    const stored: ShipmentInput = {
      carrier: normalizeLegacyCarrier(order.shipping_carrier),
      trackingNumber: sanitizeTrackingNumber(order.tracking_number),
    };
    return shipmentDataEqual(stored, input) ? { kind: "idempotent" } : { kind: "conflict" };
  }

  if (order.status === "processing" && order.payment_status === "paid") {
    return { kind: "ship" };
  }

  return {
    kind: "not_fulfillable",
    status: order.status,
    paymentStatus: order.payment_status,
  };
}

/** Tracking correction is allowed only on an already-shipped order. */
export function canEditTracking(order: OrderFulfillmentSnapshot): boolean {
  return order.status === "shipped";
}
```

- [ ] Run it to pass: `npx vitest run tests/unit/lib/fulfillment/transitions.test.ts` — expect 18 passing tests.
- [ ] Run `npx tsc --noEmit` and confirm it exits 0.
- [ ] Commit:

```bash
git add lib/fulfillment/transitions.ts tests/unit/lib/fulfillment/transitions.test.ts
git commit -m "feat(fulfillment): add pure ship/tracking transition matrix (BMC-216A)"
```

---

### Task 4: Shared `getOrderCustomerEmail` resolver + order-confirmation refactor

**Files:**
- Create: `lib/orders/customer-email.ts`
- Modify: `lib/services/order-confirmation.ts` (line ~107, `const customerEmail = ext.email || shippingAddr?.email || '';`)
- Test: `tests/unit/lib/orders/customer-email.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `export function getOrderCustomerEmail(order: { extensions?: Record<string, unknown> | null; shipping_address?: unknown }): string | null;`

**Suggested agent:** sonnet — small pure helper plus a careful in-place refactor of a live money-path caller that must keep its "no email → skip send" behavior.

**Steps:**

- [ ] Write the failing test at `tests/unit/lib/orders/customer-email.test.ts`:

```ts
// tests/unit/lib/orders/customer-email.test.ts
//
// Single source of truth for "who is this order's customer?" (BMC-216A).
// Orders have no email column: the address resolves as
// extensions.email || shipping_address.email — exactly what the
// order-confirmation sender did inline before this helper existed.
//
// The normalized value is also what the guest order-status token is bound to,
// so an unstable result here would invalidate live guest links.

import { describe, it, expect } from 'vitest';
import { getOrderCustomerEmail } from '@/lib/orders/customer-email';

describe('getOrderCustomerEmail', () => {
  it('prefers extensions.email', () => {
    expect(
      getOrderCustomerEmail({
        extensions: { email: 'ext@example.com' },
        shipping_address: { email: 'addr@example.com' },
      }),
    ).toBe('ext@example.com');
  });

  it('falls back to shipping_address.email', () => {
    expect(
      getOrderCustomerEmail({ extensions: {}, shipping_address: { email: 'addr@example.com' } }),
    ).toBe('addr@example.com');
  });

  it('trims and lowercases so the value is stable for token signing', () => {
    expect(getOrderCustomerEmail({ extensions: { email: '  Person@Example.COM ' } })).toBe(
      'person@example.com',
    );
    expect(getOrderCustomerEmail({ shipping_address: { email: 'ADDR@Example.com' } })).toBe(
      'addr@example.com',
    );
  });

  it('skips an empty or whitespace-only extensions email and uses the address', () => {
    expect(
      getOrderCustomerEmail({ extensions: { email: '   ' }, shipping_address: { email: 'addr@example.com' } }),
    ).toBe('addr@example.com');
  });

  it('returns null when neither source resolves', () => {
    expect(getOrderCustomerEmail({})).toBeNull();
    expect(getOrderCustomerEmail({ extensions: null, shipping_address: null })).toBeNull();
    expect(getOrderCustomerEmail({ extensions: {}, shipping_address: {} })).toBeNull();
    expect(getOrderCustomerEmail({ extensions: { email: '' }, shipping_address: { email: '  ' } })).toBeNull();
  });

  it('ignores non-string and structurally invalid values', () => {
    expect(getOrderCustomerEmail({ extensions: { email: 42 } as Record<string, unknown> })).toBeNull();
    expect(getOrderCustomerEmail({ shipping_address: 'not-an-object' })).toBeNull();
    expect(getOrderCustomerEmail({ shipping_address: ['a@b.com'] })).toBeNull();
    expect(getOrderCustomerEmail({ extensions: { email: { value: 'a@b.com' } } })).toBeNull();
  });
});
```

- [ ] Run it and confirm it fails: `npx vitest run tests/unit/lib/orders/customer-email.test.ts` — expect a resolve error (`Failed to load url @/lib/orders/customer-email`).

- [ ] Create `lib/orders/customer-email.ts`:

```ts
// lib/orders/customer-email.ts
//
// Resolve the customer email for an order (BMC-216A).
//
// Orders have no `email` column. Guest checkout stores the address on
// `extensions.email`; some paths only have it on the shipping address. This is
// the single source of truth for that fallback chain — the order-confirmation
// sender, the shipping email, and the guest order-status token all use it, and
// the token is signed over the value returned here, so normalization must stay
// stable.
//
// Pure: no D1/Next/Clerk/Resend imports.

function normalizeEmailValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

export function getOrderCustomerEmail(order: {
  extensions?: Record<string, unknown> | null;
  shipping_address?: unknown;
}): string | null {
  const fromExtensions = normalizeEmailValue(order.extensions?.email);
  if (fromExtensions) return fromExtensions;

  const address = order.shipping_address;
  if (address && typeof address === "object" && !Array.isArray(address)) {
    const fromAddress = normalizeEmailValue((address as Record<string, unknown>).email);
    if (fromAddress) return fromAddress;
  }

  return null;
}
```

- [ ] Run it to pass: `npx vitest run tests/unit/lib/orders/customer-email.test.ts` — expect 6 passing tests.

- [ ] Add the import to `lib/services/order-confirmation.ts`, immediately after the existing import block at the top of the file:

```ts
import { getOrderCustomerEmail } from '@/lib/orders/customer-email';
```

- [ ] Replace the inline resolution in `lib/services/order-confirmation.ts` (~line 107). Change:

```ts
    const customerEmail = ext.email || shippingAddr?.email || '';
    if (!customerEmail) {
      console.warn(`[order-confirmation] Order ${order.id}: no customer email; skipping confirmation`);
      return;
    }
```

to:

```ts
    // Single source of truth for extensions.email || shipping_address.email —
    // the shipping email and the guest order-status token bind to the same
    // normalized value (BMC-216A).
    const customerEmail = getOrderCustomerEmail(order);
    if (!customerEmail) {
      console.warn(`[order-confirmation] Order ${order.id}: no customer email; skipping confirmation`);
      return;
    }
```

Leave `ext` and `shippingAddr` in place — they are still used for `ext.subtotal`, `ext.shipping_cost`, `ext.tax_amount`, and the recipient-name fallback above.

- [ ] Run `npx tsc --noEmit` and confirm it exits 0 (`customerEmail` is now `string`, not `string | undefined`, so the downstream `OrderData.customerEmail` assignment still typechecks).
- [ ] Run the existing service tests to confirm no regression: `npx vitest run tests/unit/lib/services` — expect all existing tests to pass.
- [ ] Commit:

```bash
git add lib/orders/customer-email.ts tests/unit/lib/orders/customer-email.test.ts lib/services/order-confirmation.ts
git commit -m "feat(orders): extract shared getOrderCustomerEmail resolver (BMC-216A)"
```

---

### Task 5: Guest order-status HMAC token

**Files:**
- Create: `lib/order-status/token.ts`
- Test: `tests/unit/lib/order-status/token.test.ts`

**Interfaces:**
- Consumes: `getOrderCustomerEmail` (Task 4) — only in the test, to prove the "no email → no token" acceptance criterion.
- Produces:
  - `export const MAX_ORDER_STATUS_TOKEN_LENGTH = 256;`
  - `export function isOrderStatusTokenConfigured(): boolean;`
  - `export function createOrderStatusToken(orderId: string, email: string): Promise<string | null>;`
  - `export function verifyOrderStatusToken(token: string, orderId: string, email: string): Promise<boolean>;`
  - Signed scope: `order-status:v1:<orderId>:<normalizedEmail>`; secret env var `ORDER_STATUS_SECRET`.

**Suggested agent:** opus — this is an unauthenticated bearer credential guarding customer order data; fail-closed secret handling, pre-decode length bound, fixed-length constant-time compare, and scope binding all have to be exactly right.

**Steps:**

- [ ] Write the failing test at `tests/unit/lib/order-status/token.test.ts`:

```ts
// tests/unit/lib/order-status/token.test.ts
//
// Guest order-status bearer token (BMC-216A). Mirrors the unsubscribe-token
// tests: round trip, tampering, wrong scope (order/email), wrong secret,
// missing secret, and an over-length DoS guard. The token is the ONLY thing
// standing between a URL and a stranger's order, so every rejection path is
// asserted explicitly.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  MAX_ORDER_STATUS_TOKEN_LENGTH,
  isOrderStatusTokenConfigured,
  createOrderStatusToken,
  verifyOrderStatusToken,
} from '@/lib/order-status/token';
import { getOrderCustomerEmail } from '@/lib/orders/customer-email';

const SECRET = 'test-order-status-secret';
const ORDER_ID = 'order_abc123';
const EMAIL = 'person@example.com';

describe('order-status token', () => {
  beforeEach(() => {
    process.env.ORDER_STATUS_SECRET = SECRET;
  });
  afterEach(() => {
    delete process.env.ORDER_STATUS_SECRET;
  });

  it('round-trips a token for one order + email', async () => {
    const token = await createOrderStatusToken(ORDER_ID, EMAIL);
    expect(token).toBeTruthy();
    expect(await verifyOrderStatusToken(token!, ORDER_ID, EMAIL)).toBe(true);
  });

  it('normalizes email case/whitespace so the token is stable', async () => {
    const a = await createOrderStatusToken(ORDER_ID, '  Person@Example.COM ');
    const b = await createOrderStatusToken(ORDER_ID, EMAIL);
    expect(a).toBe(b);
    expect(await verifyOrderStatusToken(a!, ORDER_ID, '  PERSON@example.com  ')).toBe(true);
  });

  it('carries no email payload — the token is signature only', async () => {
    const token = (await createOrderStatusToken(ORDER_ID, EMAIL))!;
    expect(token).not.toContain('.');
    const decoded = Buffer.from(token.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    expect(decoded).not.toContain('example.com');
    expect(decoded).not.toContain(ORDER_ID);
  });

  it('rejects the token on a different order', async () => {
    const token = (await createOrderStatusToken(ORDER_ID, EMAIL))!;
    expect(await verifyOrderStatusToken(token, 'order_other', EMAIL)).toBe(false);
  });

  it('rejects the token for a different email', async () => {
    const token = (await createOrderStatusToken(ORDER_ID, EMAIL))!;
    expect(await verifyOrderStatusToken(token, ORDER_ID, 'attacker@example.com')).toBe(false);
  });

  it('rejects a tampered signature', async () => {
    const token = (await createOrderStatusToken(ORDER_ID, EMAIL))!;
    // Mutate the FIRST char — it maps to the high bits of signature byte 0, so
    // the decoded bytes definitely differ (the last char is partly padding).
    const flipped = (token[0] === 'A' ? 'B' : 'A') + token.slice(1);
    expect(await verifyOrderStatusToken(flipped, ORDER_ID, EMAIL)).toBe(false);
  });

  it('rejects malformed and wrong-length tokens', async () => {
    expect(await verifyOrderStatusToken('', ORDER_ID, EMAIL)).toBe(false);
    expect(await verifyOrderStatusToken('!!!not-base64!!!', ORDER_ID, EMAIL)).toBe(false);
    expect(await verifyOrderStatusToken('QUJD', ORDER_ID, EMAIL)).toBe(false); // valid base64, 3 bytes
  });

  it('rejects an over-long token without doing HMAC work (DoS guard)', async () => {
    const huge = 'a'.repeat(MAX_ORDER_STATUS_TOKEN_LENGTH + 1);
    expect(await verifyOrderStatusToken(huge, ORDER_ID, EMAIL)).toBe(false);
  });

  it('rejects a token signed with a different secret', async () => {
    const token = (await createOrderStatusToken(ORDER_ID, EMAIL))!;
    process.env.ORDER_STATUS_SECRET = 'a-different-secret';
    expect(await verifyOrderStatusToken(token, ORDER_ID, EMAIL)).toBe(false);
  });

  it('reports configuration state via isOrderStatusTokenConfigured', () => {
    expect(isOrderStatusTokenConfigured()).toBe(true);
    delete process.env.ORDER_STATUS_SECRET;
    expect(isOrderStatusTokenConfigured()).toBe(false);
    process.env.ORDER_STATUS_SECRET = '';
    expect(isOrderStatusTokenConfigured()).toBe(false);
  });

  it('fails closed when the secret is unset', async () => {
    delete process.env.ORDER_STATUS_SECRET;
    expect(await createOrderStatusToken(ORDER_ID, EMAIL)).toBeNull();

    process.env.ORDER_STATUS_SECRET = SECRET;
    const token = (await createOrderStatusToken(ORDER_ID, EMAIL))!;
    delete process.env.ORDER_STATUS_SECRET;
    expect(await verifyOrderStatusToken(token, ORDER_ID, EMAIL)).toBe(false);
  });

  it('mints no token for an empty email or empty order id', async () => {
    expect(await createOrderStatusToken(ORDER_ID, '')).toBeNull();
    expect(await createOrderStatusToken(ORDER_ID, '   ')).toBeNull();
    expect(await createOrderStatusToken('', EMAIL)).toBeNull();
  });

  it('mints no token for an order with no resolvable customer email', async () => {
    // Acceptance criterion: a token bound to an empty string would verify for
    // ANY email-less order, so the whole guest link must be suppressed.
    const emailless = { extensions: {}, shipping_address: {} };
    const resolved = getOrderCustomerEmail(emailless);
    expect(resolved).toBeNull();
    expect(await createOrderStatusToken(ORDER_ID, resolved ?? '')).toBeNull();
    expect(await verifyOrderStatusToken('anything', ORDER_ID, resolved ?? '')).toBe(false);
  });
});
```

- [ ] Run it and confirm it fails: `npx vitest run tests/unit/lib/order-status/token.test.ts` — expect a resolve error (`Failed to load url @/lib/order-status/token`).

- [ ] Create `lib/order-status/token.ts`:

```ts
/**
 * Stateless, unforgeable guest order-status tokens (BMC-216).
 *
 * A token is `base64url(HMAC-SHA256("order-status:v1:<orderId>:<email>"))`,
 * signed with ORDER_STATUS_SECRET. It is a SIGNATURE ONLY — no email, address,
 * or order payload travels inside it. The verifier already knows the order id
 * (from the URL) and re-derives the customer email from the order row, so
 * nothing about the customer is exposed by the link itself.
 *
 * The scope binds a token to exactly one (order, email) pair, so a token for
 * one order cannot be replayed against another, and rotating the customer's
 * stored email invalidates old links.
 *
 * Pure Web Crypto (`crypto.subtle`) — Workers- and unit-test-compatible, and
 * imports nothing from Next/Cloudflare/D1, mirroring
 * lib/email/unsubscribe-token.ts.
 */

/** Versioned scope prefix. Bump to v2 to invalidate every issued token. */
const SCOPE_VERSION = 'order-status:v1';

/**
 * Upper bound on token length before we base64-decode + HMAC a public,
 * unauthenticated input. A real token is base64url of a 32-byte signature (43
 * chars); 256 is generous headroom that still caps CPU/memory work from a
 * megabyte-sized query param.
 *
 * Tokens intentionally never expire: a customer must be able to check an old
 * order's status, and the link is already scoped to one order + email.
 */
export const MAX_ORDER_STATUS_TOKEN_LENGTH = 256;

/** Raw HMAC-SHA256 output length, in bytes. */
const SIGNATURE_BYTES = 32;

function b64urlEncode(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Normalize so tokens are stable regardless of case/whitespace in the address. */
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

async function hmacSha256(secret: string, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return new Uint8Array(sig);
}

function getSecret(): string | null {
  const s = process.env.ORDER_STATUS_SECRET;
  return s && s.length > 0 ? s : null;
}

function scopeFor(orderId: string, normalizedEmail: string): string {
  return `${SCOPE_VERSION}:${orderId}:${normalizedEmail}`;
}

/**
 * Whether guest status tokens can be minted (ORDER_STATUS_SECRET is set).
 * Senders should check this once up front and omit the guest link entirely
 * when false, rather than emailing a link that can never verify.
 */
export function isOrderStatusTokenConfigured(): boolean {
  return getSecret() !== null;
}

/**
 * Create a guest order-status token. Returns null when the secret is unset
 * (fail closed) or when the order has no resolvable email — a token bound to
 * an empty string would verify for ANY email-less order, so callers MUST treat
 * null as "emit no guest link".
 */
export async function createOrderStatusToken(
  orderId: string,
  email: string,
): Promise<string | null> {
  const secret = getSecret();
  if (!secret) return null;
  if (typeof orderId !== 'string' || orderId.trim() === '') return null;
  if (typeof email !== 'string') return null;

  const normalized = normalizeEmail(email);
  if (!normalized) return null;

  const sig = await hmacSha256(secret, scopeFor(orderId, normalized));
  return b64urlEncode(sig);
}

/** Length-safe byte comparison (signatures are fixed 32-byte, so no length leak). */
function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a[i] ^ b[i];
  return mismatch === 0;
}

/**
 * Verify a guest order-status token against an (orderId, email) pair. Returns
 * false when the secret is unset, the token is over-length, malformed, the
 * wrong size, or the signature does not match. Never throws.
 */
export async function verifyOrderStatusToken(
  token: string,
  orderId: string,
  email: string,
): Promise<boolean> {
  const secret = getSecret();
  if (!secret) return false;
  if (typeof token !== 'string' || token.length === 0) return false;
  if (token.length > MAX_ORDER_STATUS_TOKEN_LENGTH) return false;
  if (typeof orderId !== 'string' || orderId.trim() === '') return false;
  if (typeof email !== 'string') return false;

  const normalized = normalizeEmail(email);
  if (!normalized) return false;

  let presented: Uint8Array;
  try {
    presented = b64urlDecode(token);
  } catch {
    return false;
  }
  if (presented.length !== SIGNATURE_BYTES) return false;

  const expected = await hmacSha256(secret, scopeFor(orderId, normalized));
  return bytesEqual(expected, presented);
}
```

- [ ] Run it to pass: `npx vitest run tests/unit/lib/order-status/token.test.ts` — expect 13 passing tests.
- [ ] Run `npx tsc --noEmit` and confirm it exits 0.
- [ ] Add the local dev secret so `preview:dev` can mint links (`.dev.vars` is gitignored — this is a local-only step, nothing to commit; provisioning dev/prod secrets belongs to BMC-216G):

```bash
printf '\n# Signs guest order-status links (BMC-216). Any strong random string.\nORDER_STATUS_SECRET=%s\n' "$(openssl rand -hex 32)" >> /Users/devon/git/mercora-beauteas/.dev.vars
```

- [ ] Confirm it landed and is not staged: `grep -c ORDER_STATUS_SECRET /Users/devon/git/mercora-beauteas/.dev.vars` prints `1`, and `git status --short` shows no `.dev.vars` entry.
- [ ] Commit:

```bash
git add lib/order-status/token.ts tests/unit/lib/order-status/token.test.ts
git commit -m "feat(order-status): add HMAC guest order-status token (BMC-216A)"
```

---

### Task 6: Migration 0022 — `orders.shipping_carrier` + Drizzle/TS schema

**Files:**
- Create: `migrations/0022_add_shipping_carrier.sql`
- Modify: `lib/db/schema/order.ts` (orders table, after `shipping_method: text("shipping_method"),` ~line 34)
- Modify: `lib/types/order.ts` (`Order` interface "Tracking and fulfillment" block, ~line 64-67)
- Modify: `lib/models/mach/orders.ts` (`hydrateOrder`, ~line 451 next to `tracking_number`)
- Test: `tests/unit/lib/db/schema/orders-shipping-carrier.test.ts`

**Interfaces:**
- Consumes: `normalizeLegacyCarrier` semantics from Task 2 (the SQL mirrors them).
- Produces: `orders.shipping_carrier TEXT NULL` in D1; `orders.shipping_carrier` Drizzle column; `Order.shipping_carrier?: string`; `hydrateOrder` maps it.

**Suggested agent:** opus — a backfill that runs once against production order rows; the normalization precedence and the `shipping_method` fallback narrowness are the parts that cannot be undone by a later migration.

**Steps:**

- [ ] Create `migrations/0022_add_shipping_carrier.sql`:

```sql
-- Migration: 0022_add_shipping_carrier
-- Date: 2026-07-30
-- Ticket: BMC-216A
--
-- Adds the typed carrier column that the fulfillment workflow owns, and
-- backfills it from the two places legacy carrier data actually lives.
--
-- Precedence (see lib/fulfillment/tracking.ts::normalizeLegacyCarrier — the
-- rules below are the SQL mirror of that function; change both together):
--   1. extensions.carrier  — the admin form's old write target; authoritative.
--   2. shipping_method     — ONLY when it matches a UPS/FedEx token.
--      shipping_method mostly holds real shipping methods ("standard"), so an
--      unconditional fallback would pollute the column with "other".
--
-- Normalization: UPS/FedEx variants -> 'ups'/'fedex'; any other non-empty
-- value -> 'other' (renders as a bare tracking number, no link); empty/null
-- stays NULL.
--
-- extensions.carrier is deliberately NOT deleted. It is the lossless record of
-- what an 'other' value originally was; this migration only stops anything
-- reading it (the app now reads shipping_carrier, and BMC-216F strips
-- client-supplied `carrier`/`trackingUrl` keys in mergeExtensions).
--
-- No tracking_url column is added: customer-facing tracking links are derived
-- at the response/email boundary from (shipping_carrier, tracking_number).

ALTER TABLE orders ADD COLUMN shipping_carrier TEXT;

-- Step 1: copy the legacy extensions.carrier value verbatim.
-- The CASE guard is what keeps json_extract away from a non-JSON extensions
-- blob: SQLite evaluates only the CASE branches it needs, whereas AND operand
-- order in a WHERE clause is not a documented short-circuit guarantee.
-- json_type(...) returns NULL when the path is absent, so '= ''text''' also
-- filters out non-string carrier values.
UPDATE orders
   SET shipping_carrier = json_extract(extensions, '$.carrier')
 WHERE shipping_carrier IS NULL
   AND CASE WHEN json_valid(extensions) THEN json_type(extensions, '$.carrier') END = 'text';

-- Step 2: normalize the copied values in place. Operates on a plain column, so
-- no JSON functions and no long LIKE patterns (D1 caps LIKE patterns at 50
-- chars; every pattern here is under 20). Idempotent: rows already holding a
-- canonical code are excluded.
UPDATE orders
   SET shipping_carrier = CASE
     WHEN replace(replace(replace(replace(lower(trim(shipping_carrier)), ' ', ''), '.', ''), '-', ''), '_', '') = ''
       THEN NULL
     WHEN replace(replace(replace(replace(lower(trim(shipping_carrier)), ' ', ''), '.', ''), '-', ''), '_', '') LIKE 'ups%'
       THEN 'ups'
     WHEN replace(replace(replace(replace(lower(trim(shipping_carrier)), ' ', ''), '.', ''), '-', ''), '_', '') LIKE 'unitedparcel%'
       THEN 'ups'
     WHEN replace(replace(replace(replace(lower(trim(shipping_carrier)), ' ', ''), '.', ''), '-', ''), '_', '') LIKE 'fedex%'
       THEN 'fedex'
     WHEN replace(replace(replace(replace(lower(trim(shipping_carrier)), ' ', ''), '.', ''), '-', ''), '_', '') LIKE 'federalexpress%'
       THEN 'fedex'
     ELSE 'other'
   END
 WHERE shipping_carrier IS NOT NULL
   AND shipping_carrier NOT IN ('ups', 'fedex', 'other');

-- Step 3: narrow shipping_method fallback for rows still NULL. Only recognized
-- UPS/FedEx tokens qualify — "standard", "expedited", etc. stay NULL rather
-- than becoming 'other'.
UPDATE orders
   SET shipping_carrier = CASE
     WHEN replace(replace(replace(replace(lower(trim(shipping_method)), ' ', ''), '.', ''), '-', ''), '_', '') LIKE 'ups%'
       THEN 'ups'
     WHEN replace(replace(replace(replace(lower(trim(shipping_method)), ' ', ''), '.', ''), '-', ''), '_', '') LIKE 'unitedparcel%'
       THEN 'ups'
     ELSE 'fedex'
   END
 WHERE shipping_carrier IS NULL
   AND shipping_method IS NOT NULL
   AND (
        replace(replace(replace(replace(lower(trim(shipping_method)), ' ', ''), '.', ''), '-', ''), '_', '') LIKE 'ups%'
     OR replace(replace(replace(replace(lower(trim(shipping_method)), ' ', ''), '.', ''), '-', ''), '_', '') LIKE 'unitedparcel%'
     OR replace(replace(replace(replace(lower(trim(shipping_method)), ' ', ''), '.', ''), '-', ''), '_', '') LIKE 'fedex%'
     OR replace(replace(replace(replace(lower(trim(shipping_method)), ' ', ''), '.', ''), '-', ''), '_', '') LIKE 'federalexpress%'
   );
```

- [ ] Write the backfill fixture file to your scratchpad as `bmc216a-carrier-fixtures.sql` (these rows are deleted again at the end of this task):

```sql
INSERT INTO orders (id, status, total_amount, currency_code, items, shipping_method, payment_status, extensions) VALUES
 ('bmc216a-ext-ups',      'shipped',    '{"amount":1000,"currency":"USD"}', 'USD', '[]', 'standard',        'paid', '{"carrier":"UPS Ground"}'),
 ('bmc216a-ext-fedex',    'shipped',    '{"amount":1000,"currency":"USD"}', 'USD', '[]', 'standard',        'paid', '{"carrier":"Fed-Ex"}'),
 ('bmc216a-ext-usps',     'shipped',    '{"amount":1000,"currency":"USD"}', 'USD', '[]', 'standard',        'paid', '{"carrier":"USPS Priority"}'),
 ('bmc216a-ext-empty',    'processing', '{"amount":1000,"currency":"USD"}', 'USD', '[]', 'standard',        'paid', '{"carrier":"   "}'),
 ('bmc216a-sm-ups',       'shipped',    '{"amount":1000,"currency":"USD"}', 'USD', '[]', 'UPS 2nd Day Air', 'paid', '{"email":"a@b.com"}'),
 ('bmc216a-sm-standard',  'processing', '{"amount":1000,"currency":"USD"}', 'USD', '[]', 'standard',        'paid', '{"email":"a@b.com"}'),
 ('bmc216a-no-data',      'processing', '{"amount":1000,"currency":"USD"}', 'USD', '[]', NULL,              'paid', NULL);
```

- [ ] Load the fixtures into the local D1 **before** applying the migration (the backfill only runs at apply time):

```bash
npx wrangler d1 execute beauteas-db-dev --local --env dev --file <scratchpad>/bmc216a-carrier-fixtures.sql
```

Expected: `7 rows written`.

- [ ] Record the pre-migration order count for the "existing orders remain readable" check:

```bash
npx wrangler d1 execute beauteas-db-dev --local --env dev --command "SELECT COUNT(*) AS orders_before FROM orders"
```

Expected: a single `orders_before` value — note it.

- [ ] Apply the migration locally:

```bash
npx wrangler d1 migrations apply beauteas-db-dev --local --env dev
```

Expected output lists `0022_add_shipping_carrier.sql` with a ✅ / `Success` status and no error.

- [ ] Verify the column exists and the backfill is correct:

```bash
npx wrangler d1 execute beauteas-db-dev --local --env dev --command "SELECT id, shipping_method, extensions, shipping_carrier FROM orders WHERE id LIKE 'bmc216a-%' ORDER BY id"
```

Expected `shipping_carrier` values:

| id | expected `shipping_carrier` |
|---|---|
| `bmc216a-ext-empty` | `NULL` |
| `bmc216a-ext-fedex` | `fedex` |
| `bmc216a-ext-ups` | `ups` |
| `bmc216a-ext-usps` | `other` |
| `bmc216a-no-data` | `NULL` |
| `bmc216a-sm-standard` | `NULL` |
| `bmc216a-sm-ups` | `ups` |

If `bmc216a-sm-standard` came back `other`, step 3's fallback is too wide — stop and fix the SQL before continuing.

- [ ] Verify no row was lost and no value is off-vocabulary:

```bash
npx wrangler d1 execute beauteas-db-dev --local --env dev --command "SELECT COUNT(*) AS orders_after FROM orders; SELECT COUNT(*) AS bad_values FROM orders WHERE shipping_carrier IS NOT NULL AND shipping_carrier NOT IN ('ups','fedex','other')"
```

Expected: `orders_after` equals the `orders_before` value recorded above; `bad_values` is `0`.

- [ ] Verify the migration is recorded and re-running is a no-op:

```bash
npx wrangler d1 migrations apply beauteas-db-dev --local --env dev
```

Expected: `No migrations to apply!`.

- [ ] Delete the fixtures:

```bash
npx wrangler d1 execute beauteas-db-dev --local --env dev --command "DELETE FROM orders WHERE id LIKE 'bmc216a-%'"
```

Expected: `7 rows written`.

- [ ] Write the failing schema test at `tests/unit/lib/db/schema/orders-shipping-carrier.test.ts`:

```ts
// tests/unit/lib/db/schema/orders-shipping-carrier.test.ts
//
// The Drizzle orders table must expose the column added by
// migrations/0022_add_shipping_carrier.sql, and the Order TS type must carry
// it, or every runtime read of shipping_carrier silently returns undefined.

import { describe, it, expect } from 'vitest';
import { getTableConfig } from 'drizzle-orm/sqlite-core';
import { orders } from '@/lib/db/schema/order';
import type { Order } from '@/lib/types/order';

describe('orders.shipping_carrier', () => {
  it('exists on the Drizzle orders table as a nullable text column', () => {
    const config = getTableConfig(orders);
    const column = config.columns.find((c) => c.name === 'shipping_carrier');
    expect(column).toBeDefined();
    expect(column!.notNull).toBe(false);
  });

  it('keeps the existing fulfillment columns alongside it', () => {
    const names = getTableConfig(orders).columns.map((c) => c.name);
    expect(names).toEqual(
      expect.arrayContaining(['status', 'payment_status', 'tracking_number', 'shipped_at', 'delivered_at', 'shipping_carrier']),
    );
  });

  it('is carried on the Order type', () => {
    const order: Order = {
      status: 'shipped',
      total_amount: { amount: 1000, currency: 'USD' },
      currency_code: 'USD',
      items: [],
      payment_status: 'paid',
      shipping_carrier: 'ups',
      tracking_number: '1Z999AA10123456784',
    };
    expect(order.shipping_carrier).toBe('ups');
  });
});
```

- [ ] Run it and confirm it fails: `npx vitest run tests/unit/lib/db/schema/orders-shipping-carrier.test.ts` — expect the first test to fail (`expected undefined to be defined`) and a TS error on `shipping_carrier` in the third.

- [ ] Add the column to `lib/db/schema/order.ts`, directly after `shipping_method: text("shipping_method"),`:

```ts
  shipping_method: text("shipping_method"),
  // Typed fulfillment carrier owned by the shipment workflow (BMC-216).
  // Application values: "ups" | "fedex" | "other". Legacy carrier text remains
  // in extensions.carrier as the lossless record; see migration 0022.
  shipping_carrier: text("shipping_carrier"),
```

- [ ] Add the field to the `Order` interface in `lib/types/order.ts`, inside the "Tracking and fulfillment" block:

```ts
  // Tracking and fulfillment
  shipping_carrier?: string; // "ups" | "fedex" | "other" (see lib/fulfillment/types.ts)
  tracking_number?: string;
  shipped_at?: string; // ISO 8601 timestamp
  delivered_at?: string; // ISO 8601 timestamp
```

Do **not** add `shipping_carrier` to `UpdateOrderRequest` — the generic `PUT /api/orders` path is being locked down in BMC-216F, and the carrier is written only by the shipment service.

- [ ] Map it in `hydrateOrder` in `lib/models/mach/orders.ts`, directly above the existing `tracking_number` line:

```ts
    shipping_carrier: orderRecord.shipping_carrier ?? undefined,
    tracking_number: orderRecord.tracking_number ?? undefined,
```

- [ ] Confirm the mapping landed: `grep -n "shipping_carrier" lib/models/mach/orders.ts` prints exactly one line inside `hydrateOrder`.
- [ ] Run it to pass: `npx vitest run tests/unit/lib/db/schema/orders-shipping-carrier.test.ts` — expect 3 passing tests.
- [ ] Run `npx tsc --noEmit` and confirm it exits 0.
- [ ] Commit:

```bash
git add migrations/0022_add_shipping_carrier.sql lib/db/schema/order.ts lib/types/order.ts lib/models/mach/orders.ts tests/unit/lib/db/schema/orders-shipping-carrier.test.ts
git commit -m "feat(orders): add shipping_carrier column with legacy backfill (BMC-216A)"
```

---

### Task 7: Migration 0023 — `order_events` table + Drizzle schema

**Files:**
- Create: `migrations/0023_add_order_events.sql`
- Create: `lib/db/schema/order-events.ts`
- Modify: `lib/db/schema/index.ts` (append a re-export next to the other application-specific schema exports, after `export * from "./email-preferences";`)
- Test: `tests/unit/lib/db/schema/order-events.test.ts`

**Interfaces:**
- Consumes: `orders` table (FK target).
- Produces:
  - `order_events` table in D1 with indexes `order_events_order_id_created_at_idx` and `order_events_event_type_idx`.
  - `export const orderEvents = sqliteTable("order_events", { id, order_id, event_type, actor_type, actor_id, from_status, to_status, details (json mode), created_at })`
  - `export type OrderEventRow = typeof orderEvents.$inferSelect;` — the row type ticket B's `listOrderEvents(orderId): Promise<OrderEventRow[]>` returns.
  - Re-exported from `@/lib/db/schema` so `drizzle(env.DB, { schema })` sees it.

**Suggested agent:** sonnet — straightforward DDL plus a Drizzle table definition; the only subtlety is `details` staying JSON-mode (raw objects in, never pre-stringified).

**Steps:**

- [ ] Create `migrations/0023_add_order_events.sql`:

```sql
-- Migration: 0023_add_order_events
-- Date: 2026-07-30
-- Ticket: BMC-216A
--
-- Append-oriented fulfillment audit log. One row per fulfillment action:
-- shipment_created, tracking_updated, shipping_email_sent,
-- shipping_email_failed, shipping_email_resent.
--
-- Rows are written by the fulfillment service (BMC-216B/C) — the shipment
-- event is inserted in the same db.batch() as the guarded order UPDATE, via an
-- INSERT ... SELECT keyed on that request's exact shipped_at timestamp, so a
-- lost CAS cannot produce a false audit entry.
--
-- `details` holds JSON metadata (Drizzle json mode; per event type:
--   shipment_created   { carrier, trackingNumber, trackingUrl }
--   tracking_updated   { previous: {...}, next: {...} }
--   shipping_email_*   { idempotencyKey, error?, resendOfEventId? }
-- ). No status CHECK constraint on event_type: the vocabulary lives in
-- lib/fulfillment/types.ts and will grow (carrier webhooks, Rolo) without a
-- table rebuild, which SQLite makes expensive.
CREATE TABLE IF NOT EXISTS order_events (
  id          TEXT PRIMARY KEY,
  order_id    TEXT NOT NULL,
  event_type  TEXT NOT NULL,
  actor_type  TEXT NOT NULL,
  actor_id    TEXT,
  from_status TEXT,
  to_status   TEXT,
  details     TEXT,
  created_at  TEXT NOT NULL,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
);

-- Timeline read for one order (admin detail page), oldest first.
CREATE INDEX IF NOT EXISTS order_events_order_id_created_at_idx
  ON order_events (order_id, created_at);

-- Cross-order scans by kind (e.g. "which shipments failed to email?").
CREATE INDEX IF NOT EXISTS order_events_event_type_idx
  ON order_events (event_type);
```

- [ ] Apply the migration locally:

```bash
npx wrangler d1 migrations apply beauteas-db-dev --local --env dev
```

Expected output lists `0023_add_order_events.sql` with a ✅ / `Success` status.

- [ ] Verify the table and both indexes exist:

```bash
npx wrangler d1 execute beauteas-db-dev --local --env dev --command "SELECT type, name FROM sqlite_master WHERE tbl_name='order_events' ORDER BY type, name"
```

Expected rows: `table | order_events`, `index | order_events_event_type_idx`, `index | order_events_order_id_created_at_idx` (SQLite may also list an internal `sqlite_autoindex_order_events_1` for the PK — that is fine).

- [ ] Verify the columns:

```bash
npx wrangler d1 execute beauteas-db-dev --local --env dev --command "SELECT name, type, \"notnull\" FROM pragma_table_info('order_events')"
```

Expected 9 rows: `id`, `order_id`, `event_type`, `actor_type`, `actor_id`, `from_status`, `to_status`, `details`, `created_at` — all `TEXT`, with `notnull = 1` on `order_id`, `event_type`, `actor_type`, `created_at` (`id` is the PK; SQLite reports `notnull = 0` for a TEXT PK, which is expected).

- [ ] Verify a round-trip insert and the FK cascade, then clean up:

```bash
npx wrangler d1 execute beauteas-db-dev --local --env dev --command "INSERT INTO orders (id, status, total_amount, currency_code, items, payment_status) VALUES ('bmc216a-evt-order','shipped','{\"amount\":1000,\"currency\":\"USD\"}','USD','[]','paid'); INSERT INTO order_events (id, order_id, event_type, actor_type, actor_id, from_status, to_status, details, created_at) VALUES ('bmc216a-evt-1','bmc216a-evt-order','shipment_created','admin','user_1','processing','shipped','{\"carrier\":\"ups\"}','2026-07-30T12:00:00.000Z'); SELECT COUNT(*) AS events FROM order_events WHERE order_id='bmc216a-evt-order'"
```

Expected: `events` = `1`.

```bash
npx wrangler d1 execute beauteas-db-dev --local --env dev --command "DELETE FROM orders WHERE id='bmc216a-evt-order'; SELECT COUNT(*) AS orphans FROM order_events WHERE order_id='bmc216a-evt-order'"
```

Expected: `orphans` = `0` (cascade fired).

- [ ] Verify re-running is a no-op:

```bash
npx wrangler d1 migrations apply beauteas-db-dev --local --env dev
```

Expected: `No migrations to apply!`.

- [ ] Write the failing test at `tests/unit/lib/db/schema/order-events.test.ts`:

```ts
// tests/unit/lib/db/schema/order-events.test.ts
//
// The Drizzle table must match migrations/0023_add_order_events.sql exactly —
// a mismatched column name only surfaces as a runtime D1 error in production,
// long after CI is green.

import { describe, it, expect } from 'vitest';
import { getTableConfig } from 'drizzle-orm/sqlite-core';
import { orderEvents } from '@/lib/db/schema/order-events';
import { orderEvents as reExported } from '@/lib/db/schema';

describe('order_events schema', () => {
  it('maps to the order_events table', () => {
    expect(getTableConfig(orderEvents).name).toBe('order_events');
  });

  it('declares exactly the migration 0023 columns', () => {
    const names = getTableConfig(orderEvents)
      .columns.map((c) => c.name)
      .sort();
    expect(names).toEqual(
      [
        'actor_id',
        'actor_type',
        'created_at',
        'details',
        'event_type',
        'from_status',
        'id',
        'order_id',
        'to_status',
      ].sort(),
    );
  });

  it('marks order_id, event_type, actor_type, and created_at NOT NULL', () => {
    const columns = getTableConfig(orderEvents).columns;
    const notNull = columns.filter((c) => c.notNull).map((c) => c.name).sort();
    expect(notNull).toEqual(['actor_type', 'created_at', 'event_type', 'id', 'order_id'].sort());
  });

  it('stores details as a JSON-mode column so raw objects are passed, never pre-stringified', () => {
    const details = getTableConfig(orderEvents).columns.find((c) => c.name === 'details');
    expect(details).toBeDefined();
    expect(details!.notNull).toBe(false);
    expect(details!.mapToDriverValue({ carrier: 'ups' })).toBe('{"carrier":"ups"}');
  });

  it('is re-exported from the schema barrel so drizzle(env.DB, { schema }) sees it', () => {
    expect(reExported).toBe(orderEvents);
  });
});
```

- [ ] Run it and confirm it fails: `npx vitest run tests/unit/lib/db/schema/order-events.test.ts` — expect a resolve error (`Failed to load url @/lib/db/schema/order-events`).

- [ ] Create `lib/db/schema/order-events.ts`:

```ts
// lib/db/schema/order-events.ts - Fulfillment audit log (BMC-216)

import { sqliteTable, text, index } from "drizzle-orm/sqlite-core";

/**
 * Append-oriented fulfillment audit trail. One row per fulfillment action;
 * rows are never updated or deleted (except by the order's ON DELETE CASCADE).
 *
 * `details` is a JSON-mode column: pass RAW OBJECTS to Drizzle, never
 * pre-stringified JSON, or the value lands double-encoded.
 *
 * See migrations/0023_add_order_events.sql.
 */
export const orderEvents = sqliteTable(
  "order_events",
  {
    id: text("id").primaryKey(), // crypto.randomUUID()
    order_id: text("order_id").notNull(),
    event_type: text("event_type").notNull(), // OrderEventType
    actor_type: text("actor_type").notNull(), // ActorType
    actor_id: text("actor_id"), // Clerk user ID / "api-token" / null
    from_status: text("from_status"),
    to_status: text("to_status"),
    details: text("details", { mode: "json" }),
    created_at: text("created_at").notNull(), // ISO 8601 with milliseconds
  },
  (t) => ({
    orderCreatedIdx: index("order_events_order_id_created_at_idx").on(t.order_id, t.created_at),
    eventTypeIdx: index("order_events_event_type_idx").on(t.event_type),
  })
);

export type OrderEventRow = typeof orderEvents.$inferSelect;
```

- [ ] Append the re-export to the end of `lib/db/schema/index.ts`:

```ts
// Fulfillment audit log (application-specific, BMC-216)
export * from "./order-events";
```

- [ ] Run it to pass: `npx vitest run tests/unit/lib/db/schema/order-events.test.ts` — expect 5 passing tests.
- [ ] Run `npx tsc --noEmit` and confirm it exits 0.
- [ ] Commit:

```bash
git add migrations/0023_add_order_events.sql lib/db/schema/order-events.ts lib/db/schema/index.ts tests/unit/lib/db/schema/order-events.test.ts
git commit -m "feat(fulfillment): add order_events audit table and Drizzle schema (BMC-216A)"
```

---

## Verification

Run all three gates from `/Users/devon/git/mercora-beauteas`:

- [ ] `npm run lint` — expect `✔ No ESLint warnings or errors`.
- [ ] `npx tsc --noEmit` — expect exit 0 with no output.
- [ ] `npm test` — the full unit suite (`vitest run`, `tests/unit/**/*.test.{ts,tsx}`); expect every pre-existing test plus the 6 new files (`types`, `tracking`, `transitions`, `customer-email`, `token`, `orders-shipping-carrier`, `order-events`) passing, with zero failures.
- [ ] `npx wrangler d1 migrations list beauteas-db-dev --local --env dev` — expect `No migrations to apply!` (0022 and 0023 recorded locally).
- [ ] `git status --short` — expect a clean tree with no `.dev.vars` and no stray fixture SQL committed.

Acceptance criteria from the spec's BMC-216A section, mapped to evidence:

| Criterion | Evidence |
|---|---|
| Existing orders remain readable | Task 6 pre/post `COUNT(*)` match; `bad_values = 0` |
| Recognized legacy carrier values are preserved | Task 6 backfill table (`UPS Ground` → `ups`, `Fed-Ex` → `fedex`, `USPS Priority` → `other`); `extensions.carrier` untouched |
| Invalid transitions and malformed tracking data are rejected | `transitions.test.ts` (`not_fulfillable` matrix, `parseShipmentInput` rejections), `tracking.test.ts` (control chars, over-length) |
| Carrier URLs safely encode tracking values | `tracking.test.ts` URL-encoding cases; `other`/null → `null`, never a search URL |
| Guest tokens reject tampering and wrong-order use | `token.test.ts` tampered-signature, wrong-order, wrong-email, wrong-secret, over-length cases |
| No guest token is produced for an order with no resolvable email | `token.test.ts` "mints no token for an order with no resolvable customer email" |

**Out of scope for this ticket** (do not do it here): provisioning `ORDER_STATUS_SECRET` in remote dev/production, applying 0022/0023 to remote dev or production, and adding `ORDER_STATUS_SECRET` to `cloudflare-env.d.ts` — all belong to BMC-216G's rollout checklist.

## Contract Deviations

None of the contract's names, types, signatures, or paths were changed. Four points where the contract underspecifies or diverges from existing codebase convention, recorded rather than renamed:

1. **`orderEvents` is camelCase; every other Drizzle table export in this repo is snake_case** (`orders`, `order_webhooks`, `email_unsubscribes`, `product_recommendations`). The contract pins `export const orderEvents`, so the plan uses `orderEvents`. Ticket B must import that exact name.
2. **`OrderEventRow` has no declared home.** The contract references it in `lib/fulfillment/service.ts`'s `listOrderEvents(): Promise<OrderEventRow[]>` but never says where it is defined. This plan defines it in `lib/db/schema/order-events.ts` as `typeof orderEvents.$inferSelect`, mirroring `EmailUnsubscribeRow` in `lib/db/schema/email-preferences.ts`. Ticket B should import it from `@/lib/db/schema/order-events`.
3. **The contract's control-character range for `sanitizeTrackingNumber` was lost in markdown rendering** (`"Strip control chars"` with the ranges themselves stripped — the literal characters did not survive). Implemented as C0 controls, DEL, and C1 controls: `/[\u0000-\u001F\u007F-\u009F]/g`.
4. **`normalizeLegacyCarrier`'s "UPS/FedEx variants" is not enumerated** in the contract. Implemented as: lowercase, trim, strip `[\s._-]`, then prefix-match `ups`/`unitedparcel` → `ups` and `fedex`/`federalexpress` → `fedex`; any other non-empty value → `other`. Migration 0022's SQL mirrors exactly these rules with `replace(...)` + short `LIKE` patterns (each under 20 chars, well inside D1's 50-char cap). The `shipping_method` fallback in step 3 deliberately applies only the UPS/FedEx branches — a non-matching method such as `standard` stays `NULL` rather than becoming `other`, per the spec's Data Model section.

Additionally, `getOrderCustomerEmail` now lowercases the resolved address, which the inline expression in `lib/services/order-confirmation.ts` did not. This is the contract's specified behavior (`trimmed + lowercased`) and is required for stable token signing; the only visible effect is the casing of the `To:` address on confirmation emails.
