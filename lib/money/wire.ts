import { Money } from './money';
import type { MachMoney } from './money';

/** Serialize any stored/legacy money value to the MACH wire shape. */
export function toWireMoney(value: unknown, currency = 'USD'): MachMoney {
  return Money.fromStored(value, currency).toMach();
}
