import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer, Option } from "effect";

import { Customer, CustomerId, Customers, MemoryCustomerStore } from "#index";

const ada = new Customer({ id: CustomerId.make("Ada"), displayName: "Ada Lovelace Ltd", email: "billing@ada.example", taxId: Option.some("GB123456789"), archived: false });

const TestLayer = Customers.layer.pipe(Layer.provide(MemoryCustomerStore.layer([ada])));

describe("Customers", () => {
  it.effect("finds a customer by identity", () =>
    Effect.gen(function* () {
      const customers = yield* Customers;
      assert.deepStrictEqual(yield* customers.find(CustomerId.make("Ada")), Option.some(ada));
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("finds nothing for an identity it does not know", () =>
    Effect.gen(function* () {
      const customers = yield* Customers;
      assert.isTrue(Option.isNone(yield* customers.find(CustomerId.make("Nobody"))));
    }).pipe(Effect.provide(TestLayer)),
  );
});
