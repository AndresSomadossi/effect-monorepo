import { Context, DateTime, Effect, HashMap, Layer, Option, Ref, Schema } from "effect";
import { HttpClientRequest, HttpRouter, HttpServer, HttpServerRequest, HttpServerResponse } from "effect/http";
import { HttpApiMiddleware, HttpApiTest } from "effect/http-api";
import { TestClock } from "effect/testing";

import { InvoiceId, InvoiceIssuedAnnouncer, InvoiceStore, MemoryInvoiceStore, PubSubInvoiceIssuedAnnouncer, RequestKey, Version } from "@repo/invoicing";

import { makeContexts } from "#composition/index";
import { world } from "#composition/world";
import { BillingApi, OrganizationAuthorization } from "#contracts/index";
import { AccessGrants, OrganizationAccess } from "#inbound/access/index";
import { InvoicesApiHandlers, OrganizationAuthorizationLive } from "#inbound/http/index";
import { messages, ScreenRoutes, sessionCookie } from "#inbound/screen/index";
import { formatAmount } from "#inbound/screen/render";

// Drives the proof of concept through its endpoint and its screen, in process, with the organization's clock under test control.

export const tokens = { ops: "ops-token", partner: "partner-token" } as const;

const AccessLayer = OrganizationAccess.layer(Schema.decodeUnknownSync(AccessGrants)({ ops: tokens.ops, partner: tokens.partner }));

/** Whether the place invoices are kept, or the announcement feed, can be reached. Flipped by tests. */
export class Reachability extends Context.Service<Reachability, { readonly invoiceStore: Ref.Ref<boolean>; readonly announcer: Ref.Ref<boolean> }>()("test/Reachability") {
  static readonly layer = Layer.effect(Reachability, Effect.all({ invoiceStore: Ref.make(true), announcer: Ref.make(true) }));
}

const whenReachable =
  (pick: (reachability: Reachability["Service"]) => Ref.Ref<boolean>, reachability: Reachability["Service"]) =>
  <A, E>(effect: Effect.Effect<A, E>): Effect.Effect<A, E> =>
    Effect.flatMap(Ref.get(pick(reachability)), (reachable) => (reachable ? effect : Effect.die(new Error("cannot be reached"))));

const FlakyInvoiceStore = Layer.effect(
  InvoiceStore,
  Effect.gen(function* () {
    const inner = yield* MemoryInvoiceStore.make;
    const guard = whenReachable((reachability) => reachability.invoiceStore, yield* Reachability);
    return InvoiceStore.of({
      find: (id) => guard(inner.find(id)),
      recordIssue: (issue) => guard(inner.recordIssue(issue)),
      pendingAnnouncements: guard(inner.pendingAnnouncements),
      markAnnounced: (id) => guard(inner.markAnnounced(id)),
    });
  }),
).pipe(Layer.provideMerge(MemoryInvoiceStore.InvoiceRecords.layer(world)), Layer.provide(Reachability.layer));

const FlakyAnnouncer = Layer.effect(
  InvoiceIssuedAnnouncer,
  Effect.gen(function* () {
    const inner = yield* PubSubInvoiceIssuedAnnouncer.make;
    const guard = whenReachable((reachability) => reachability.announcer, yield* Reachability);
    return InvoiceIssuedAnnouncer.of({ announce: (event) => guard(inner.announce(event)) });
  }),
).pipe(Layer.provideMerge(PubSubInvoiceIssuedAnnouncer.InvoiceIssuedFeed.layer), Layer.provide(Reachability.layer));

/**
 * A fresh world per test: both contexts in memory, the endpoint's handlers and middleware, the screen's access, and stores that can be
 * made unreachable. `Reachability.layer` is the same layer value everywhere, so one build shares one instance of it.
 */
export const TestLayer = Layer.mergeAll(InvoicesApiHandlers.pipe(Layer.provideMerge(OrganizationAuthorizationLive)), HttpServer.layerServices).pipe(
  Layer.provideMerge(Layer.mergeAll(makeContexts(world, { invoiceStore: FlakyInvoiceStore, announcer: FlakyAnnouncer }), AccessLayer, Reachability.layer)),
);

/** The organization's current instant in the tests. */
export const today = DateTime.makeUnsafe("2026-10-25T12:00:00Z");

export const setClock = (instant: DateTime.Utc) => TestClock.setTime(DateTime.toEpochMillis(instant));

/** An answer, read the same way from the endpoint and from the screen. */
export interface Answer {
  /** `Issued`, or the refusal's tag. */
  readonly outcome: string;
  readonly number: Option.Option<number>;
  readonly state?: string | undefined;
  readonly subtotal?: string | undefined;
  readonly taxAmount?: string | undefined;
  readonly total?: string | undefined;
  readonly billToEmail?: string | undefined;
  readonly issuedAt?: string | undefined;
  readonly overdue?: boolean | undefined;
  /** The answer as received, to compare two answers whole. */
  readonly raw: unknown;
}

export interface IssueInput {
  readonly invoiceId: string;
  readonly version: number;
  readonly requestKey?: string;
  /** The caller's token; `null` sends none. Defaults to ops. */
  readonly token?: string | null;
}

export interface Driver {
  readonly name: string;
  issue(input: IssueInput): Effect.Effect<Answer, never, Layer.Success<typeof TestLayer>>;
}

const tokenOf = (input: { readonly token?: string | null }): string | null => (input.token === undefined ? tokens.ops : input.token);

