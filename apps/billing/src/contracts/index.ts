import { Context, Schema } from "effect";
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiMiddleware, HttpApiSchema, HttpApiSecurity, OpenApi } from "effect/http-api";

import {
  type Actor,
  CustomerCannotBeBilled,
  InvoiceChangedSinceSeen,
  InvoiceHasNoLines,
  InvoiceId,
  InvoiceNotDraft,
  InvoiceNotFound,
  InvoiceView,
  RequestKey,
  RequestKeyReused,
  RequestStillInProgress,
  UnknownCustomer,
  Version,
} from "@repo/invoicing";

/** Who the request was established to act for. Provided by `OrganizationAuthorization`. */
export class CurrentActor extends Context.Service<CurrentActor, Actor>()("@repo/billing/contracts/CurrentActor") {}

/** The caller does not act on behalf of the organization. Refused before anything else is checked; nothing about the invoice is told. */
export class NotAllowed extends Schema.TaggedError<NotAllowed>()("NotAllowed", {}, { httpApiStatus: 403 }) {}

/** Any unexpected failure. Nothing internal is revealed; the caller may try again. */
export class SomethingWentWrong extends Schema.TaggedError<SomethingWentWrong>()("SomethingWentWrong", {}, { httpApiStatus: 500 }) {}

/** Establishes that a caller acts on behalf of the organization from a bearer token. */
export class OrganizationAuthorization extends HttpApiMiddleware.Service<OrganizationAuthorization, { provides: CurrentActor; requires: never }>()("@repo/billing/contracts/OrganizationAuthorization", {
  requiredForClient: true,
  security: { bearer: HttpApiSecurity.bearer },
  error: NotAllowed,
}) {}

/**
 * Issue an invoice. Every outcome is told apart by its `_tag` and its status; the successful answer carries the new version so that
 * the caller can make a later change to it.
 */
export class InvoicesApi extends HttpApiGroup.make("invoices")
  .add(
    HttpApiEndpoint.post("issue", "/:invoiceId/issue", {
      params: { invoiceId: InvoiceId },
      payload: Schema.Struct({
        version: Version,
        requestKey: Schema.optionalKey(RequestKey),
      }),
      success: InvoiceView,
      error: [
        InvoiceNotFound.pipe(HttpApiSchema.status(404)),
        InvoiceChangedSinceSeen.pipe(HttpApiSchema.status(409)),
        InvoiceNotDraft.pipe(HttpApiSchema.status(409)),
        InvoiceHasNoLines.pipe(HttpApiSchema.status(422)),
        UnknownCustomer.pipe(HttpApiSchema.status(422)),
        CustomerCannotBeBilled.pipe(HttpApiSchema.status(422)),
        RequestKeyReused.pipe(HttpApiSchema.status(422)),
        RequestStillInProgress.pipe(HttpApiSchema.status(409)),
        SomethingWentWrong,
      ],
    }),
  )
  .middleware(OrganizationAuthorization)
  .prefix("/invoices")
  .annotateMerge(OpenApi.annotations({ title: "Invoices" })) {}

export class BillingApi extends HttpApi.make("billing")
  .add(InvoicesApi)
  .annotateMerge(OpenApi.annotations({ title: "Billing" })) {}
