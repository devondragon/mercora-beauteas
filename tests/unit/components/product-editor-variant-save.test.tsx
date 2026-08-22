/**
 * Regression test: the admin product editor must SEND the variant fields the
 * admin just typed.
 *
 * `handleSave` called `saveCurrentVariantData()` (which commits the form fields
 * into the variants array via `setVariants`) and then read the `variants` state
 * in the same tick. React state setters do not update the binding the running
 * function already closed over, so the payload carried the PRE-EDIT array: the
 * PUT rewrote the values that were already in the database, the response was a
 * 200, and the admin UI reported a successful save while the typed value was
 * silently discarded. Reported as "I set Evening to 144, hit save, no errors,
 * it stays at 250".
 *
 * The test drives the real component: type into the inventory field, click
 * Save, and assert on what `onSave` received. Asserting on the payload rather
 * than on component state is deliberate — state was always correct one render
 * later, which is exactly why this looked fine from the inside.
 *
 * No @testing-library/react in this repo, so this uses react-dom/client with
 * React 19's own `act`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

vi.mock('next/image', () => ({
  default: (props: any) => <img {...props} alt={props.alt ?? ''} />,
}));

vi.mock('@/components/admin/CategoryPicker', () => ({
  default: () => <div data-testid="category-picker" />,
}));

import ProductEditor from '@/components/admin/ProductEditor';

const PRODUCT: any = {
  id: 'prod_clearly_calendula_evening',
  name: 'Clearly Calendula Evening',
  slug: 'clearly-calendula-evening',
  status: 'active',
  fulfillment_type: 'physical',
  categories: [],
  tags: [],
  variants: [
    {
      id: 'variant_clearly_calendula_evening_btcce1',
      sku: 'BTCCE1',
      price: { amount: 300, currency: 'USD' },
      compare_at_price: { amount: 2000, currency: 'USD' },
      option_values: [],
      status: 'active',
      shipping_required: true,
      inventory: { track_inventory: true, quantity: 250, allow_backorder: false },
    },
  ],
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  // The editor loads subscription plans and categories on mount.
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [], plans: [] }) })
  );
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
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

function findInventoryInput(): HTMLInputElement {
  const labels = Array.from(container.querySelectorAll('label'));
  const label = labels.find((l) => /inventory|quantity|stock/i.test(l.textContent ?? ''));
  const input =
    (label?.parentElement?.querySelector('input') as HTMLInputElement | null) ??
    (label?.nextElementSibling as HTMLInputElement | null);
  if (!input) throw new Error('inventory input not found in the rendered editor');
  return input;
}

function findSaveButton(): HTMLButtonElement {
  const buttons = Array.from(container.querySelectorAll('button'));
  const save = buttons.find((b) => /save/i.test(b.textContent ?? ''));
  if (!save) throw new Error('save button not found in the rendered editor');
  return save as HTMLButtonElement;
}

describe('ProductEditor — saving an edited variant field', () => {
  it('sends the typed inventory quantity, not the value it was opened with', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);

    await act(async () => {
      root.render(
        <ProductEditor
          product={PRODUCT}
          isOpen={true}
          isNew={false}
          onClose={() => {}}
          onSave={onSave}
        />
      );
    });

    const input = findInventoryInput();
    expect(input.value).toBe('250');

    await act(async () => {
      typeInto(input, '144');
    });

    await act(async () => {
      findSaveButton().click();
    });

    expect(onSave).toHaveBeenCalledTimes(1);
    const payload = onSave.mock.calls[0][0];
    const variant = payload.variants.find(
      (v: any) => v.id === 'variant_clearly_calendula_evening_btcce1'
    );

    // The bug: 250.
    expect(variant.inventory.quantity).toBe(144);

    // Editing quantity must not drop the sibling inventory flags. These are what
    // make a variant purchasable at quantity 0; rebuilding inventory as
    // `{ quantity }` used to strip them on every save.
    expect(variant.inventory.track_inventory).toBe(true);
    expect(variant.inventory.allow_backorder).toBe(false);
  });
});
