import { Context, Effect, Layer, Semaphore } from "effect";

import { InvoiceIssuedAnnouncer } from "#outbound/invoice-issued-announcer/index";
import { InvoiceStore } from "#outbound/invoice-store/index";

/**
 * Makes the announcements the store recorded with each issue (a transactional outbox), oldest first, marking each one as made only
 * after it was announced. An announcement that fails stays pending, as do the ones after it, and is made by the next run.
 *
 * Runs never overlap, so within one process each **Invoice Issued** is announced exactly once. Across a crash between announcing and
 * marking, an announcement may be made again: delivery is at least once, and subscribers deduplicate on the invoice.
 */
export class AnnouncementRelay extends Context.Service<
  AnnouncementRelay,
  {
    readonly announcePending: Effect.Effect<void>;
  }
>()("@repo/invoicing/services/AnnouncementRelay") {
  static readonly layer = Layer.effect(
    AnnouncementRelay,
    Effect.gen(function* () {
      const store = yield* InvoiceStore;
      const announcer = yield* InvoiceIssuedAnnouncer;
      const oneRunAtATime = yield* Semaphore.make(1);

      const announcePending = Effect.gen(function* () {
        const pending = yield* store.pendingAnnouncements;
        yield* Effect.annotateCurrentSpan({ pending: pending.length });
        yield* Effect.forEach(pending, (announcement) => announcer.announce(announcement).pipe(Effect.andThen(store.markAnnounced(announcement.invoiceId))), { discard: true });
      }).pipe(Semaphore.withPermit(oneRunAtATime), Effect.withSpan("AnnouncementRelay.announcePending"));

      return AnnouncementRelay.of({ announcePending });
    }),
  );
}
