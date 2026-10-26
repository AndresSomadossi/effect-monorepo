import { DateTime, Effect } from "effect";

import { Invoices, type InvoiceView, type IssueRefusal, type IssueRequest, viewOf } from "@repo/invoicing";

import { SomethingWentWrong } from "#contracts/index";

/**
 * Reports an unexpected failure internally, with its full cause, and tells the caller only that something went wrong. Expected outcomes
 * pass through untouched.
 */
export const reportUnexpected = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E | SomethingWentWrong, R> =>
  effect.pipe(Effect.catchDefect((defect) => Effect.logError("Unexpected failure", defect).pipe(Effect.andThen(Effect.fail(new SomethingWentWrong())))));

/**
 * Builds the one path both the endpoint and the screen take to issue: issue the draft, then answer the issued invoice as it reads now.
 * Sharing it is what keeps the two behaving identically.
 */
export const makeIssueInvoice = Effect.gen(function* () {
  const invoices = yield* Invoices;
  return Effect.fn("issueInvoice")(function* (request: IssueRequest): Effect.fn.Return<InvoiceView, IssueRefusal> {
    const issued = yield* invoices.issue(request);
    return viewOf(issued, yield* DateTime.now);
  }, reportUnexpected);
});
