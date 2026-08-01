/**
 * Unit tests for the two admin-queue defects confirmed by the BMC-228 browser
 * QA pass (review findings C-1 and C-2).
 *
 * Both live in `OrdersQueueClient.tsx`, which this repo has no component-test
 * library to exercise — BMC-228 deliberately declined to add one. So the
 * DECISION each fix turns on is pulled into `lib/fulfillment/queue-view.ts`,
 * the existing pure view-model seam, where `tests/unit/**` actually gates a
 * merge. The component keeps only the wiring.
 *
 * ── C-1: stale-response race ────────────────────────────────────────────────
 * `load()` had no AbortController and no request-sequence guard, and it awaits
 * `loadEmailStates(rows)` (N more fetches) before returning — a wide window.
 * Whichever response landed LAST won, not whichever request started last. QA
 * reproduced it: delay the `cancelled` response 5s, click Cancelled then
 * Shipped, and the Shipped tab renders while displaying the cancelled orders.
 * Reversed, an operator gets live "Mark shipped" buttons under Cancelled.
 *
 * ── C-2: stranded page after shipping the last row ──────────────────────────
 * `handleShipConfirm` mutated local state instead of refetching: it spliced the
 * row out, decremented the counts, and decremented `total`. Ship the only row
 * on Awaiting page 2 (offset 20, total 21) and `total` becomes exactly 20, so
 * the `total > PAGE_SIZE` pager guard hides the pager while `offset` stays 20 —
 * an empty "Nothing in awaiting shipment" list, no way back, and a tab badge
 * still reading 20. An operator working the queue from the last page can
 * reasonably conclude it is clear while 20 paid orders sit unshipped.
 */
import { describe, it, expect } from "vitest";
import {
  createRequestSequence,
  clampOffsetAfterRemoval,
} from "@/lib/fulfillment/queue-view";

describe("createRequestSequence (C-1: last request wins, not last response)", () => {
  it("treats the only in-flight request as current", () => {
    const seq = createRequestSequence();
    const token = seq.start();
    expect(seq.isCurrent(token)).toBe(true);
  });

  it("invalidates an earlier request once a later one starts", () => {
    const seq = createRequestSequence();
    const slowCancelled = seq.start();
    const fastShipped = seq.start();

    // The QA repro: 'cancelled' was requested first but resolves last.
    expect(seq.isCurrent(slowCancelled)).toBe(false);
    expect(seq.isCurrent(fastShipped)).toBe(true);
  });

  it("keeps the newest request current across many rapid tab switches", () => {
    const seq = createRequestSequence();
    const tokens = [seq.start(), seq.start(), seq.start(), seq.start()];

    expect(tokens.slice(0, -1).every((t) => seq.isCurrent(t))).toBe(false);
    expect(seq.isCurrent(tokens[tokens.length - 1])).toBe(true);
  });

  it("issues a distinct token per request", () => {
    const seq = createRequestSequence();
    const tokens = [seq.start(), seq.start(), seq.start()];
    expect(new Set(tokens).size).toBe(tokens.length);
  });

  it("keeps sequences independent of one another", () => {
    const a = createRequestSequence();
    const b = createRequestSequence();
    const tokenA = a.start();
    b.start();
    // Starting a request on an unrelated sequence must not invalidate this one.
    expect(a.isCurrent(tokenA)).toBe(true);
  });
});

describe("clampOffsetAfterRemoval (C-2: never strand the operator on a dead page)", () => {
  const pageSize = 20;

  it("walks back a page when the last row on page 2 is shipped", () => {
    // The exact QA repro: on page 2 (offset 20) with 21 awaiting, ship the one
    // row → 20 remain, so page 2 no longer exists and page 1 is the last page.
    expect(clampOffsetAfterRemoval({ offset: 20, pageSize, totalAfter: 20 })).toBe(0);
  });

  it("stays put while the current page still holds rows", () => {
    expect(clampOffsetAfterRemoval({ offset: 20, pageSize, totalAfter: 21 })).toBe(20);
  });

  it("returns to the first page when the queue empties completely", () => {
    expect(clampOffsetAfterRemoval({ offset: 20, pageSize, totalAfter: 0 })).toBe(0);
  });

  it("lands on the last surviving page, not merely one page back", () => {
    // offset 80 (page 5) but only 25 rows remain → last page starts at 20.
    expect(clampOffsetAfterRemoval({ offset: 80, pageSize, totalAfter: 25 })).toBe(20);
  });

  it("leaves an already-valid earlier page untouched", () => {
    expect(clampOffsetAfterRemoval({ offset: 0, pageSize, totalAfter: 5 })).toBe(0);
    expect(clampOffsetAfterRemoval({ offset: 20, pageSize, totalAfter: 100 })).toBe(20);
  });

  it("puts the operator on a page that actually contains a row", () => {
    // The invariant behind the fix: the returned offset must be a real page
    // start with at least one row, for every position in a 60-row queue.
    for (let totalAfter = 1; totalAfter <= 60; totalAfter++) {
      for (let offset = 0; offset <= 80; offset += pageSize) {
        const next = clampOffsetAfterRemoval({ offset, pageSize, totalAfter });
        expect(next % pageSize).toBe(0);
        expect(next).toBeLessThan(totalAfter);
        expect(next).toBeLessThanOrEqual(offset);
      }
    }
  });
});
