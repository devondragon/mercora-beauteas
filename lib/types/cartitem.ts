export interface CartItem {
  variantId: string; // Unique identifier for the variant in the cart
  productId: string; // Parent product reference (string for MACH)
  name: string;
  price: number; // integer minor units (e.g. cents)
  quantity: number;
  primaryImageUrl: string;
  // Present on gift-card items: who the purchased card is emailed to once paid.
  giftCard?: {
    recipientEmail: string;
    recipientName?: string;
    message?: string;
  };
}
