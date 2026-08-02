"use client";

import { useCartPersistence } from "@/hooks/useCartPersistence";

interface CartHydrationGuardProps {
  children: React.ReactNode;
}

/**
 * Hydration guard that ensures cart store is properly hydrated before rendering
 * This prevents hydration mismatches between server and client
 */
export function CartHydrationGuard({ children }: CartHydrationGuardProps) {
  const { isHydrated } = useCartPersistence();
  if (!isHydrated) {
    return null;
  }

  return <>{children}</>;
}
