/**
 * BMC-216B — B↔C seam stub. Ticket C replaces the body of
 * sendInitialShippingEmail; until then it must report a truthful
 * "no email was attempted" result and never throw.
 */
import { describe, it, expect } from "vitest";
import { sendInitialShippingEmail } from "@/lib/fulfillment/shipping-email";
import type { Order } from "@/lib/types/order";

const order = {
  id: "ORD-1",
  status: "shipped",
  payment_status: "paid",
  total_amount: { amount: 2500, currency: "USD" },
  currency_code: "USD",
  items: [],
} as unknown as Order;

describe("sendInitialShippingEmail (BMC-216B stub)", () => {
  it("resolves { attempted: false, success: false } without throwing", async () => {
    await expect(
      sendInitialShippingEmail(order, { type: "admin", id: "user_1" }),
    ).resolves.toEqual({ attempted: false, success: false });
  });

  it("resolves the same for a service actor", async () => {
    await expect(
      sendInitialShippingEmail(order, { type: "service", id: "api-token" }),
    ).resolves.toEqual({ attempted: false, success: false });
  });
});
