/**
 * Inventory Adjustment (BMC-178)
 *
 * Enforces on-hand stock for the ONE live inventory source of truth: the
 * `inventory` JSON column on `product_variants` (`.quantity`). The parallel MACH
 * `inventory` table (`lib/models/mach/inventory.ts`) is orphaned — never
 * populated, never read, no variant linkage — so it is intentionally NOT touched
 * here; enforcement operates directly on the variant field the PDP, catalog, and
 * Shopify ETL all use.
 *
 * Per-variant intent is honored via the two flags already carried on that JSON:
 *   - `track_inventory` false / absent → unlimited (skip — matches the historic
 *     oversell behavior for unconfigured variants, e.g. made-to-order teas).
 *   - `allow_backorder` true          → decrement unconditionally (may go
 *     negative = backorder), never blocks a sale.
 *   - tracked & no backorder          → guarded decrement; a sale can never take
 *     the quantity below zero.
 *
 * Race-safety: the decrement is a single guarded conditional UPDATE
 * (`... SET quantity = quantity - q WHERE quantity >= q`) evaluated atomically by
 * D1, modeled on the gift-card `redeemGiftCard` compare-and-swap. D1 has no
 * interactive transactions, so this self-guarding statement — not a read-then-
 * write — is what makes "cannot be sold below stock" hold under concurrent
 * checkouts. The pre-charge availability gate in `/api/payment-intent` rejects the
 * common case before any money moves; this CAS is the backstop for the narrow
 * window where two captured payments race for the last unit (the loser is
 * reported as `oversold` so the caller can flag the order for manual review).
 *
 * Callers own idempotency: the storefront decrement runs only for the
 * pending→paid CAS winner in `finalizePaidOrder`, and the MCP decrement runs once
 * per order (a duplicate `createOrderPaid` collides on the order PK), so each
 * order decrements exactly once without an extra ledger.
 */

import { getDbAsync } from '@/lib/db';
import { product_variants } from '@/lib/db/schema/products';
import { and, eq, sql } from 'drizzle-orm';
import { getProduct, getProductVariant } from '@/lib/models/mach/products';

// Gift-card lines are digital and priced/validated separately — never stock-
// managed. Duplicated as a bare literal (rather than imported from
// order-pricing) to keep this module free of that import.
const GIFT_CARD_PRODUCT_ID = 'gift-card';

/** An order/cart line, accepting both the MACH order shape and the cart shape. */
export interface OrderLineForStock {
  product_id?: string;
  productId?: string;
  variant_id?: string;
  variantId?: string;
  quantity?: number;
  product_name?: string;
}

/** The per-variant stock config, coerced to a well-typed shape. */
export interface NormalizedInventory {
  track_inventory: boolean;
  allow_backorder: boolean;
  quantity: number;
}

export type StockAction = 'skip' | 'decrement' | 'backorder';

export interface StockShortfall {
  variant_id: string;
  product_id?: string;
  product_name?: string;
  requested: number;
  available: number;
}

export interface AvailabilityResult {
  ok: boolean;
  shortfalls: StockShortfall[];
}

export interface DecrementResult {
  /** Variant ids successfully decremented (tracked/backorder lines). */
  decremented: string[];
  /** Tracked, non-backorderable lines the guarded CAS could not satisfy. */
  oversold: StockShortfall[];
}

/**
 * Coerce a raw variant `inventory` value (Drizzle-parsed object, JSON string,
 * bare number, or null) to a NormalizedInventory. Absent/malformed → an
 * untracked, zero-quantity record, i.e. treated as unlimited (skip). Pure.
 */
