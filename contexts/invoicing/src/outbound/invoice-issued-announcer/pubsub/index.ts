import { Context, Effect, Layer, PubSub } from "effect";

import type { InvoiceIssued } from "#entities/invoice-issued/index";
import { InvoiceIssuedAnnouncer } from "#outbound/invoice-issued-announcer/index";

/** The in-process feed of **Invoice Issued** announcements. Other parts of the organization subscribe to it. */
export class InvoiceIssuedFeed extends Context.Service<InvoiceIssuedFeed, PubSub.PubSub<InvoiceIssued>>()("@repo/invoicing/outbound/InvoiceIssuedAnnouncer/pubsub/InvoiceIssuedFeed") {
  static readonly layer = Layer.effect(InvoiceIssuedFeed, Effect.acquireRelease(PubSub.unbounded<InvoiceIssued>(), PubSub.shutdown));
}

/** Announces through the in-process `InvoiceIssuedFeed`. */
export const make: Effect.Effect<InvoiceIssuedAnnouncer["Service"], never, InvoiceIssuedFeed> = Effect.gen(function* () {
  const feed = yield* InvoiceIssuedFeed;
  return InvoiceIssuedAnnouncer.of({
    announce: (event) => PubSub.publish(feed, event).pipe(Effect.asVoid),
  });
});

/** Announces through an in-process `PubSub`. Its `InvoiceIssuedFeed` stays available to whoever provides it. */
export const layer: Layer.Layer<InvoiceIssuedAnnouncer | InvoiceIssuedFeed> = Layer.effect(InvoiceIssuedAnnouncer, make).pipe(Layer.provideMerge(InvoiceIssuedFeed.layer));