export const endpoint: Driver = {
  name: "endpoint",
  issue: (input) =>
    Effect.gen(function* () {
      const client = yield* HttpApiTest.groups(BillingApi, ["invoices"]);
      return yield* client.invoices
        .issue({
          params: { invoiceId: InvoiceId.make(input.invoiceId) },
          payload: { version: Version.make(input.version), ...(input.requestKey === undefined ? {} : { requestKey: RequestKey.make(input.requestKey) }) },
        })
        .pipe(
          Effect.map(
            (view): Answer => ({
              outcome: "Issued",
              number: view.number,
              state: view.state,
              subtotal: formatAmount(view.currency, view.subtotal),
              taxAmount: formatAmount(view.currency, view.taxAmount),
              total: formatAmount(view.currency, view.total),
              billToEmail: view.billTo.email,
              issuedAt: Option.getOrUndefined(Option.map(view.issuedAt, DateTime.formatIso)),
              overdue: view.overdue,
              raw: view,
            }),
          ),
          Effect.catch((error) => Effect.succeed<Answer>({ outcome: error._tag, number: Option.none(), state: error._tag === "InvoiceNotDraft" ? error.state : undefined, raw: error })),
        );
    }).pipe(
      Effect.provide(
        HttpApiMiddleware.layerClient(OrganizationAuthorization, ({ next, request }) => {
          const token = tokenOf(input);
          return next(token === null ? request : HttpClientRequest.bearerToken(request, token));
        }),
      ),
      Effect.scoped,
    ),
};

/** Sends one request to the screen's routes and reads the response. */
export const visitScreen = (method: "GET" | "POST", path: string, options: { readonly token?: string | null; readonly form?: Record<string, string> } = {}) =>
  Effect.gen(function* () {
    const headers = new Headers();
    const token = tokenOf(options);
    if (token !== null) {
      headers.set("cookie", `${sessionCookie}=${token}`);
    }
    if (options.form !== undefined) {
      headers.set("content-type", "application/x-www-form-urlencoded");
    }
    const request = new Request(`http://screen.test${path}`, { method, headers, ...(options.form === undefined ? {} : { body: new URLSearchParams(options.form).toString() }) });
    const handle = yield* HttpRouter.toHttpEffect(ScreenRoutes);
    const response = HttpServerResponse.toWeb(yield* handle.pipe(Effect.provideService(HttpServerRequest.HttpServerRequest, HttpServerRequest.fromWeb(request))));
    const body = yield* Effect.promise(() => response.text());
    return { status: response.status, headers: response.headers, body };
  }).pipe(Effect.orDie, Effect.scoped);

const unescapeHtml = (text: string): string => text.replaceAll("&#39;", "'").replaceAll("&quot;", '"').replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");

const outcomeOfMessage = new Map<string, string>([
  [messages.notAllowed, "NotAllowed"],
  [messages.notFound, "InvoiceNotFound"],
  [messages.changed, "InvoiceChangedSinceSeen"],
  [messages.notDraft, "InvoiceNotDraft"],
  [messages.noLines, "InvoiceHasNoLines"],
  [messages.unknownCustomer, "UnknownCustomer"],
  [messages.cannotBeBilled, "CustomerCannotBeBilled"],
  [messages.keyReused, "RequestKeyReused"],
  [messages.inProgress, "RequestStillInProgress"],
  [messages.somethingWentWrong, "SomethingWentWrong"],
]);

/** Reads what the screen shows into an `Answer`: the notice names the outcome, its absence after an issue means Issued. */
export const readScreen = ({ status, body }: { readonly status: number; readonly body: string }): Answer => {
  const find = (pattern: RegExp) => {
    const found = pattern.exec(body)?.[1];
    return found === undefined ? undefined : unescapeHtml(found);
  };
  const notice = find(/<p class="notice" role="alert">(.*?)<\/p>/);
  return {
    outcome: notice === undefined ? (status === 200 ? "Issued" : `HTTP ${status}`) : (outcomeOfMessage.get(notice) ?? `Unknown notice: ${notice}`),
    number: Option.map(Option.fromUndefinedOr(find(/<h1>Invoice (\d+)<\/h1>/)), Number),
    state: find(/<p class="state">(\w+)/),
    subtotal: find(/<td colspan="5">Subtotal<\/td><td class="num">(.*?)<\/td>/),
    taxAmount: find(/<td colspan="5">Tax amount<\/td><td class="num">(.*?)<\/td>/),
    total: find(/<td colspan="5">Total<\/td><td class="num">(.*?)<\/td>/),
    billToEmail: find(/<dt>Email<\/dt><dd>(.*?)<\/dd>/),
    issuedAt: find(/<dt>Issued at<\/dt><dd>(.*?)<\/dd>/),
    overdue: body.includes('class="overdue"'),
    raw: body,
  };
};

export const screen: Driver = {
  name: "screen",
  issue: (input) =>
    visitScreen("POST", `/screen/invoices/${encodeURIComponent(input.invoiceId)}/issue`, {
      ...(input.token === undefined ? {} : { token: input.token }),
      // The screen always sends a request key: the one its form carries, unless the scenario names one.
      form: { version: String(input.version), requestKey: input.requestKey ?? `screen:${input.invoiceId}:v${input.version}` },
    }).pipe(Effect.map(readScreen)),
};

export const drivers: ReadonlyArray<Driver> = [endpoint, screen];

/** The invoice as it is kept now. */
export const storedInvoice = (id: string) =>
  Effect.gen(function* () {
    const state = yield* Ref.get(yield* MemoryInvoiceStore.InvoiceRecords);
    return Option.getOrThrow(HashMap.get(state.invoices, InvoiceId.make(id)));
  });

/** The highest invoice number used so far. */
export const lastNumber = Effect.gen(function* () {
  const state = yield* Ref.get(yield* MemoryInvoiceStore.InvoiceRecords);
  return state.lastNumber;
});
