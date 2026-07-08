export type ShippingOption = {
  id: string;
  label: string;
  /** integer minor units (e.g. cents). The `/api/shipping-options` response is
   * major-unit dollars; `CheckoutClient` converts to minor units on receipt. */
  cost: number;
  estimatedDays: number;
};
