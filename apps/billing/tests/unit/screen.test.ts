import { assert, describe, it } from "@effect/vitest";
import { DateTime, Effect, type Layer } from "effect";

import { readScreen, setClock, storedInvoice, TestLayer, today, visitScreen } from "../support/harness";

// What only the screen does: show one invoice, offer the one action a draft allows, and sign a person in.

const run = <A, E>(effect: Effect.Effect<A, E, Layer.Success<typeof TestLayer>>) => setClock(today).pipe(Effect.andThen(effect), Effect.provide(TestLayer));

describe("Invoice screen", () => {
  it.effect("shows a draft with its amounts and one action, issuing the version shown", () =>
    run(
      Effect.gen(function* () {
        const page = yield* visitScreen("GET", "/screen/invoices/D-1");
        assert.strictEqual(page.status, 200);
        assert.include(page.body, "<h1>Draft</h1>");
        assert.include(page.body, "Ada Lovelace Ltd");
        assert.include(page.body, "GB123456789");
        assert.include(page.body, "Standard (synthetic)");
        assert.include(page.body, "EUR 0.11");
        assert.include(page.body, "EUR 480.39");
        assert.include(page.body, 'name="version" value="1"');
        assert.include(page.body, "Issue invoice");
      }),
    ),
  );

  it.effect("shows an issued invoice read only, with its number and issue instant", () =>
    run(
      Effect.gen(function* () {
        const page = yield* visitScreen("GET", "/screen/invoices/I-1");
        assert.include(page.body, "<h1>Invoice 1</h1>");
        assert.include(page.body, "<dt>Issued at</dt>");
        assert.notInclude(page.body, "Issue invoice");
      }),
    ),
  );

  it.effect("omits the tax ID when the bill-to has none", () =>
    run(
      Effect.gen(function* () {
        const page = yield* visitScreen("GET", "/screen/invoices/D-4");
        assert.notInclude(page.body, "Tax ID");
        assert.include(page.body, "USD 1089.00");
      }),
    ),
  );

  it.effect("16. overdue is read from the due date, not stored", () =>
    Effect.gen(function* () {
      const before = yield* storedInvoice("I-1");
      yield* setClock(DateTime.makeUnsafe("2026-09-30T23:59:59Z"));
      assert.isFalse(readScreen(yield* visitScreen("GET", "/screen/invoices/I-1")).overdue);
      yield* setClock(DateTime.makeUnsafe("2026-10-01T00:00:00Z"));
      assert.isTrue(readScreen(yield* visitScreen("GET", "/screen/invoices/I-1")).overdue);
      assert.deepStrictEqual(yield* storedInvoice("I-1"), before);
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("pressing Issue invoice twice, or reloading after pressing it, issues once with one number", () =>
    run(
      Effect.gen(function* () {
        const page = yield* visitScreen("GET", "/screen/invoices/D-1");
        const requestKey = /name="requestKey" value="([^"]+)"/.exec(page.body)?.[1] ?? "";
        const press = visitScreen("POST", "/screen/invoices/D-1/issue", { form: { version: "1", requestKey } });
        const first = yield* press;
        const reload = yield* press;
        assert.include(first.body, "<h1>Invoice 3</h1>");
        assert.strictEqual(reload.body, first.body);
        const d1 = yield* storedInvoice("D-1");
        assert.isTrue(d1._tag === "Issued" && d1.number === 3);
      }),
    ),
  );

  it.effect("shows the current version after someone else changed the invoice, so the person can decide again", () =>
    run(
      Effect.gen(function* () {
        yield* visitScreen("POST", "/screen/invoices/D-1/issue", { form: { version: "1", requestKey: "someone-else" } });
        const stale = yield* visitScreen("POST", "/screen/invoices/D-1/issue", { form: { version: "1", requestKey: "mine" } });
        assert.strictEqual(readScreen(stale).outcome, "InvoiceChangedSinceSeen");
        assert.include(stale.body, "<h1>Invoice 3</h1>");
      }),
    ),
  );

  it.effect("sends a person who is not signed in to sign in, and tells them nothing about the invoice", () =>
    run(
      Effect.gen(function* () {
        const page = yield* visitScreen("GET", "/screen/invoices/D-1", { token: null });
        assert.strictEqual(page.status, 303);
        assert.strictEqual(page.headers.get("location"), "/screen/sign-in?next=%2Fscreen%2Finvoices%2FD-1");
        assert.notInclude(page.body, "Ada");
      }),
    ),
  );

  it.effect("signs in with a token that grants access, and refuses one that does not", () =>
    run(
      Effect.gen(function* () {
        const refused = yield* visitScreen("POST", "/screen/sign-in", { token: null, form: { token: "guess", next: "/screen/invoices/D-1" } });
        assert.strictEqual(refused.status, 403);
        assert.isNull(refused.headers.get("set-cookie"));

        const accepted = yield* visitScreen("POST", "/screen/sign-in", { token: null, form: { token: "ops-token", next: "/screen/invoices/D-1" } });
        assert.strictEqual(accepted.status, 303);
        assert.strictEqual(accepted.headers.get("location"), "/screen/invoices/D-1");
        assert.include(accepted.headers.get("set-cookie") ?? "", "HttpOnly");
        assert.include(accepted.headers.get("set-cookie") ?? "", "SameSite=Strict");
      }),
    ),
  );

  it.effect("never follows a sign-in to somewhere outside the screen", () =>
    run(
      Effect.gen(function* () {
        const accepted = yield* visitScreen("POST", "/screen/sign-in", { token: null, form: { token: "ops-token", next: "https://elsewhere.example/" } });
        assert.strictEqual(accepted.headers.get("location"), "/screen/sign-in");
      }),
    ),
  );

  it.effect("escapes what it shows", () =>
    run(
      Effect.gen(function* () {
        const page = yield* visitScreen("GET", "/screen/invoices/%3Cscript%3E");
        assert.strictEqual(page.status, 404);
        assert.notInclude(page.body, "<script>");
      }),
    ),
  );
});
