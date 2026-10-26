import { Effect, Layer, Option } from "effect";

import { CustomerId, Customers } from "@repo/customers";

import { BillTo, type CustomerId as InvoicingCustomerId } from "#entities/invoice/index";
import { CustomerCannotBeBilled, UnknownCustomer } from "#entities/refusals/index";
import { CustomerBillTo } from "#outbound/customer-bill-to/index";

/** Answers `CustomerBillTo` by asking the Customers context in process, translating its model into Invoicing's words. */
export const layer: Layer.Layer<CustomerBillTo, never, Customers> = Layer.effect(
  CustomerBillTo,
  Effect.gen(function* () {
    const customers = yield* Customers;

    const billToOf = Effect.fn("CustomerBillTo.billToOf")(function* (customerId: InvoicingCustomerId) {
      const found = yield* customers.find(CustomerId.make(customerId));
      if (Option.isNone(found)) {
        return yield* new UnknownCustomer({ customerId });
      }
      const customer = found.value;
      if (customer.archived) {
        return yield* new CustomerCannotBeBilled({ customerId });
      }
      return new BillTo({ displayName: customer.displayName, email: customer.email, taxId: customer.taxId });
    });

    return CustomerBillTo.of({ billToOf });
  }),
);
