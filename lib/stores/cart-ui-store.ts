/**
 * === Cart UI Store ===
 *
 * Ephemeral UI state for the cart drawer's open/closed status. Kept separate
 * from the persisted `cart-store` on purpose: this is transient view state that
 * must NOT survive a page refresh (otherwise the drawer would spring open on
 * every load). Any component can open the drawer — e.g. the header cart button
 * or an "Added to Cart" toast's "View Cart" action.
 */

import { create } from "zustand";

interface CartUIState {
  /** Whether the cart drawer is currently open */
  isOpen: boolean;
  /** Open the cart drawer */
  openCart: () => void;
  /** Close the cart drawer */
  closeCart: () => void;
  /** Set the cart drawer open state directly (for controlled components) */
  setCartOpen: (open: boolean) => void;
}

export const useCartUIStore = create<CartUIState>((set) => ({
  isOpen: false,
  openCart: () => set({ isOpen: true }),
  closeCart: () => set({ isOpen: false }),
  setCartOpen: (open) => set({ isOpen: open }),
}));