export function normalizeInventory(raw: unknown): NormalizedInventory {
  let inv: any = raw;
  if (typeof raw === 'string') {
    if (raw.startsWith('{')) {
      try {
        inv = JSON.parse(raw);
      } catch {
        inv = null;
      }
    } else {
      const n = parseInt(raw, 10);
      inv = { quantity: Number.isFinite(n) ? n : 0 };
    }
  } else if (typeof raw === 'number') {
    inv = { quantity: raw };
  }

  if (!inv || typeof inv !== 'object') {
    return { track_inventory: false, allow_backorder: false, quantity: 0 };
  }

  const qtyRaw = (inv as any).quantity;
  const qtyNum = typeof qtyRaw === 'number' ? qtyRaw : Number(qtyRaw);

  return {
    // JSON booleans may arrive as true/false or SQLite's 1/0.
    track_inventory: (inv as any).track_inventory === true || (inv as any).track_inventory === 1,
    allow_backorder: (inv as any).allow_backorder === true || (inv as any).allow_backorder === 1,
    quantity: Number.isFinite(qtyNum) ? Math.trunc(qtyNum) : 0,
  };
}

/**
 * Decide how a line's stock should move, from its inventory config alone. Pure —
 * the availability check layers quantity on top of this.
 */
export function planLineAdjustment(inv: NormalizedInventory | null | undefined): StockAction {
  if (!inv || !inv.track_inventory) return 'skip';
  if (inv.allow_backorder) return 'backorder';
  return 'decrement';
}

/** Coerce a client/line quantity to a positive integer, or null if untrustworthy. */
function normalizeQuantity(raw: unknown): number | null {
  if (raw == null) return 1;
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.max(1, Math.floor(n));
}

function lineVariantId(item: OrderLineForStock): string | undefined {
  return item.variant_id ?? item.variantId;
}
function lineProductId(item: OrderLineForStock): string | undefined {
  return item.product_id ?? item.productId;
}

interface ResolvedLine {
  variantId: string;
  productId?: string;
  productName?: string;
  quantity: number;
  inv: NormalizedInventory;
}

/**
 * Resolve an order/cart line to a concrete variant id + its normalized stock
 * config. Mirrors the variant resolution the pricing gate uses: an explicit
 * variant_id resolves that exact variant; a variant-less line falls back to the
 * product's default (or first) variant. Returns null for gift-card lines,
 * untrusted quantities, or lines whose variant can't be resolved — such a line
 * is simply not stock-managed (the charge gate independently handles unpriceable
 * lines), so it never blocks or over-decrements.
 */
async function resolveLine(item: OrderLineForStock): Promise<ResolvedLine | null> {
  if (!item || typeof item !== 'object') return null;
  if (lineProductId(item) === GIFT_CARD_PRODUCT_ID) return null;

  const quantity = normalizeQuantity(item.quantity);
  if (quantity == null) return null;

  const variantId = lineVariantId(item);
  if (variantId) {
    const variant = await getProductVariant(variantId);
    if (!variant) return null;
    return {
      variantId,
      productId: (variant as any).product_id ?? lineProductId(item),
      productName: item.product_name,
      quantity,
      inv: normalizeInventory((variant as any).inventory),
    };
  }

  const productId = lineProductId(item);
  if (productId) {
    const product = await getProduct(productId);
    const variant =
      product?.variants?.find((v) => v.id === (product as any).default_variant_id) ||
      product?.variants?.[0] ||
      null;
    if (!variant) return null;
    return {
      variantId: variant.id,
      productId,
      productName: item.product_name,
      quantity,
      inv: normalizeInventory((variant as any).inventory),
    };
  }

  return null;
}

/**
 * Pre-charge availability check. Reports every tracked, non-backorderable line
 * whose requested quantity exceeds on-hand. Backorderable and untracked lines
 * are always available. Unresolvable lines are treated as available (not our
 * gate to fail — the charge gate covers unpriceable lines). Concurrent reads.
 */
