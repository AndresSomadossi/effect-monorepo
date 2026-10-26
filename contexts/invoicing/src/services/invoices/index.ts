import { Cause, Context, DateTime, Effect, Exit, Layer, Option, Result } from "effect";

import type { Invoice, InvoiceId, IssuedInvoice } from "#entities/invoice/index";
import { InvoiceNotFound, type IssueRefusal, RequestKeyReused, RequestStillInProgress } from "#entities/refusals/index";
import type { IssueRequest, RequestKey } from "#entities/request/index";
import { checkIssuable } from "#lib/issue/index";
import { CustomerBillTo } from "#outbound/customer-bill-to/index";
import { InvoiceStore } from "#outbound/invoice-store/index";
import { RequestKeyClaim, RequestKeys } from "#outbound/request-keys/index";
import { AnnouncementRelay } from "#services/announcement-relay/index";

/** Identifies what a request asks, so that a request key sent with a different request is told apart from a retry. */
const fingerprintOf = (request: IssueRequest): string => JSON.stringify([request.invoiceId, request.versionSeen]);

/**
 * Invoicing's capabilities. Whoever calls `issue` has already established that the actor acts on behalf of the organization.
 *
 * Expected outcomes are in the error channel; anything else, such as a store that cannot be reached, is a defect.
 */
export class Invoices extends Context.Service<
  Invoices,
  {
    find(invoiceId: InvoiceId): Effect.Effect<Invoice, InvoiceNotFound>;
    issue(request: IssueRequest): Effect.Effect<IssuedInvoice, IssueRefusal>;
  }
>()("@repo/invoicing/services/Invoices") {
  static readonly layer = Layer.effect(
    Invoices,
    Effect.gen(function* () {
      const store = yield* InvoiceStore;
      const customerBillTo = yield* CustomerBillTo;
      const requestKeys = yield* RequestKeys;
      const relay = yield* AnnouncementRelay;

      const find = Effect.fn("Invoices.find")(function* (invoiceId: InvoiceId) {
        yield* Effect.annotateCurrentSpan({ invoiceId });
        const found = yield* store.find(invoiceId);
        if (Option.isNone(found)) {
          return yield* new InvoiceNotFound({ invoiceId });
        }
        return found.value;
      });

      // The rules in the order they are checked, then the issue recorded as one change, then the announcement.
      const issueDraft = Effect.fnUntraced(function* (request: IssueRequest) {
        const invoice = yield* find(request.invoiceId);
        const draft = yield* Effect.fromResult(checkIssuable(invoice, request.versionSeen));
        const billTo = yield* customerBillTo.billToOf(draft.customerId);
        const issuedAt = yield* DateTime.now;
        const issued = yield* store.recordIssue({ invoiceId: draft.id, versionSeen: draft.version, billTo, issuedAt });
        // The issue stands once recorded. An announcement that cannot be made now stays in the outbox and the relay makes it later.
        yield* relay.announcePending.pipe(Effect.catchCause(() => Effect.void));
        return issued;
      });

      // An expected outcome is the request's answer and is kept; after an unexpected failure the key is given back.
      const settle = (request: IssueRequest, requestKey: RequestKey) => (exit: Exit.Exit<IssuedInvoice, IssueRefusal>) => {
        const keyed = { actor: request.actor, requestKey };
        if (Exit.isSuccess(exit)) {
          return requestKeys.complete({ ...keyed, answer: Result.succeed(exit.value) });
        }
        const refusal = Cause.hasDies(exit.cause) || Cause.hasInterrupts(exit.cause) ? Option.none() : Cause.findErrorOption(exit.cause);
        return Option.match(refusal, {
          onNone: () => requestKeys.release(keyed),
          onSome: (error) => requestKeys.complete({ ...keyed, answer: Result.fail(error) }),
        });
      };

      const issueWithKey = Effect.fnUntraced(function* (request: IssueRequest, requestKey: RequestKey) {
        const now = yield* DateTime.now;
        const claim = yield* requestKeys.claim({ actor: request.actor, requestKey, fingerprint: fingerprintOf(request), now });
        return yield* RequestKeyClaim.$match(claim, {
          Claimed: () => issueDraft(request).pipe(Effect.onExit(settle(request, requestKey))),
          Answered: ({ answer }) => Effect.fromResult(answer),
          Reused: () => Effect.fail(new RequestKeyReused({ requestKey })),
          InProgress: () => Effect.fail(new RequestStillInProgress({ requestKey })),
        });
      });

      const issue = Effect.fn("Invoices.issue")(function* (request: IssueRequest) {
        yield* Effect.annotateCurrentSpan({ invoiceId: request.invoiceId, versionSeen: request.versionSeen, keyed: Option.isSome(request.requestKey) });
        return yield* Option.match(request.requestKey, {
          onNone: () => issueDraft(request),
          onSome: (requestKey) => issueWithKey(request, requestKey),
        });
      });

      return Invoices.of({ find, issue });
    }),
  );
}
