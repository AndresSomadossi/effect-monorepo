import { Context, Effect, HashMap, Layer, Option, Ref, Result } from "effect";

import { type Invoice, type InvoiceId, InvoiceNumber, type IssuedInvoice } from "#entities/invoice/index";
import type { InvoiceIssued } from "#entities/invoice-issued/index";
import { InvoiceChangedSinceSeen } from "#entities/refusals/index";
import { invoiceIssuedOf, issueDraft } from "#lib/issue/index";
import { InvoiceStore } from "#outbound/invoice-store/index";

export interface InvoiceRecordsState {
  readonly invoices: HashMap.HashMap<InvoiceId, Invoice>;
  /** The highest invoice number used so far, 0 before the first issue. */
  readonly lastNumber: number;
  /** The outbox: announcements recorded in the same change as their issue, in the order they were recorded. */
  readonly pendingAnnouncements: ReadonlyArray<InvoiceIssued>;
}

/** The state behind the in-memory store, exposed so a test or a seed can put the world in place. */
export class InvoiceRecords extends Context.Service<InvoiceRecords, Ref.Ref<InvoiceRecordsState>>()("@repo/invoicing/outbound/InvoiceStore/memory/InvoiceRecords") {
  static readonly layer = (seed: { readonly invoices: Iterable<Invoice>; readonly lastNumber: number }) =>
    Layer.effect(
      InvoiceRecords,
      Ref.make<InvoiceRecordsState>({
        invoices: HashMap.fromIterable(Array.from(seed.invoices, (invoice) => [invoice.id, invoice] as const)),
        lastNumber: seed.lastNumber,
        pendingAnnouncements: [],
      }),
    );
}

/**
 * An in-memory `InvoiceStore` over `InvoiceRecords`. `Ref.modify` applies each change atomically, so the version check, the number taken
 * and the outbox entry of an issue land together or not at all, and two issues never interleave.
 */
export const make: Effect.Effect<InvoiceStore["Service"], never, InvoiceRecords> = Effect.gen(function* () {
  const records = yield* InvoiceRecords;

  return InvoiceStore.of({
    find: (id) => Ref.get(records).pipe(Effect.map((state) => HashMap.get(state.invoices, id))),

    recordIssue: (issue) =>
      Ref.modify(records, (state): [Result.Result<IssuedInvoice, InvoiceChangedSinceSeen>, InvoiceRecordsState] => {
        const current = HashMap.get(state.invoices, issue.invoiceId);
        if (Option.isNone(current) || current.value._tag !== "Draft" || current.value.version !== issue.versionSeen) {
          return [Result.fail(new InvoiceChangedSinceSeen({ invoiceId: issue.invoiceId, versionSeen: issue.versionSeen })), state];
        }
        const number = state.lastNumber + 1;
        const issued = issueDraft(current.value, { number: InvoiceNumber.make(number), billTo: issue.billTo, issuedAt: issue.issuedAt });
        return [
          Result.succeed(issued),
          {
            invoices: HashMap.set(state.invoices, issued.id, issued),
            lastNumber: number,
            pendingAnnouncements: [...state.pendingAnnouncements, invoiceIssuedOf(issued)],
          },
        ];
      }).pipe(Effect.flatMap(Effect.fromResult)),

    pendingAnnouncements: Ref.get(records).pipe(Effect.map((state) => state.pendingAnnouncements)),

    markAnnounced: (invoiceId) =>
      Ref.update(records, (state) => ({
        ...state,
        pendingAnnouncements: state.pendingAnnouncements.filter((announcement) => announcement.invoiceId !== invoiceId),
      })),
  });
});

/** An in-memory `InvoiceStore` seeded with `seed`. Its `InvoiceRecords` stay available to whoever provides it. */
export const layer = (seed: { readonly invoices: Iterable<Invoice>; readonly lastNumber: number }): Layer.Layer<InvoiceStore | InvoiceRecords> => Layer.effect(InvoiceStore, make).pipe(Layer.provideMerge(InvoiceRecords.layer(seed)));
