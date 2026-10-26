import { Context, type Effect } from "effect";

import type { BillTo, CustomerId } from "#entities/invoice/index";
import type { CustomerCannotBeBilled, UnknownCustomer } from "#entities/refusals/index";

/**
 * Invoicing's one question to Customers, in its own words: "what is the bill-to of this customer, if they can be billed today?". It has
 * three answers: the bill-to, `UnknownCustomer`, or `CustomerCannotBeBilled`.
 */
export class CustomerBillTo extends Context.Service<
  CustomerBillTo,
  {
    billToOf(customerId: CustomerId): Effect.Effect<BillTo, UnknownCustomer | CustomerCannotBeBilled>;
  }
>()("@repo/invoicing/outbound/CustomerBillTo") {}
