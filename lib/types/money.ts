export type Money = {
  // Internally (DB/session/service layer): the smallest currency unit (e.g.
  // cents for USD). At API/MCP/JSON-LD wire boundaries (see lib/money/wire.ts
  // toWireMoney / Money.toMach()): decimal MAJOR units, with `precision` set —
  // the MACH Alliance wire shape (BMC-164).
  amount: number;
  currency: string; // ISO 4217 currency code (e.g., "USD", "EUR")
  precision?: number; // Present only on MACH-wire-shaped values (see toMach()).
};