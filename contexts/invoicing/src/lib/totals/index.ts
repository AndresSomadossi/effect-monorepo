import type { Line } from "#entities/invoice/index";
import { Amount } from "#entities/money/index";
import { taxRates } from "#lib/tax-rates/index";

const basisPointsPerUnit = 10_000;

/** A line's quantity times its unit amount, before tax. */
export const lineAmount = (line: Line): Amount => Amount.make(line.quantity * line.unitAmount);

/**
 * A line amount times its tax rate, rounded on its own to a whole minor unit, an exact half rounded up. Amounts are never negative,
 * so adding half the divisor before the integer division rounds half up exactly, with no floating point involved.
 */
export const lineTax = (line: Line): Amount => Amount.make(Math.floor((lineAmount(line) * taxRates[line.taxRate].basisPoints + basisPointsPerUnit / 2) / basisPointsPerUnit));

export interface Totals {
  readonly subtotal: Amount;
  readonly taxAmount: Amount;
  readonly total: Amount;
}

/** Subtotal is the sum of the line amounts; tax amount the sum of the line taxes, never the tax of the subtotal; total their sum. */
export const totalsOf = (lines: ReadonlyArray<Line>): Totals => {
  const subtotal = lines.reduce((sum, line) => sum + lineAmount(line), 0);
  const taxAmount = lines.reduce((sum, line) => sum + lineTax(line), 0);
  return { subtotal: Amount.make(subtotal), taxAmount: Amount.make(taxAmount), total: Amount.make(subtotal + taxAmount) };
};
