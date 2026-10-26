import { Context, type Effect, type Option } from "effect";

import type { Customer, CustomerId } from "#entities/customer/index";

/**
 * Where customers are kept. A store that cannot be reached is an unexpected failure, so it surfaces as a defect rather than in the
 * error channel: no caller of Customers can do anything about it but report it.
 */
export class CustomerStore extends Context.Service<
  CustomerStore,
  {
    find(id: CustomerId): Effect.Effect<Option.Option<Customer>>;
  }
>()("@repo/customers/outbound/CustomerStore") {}