export async function checkStockAvailability(
  items: OrderLineForStock[]
): Promise<AvailabilityResult> {
  const list = Array.isArray(items) ? items : [];
  const resolved = await Promise.all(list.map((it) => resolveLine(it).catch(() => null)));

  const shortfalls: StockShortfall[] = [];
  for (const line of resolved) {
    if (!line) continue;
    if (planLineAdjustment(line.inv) !== 'decrement') continue; // skip / backorder → available
    if (line.inv.quantity < line.quantity) {
      shortfalls.push({
        variant_id: line.variantId,
        product_id: line.productId,
        product_name: line.productName,
        requested: line.quantity,
        available: Math.max(0, line.inv.quantity),
      });
    }
  }

  return { ok: shortfalls.length === 0, shortfalls };
}

/**
 * Decrement on-hand stock for a paid order's lines. Tracked/non-backorderable
 * lines use a guarded CAS that can never drive quantity below zero; if a race
 * left too little on hand, the line is returned in `oversold` (the caller flags
 * the order for review — the money is already captured). Backorder lines
 * decrement unconditionally; untracked/unresolved lines are skipped. Never
 * throws for a per-line miss; a DB error still propagates so the caller can
 * decide (finalization swallows it — payment is already recorded).
 */
export async function decrementStockForOrder(
  items: OrderLineForStock[]
): Promise<DecrementResult> {
  const list = Array.isArray(items) ? items : [];
  const db = await getDbAsync();

  const decremented: string[] = [];
  const oversold: StockShortfall[] = [];

  for (const item of list) {
    const line = await resolveLine(item);
    if (!line) continue;

    const action = planLineAdjustment(line.inv);
    if (action === 'skip') continue;

    if (action === 'backorder') {
      // Unconditional decrement — may go negative (backorder), never blocks.
      await db
        .update(product_variants)
        .set({
          inventory: sql`json_set(inventory, '$.quantity', json_extract(inventory, '$.quantity') - ${line.quantity})`,
          updated_at: sql`CURRENT_TIMESTAMP`,
        })
        .where(eq(product_variants.id, line.variantId));
      decremented.push(line.variantId);
      continue;
    }

    // Guarded compare-and-swap: only decrements when at least `quantity` remains,
    // so concurrent checkouts can never oversell a tracked, non-backorderable
    // variant. Zero rows back = the guard failed = oversold at capture time.
    const rows = await db
      .update(product_variants)
      .set({
        inventory: sql`json_set(inventory, '$.quantity', json_extract(inventory, '$.quantity') - ${line.quantity})`,
        updated_at: sql`CURRENT_TIMESTAMP`,
      })
      .where(
        and(
          eq(product_variants.id, line.variantId),
          sql`json_extract(inventory, '$.quantity') >= ${line.quantity}`
        )
      )
      .returning({ id: product_variants.id });

    if (rows.length > 0) {
      decremented.push(line.variantId);
    } else {
      oversold.push({
        variant_id: line.variantId,
        product_id: line.productId,
        product_name: line.productName,
        requested: line.quantity,
        available: Math.max(0, line.inv.quantity),
      });
    }
  }

  return { decremented, oversold };
}

/**
 * Restore on-hand stock for a refunded/cancelled order's lines (the inverse of
 * `decrementStockForOrder`). Increments only stock-managed variants
 * (tracked or backorderable); untracked/unresolved lines are skipped.
 * Idempotency is the caller's responsibility (the refund route restocks once per
 * recorded refund). Best-effort per line; a DB error propagates to the caller,
 * which wraps this so it can never roll back an already-processed refund.
 */
export async function restockForOrder(items: OrderLineForStock[]): Promise<{ restocked: string[] }> {
  const list = Array.isArray(items) ? items : [];
  const db = await getDbAsync();

  const restocked: string[] = [];
  for (const item of list) {
    const line = await resolveLine(item);
    if (!line) continue;
    if (planLineAdjustment(line.inv) === 'skip') continue; // untracked → nothing to restore

    await db
      .update(product_variants)
      .set({
        inventory: sql`json_set(inventory, '$.quantity', json_extract(inventory, '$.quantity') + ${line.quantity})`,
        updated_at: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(product_variants.id, line.variantId));
    restocked.push(line.variantId);
  }

  return { restocked };
}
