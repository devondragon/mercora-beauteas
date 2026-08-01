/**
 * Timestamp normalization for the Shopify → Mercora ETL.
 */

/**
 * Normalize a timestamp to canonical ISO-8601 UTC ("YYYY-MM-DDTHH:MM:SS.sssZ").
 *
 * Shopify emits timestamps with a TIMEZONE OFFSET ("2026-07-27T23:19:37-06:00"),
 * which is a third encoding on top of the two that migration 0024 had to
 * reconcile in `orders.created_at`. SQLite compares TEXT byte-wise, so an
 * offset-form row sorts by its LOCAL wall-clock digits rather than its real
 * instant — the same class of bug that made the admin fulfillment queue's
 * oldest-first ordering wrong (BMC-228 F-10). Passing Shopify's value straight
 * through would re-seed that mix on the next ETL run.
 *
 * `Date#toISOString()` resolves the offset to UTC and pads the milliseconds, so
 * every ETL'd row lands in the exact form the runtime writers use
 * (lib/models/mach/orders.ts) and the D1 column default never has to.
 *
 * An unparseable value falls back to now rather than throwing: a historical
 * record with a junk date is still worth importing, and a wrong-but-valid
 * timestamp beats aborting the migration.
 */
export function toIsoUtc(dateStr?: string): string {
  if (!dateStr) return new Date().toISOString();

  const date = new Date(dateStr);
  if (isNaN(date.getTime())) {
    // A MISSING value falling back to now matches the prior `||` behaviour and
    // needs no comment. A PRESENT-but-unparseable one is a behaviour change:
    // it used to pass through visibly wrong, and now gets silently replaced by
    // the ETL run's own timestamp — which would misdate a historical record
    // with no trace. Warn so an operator can spot-check what was rewritten.
    console.warn(
      `[dates] Unparseable timestamp ${JSON.stringify(dateStr)} — substituting the current time. This record's date is now the ETL run time, not its original.`
    );
    return new Date().toISOString();
  }

  return date.toISOString();
}
