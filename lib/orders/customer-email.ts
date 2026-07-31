// lib/orders/customer-email.ts
//
// Resolve the customer email for an order (BMC-216A).
//
// Orders have no `email` column. Guest checkout stores the address on
// `extensions.email`; some paths only have it on the shipping address. This is
// the single source of truth for that fallback chain — the order-confirmation
// sender, the shipping email, and the guest order-status token all use it, and
// the token is signed over the value returned here, so normalization must stay
// stable.
//
// Pure: no D1/Next/Clerk/Resend imports.

function normalizeEmailValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

export function getOrderCustomerEmail(order: {
  extensions?: Record<string, unknown> | null;
  shipping_address?: unknown;
}): string | null {
  const fromExtensions = normalizeEmailValue(order.extensions?.email);
  if (fromExtensions) return fromExtensions;

  const address = order.shipping_address;
  if (address && typeof address === "object" && !Array.isArray(address)) {
    const fromAddress = normalizeEmailValue((address as Record<string, unknown>).email);
    if (fromAddress) return fromAddress;
  }

  return null;
}
