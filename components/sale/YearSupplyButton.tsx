'use client';

/**
 * One-click year supply for a single blend.
 *
 * The decision is entirely `yearSupplyOffer` (lib/sale/year-supply.ts), which
 * is pure and tested there; this component only renders it and dispatches one
 * addItem. It subtracts what the cart already holds, so clicking twice cannot
 * queue more boxes than exist - /api/payment-intent would reject that, but not
 * until checkout.
 *
 * The price is read from the variant every render. A constant would go stale
 * the moment scripts/goob-reprice.mjs runs again, which it is built to do.
 */
import { Money } from '@/lib/money';
import { useCartStore } from '@/lib/stores/cart-store';
import {
  CUPS_PER_BOX,
  boxesLeft,
  yearSupplyOffer,
  yearSupplyCartItem,
} from '@/lib/sale/year-supply';
import type { ProductVariant } from '@/lib/types';

interface YearSupplyButtonProps {
  variant: ProductVariant;
  productId: string;
  name: string;
  imageUrl: string;
}

export default function YearSupplyButton({
  variant,
  productId,
  name,
  imageUrl,
}: YearSupplyButtonProps) {
  const items = useCartStore((state) => state.items);
  const addItem = useCartStore((state) => state.addItem);

  const alreadyInCart = (items ?? [])
    .filter((item) => item.variantId === variant?.id)
    .reduce((total, item) => total + (item.quantity ?? 0), 0);

  const offer = yearSupplyOffer(boxesLeft(variant), alreadyInCart);
  const item = offer
    ? yearSupplyCartItem({ variant, productId, name, imageUrl, boxes: offer.boxes })
    : null;

  // No offer, or no readable price: render nothing rather than a $NaN button.
  if (!offer || !item) return null;

  const currency = typeof variant?.price?.currency === 'string' ? variant.price.currency : 'USD';
  // Integer minor units times a box count - exact, and not a major/minor
  // conversion, so lib/money's boundary rules are satisfied by formatting alone.
  const total = Money.fromMinor(item.price * item.quantity, currency).format();
  const label =
    offer.kind === 'year'
      ? `Make it a year - ${offer.boxes} boxes, ${total}`
      : `Take the last ${offer.boxes} - ${total}`;

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => addItem(item)}
        className="w-full rounded border border-secondary-400 px-4 py-2 text-sm font-semibold text-secondary-600 transition hover:bg-secondary-400 hover:text-text-inverse"
      >
        {label}
      </button>
      <p className="mt-1 text-center text-xs text-text-muted">
        {offer.boxes * CUPS_PER_BOX} cups
        {offer.kind === 'year' ? ', one a day for a year' : ', everything we have left'}
      </p>
    </div>
  );
}
