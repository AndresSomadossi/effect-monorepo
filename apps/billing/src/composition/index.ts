import { Effect, Layer, Schedule } from "effect";

import { Customers, MemoryCustomerStore } from "@repo/customers";
import { AnnouncementRelay, CustomersBillTo, type InvoiceIssuedAnnouncer, type InvoiceStore, Invoices, MemoryInvoiceStore, MemoryRequestKeys, PubSubInvoiceIssuedAnnouncer } from "@repo/invoicing";

import type { World } from "#composition/world";
import { ApiRoutes } from "#inbound/http/index";
import { ScreenRoutes } from "#inbound/screen/index";

/**
 * Both contexts wired in memory and seeded with `world`. Invoicing asks Customers its one question in process, through its
 * `CustomerBillTo` port. The stores' records and the announcement feed stay in the output so tests can reach them; a test may also
 * replace the invoice store or the announcer, for example with one that cannot be reached.
 */
export const makeContexts = (
  world: World,
  adapters: {
    readonly invoiceStore?: Layer.Layer<InvoiceStore | MemoryInvoiceStore.InvoiceRecords>;
    readonly announcer?: Layer.Layer<InvoiceIssuedAnnouncer | PubSubInvoiceIssuedAnnouncer.InvoiceIssuedFeed>;
  } = {},
) =>
  Invoices.layer.pipe(
    Layer.provideMerge(AnnouncementRelay.layer),
    Layer.provideMerge(
      Layer.mergeAll(
        adapters.invoiceStore ?? MemoryInvoiceStore.layer(world),
        MemoryRequestKeys.layer,
        adapters.announcer ?? PubSubInvoiceIssuedAnnouncer.layer,
        CustomersBillTo.layer.pipe(Layer.provideMerge(Customers.layer), Layer.provideMerge(MemoryCustomerStore.layer(world.customers))),
      ),
    ),
  );

/**
 * Keeps making the announcements still pending, such as one whose first attempt failed right after its issue was recorded. A failed
 * run is reported and tried again on the next tick.
 */
export const AnnouncementRelayLoop = Layer.effectDiscard(
  Effect.gen(function* () {
    const relay = yield* AnnouncementRelay;
    yield* relay.announcePending.pipe(
      Effect.catchCause((cause) => Effect.logError("Announcing Invoice Issued failed; it stays pending", cause)),
      Effect.repeat(Schedule.spaced("1 second")),
      Effect.forkScoped,
    );
  }),
);

/** The endpoint and the screen. */
export const Routes = Layer.mergeAll(ApiRoutes, ScreenRoutes);
