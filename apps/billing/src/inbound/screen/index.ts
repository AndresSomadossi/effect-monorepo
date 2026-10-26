import { DateTime, Effect, Option, Redacted, Schema } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";

import { InvoiceId, Invoices, IssueRequest, RequestKey, Version, viewOf } from "@repo/invoicing";

import { OrganizationAccess } from "#inbound/access/index";
import { makeIssueInvoice, reportUnexpected } from "#inbound/issue-invoice";
import { invoicePage, messagePage, signInPage } from "#inbound/screen/render";

/** The session cookie the screen reads the access token from. HttpOnly and SameSite=Strict, so other sites cannot send it. */
export const sessionCookie = "billing_access";

const htmlResponse = (status: number, body: string) => HttpServerResponse.text(body, { status, contentType: "text/html; charset=utf-8" });

/** What the screen tells the person after acting, by outcome. */
export const messages = {
  notAllowed: "You are not allowed to issue invoices.",
  notFound: "This invoice does not exist.",
  changed: "Someone changed this invoice while you were looking at it.",
  notDraft: "This invoice has already been issued (or paid, or voided).",
  noLines: "Add at least one line before issuing.",
  unknownCustomer: "This invoice's customer no longer exists.",
  cannotBeBilled: "This invoice's customer is archived and can no longer be billed.",
  keyReused: "This request was already used for a different one. Reload the invoice and try again.",
  inProgress: "Your earlier request is still being handled. Try again shortly.",
  somethingWentWrong: "Something went wrong. Try again.",
} as const;

const InvoicePath = Schema.Struct({ invoiceId: InvoiceId });

const IssueForm = Schema.Struct({
  version: Schema.NumberFromString.pipe(Schema.decodeTo(Version)),
  requestKey: RequestKey,
});

const SignInForm = Schema.Struct({ token: Schema.String, next: Schema.String });

/** Only paths of this screen are followed after sign-in, so the form cannot be used to send someone elsewhere. */
const safeNext = (next: string): string => (/^\/screen\/invoices\/[^/]+$/.test(next) ? next : "/screen/sign-in");

/** The Invoice screen's routes. Its services are resolved once, when the routes are built. */
export const ScreenRoutes = HttpRouter.use(
  Effect.fnUntraced(function* (router) {
    const invoices = yield* Invoices;
    const access = yield* OrganizationAccess;
    const issueInvoice = yield* makeIssueInvoice;

    /** The actor the session cookie acts for, if any. */
    const currentActor = Effect.gen(function* () {
      const token = (yield* HttpServerRequest.HttpServerRequest).cookies[sessionCookie];
      return token === undefined ? Option.none() : yield* access.actorFor(Redacted.make(token));
    });

    /** The invoice as it is now, with a notice above it. */
    const currentInvoice = (invoiceId: InvoiceId, status: number, notice: Option.Option<string>) =>
      Effect.gen(function* () {
        const invoice = yield* invoices.find(invoiceId);
        return htmlResponse(status, invoicePage(viewOf(invoice, yield* DateTime.now), notice));
      }).pipe(
        reportUnexpected,
        Effect.catchTags({
          InvoiceNotFound: () => Effect.succeed(htmlResponse(404, messagePage(messages.notFound))),
          SomethingWentWrong: () => Effect.succeed(htmlResponse(500, messagePage(messages.somethingWentWrong))),
        }),
      );

    yield* router.add(
      "GET",
      "/screen/invoices/:invoiceId",
      Effect.gen(function* () {
        const { invoiceId } = yield* HttpRouter.schemaPathParams(InvoicePath);
        if (Option.isNone(yield* currentActor)) {
          return HttpServerResponse.redirect(`/screen/sign-in?next=${encodeURIComponent(`/screen/invoices/${invoiceId}`)}`, { status: 303 });
        }
        return yield* currentInvoice(invoiceId, 200, Option.none());
      }).pipe(Effect.catchTag("SchemaError", () => Effect.succeed(htmlResponse(404, messagePage(messages.notFound))))),
    );

    yield* router.add(
      "POST",
      "/screen/invoices/:invoiceId/issue",
      Effect.gen(function* () {
        // Anyone not acting for the organization is refused before anything else is read, and learns nothing about the invoice.
        const actor = yield* currentActor;
        if (Option.isNone(actor)) {
          return htmlResponse(403, messagePage(messages.notAllowed));
        }
        const { invoiceId } = yield* HttpRouter.schemaPathParams(InvoicePath);
        const form = yield* HttpServerRequest.schemaBodyUrlParams(IssueForm);
        const request = new IssueRequest({ actor: actor.value, invoiceId, versionSeen: form.version, requestKey: Option.some(form.requestKey) });
        return yield* issueInvoice(request).pipe(
          Effect.map((view) => htmlResponse(200, invoicePage(view, Option.none()))),
          Effect.catchTags({
            InvoiceNotFound: () => Effect.succeed(htmlResponse(404, messagePage(messages.notFound))),
            InvoiceChangedSinceSeen: () => currentInvoice(invoiceId, 409, Option.some(messages.changed)),
            InvoiceNotDraft: () => currentInvoice(invoiceId, 409, Option.some(messages.notDraft)),
            InvoiceHasNoLines: () => currentInvoice(invoiceId, 422, Option.some(messages.noLines)),
            UnknownCustomer: () => currentInvoice(invoiceId, 422, Option.some(messages.unknownCustomer)),
            CustomerCannotBeBilled: () => currentInvoice(invoiceId, 422, Option.some(messages.cannotBeBilled)),
            RequestKeyReused: () => currentInvoice(invoiceId, 422, Option.some(messages.keyReused)),
            RequestStillInProgress: () => currentInvoice(invoiceId, 409, Option.some(messages.inProgress)),
            SomethingWentWrong: () => Effect.succeed(htmlResponse(500, messagePage(messages.somethingWentWrong))),
          }),
        );
      }).pipe(Effect.catchTags({ SchemaError: () => Effect.succeed(htmlResponse(400, messagePage(messages.somethingWentWrong))) })),
    );

    yield* router.add(
      "GET",
      "/screen/sign-in",
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const next = new URL(request.url, "http://screen.local").searchParams.get("next") ?? "";
        return htmlResponse(200, signInPage(safeNext(next), Option.none()));
      }),
    );

    yield* router.add(
      "POST",
      "/screen/sign-in",
      Effect.gen(function* () {
        const form = yield* HttpServerRequest.schemaBodyUrlParams(SignInForm);
        const actor = yield* access.actorFor(Redacted.make(form.token));
        if (Option.isNone(actor)) {
          return htmlResponse(403, signInPage(safeNext(form.next), Option.some(messages.notAllowed)));
        }
        return HttpServerResponse.redirect(safeNext(form.next), { status: 303 }).pipe(HttpServerResponse.setCookieUnsafe(sessionCookie, form.token, { httpOnly: true, sameSite: "strict", path: "/screen" }));
      }).pipe(Effect.catchTag("SchemaError", () => Effect.succeed(htmlResponse(400, signInPage("/screen/sign-in", Option.none()))))),
    );
  }),
);
