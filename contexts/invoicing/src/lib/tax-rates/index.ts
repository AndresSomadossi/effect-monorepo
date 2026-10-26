import type { TaxRate } from "#entities/money/index";

/**
 * The fixed tax rate catalog. Percentages are held in basis points (1% = 100) so that every computation stays in whole numbers.
 * The rates are synthetic, chosen to exercise rounding; they are no jurisdiction's rates.
 */
export const taxRates: Readonly<Record<TaxRate, { readonly name: string; readonly basisPoints: number }>> = {
  standard: { name: "Standard (synthetic)", basisPoints: 2100 },
  reduced: { name: "Reduced (synthetic)", basisPoints: 1050 },
  exempt: { name: "Exempt (synthetic)", basisPoints: 0 },
};
