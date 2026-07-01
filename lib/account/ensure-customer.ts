/**
 * === Customer Provisioning ===
 *
 * Clerk sign-up does not create a `customers` row. Historically that happened
 * lazily at first order (see app/api/orders/route.ts), which meant account
 * activities for a brand-new user — saving profile settings, adding an
 * address — failed with "Customer not found" before they had ever ordered.
 *
 * `getOrCreateCustomer` centralizes the lazy-provisioning logic so any account
 * write path can ensure a customer exists, seeded from the Clerk profile.
 */

import { currentUser } from "@clerk/nextjs/server";
import { getCustomer, createCustomer } from "@/lib/models/mach/customer";
import type { MACHCustomer } from "@/lib/types/mach/Customer";

/**
 * Return the customer for a Clerk user id, creating it from the Clerk profile
 * if it does not exist yet.
 *
 * Use this on account write paths (settings, addresses) so first-time users
 * who have not placed an order can still manage their account.
 *
 * @param userId - Clerk user id (used as the customer id)
 */
export async function getOrCreateCustomer(userId: string): Promise<MACHCustomer> {
  const existing = await getCustomer(userId);
  if (existing) return existing;

  const user = await currentUser();
  try {
    return await createCustomer({
      id: userId,
      type: "person",
      person: {
        email: user?.emailAddresses?.[0]?.emailAddress || "",
        first_name: user?.firstName || "",
        last_name: user?.lastName || "",
        full_name: user ? `${user.firstName || ""} ${user.lastName || ""}`.trim() : "",
      },
    });
  } catch (err) {
    // Race: a concurrent request may have created the row first (customer id is
    // unique). Re-fetch before surfacing the error.
    const retry = await getCustomer(userId);
    if (retry) return retry;
    throw err;
  }
}
