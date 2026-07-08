export type Money = {
  // Internally (DB/session/service layer): the smallest currency unit (e.g.
  // cents for USD). Cents-shaped values never carry a `precision` — that
  // field only exists on the MACH wire shape (see `MachMoney` in
  // lib/money/money.ts, produced by toWireMoney / Money.toMach()).
  //
  // `precision?: never` (rather than `precision?: number`) is deliberate
  // (BMC-164 review follow-up): a plain `precision?: number` would make
  // `MachMoney` structurally assignable to `Money` (MachMoney's required
  // `precision: number` satisfies an optional `number | undefined`),
  // silently defeating the distinct Wire*/cents-typed return types in
  // lib/models/mach/product-serializer.ts and app/api/orders/route.ts and
  // letting a major-unit wire value flow back into a cents-typed DB-write
  // sink with no compile error. Banning the field here makes the two money
  // shapes genuinely non-interchangeable for `tsc`.
  amount: number;
  currency: string; // ISO 4217 currency code (e.g., "USD", "EUR")
  precision?: never;
};