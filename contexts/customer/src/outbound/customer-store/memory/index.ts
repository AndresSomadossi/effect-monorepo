import { Context, Effect, HashMap, Layer, Ref } from "effect";

import type { Customer, CustomerId } from "#entities/customer/index";
import { CustomerStore } from "#outbound/customer-store/index";

/** The records behind the in-memory store, exposed so a test or a seed can put the world in place. */
export class CustomerRecords extends Context.Service<CustomerRecords, Ref.Ref<HashMap.HashMap<CustomerId, Customer>>>()("@repo/customers/outbound/CustomerStore/memory/CustomerRecords") {
  static readonly layer = (customers: Iterable<Customer>) => Layer.effect(CustomerRecords, Ref.make(HashMap.fromIterable(Array.from(customers, (customer) => [customer.id, customer] as const))));
}

/** An in-memory `CustomerStore` seeded with the given customers. Its `CustomerRecords` stay available to whoever provides it. */
export const layer = (customers: Iterable<Customer>): Layer.Layer<CustomerStore | CustomerRecords> =>
  Layer.effect(
    CustomerStore,
    Effect.gen(function* () {
      const records = yield* CustomerRecords;
      return CustomerStore.of({
        find: (id) => Ref.get(records).pipe(Effect.map(HashMap.get(id))),
      });
    }),
  ).pipe(Layer.provideMerge(CustomerRecords.layer(customers)));
