/**
 * The admin order-detail page must offer the same fulfillment actions the
 * orders queue does.
 *
 * `POST /api/admin/orders/[id]/ship` has been the only writer of
 * processing+paid -> shipped since BMC-216B, but the only UI that called it was
 * `OrdersQueueClient`. An operator who opened an order directly (from a link,
 * or after searching) had no way to ship it and had to navigate back to the
 * list. These tests pin the wiring: the right control for the order's state,
 * and a request body the server's `parseShipmentInput` will accept.
 *
 * The two modals are stubbed. What changed here is the page's wiring, not the
 * modals (already covered by the queue-view and ship-route suites), and the
 * real ones are Radix dialogs that need portal/observer polyfills this jsdom
 * setup does not install.
 *
 * No @testing-library/react in this repo, so this uses react-dom/client with
 * React 19's own `act`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'WEB-TEST-1' }),
  useRouter: () => ({ push: vi.fn() }),
}));

/**
 * Stub modals: render a confirm button per scenario the real dialog can
 * produce, so a test can drive `onConfirm` with a specific payload.
 */
vi.mock('@/components/admin/orders/MarkShippedModal', () => ({
  default: ({ onConfirm }: any) => (
    <div data-testid="ship-modal">
      <button
        data-testid="confirm-tracked"
        onClick={() => onConfirm({ carrier: 'ups', trackingNumber: '1Z999AA10123456784' })}
      />
      <button
        data-testid="confirm-untracked"
        onClick={() => onConfirm({ carrier: null, trackingNumber: null })}
      />
    </div>
  ),
}));
vi.mock('@/components/admin/orders/EditTrackingModal', () => ({
  default: ({ initialCarrier, initialTrackingNumber }: any) => (
    <div
      data-testid="tracking-modal"
      data-carrier={initialCarrier ?? ''}
      data-tracking={initialTrackingNumber ?? ''}
    />
  ),
}));

import OrderDetailPage from '@/app/admin/orders/[id]/page';

const BASE_ORDER = {
  id: 'WEB-TEST-1',
  status: 'processing',
  payment_status: 'paid',
  payment_method: 'card',
  total_amount: { amount: 40, currency: 'USD' },
  currency_code: 'USD',
  shipping_address: {
    recipient: 'Launch Tester',
    line1: '100 Tea Way',
    city: 'Denver',
    region: 'CO',
    postal_code: '80202',
    country: 'US',
  },
  items: [
    {
      product_id: 'prod_clearly_calendula_morning',
      product_name: 'Clearly Calendula Morning',
      quantity: 10,
      unit_price: { amount: 3, currency: 'USD' },
    },
  ],
  created_at: '2026-08-19T10:00:00.000Z',
  updated_at: '2026-08-19T10:00:00.000Z',
  extensions: {},
};

let container: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;
let order: Record<string, any>;
/** Every POST/PATCH body seen, keyed by path (query string stripped). */
let posts: Record<string, any>;
let orderFetchCount: number;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  order = { ...BASE_ORDER };
  posts = {};
  orderFetchCount = 0;

  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const path = String(url);
    if (init?.method && init.method !== 'GET') {
      posts[path] = init.body ? JSON.parse(String(init.body)) : null;
    }
    if (path.startsWith('/api/orders?admin=true')) {
      orderFetchCount += 1;
      return { ok: true, status: 200, json: async () => ({ data: [order] }) };
    }
    if (path.includes('/api/admin/settings')) {
      return { ok: true, status: 200, json: async () => ({ settings: [] }) };
    }
    if (path.includes('/events')) {
      return { ok: true, status: 200, json: async () => ({ events: [] }) };
    }
    if (path.includes('/ship')) {
      // What the server does on success, so the refetch above sees it.
      order = {
        ...order,
        status: 'shipped',
        shipping_carrier: 'ups',
        tracking_number: '1Z999AA10123456784',
        shipped_at: '2026-08-19T12:00:00.000Z',
      };
      return {
        ok: true,
        status: 201,
        json: async () => ({ email: { attempted: true, success: true }, eventId: 'evt_1' }),
      };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  }) as any;
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function mount() {
  await act(async () => {
    root.render(<OrderDetailPage />);
  });
}

function buttonLabelled(pattern: RegExp): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll('button')).find((b) =>
    pattern.test(b.textContent ?? '')
  ) as HTMLButtonElement | undefined;
}

async function click(el: Element) {
  await act(async () => {
    (el as HTMLElement).click();
  });
}

describe('admin order detail: fulfillment actions', () => {
  it('offers Mark as Shipped on a processing, paid order', async () => {
    await mount();
    expect(buttonLabelled(/Mark as Shipped/)).toBeTruthy();
    expect(buttonLabelled(/Edit tracking|Add tracking/)).toBeUndefined();
  });

  it('posts the carrier and tracking pair to the ship endpoint', async () => {
    await mount();
    await click(buttonLabelled(/Mark as Shipped/)!);
    await click(container.querySelector('[data-testid="confirm-tracked"]')!);

    expect(posts['/api/admin/orders/WEB-TEST-1/ship']).toEqual({
      carrier: 'ups',
      trackingNumber: '1Z999AA10123456784',
    });
    // Refetched, so the page shows server-owned shipped_at and the normalized
    // carrier rather than an optimistic guess.
    expect(orderFetchCount).toBe(2);
    expect(container.textContent).toContain('1Z999AA10123456784');
  });

  it('sends an empty body for an untracked shipment', async () => {
    await mount();
    await click(buttonLabelled(/Mark as Shipped/)!);
    await click(container.querySelector('[data-testid="confirm-untracked"]')!);

    // A half-pair is a 400 from parseShipmentInput. Omitting both keys is the
    // deliberate "shipped without tracking" signal, not an accidental drop.
    expect(posts['/api/admin/orders/WEB-TEST-1/ship']).toEqual({});
  });

  it('offers Edit tracking, not Mark as Shipped, once the order has shipped', async () => {
    order = {
      ...BASE_ORDER,
      status: 'shipped',
      shipping_carrier: 'usps',
      tracking_number: '9400111899223197428490',
      shipped_at: '2026-08-19T12:00:00.000Z',
    };
    await mount();

    expect(buttonLabelled(/Mark as Shipped/)).toBeUndefined();
    const edit = buttonLabelled(/Edit tracking/);
    expect(edit).toBeTruthy();

    await click(edit!);
    const modal = container.querySelector('[data-testid="tracking-modal"]')!;
    expect(modal.getAttribute('data-carrier')).toBe('usps');
    expect(modal.getAttribute('data-tracking')).toBe('9400111899223197428490');
  });

  it('explains why no action is available instead of hiding the control', async () => {
    order = { ...BASE_ORDER, status: 'pending', payment_status: 'pending' };
    await mount();

    expect(buttonLabelled(/Mark as Shipped/)).toBeUndefined();
    expect(container.textContent).toContain('processing and paid');
    expect(container.textContent).toContain('pending');
  });
});
