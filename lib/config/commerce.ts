/**
 * Launch-time commerce controls.
 *
 * Purchasing newly-issued gift cards is deliberately fail-closed. It can only
 * be enabled in a non-production runtime with an explicit server-side setting;
 * production remains disabled for the public launch even if the variable is
 * accidentally present. Redemption and administration of existing cards do
 * not consult this flag.
 */
export const GIFT_CARD_PRODUCT_ID = 'gift-card';

export function giftCardPurchasesEnabled(): boolean {
  return (
    process.env.NODE_ENV !== 'production' &&
    process.env.ENABLE_GIFT_CARD_PURCHASES === 'true'
  );
}

export function isGiftCardPurchaseProduct(product: {
  id?: unknown;
  slug?: unknown;
  type?: unknown;
} | null | undefined): boolean {
  if (!product) return false;
  const slug =
    typeof product.slug === 'string'
      ? product.slug
      : product.slug && typeof product.slug === 'object'
        ? Object.values(product.slug as Record<string, unknown>)[0]
        : undefined;
  const normalizedType =
    typeof product.type === 'string'
      ? product.type.toLowerCase().replace(/[^a-z0-9]/g, '')
      : '';

  return (
    product.id === GIFT_CARD_PRODUCT_ID ||
    slug === GIFT_CARD_PRODUCT_ID ||
    normalizedType === 'giftcard'
  );
}

/**
 * Whether a `status` column value means "still sellable".
 *
 * FAILS OPEN on a missing value. `products.status` and `product_variants.status`
 * both default to 'active' in the schema, but a NULL row must not withdraw the
 * catalog — the blast radius of a false negative here is the entire storefront,
 * while a false positive is one product that should have been archived.
 */
export function isActiveStatus(status: unknown): boolean {
  if (status === undefined || status === null || status === '') return true;
  return typeof status === 'string' && status.toLowerCase() === 'active';
}

/**
 * Whether a resolved catalog variant may be sold. A null variant is never
 * sellable — the caller could not resolve it, so there is nothing to price.
 */
export function isSellableVariant(
  variant: { status?: unknown } | null | undefined
): boolean {
  if (!variant) return false;
  return isActiveStatus(variant.status);
}

export function isPubliclyPurchasableProduct(product: {
  id?: unknown;
  slug?: unknown;
  type?: unknown;
  status?: unknown;
}): boolean {
  if (!isActiveStatus(product.status)) return false;
  return giftCardPurchasesEnabled() || !isGiftCardPurchaseProduct(product);
}
