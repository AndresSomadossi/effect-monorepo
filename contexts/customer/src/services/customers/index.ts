import { Context, Effect, Layer, type Option } from "effect";

import type { Customer, CustomerId } from "#entities/customer/index";
import { CustomerStore } from "#outbound/customer-store/index";

/** What Customers tells other contexts about the parties the organization bills. */
export class Customers extends Context.Service<
  Customers,
  {
    find(id: CustomerId): Effect.Effect<Option.Option<Customer>>;
  }
>()("@repo/customers/services/Customers") {
  static readonly layer = Layer.effect(
    Customers,
    Effect.gen(function* () {
      const store = yield* CustomerStore;

      const find = Effect.fn("Customers.find")(function* (id: CustomerId) {
        yield* Effect.annotateCurrentSpan({ customerId: id });
        return yield* store.find(id);
      });

      return Customers.of({ find });
    }),
  );
}
