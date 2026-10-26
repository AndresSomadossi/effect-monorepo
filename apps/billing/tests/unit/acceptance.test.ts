import { assert, describe, it } from "@effect/vitest";
import { DateTime, Effect, HashMap, type Layer, Option, PubSub, Ref, type Scope } from "effect";

import { Customer, CustomerId, MemoryCustomerStore } from "@repo/customers";
import { AnnouncementRelay, DraftInvoice, InvoiceId, MemoryInvoiceStore, PubSubInvoiceIssuedAnnouncer, Version } from "@repo/invoicing";

import { drivers, lastNumber, Reachability, readScreen, setClock, storedInvoice, TestLayer, today, tokens, visitScreen } from "../support/harness";

// The spec's acceptance scenarios. Each holds through the endpoint and through the screen.

/** Subscribes to Invoice Issued before acting, and reads what was announced afterwards. */
const announcements = Effect.gen(function* () {
  const subscription = yield* PubSub.subscribe(yield* PubSubInvoiceIssuedAnnouncer.InvoiceIssuedFeed);
  // Everything announced so far, without waiting for more.
  return PubSub.takeUpTo(subscription, 1_000);
});

for (const driver of drivers) {
  describe(`Issue invoice through the ${driver.name}`, () => {
    const scenario = (name: string, body: () => Effect.Effect<void, never, Layer.Success<typeof TestLayer> | Scope.Scope>) => it.effect(name, () => setClock(today).pipe(Effect.andThen(body()), Effect.scoped, Effect.provide(TestLayer)));

    scenario("1. issuing a draft", () =>
      Effect.gen(function* () {
        const answer = yield* driver.issue({ invoiceId: "D-1", version: 1 });
        assert.strictEqual(answer.outcome, "Issued");
        assert.deepStrictEqual(answer.number, Option.some(3));
        assert.strictEqual(answer.state, "Issued");
        assert.strictEqual(answer.issuedAt, DateTime.formatIso(today));
        assert.strictEqual(answer.subtotal, "EUR 400.48");
        assert.strictEqual(answer.taxAmount, "EUR 79.91");
        assert.strictEqual(answer.total, "EUR 480.39");

        const stored = yield* storedInvoice("D-1");
        assert.strictEqual(stored._tag, "Issued");
        assert.strictEqual(stored.version, 2);
        assert.isTrue(stored._tag === "Issued" && DateTime.Equivalence(stored.issuedAt, today));
      }),
    );

    scenario("2. the bill-to is refreshed, then frozen", () =>
      Effect.gen(function* () {
        assert.strictEqual((yield* storedInvoice("D-1")).billTo.email, "old@ada.example");
        const answer = yield* driver.issue({ invoiceId: "D-1", version: 1 });
        assert.strictEqual(answer.billToEmail, "billing@ada.example");

        const customers = yield* MemoryCustomerStore.CustomerRecords;
        yield* Ref.update(
          customers,
          HashMap.modify(CustomerId.make("Ada"), (ada) => new Customer({ ...ada, email: "accounts@ada.example" })),
        );
        assert.strictEqual((yield* storedInvoice("D-1")).billTo.email, "billing@ada.example");
        const shown = readScreen(yield* visitScreen("GET", "/screen/invoices/D-1"));
        assert.strictEqual(shown.billToEmail, "billing@ada.example");
      }),
    );

    scenario("3. the announcement, once, and none when refused", () =>
      Effect.gen(function* () {
        const announced = yield* announcements;
        yield* driver.issue({ invoiceId: "D-2", version: 1 });
        yield* driver.issue({ invoiceId: "D-1", version: 1 });
        const events = yield* announced;
        assert.strictEqual(events.length, 1);
        const [event] = events;
        assert.strictEqual(event?.invoiceId, "D-1");
        assert.strictEqual(event?.number, 3);
        assert.strictEqual(event?.customerId, "Ada");
        assert.strictEqual(event?.currency, "EUR");
        assert.strictEqual(event?.total, 480_39);
        assert.strictEqual(event?.dueDate, "2026-11-30");
        assert.isTrue(event !== undefined && DateTime.Equivalence(event.issuedAt, today));
      }),
    );

    scenario("4. numbers continue past a void", () =>
      Effect.gen(function* () {
        assert.strictEqual((yield* storedInvoice("I-2"))._tag, "Void");
        const answer = yield* driver.issue({ invoiceId: "D-1", version: 1 });
        assert.deepStrictEqual(answer.number, Option.some(3));
      }),
    );

    scenario("5. no lines", () =>
      Effect.gen(function* () {
        const answer = yield* driver.issue({ invoiceId: "D-2", version: 1 });
        assert.strictEqual(answer.outcome, "InvoiceHasNoLines");
        const d2 = yield* storedInvoice("D-2");
        assert.strictEqual(d2._tag, "Draft");
        assert.strictEqual(d2.version, 1);
        assert.strictEqual(yield* lastNumber, 2);
        assert.deepStrictEqual((yield* driver.issue({ invoiceId: "D-1", version: 1 })).number, Option.some(3));
      }),
    );

    scenario("6. archived customer", () =>
      Effect.gen(function* () {
        const answer = yield* driver.issue({ invoiceId: "D-3", version: 1 });
        assert.strictEqual(answer.outcome, "CustomerCannotBeBilled");
        assert.strictEqual((yield* storedInvoice("D-3"))._tag, "Draft");
      }),
    );

    scenario("unknown customer", () =>
      Effect.gen(function* () {
        const customers = yield* MemoryCustomerStore.CustomerRecords;
        yield* Ref.update(customers, HashMap.remove(CustomerId.make("Grace")));
        const answer = yield* driver.issue({ invoiceId: "D-4", version: 1 });
        assert.strictEqual(answer.outcome, "UnknownCustomer");
        assert.strictEqual((yield* storedInvoice("D-4"))._tag, "Draft");
      }),
    );

    scenario("7. not a draft, stating Issued", () =>
      Effect.gen(function* () {
        const answer = yield* driver.issue({ invoiceId: "I-1", version: 2 });
        assert.strictEqual(answer.outcome, "InvoiceNotDraft");
        assert.strictEqual(answer.state, "Issued");
      }),
    );

    scenario("8. stale version", () =>
      Effect.gen(function* () {
        // Someone else changes D-1 after it was read: its version moves forward.
        const records = yield* MemoryInvoiceStore.InvoiceRecords;
        yield* Ref.update(records, (state) => ({
          ...state,
          invoices: HashMap.modify(state.invoices, InvoiceId.make("D-1"), (d1) => (d1._tag === "Draft" ? new DraftInvoice({ ...d1, version: Version.make(2) }) : d1)),
        }));
        const answer = yield* driver.issue({ invoiceId: "D-1", version: 1 });
        assert.strictEqual(answer.outcome, "InvoiceChangedSinceSeen");
        assert.strictEqual((yield* storedInvoice("D-1"))._tag, "Draft");
        assert.strictEqual(yield* lastNumber, 2);
      }),
    );

    scenario("9. same draft, same moment: exactly one succeeds", () =>
      Effect.gen(function* () {
        const answers = yield* Effect.all([driver.issue({ invoiceId: "D-4", version: 1, token: tokens.ops }), driver.issue({ invoiceId: "D-4", version: 1, token: tokens.partner })], { concurrency: "unbounded" });
        const outcomes = answers.map((answer) => answer.outcome).sort();
        assert.strictEqual(outcomes.filter((outcome) => outcome === "Issued").length, 1);
        assert.isTrue(outcomes.some((outcome) => outcome === "InvoiceChangedSinceSeen" || outcome === "InvoiceNotDraft"));
        const d4 = yield* storedInvoice("D-4");
        assert.isTrue(d4._tag === "Issued" && d4.number === 3);
        assert.strictEqual(yield* lastNumber, 3);
      }),
    );

    scenario("10. different drafts, same moment: no number skipped or repeated", () =>
      Effect.gen(function* () {
        const answers = yield* Effect.all([driver.issue({ invoiceId: "D-1", version: 1 }), driver.issue({ invoiceId: "D-4", version: 1 })], { concurrency: "unbounded" });
        const numbers = answers.map((answer) => Option.getOrThrow(answer.number)).sort();
        assert.deepStrictEqual(numbers, [3, 4]);
        assert.strictEqual(yield* lastNumber, 4);
      }),
    );

    scenario("11. retry with a key", () =>
      Effect.gen(function* () {
        const announced = yield* announcements;
        const first = yield* driver.issue({ invoiceId: "D-1", version: 1, requestKey: "k-1" });
        const second = yield* driver.issue({ invoiceId: "D-1", version: 1, requestKey: "k-1" });
        assert.strictEqual(first.outcome, "Issued");
        assert.deepStrictEqual(second.raw, first.raw);
        const d1 = yield* storedInvoice("D-1");
        assert.isTrue(d1._tag === "Issued" && d1.number === 3);
        assert.strictEqual((yield* announced).length, 1);
      }),
    );

    scenario("12. key reused for a different request", () =>
      Effect.gen(function* () {
        yield* driver.issue({ invoiceId: "D-1", version: 1, requestKey: "k-1" });
        const answer = yield* driver.issue({ invoiceId: "D-2", version: 1, requestKey: "k-1" });
        assert.strictEqual(answer.outcome, "RequestKeyReused");
      }),
    );

    scenario("keys belong to the caller", () =>
      Effect.gen(function* () {
        yield* driver.issue({ invoiceId: "D-1", version: 1, requestKey: "k-1", token: tokens.ops });
        const answer = yield* driver.issue({ invoiceId: "D-4", version: 1, requestKey: "k-1", token: tokens.partner });
        assert.strictEqual(answer.outcome, "Issued");
        assert.deepStrictEqual(answer.number, Option.some(4));
      }),
    );

    scenario("13. unknown invoice", () =>
      Effect.gen(function* () {
        const answer = yield* driver.issue({ invoiceId: "D-99", version: 1 });
        assert.strictEqual(answer.outcome, "InvoiceNotFound");
      }),
    );

    scenario("14. not allowed, whether no token or one that grants nothing", () =>
      Effect.gen(function* () {
        assert.strictEqual((yield* driver.issue({ invoiceId: "D-1", version: 1, token: null })).outcome, "NotAllowed");
        assert.strictEqual((yield* driver.issue({ invoiceId: "D-1", version: 1, token: "stolen-guess" })).outcome, "NotAllowed");
        // Refused before anything else: an invoice that does not exist is not revealed either.
        assert.strictEqual((yield* driver.issue({ invoiceId: "D-99", version: 1, token: null })).outcome, "NotAllowed");
        const d1 = yield* storedInvoice("D-1");
        assert.strictEqual(d1._tag, "Draft");
        assert.strictEqual(d1.version, 1);
      }),
    );

    scenario("15. unexpected failure: told something went wrong, never half issued", () =>
      Effect.gen(function* () {
        const reachability = yield* Reachability;
        yield* Ref.set(reachability.invoiceStore, false);
        const failed = yield* driver.issue({ invoiceId: "D-1", version: 1, requestKey: "k-15" });
        assert.strictEqual(failed.outcome, "SomethingWentWrong");
        assert.isFalse(JSON.stringify(failed.raw).includes("cannot be reached"));

        yield* Ref.set(reachability.invoiceStore, true);
        assert.strictEqual((yield* storedInvoice("D-1"))._tag, "Draft");
        assert.strictEqual(yield* lastNumber, 2);
        // The key is not held against the caller after an unexpected failure: sending it again tries again.
        const retried = yield* driver.issue({ invoiceId: "D-1", version: 1, requestKey: "k-15" });
        assert.deepStrictEqual(retried.number, Option.some(3));
      }),
    );

    scenario("an announcement that cannot be made does not undo the issue, and is made later", () =>
      Effect.gen(function* () {
        const announced = yield* announcements;
        const reachability = yield* Reachability;
        yield* Ref.set(reachability.announcer, false);
        const answer = yield* driver.issue({ invoiceId: "D-1", version: 1 });
        assert.strictEqual(answer.outcome, "Issued");
        assert.strictEqual((yield* announced).length, 0);

        yield* Ref.set(reachability.announcer, true);
        yield* (yield* AnnouncementRelay).announcePending;
        yield* (yield* AnnouncementRelay).announcePending;
        assert.strictEqual((yield* announced).length, 1);
      }),
    );

    scenario("17. rounding is per line", () =>
      Effect.gen(function* () {
        const answer = yield* driver.issue({ invoiceId: "D-1", version: 1 });
        assert.strictEqual(answer.taxAmount, "EUR 79.91");
      }),
    );
  });
}
