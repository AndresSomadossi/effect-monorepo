import { Effect, Layer, Option } from "effect";
import { HttpApiBuilder } from "effect/http-api";

import { IssueRequest } from "@repo/invoicing";

import { BillingApi, CurrentActor, NotAllowed, OrganizationAuthorization } from "#contracts/index";
import { OrganizationAccess } from "#inbound/access/index";
import { makeIssueInvoice } from "#inbound/issue-invoice";

/** Server side of `OrganizationAuthorization`: a bearer token that grants no access is refused before the handler runs. */
export const OrganizationAuthorizationLive = Layer.effect(
  OrganizationAuthorization,
  Effect.gen(function* () {
    const access = yield* OrganizationAccess;
    return OrganizationAuthorization.of({
      bearer: Effect.fn("OrganizationAuthorization.bearer")(function* (handler, { credential }) {
        const actor = yield* access.actorFor(credential);
        if (Option.isNone(actor)) {
          return yield* new NotAllowed();
        }
        return yield* Effect.provideService(handler, CurrentActor, actor.value);
      }),
    });
  }),
);

export const InvoicesApiHandlers = HttpApiBuilder.group(
  BillingApi,
  "invoices",
  Effect.fn(function* (handlers) {
    const issueInvoice = yield* makeIssueInvoice;
    return handlers.handle("issue", ({ params, payload }) =>
      Effect.flatMap(CurrentActor, (actor) =>
        issueInvoice(
          new IssueRequest({
            actor,
            invoiceId: params.invoiceId,
            versionSeen: payload.version,
            requestKey: Option.fromUndefinedOr(payload.requestKey),
          }),
        ),
      ),
    );
  }),
);

/** The endpoint's routes, needing `Invoices` and `OrganizationAccess`. */
export const ApiRoutes = HttpApiBuilder.layer(BillingApi, { openapiPath: "/openapi.json" }).pipe(Layer.provide(InvoicesApiHandlers), Layer.provide(OrganizationAuthorizationLive));
