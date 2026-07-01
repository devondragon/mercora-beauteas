/**
 * === Cart Drawer Component ===
 *
 * A sliding shopping cart interface that provides users with quick access to
 * their cart items, total calculations, and checkout functionality. Implements
 * persistent cart state and real-time updates.
 *
 * === Features ===
 * - **Persistent Cart State**: Uses Zustand store for cart persistence
 * - **Real-time Updates**: Instant reflection of quantity changes
 * - **Total Calculations**: Automatic price calculations and updates
 * - **Item Management**: Add, remove, and modify cart items
 * - **Quick Checkout**: Direct link to checkout process
 * - **Responsive Design**: Works across all device sizes
 * - **Visual Indicators**: Item count badge and empty state handling
 *
 * === Cart Functionality ===
 * - **Item Display**: Shows product image, name, price, quantity
 * - **Quantity Controls**: Increase/decrease item quantities
 * - **Item Removal**: Remove items from cart
 * - **Total Calculation**: Real-time price totals with currency formatting
 * - **Empty State**: Helpful message when cart is empty
 *
 * === State Management ===
 * - **Zustand Store**: Persistent cart state across sessions
 * - **Local Storage**: Cart survives browser refreshes
 * - **Real-time Sync**: Immediate UI updates on state changes
 *
 * === Usage ===
 * ```tsx
 * <CartDrawer />
 * ```
 * 
 * No props required - manages its own state and integrates with cart store.
 *
 * === Integration ===
 * - **CartItemCard**: Individual cart item display and management
 * - **Cart Store**: Global cart state management
 * - **Checkout Flow**: Direct integration with checkout process
 */

import { useCartStore } from "@/lib/stores/cart-store";
import { useCartUIStore } from "@/lib/stores/cart-ui-store";
import { Sheet, SheetContent, SheetTrigger, SheetTitle, SheetDescription, SheetClose } from "@/components/ui/sheet";
import CartItemCard from "./CartItemCard";
import { Button } from "@/components/ui/button";
import { ShoppingCart, X } from "lucide-react";
import { useState, useEffect } from "react";
import Link from "next/link";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";

/**
 * CartDrawer component providing shopping cart functionality
 * 
 * @returns JSX element representing a sliding cart drawer with items and totals
 */
export default function CartDrawer() {
  const isOpen = useCartUIStore((state) => state.isOpen);
  const setCartOpen = useCartUIStore((state) => state.setCartOpen);
  const [hasMounted, setHasMounted] = useState(false);
  const items = useCartStore((state) => state.items) || [];

  useEffect(() => {
    // Trigger manual rehydration and mark as mounted
    useCartStore.persist.rehydrate();
    setHasMounted(true);
  }, []);

  // Calculate total price for all items in cart with safety checks
  const total = items.reduce(
    (acc, item) => acc + (item?.price || 0) * (item?.quantity || 0),
    0
  );

  // Only show real count after mounting to prevent hydration mismatch
  const itemCount = hasMounted ? items.length : 0;

  return (
    <Sheet open={isOpen} onOpenChange={setCartOpen}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          className="text-text-primary hover:bg-white hover:text-primary-600 relative"
        >
          <ShoppingCart className="mr-2 h-4 w-4" />
          Cart ({itemCount})
          {itemCount > 0 && (
            <span className="absolute -top-2 -right-2 bg-primary-500 text-text-inverse rounded-full w-5 h-5 flex items-center justify-center text-xs">
              {itemCount}
            </span>
          )}
        </Button>
      </SheetTrigger>
      <SheetContent
        side="right"
        className="bg-white text-text-primary  transition-all ease-in-out px-3 w-full sm:w-[400px] !max-w-[400px] !duration-[600ms] data-[state=closed]:!duration-[600ms] data-[state=open]:!duration-[600ms] flex flex-col h-full border-border-default"
      >
        {/* Accessibility components */}
        <VisuallyHidden>
          <SheetTitle>Shopping Cart</SheetTitle>
          <SheetDescription>
            Review and manage items in your shopping cart before checkout.
          </SheetDescription>
        </VisuallyHidden>

        {/* Custom Close Button */}
        <div className="absolute top-4 right-4 z-10">
          <SheetClose asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0 rounded-full bg-surface-light hover:bg-surface hover:text-text-primary transition-colors"
            >
              <X className="h-4 w-4" />
              <span className="sr-only">Close cart</span>
            </Button>
          </SheetClose>
        </div>

        <div className="py-6">
          <h2 className="text-xl font-bold mb-4 flex items-center">
            <ShoppingCart className="mr-2 h-4 w-4" />
            Your Cart
          </h2>
          
          {itemCount === 0 ? (
            <div className="text-text-secondary text-center py-8">
              Your cart is empty
            </div>
          ) : (
            <div className="space-y-4">
              {items.map((item) => (
                <CartItemCard key={item.variantId} item={item} />
              ))}

              <div className="border-t border-border-default pt-4">
                <div className="flex justify-between items-center text-lg font-bold">
                  <span>Total: ${total.toFixed(2)}</span>
                </div>

                <Button
                  asChild
                  className="w-full bg-primary-500 hover:bg-primary-600 mt-4"
                >
                  <Link href="/checkout" onClick={() => setCartOpen(false)}>
                    Proceed to Checkout
                  </Link>
                </Button>
              </div>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
