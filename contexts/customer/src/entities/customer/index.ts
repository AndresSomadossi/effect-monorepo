import { Schema } from "effect";

/** Identifies a customer the organization may bill. */
export const CustomerId = Schema.NonEmptyString.pipe(Schema.brand("CustomerId"));
export type CustomerId = typeof CustomerId.Type;

/** A party the organization has a commercial relationship with and may bill. Customers are archived, never deleted. */
export class Customer extends Schema.Class<Customer>("@repo/customers/entities/Customer")({
  id: CustomerId,
  displayName: Schema.NonEmptyString,
  email: Schema.NonEmptyString,
  taxId: Schema.OptionFromNullOr(Schema.NonEmptyString),
  archived: Schema.Boolean,
}) {}
