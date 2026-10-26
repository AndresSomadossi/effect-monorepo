import { Schema } from "effect";

/** The one currency every amount on an invoice is stated in. Both have cents as their minor unit. */
export const Currency = Schema.Literals(["EUR", "USD"]);
export type Currency = typeof Currency.Type;

/** A quantity of money, always a whole number of the currency's minor units: fractions of a minor unit never exist. */
export const Amount = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).pipe(Schema.brand("Amount"));
export type Amount = typeof Amount.Type;

/** A named percentage from the fixed catalog, applied to a line amount. */
export const TaxRate = Schema.Literals(["standard", "reduced", "exempt"]);
export type TaxRate = typeof TaxRate.Type;
