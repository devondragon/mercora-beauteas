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

export function isPubliclyPurchasableProduct(product: {
  id?: unknown;
  slug?: unknown;
  type?: unknown;
}): boolean {
  return giftCardPurchasesEnabled() || !isGiftCardPurchaseProduct(product);
}
