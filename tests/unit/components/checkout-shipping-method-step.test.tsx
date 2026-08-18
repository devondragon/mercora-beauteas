/**
 * Regression tests for the checkout "Shipping Method" step.
 *
 * Two defects, both of which made the step look finished while the flow was
 * still blocked on a click nothing asked for:
 *
 * 1. `selectedOptionId` was fed straight from the PERSISTED cart store
 *    (`lib/stores/cart-store.ts` persists `shippingOption` to localStorage under
 *    `cart-storage`, and method ids are stable strings like `standard`). On a
 *    return visit the single option rendered with the selected border and the
 *    check icon before the customer had done anything, but `handleShippingSelected`
 *    (tax + PaymentIntent + step advance) had never run, so "Continue" was a
 *    click the UI actively denied was needed.
 *
 * 2. The sale enables exactly one shipping method (migration 0028 disables
 *    express and overnight), so the step presented a choice that did not exist.
 *    A lone option now auto-selects from `handleAddressSubmit` and the flow goes
 *    straight to payment. Two or more options still require a real choice.
 *
 * The auto-advance also has to survive the stale-closure trap that
 * `createPaymentIntent`'s comment already documents for totals: the address is
 * written to the store in the same tick, so the render-time `shippingAddress`
 * binding is still undefined when the auto-advance runs. Asserting on the
 * `/api/tax` body catches a regression that would otherwise ship an addressless
 * tax quote.
 *
 * No @testing-library/react in this repo, so this uses react-dom/client with
 * React 19's own `act` (same harness as product-editor-variant-save.test.tsx).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

// The sale-rules fetch is irrelevant here; `minimumKnown: false` keeps the
// box-minimum gate open so the address form renders (see `blockedByMinimum`).
vi.mock('@/lib/sale/use-sale-rules', () => ({
  useSaleRules: () => ({ minimumBoxes: 10, minimumKnown: false, finalSale: true }),
}));

// Stripe Elements needs a live publishable key and a network round trip; the
// payment step's presence is what this file asserts, not its contents.
vi.mock('@/components/checkout/StripeProvider', () => ({
  default: ({ children }: any) => <div data-testid="stripe-provider">{children}</div>,
}));
vi.mock('@/components/checkout/PaymentForm', () => ({
  default: () => <div data-testid="payment-form" />,
}));
vi.mock('@/components/checkout/OrderSummary', () => ({
  default: () => <div data-testid="order-summary" />,
}));

import CheckoutClient from '@/components/checkout/CheckoutClient';
import { useCartStore } from '@/lib/stores/cart-store';

const CART_ITEM = {
  productId: 'prod_clearly_calendula_morning',
  variantId: 'variant_clearly_calendula_morning_btccm1',
  name: 'Clearly Calendula Morning',
  price: 300,
  quantity: 10,
  imageUrl: '/morning.png',
} as any;

const STANDARD = { id: 'standard', label: 'Standard (5-7 days)', cost: 10, estimatedDays: 5 };
const EXPRESS = { id: 'express', label: 'Express (2-3 days)', cost: 20, estimatedDays: 2 };

let container: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;
let shippingOptionsResponse: Array<typeof STANDARD>;

/** Record the body of every POST, keyed by the path fetched. */
let requests: Record<string, any>;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  requests = {};
  shippingOptionsResponse = [STANDARD];

  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const path = String(url);
    requests[path] = init?.body ? JSON.parse(String(init.body)) : null;
    if (path.includes('/api/shipping-options')) {
      return { ok: true, json: async () => ({ options: shippingOptionsResponse }) };
    }
    if (path.includes('/api/tax')) {
      return { ok: true, json: async () => ({ amount: 0.39 }) };
    }
    if (path.includes('/api/payment-intent')) {
      return { ok: true, json: async () => ({ clientSecret: 'pi_test_secret_abc' }) };
    }
    return { ok: true, json: async () => ({}) };
  }) as any;
  vi.stubGlobal('fetch', fetchMock);

  useCartStore.setState({
    items: [CART_ITEM],
    appliedDiscounts: [],
    totalDiscount: 0,
    appliedGiftCard: undefined,
    shippingAddress: undefined,
    shippingOption: undefined,
    taxAmount: undefined,
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

/** Set a controlled React input's value and fire the change React listens for. */
function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value'
  )!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function byName(name: string): HTMLInputElement {
  const el = container.querySelector<HTMLInputElement>(`input[name="${name}"]`);
  if (!el) throw new Error(`no input named ${name} rendered`);
  return el;
}

function buttonLabelled(pattern: RegExp): HTMLButtonElement {
  const match = Array.from(container.querySelectorAll('button')).find((b) =>
    pattern.test(b.textContent ?? '')
  );
  if (!match) throw new Error(`no button matching ${pattern} rendered`);
  return match as HTMLButtonElement;
}

async function mount() {
  await act(async () => {
    root.render(<CheckoutClient userId={null} />);
  });
}

async function fillAddressAndSubmit() {
  await act(async () => {
    typeInto(byName('recipient'), 'Launch Tester');
    typeInto(byName('email'), 'launch@example.com');
    typeInto(byName('line1'), '100 Tea Way');
    typeInto(byName('city'), 'Denver');
    typeInto(byName('region'), 'CO');
    typeInto(byName('postal_code'), '80202');
  });
  await act(async () => {
    buttonLabelled(/Use Address/).click();
  });
}

describe('checkout shipping-method step', () => {
  it('auto-selects and advances to payment when only one method is offered', async () => {
    await mount();
    await fillAddressAndSubmit();

    // No click on the method was needed: tax and the PaymentIntent both ran and
    // the payment step is mounted.
    expect(requests['/api/tax']).toBeTruthy();
    expect(requests['/api/payment-intent']).toBeTruthy();
    expect(container.querySelector('[data-testid="payment-form"]')).toBeTruthy();
    // And the radiogroup the customer would have had to click is gone.
    expect(container.querySelector('[role="radiogroup"]')).toBeNull();
  });

  it('sends the freshly-submitted address with the auto-advanced tax quote', async () => {
    await mount();
    await fillAddressAndSubmit();

    // The render-time `shippingAddress` binding is still undefined at
    // auto-advance time (setShippingAddress ran in the same tick), so this only
    // passes if the handler reads the address back out of the store.
    expect(requests['/api/tax'].shippingAddress).toMatchObject({
      line1: '100 Tea Way',
      city: 'Denver',
      region: 'CO',
      postal_code: '80202',
      country: 'US',
    });
  });

  it('still requires an explicit choice when more than one method is offered', async () => {
    shippingOptionsResponse = [STANDARD, EXPRESS];
    await mount();
    await fillAddressAndSubmit();

    expect(requests['/api/tax']).toBeUndefined();
    const radios = container.querySelectorAll('[role="radio"]');
    expect(radios.length).toBe(2);
    expect(Array.from(radios).every((r) => r.getAttribute('aria-checked') === 'false')).toBe(true);

    await act(async () => {
      (radios[1] as HTMLElement).click();
    });
    expect(requests['/api/tax']).toBeTruthy();
    expect(container.querySelector('[data-testid="payment-form"]')).toBeTruthy();
  });

  it('does not render a persisted shipping option as already chosen', async () => {
    // What a returning customer's localStorage looks like: a shippingOption
    // left over from a previous checkout, with a matching id in this session's
    // options list.
    shippingOptionsResponse = [STANDARD, EXPRESS];
    useCartStore.setState({ shippingOption: { ...STANDARD, cost: 1000 } as any });

    await mount();
    await fillAddressAndSubmit();

    const radios = Array.from(container.querySelectorAll('[role="radio"]'));
    expect(radios.length).toBe(2);
    expect(radios.map((r) => r.getAttribute('aria-checked'))).toEqual(['false', 'false']);
  });
});
