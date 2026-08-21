/**
 * The one-click year supply. Its two decisions live in pure functions tested in
 * tests/unit/lib/sale/year-supply.test.ts - `yearSupplyOffer` (how many boxes)
 * and `yearSupplyCartItem` (the exact cart payload). This file covers only what
 * those cannot: that the rendered label reflects the offer, that the dollar
 * figure comes from the LIVE variant price rather than a constant, and that the
 * component renders nothing when there is nothing to offer.
 *
 * Rendered with renderToStaticMarkup, matching the repo's other component
 * tests. There is no DOM testing library here and none is being added.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

let cartItems: Array<{ variantId: string; quantity: number }> = [];
const addItem = vi.fn();
vi.mock('@/lib/stores/cart-store', () => ({
  useCartStore: (selector: (s: unknown) => unknown) => selector({ items: cartItems, addItem }),
}));

const toastMock = vi.fn();
vi.mock('sonner', () => ({ toast: (...args: unknown[]) => toastMock(...args) }));

const openCart = vi.fn();
vi.mock('@/lib/stores/cart-ui-store', () => ({
  useCartUIStore: { getState: () => ({ openCart }) },
}));

const { default: YearSupplyButton } = await import('@/components/sale/YearSupplyButton');

// `amount` defaults to 300 when omitted. A price-less variant is requested
// with `null`, not `undefined` - a default parameter fires on an explicitly
// passed `undefined` too (`props(373, undefined)` would silently fall back
// to 300), so `undefined` can't distinguish "omitted" from "no price."
const props = (quantity: number, amount: number | null = 300) => ({
  variant: {
    id: 'var_morning',
    price: amount === null ? undefined : { amount, currency: 'USD' },
    inventory: { quantity, track_inventory: true },
  } as never,
  productId: 'prod_morning',
  name: 'Clearly Calendula Morning - One box (10 tea bags)',
  productName: 'Clearly Calendula Morning',
  imageUrl: '/morning.jpg',
});

describe('YearSupplyButton', () => {
  it('offers a year priced from the live variant price', () => {
    cartItems = [];
    const html = renderToStaticMarkup(<YearSupplyButton {...props(373)} />);
    // 36 boxes at $3.00 = $108.00, formatted by lib/money, never hardcoded.
    expect(html).toContain('36 boxes');
    expect(html).toContain('$108.00');
  });

  it('reprices itself when the catalog price changes', () => {
    cartItems = [];
    // Same 36 boxes at $2.00 must read $72.00 - proof the figure is derived.
    expect(renderToStaticMarkup(<YearSupplyButton {...props(373, 200)} />)).toContain('$72.00');
  });

  it('states the cups so the year claim is checkable', () => {
    cartItems = [];
    expect(renderToStaticMarkup(<YearSupplyButton {...props(373)} />)).toContain('360 cups');
  });

  it('offers the remainder when fewer than 36 are left', () => {
    cartItems = [];
    const html = renderToStaticMarkup(<YearSupplyButton {...props(24)} />);
    expect(html).toContain('last 24');
    expect(html).toContain('$72.00');
  });

  it('accounts for what is already in the cart', () => {
    cartItems = [{ variantId: 'var_morning', quantity: 10 }];
    // 40 in stock less 10 in cart = 30, not a full year.
    expect(renderToStaticMarkup(<YearSupplyButton {...props(40)} />)).toContain('last 30');
  });

  it('renders nothing when sold out', () => {
    cartItems = [];
    expect(renderToStaticMarkup(<YearSupplyButton {...props(0)} />)).toBe('');
  });

  it('renders nothing when the price cannot be read', () => {
    cartItems = [];
    expect(renderToStaticMarkup(<YearSupplyButton {...props(373, null)} />)).toBe('');
  });
});

/**
 * Whole-branch review fix: the click used to call `addItem` and nothing else.
 * `addItem` merges into an existing line, the header badge counts lines rather
 * than units, and 373 in stock less 36 in cart is still a full year - so a
 * customer who could not tell the click registered clicked again and committed
 * a second year. The confirmation is the same toast the sibling Add to Cart
 * button raises on the same page.
 *
 * `renderToStaticMarkup` drops event handlers, so the component is invoked
 * directly for its element tree and the button's onClick is called. That works
 * because the only hook it uses (`useCartStore`) is mocked to a plain selector
 * call above.
 */
function clickTheButton(element: React.ReactElement) {
  const children = React.Children.toArray(
    (element.props as { children: React.ReactNode }).children
  );
  const button = children[0] as React.ReactElement<{ onClick: () => void }>;
  button.props.onClick();
}

describe('YearSupplyButton click feedback', () => {
  beforeEach(() => {
    cartItems = [];
    addItem.mockClear();
    toastMock.mockClear();
    openCart.mockClear();
  });

  it('confirms the click with the same toast as Add to Cart', () => {
    clickTheButton(YearSupplyButton(props(373)) as React.ReactElement);

    expect(addItem).toHaveBeenCalledTimes(1);
    expect(toastMock).toHaveBeenCalledTimes(1);

    const [title, options] = toastMock.mock.calls[0] as [
      string,
      { description: string; icon: string; action: { label: string; onClick: () => void } },
    ];
    expect(title).toBe('Added to Cart');
    expect(options.description).toContain('36 boxes');
    expect(options.description).toContain('Clearly Calendula Morning');
    // The toast names the product alone: "36 boxes of X - One box (10 tea
    // bags)" read like a contradiction with the variant suffix attached.
    expect(options.description).not.toContain('One box');
    expect(options.icon).toBe('🔥');
    expect(options.action.label).toBe('View Cart');
  });

  it('offers the cart rather than forcing it open, matching Add to Cart', () => {
    clickTheButton(YearSupplyButton(props(373)) as React.ReactElement);

    expect(openCart).not.toHaveBeenCalled();

    const [, options] = toastMock.mock.calls[0] as [string, { action: { onClick: () => void } }];
    options.action.onClick();
    expect(openCart).toHaveBeenCalledTimes(1);
  });

  it('names the actual quantity when only a remainder is on offer', () => {
    clickTheButton(YearSupplyButton(props(24)) as React.ReactElement);

    const [, options] = toastMock.mock.calls[0] as [string, { description: string }];
    expect(options.description).toContain('24 boxes');
  });
});
