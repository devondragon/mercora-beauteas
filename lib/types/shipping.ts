export type ShippingOption = {
  id: string;
  label: string;
  /**
   * UNITS DEPEND ON WHERE YOU ARE — this shape is reused across a conversion
   * boundary, so check which side you're on before doing arithmetic:
   *
   * - SERVER (`resolveShippingOptions`, `computeShippingFloorCents`, the
   *   `/api/shipping-options` response body, `lib/ai/deterministic-answers.ts`):
   *   MAJOR units (dollars), because that is how admin settings store
   *   `shipping.methods[].cost`.
   * - CLIENT (after `CheckoutClient` maps the response through `majorToMinor`,
   *   and everything downstream — cart store, order payload, display):
   *   integer MINOR units (cents).
   */
  cost: number;
  estimatedDays: number;
};
