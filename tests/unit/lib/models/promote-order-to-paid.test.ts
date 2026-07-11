/**
 * Unit test for promoteOrderToPaid — the guarded compare-and-swap that makes the
 * pending → paid flip atomic on D1 (BMC-167).
 *
 * D1 has no interactive transactions, so "at most one writer marks this order
 * paid" is enforced by the conditional UPDATE ... WHERE payment_status =
 * 'pending'. The winner gets the row back via RETURNING (`promoted: true`); a
 * concurrent or later caller matches zero rows (`promoted: false`) and reads the
 * current state to distinguish already-paid (idempotent success) from missing.
 * This is the primitive the client POST and the Stripe webhook both race on so
 * they converge on exactly one paid order.
 *
 * The mock records the WHERE terms so we can assert the CAS actually gates on
 * payment_status = 'pending' (not just id), and returns rows per test to model a
 * win vs. a loss.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  getDbAsync: vi.fn(),
}));

import { promoteOrderToPaid } from '@/lib/models/mach/orders';
import { getDbAsync } from '@/lib/db';

let updateReturns: any[] = [];
let selectReturns: any[] = [];
let capturedWhere: any = null;
let capturedSet: any = null;

function makeDb() {
  return {
    update: vi.fn().mockImplementation(() => ({
      set: vi.fn().mockImplementation((row: any) => {
        capturedSet = row;
        return {
          where: vi.fn().mockImplementation((cond: any) => {
            capturedWhere = cond;
            return { returning: vi.fn().mockResolvedValue(updateReturns) };
          }),
        };
      }),
    })),
    select: vi.fn().mockImplementation(() => ({
      from: vi.fn().mockImplementation(() => ({
        where: vi.fn().mockImplementation(() => ({
          limit: vi.fn().mockResolvedValue(selectReturns),
        })),
      })),
    })),
  };
}

const PAID_ROW = {
  id: 'WEB-GUEST-1',
  status: 'processing',
  payment_status: 'paid',
  total_amount: { amount: 2500, currency: 'USD' },
  currency_code: 'USD',
  items: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  updateReturns = [];
  selectReturns = [];
  capturedWhere = null;
  capturedSet = null;
  vi.mocked(getDbAsync).mockResolvedValue(makeDb() as any);
});

describe('promoteOrderToPaid (guarded CAS)', () => {
  it('WIN: the conditional UPDATE matched a pending row → promoted:true with the paid order', async () => {
    updateReturns = [PAID_ROW];
    const res = await promoteOrderToPaid('WEB-GUEST-1', { status: 'processing', notes: 'paid' });
    expect(res.promoted).toBe(true);
    expect(res.order?.payment_status).toBe('paid');
    // The CAS sets the paid field-set...
    expect(capturedSet.payment_status).toBe('paid');
    expect(capturedSet.status).toBe('processing');
    expect(capturedSet.notes).toBe('paid');
    // ...and it is gated (a WHERE was applied — id AND payment_status='pending').
    expect(capturedWhere).toBeTruthy();
  });

  it('LOSE: zero rows matched (already paid) → promoted:false and the current paid state is surfaced', async () => {
    updateReturns = []; // WHERE payment_status='pending' matched nothing
    selectReturns = [PAID_ROW]; // getOrderById fallback shows it is already paid
    const res = await promoteOrderToPaid('WEB-GUEST-1');
    expect(res.promoted).toBe(false);
    expect(res.order?.payment_status).toBe('paid');
  });

  it('MISSING: zero rows matched and no such order → promoted:false, order null', async () => {
    updateReturns = [];
    selectReturns = [];
    const res = await promoteOrderToPaid('WEB-UNKNOWN-9');
    expect(res.promoted).toBe(false);
    expect(res.order).toBeNull();
  });
});
