# Issue Invoice — Proof of Concept

A domain-only specification of one capability of the billing domain: **issuing a draft invoice**. It describes what the organization can do and what it is told, in the language of the Customers and Invoicing contexts. It deliberately says nothing about how it is built: no storage, protocol, framework, error encoding, library or layout choice is made here. Those are the implementation's to make, and are the point of comparison.

The proof of concept delivers this one capability twice:

- **One endpoint**, through which another system asks for a draft invoice to be issued.
- **One screen**, through which a person of the organization looks at one invoice and issues it.

Both must behave identically: same rules, same outcomes, same answer.

## Why this capability

Issuing is the moment a draft becomes a request for payment. It is where most of the domain's rules meet in one step: the lifecycle, totals and tax, the bill-to freeze, the gapless invoice number, the dependency on another context (Customers), the organization's clock, changes made at the same time by someone else, retries, and the announcement that an invoice was issued. A single capability is therefore enough to show how an approach handles expected outcomes, unexpected failures, dependencies and concurrency.

## Language

Use these words, and only these, in the code, the endpoint, the screen and the tests. The _Avoid_ words are synonyms the domain rejects.

### Customers context

**Customer** — A party the organization has a commercial relationship with and may bill. _Avoid_: client, account, user, payer.

**Display Name** — The name a customer is addressed by on everything sent to them.

**Email** — Where the customer is reached.

**Tax ID** — The identifier a tax authority assigns to a customer. Optional. _Avoid_: fiscal number, document.

**Archived** — A customer who can no longer be billed but is kept because existing invoices refer to them. Customers are archived, never deleted. _Avoid_: deleted, inactive, disabled.

### Invoicing context

**Invoice** — A request for payment of a stated total, in one currency, due by a stated date. _Avoid_: bill, receipt, charge.

**Bill-to** — The customer's display name, email and tax ID copied onto an invoice. Copied when the draft is created, copied again when it is issued, frozen from then on: later changes to the customer never alter an issued invoice. _Avoid_: billing address, recipient.

**Line** — One billed item: a description, a quantity (a positive whole number), a unit amount stated before tax, and a tax rate. _Avoid_: item, row, entry.

**Tax Rate** — A named percentage from a fixed catalog, applied to a line amount. _Avoid_: tax, VAT, levy.

**Line Amount** — A line's quantity times its unit amount, before tax.

**Line Tax** — A line amount times its tax rate, rounded on its own to a whole minor unit, an exact half rounded up.

**Subtotal** — The sum of the line amounts. _Avoid_: net, base amount.

**Tax Amount** — The sum of the line taxes. Never the tax of the subtotal. _Avoid_: tax total.

**Total** — Subtotal plus tax amount: what the customer owes. _Avoid_: grand total, balance, amount due.

**Amount** — A quantity of money in one currency, always a whole number of that currency's minor units (cents for EUR). Fractions of a minor unit never exist. _Avoid_: price, value, sum.

**Invoice Currency** — The one currency every amount on an invoice is stated in. An invoice never mixes currencies.

**Due Date** — The calendar date by which an issued invoice's total is expected to be paid. _Avoid_: deadline, expiry.

**Invoice Number** — The sequential, gapless identifier an invoice receives when it is issued: 1 for the first invoice the organization issues, then 2, 3 and so on, never skipping or repeating. Drafts have none. _Avoid_: invoice id, reference, folio.

**Version** — Which revision of an invoice someone is looking at. It starts at 1 and moves forward every time the invoice changes. A change is always made "to the version I saw".

### Lifecycle

**Draft** — An invoice still being prepared; it can be changed and has not been sent to anyone. _Avoid_: pending, unsent.

**Issued** — An invoice that has been sent and awaits payment; its content can no longer change. _Avoid_: sent, open, finalized.

**Paid** — An issued invoice settled by one payment of its full total.

**Void** — An invoice cancelled before being paid, from Draft or Issued. Kept for the record; nothing is owed. A voided issued invoice keeps its invoice number.

**Overdue** — An issued invoice whose due date has passed without payment. A due date passes at the end of that day in UTC: an invoice is not overdue on its due date, only from the next UTC day. Overdue is read from the due date, never a state of its own. _Avoid_: late, expired.

```
Draft ──issue──▶ Issued ──pay──▶ Paid
  │                │
  └──void──▶ Void ◀┘
```

Only the **issue** transition is built in this proof of concept.

### Announcement

**Invoice Issued** — The fact, announced by Invoicing to whoever is interested, that an invoice was issued. It states the invoice, its number, its customer, its currency, its total, its due date and the instant it was issued. Other parts of the organization (for example, the one that will remind the customer to pay on the due date) learn of issued invoices only through it.

## The tax rate catalog

Fixed configuration. These rates are synthetic, chosen to exercise rounding; they are no jurisdiction's rates.

| Tax rate | Name                 | Percentage |
| -------- | -------------------- | ---------- |
| standard | Standard (synthetic) | 21%        |
| reduced  | Reduced (synthetic)  | 10.5%      |
| exempt   | Exempt (synthetic)   | 0%         |

## The two contexts

Customers knows who the organization bills. Invoicing bills them. Invoicing never reaches into Customers: it asks one question, in its own words — **"what is the bill-to of this customer, if they can be billed today?"** — and gets back one of three answers: the bill-to, "no such customer", or "this customer can no longer be billed". How that question reaches Customers is the implementation's choice; that the two contexts stay independent is not.

## Issuing a draft

### Who may issue

Only someone acting on behalf of the organization. Anyone else is refused before anything else is checked, and learns nothing about the invoice.

### What is asked

- **Which invoice** to issue.
- **The version** of it the caller saw when deciding to issue it.
- Optionally, a **request key**: a label the caller chooses so that, if they are unsure whether their request arrived, they can send it again without the invoice being issued twice.

### The rules, in the order they are checked

1. **The invoice must exist.** Otherwise: _Invoice not found_.
2. **It must still be at the version the caller saw.** If someone changed it since, the caller must look again before deciding: _Invoice changed since it was seen_.
3. **It must be a draft.** An issued, paid or void invoice cannot be issued (again): _Invoice is not a draft_, stating which state it is in.
4. **It must have at least one line.** An invoice requests payment of what its lines charge: _Invoice has no lines_.
5. **Its customer must still exist.** Otherwise: _Unknown customer_.
6. **Its customer must still be billable** — not archived. Otherwise: _Customer cannot be billed_.

Each failed rule leaves the invoice exactly as it was: still a draft, same version, no number used.

### What issuing does

When every rule holds, at once and as one indivisible change:

- The **bill-to is copied again** from the customer as they are now, and frozen from here on.
- The invoice receives the **next invoice number**.
- It is stamped with the **instant it was issued**, read from the organization's clock (UTC).
- Its state becomes **Issued** and its **version moves forward by one**.

Then, and only once the issue is recorded, **Invoice Issued** is announced.

### The invoice number is gapless

- The first invoice the organization ever issues is number 1; each later one is the previous highest plus one.
- A number is only ever used by an issue that actually happened. An issue that is refused, or that fails for any reason before being recorded, uses no number.
- When two different drafts are issued at the same moment, each receives a different number, and together they still leave no gap.
- A voided issued invoice keeps its number; the next issue continues after it.

### Two people issuing the same draft at the same moment

Exactly one succeeds. The other is told _Invoice changed since it was seen_ (or, if it checks after the first is recorded, _Invoice is not a draft_). The draft is never issued twice and never receives two numbers.

### Retrying with a request key

- The same key sent again for the same request, within 24 hours: the caller receives the original answer again, and nothing happens a second time.
- The same key sent with a different request: refused, _Request key reused for a different request_.
- The same key sent while the first request is still being handled: _Request still in progress_; the caller may try again shortly.
- If the first request ended in an unexpected failure, the key is not held against the caller: sending it again tries the issue again.
- Keys belong to the caller; two callers may use the same key without affecting each other.
- With no key, every request is handled on its own.

### Unexpected failures

Anything that is not one of the outcomes above (for example, the place invoices are kept cannot be reached) is an **unexpected failure**. The caller is told only that something went wrong and that they may try again; nothing internal is revealed. The invoice is left either fully issued or fully as it was, never half issued.

The announcement is the one step after the issue is recorded. If the announcement cannot be made, the issue still stands; the implementation must say how it guarantees that **Invoice Issued** is eventually announced exactly once per issued invoice, or, if it does not, state that limit openly (see _Decisions left open_).

### The answer

On success the caller receives the issued invoice:

- its identity, state (Issued), invoice number and issue instant;
- its customer and its frozen bill-to;
- its currency and due date, and whether it is overdue today;
- each line with its description, quantity, unit amount, tax rate, line amount and line tax;
- its subtotal, tax amount and total;
- its new version.

On any refusal the caller receives which outcome it was, by name, plus the details that outcome states (for example, the state of an invoice that is not a draft). Outcomes are always distinguishable from one another by a machine, without reading prose.

### All outcomes

| Outcome                                     | When                                                       | Invoice afterwards              |
| ------------------------------------------- | ---------------------------------------------------------- | ------------------------------- |
| Issued                                      | Every rule holds                                           | Issued, numbered, next version  |
| Not allowed                                 | The caller does not act on behalf of the organization      | Unchanged                       |
| Invoice not found                           | No invoice has this identity                               | —                               |
| Invoice changed since it was seen           | The version given is not the current one, or a race lost   | Unchanged by this request       |
| Invoice is not a draft (states its state)   | Issued, paid or void                                       | Unchanged                       |
| Invoice has no lines                        | Draft without lines                                        | Unchanged                       |
| Unknown customer                            | The invoice's customer does not exist                      | Unchanged                       |
| Customer cannot be billed                   | The invoice's customer is archived                         | Unchanged                       |
| Request key reused for a different request  | Same key, different request                                | Unchanged by this request       |
| Request still in progress                   | Same key, first request not finished                       | Unchanged by this request       |
| Something went wrong                        | Any unexpected failure                                     | Fully issued or fully unchanged |

## The endpoint

One endpoint: **Issue an invoice**. It takes what is asked (invoice, version seen, optional request key), applies the rules above, and gives the answer above. How outcomes are encoded on the wire is the implementation's choice, as long as every outcome in the table is distinct and machine-readable, and the successful answer carries the new version so that the caller can make a later change to it.

## The screen

One screen: **Invoice**, showing one invoice, reached by its identity.

### What it shows

- A heading with the state, and the invoice number when it has one ("Draft" or "Invoice 3").
- **Bill to**: display name, email, and tax ID when there is one.
- Currency, due date, and an **Overdue** marker when the invoice is overdue today.
- The issue instant, once issued.
- The lines: description, quantity, unit amount, tax rate name, line amount, line tax.
- Subtotal, tax amount and total.

Amounts are shown in the currency's major units with the currency, e.g. `EUR 480.39`; they are never rounded for display beyond what the domain already rounded.

### What the person can do

- On a **Draft**: one action, **Issue invoice**. It always issues the version the person is looking at.
- On any other state: nothing; the screen is read only.

### What the person sees after acting

| Outcome                                        | The screen                                                                                     |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Issued                                         | The same invoice, now Issued, with its number, issue instant and refreshed bill-to; no action |
| Not allowed                                    | "You are not allowed to issue invoices." Invoice unchanged                                     |
| Invoice not found                              | "This invoice does not exist."                                                                 |
| Invoice changed since it was seen              | "Someone changed this invoice while you were looking at it." and the current version, so the person can decide again |
| Invoice is not a draft                         | "This invoice has already been issued (or paid, or voided)." and the current invoice           |
| Invoice has no lines                           | "Add at least one line before issuing."                                                        |
| Unknown customer                               | "This invoice's customer no longer exists."                                                    |
| Customer cannot be billed                      | "This invoice's customer is archived and can no longer be billed."                             |
| Something went wrong                           | "Something went wrong. Try again." Nothing internal is shown                                   |

Pressing **Issue invoice** twice quickly, or reloading after pressing it, never issues twice and never uses two numbers.

## The world the proof of concept starts with

Synthetic data only. The organization has already issued two invoices, so the next invoice number is **3**.

### Customers

| Customer | Display name     | Email                | Tax ID      | Archived |
| -------- | ---------------- | -------------------- | ----------- | -------- |
| Ada      | Ada Lovelace Ltd | billing@ada.example  | GB123456789 | No       |
| Grace    | Grace Hopper Co  | ap@grace.example     | —           | No       |
| Linus    | Linus Torvalds   | linus@linus.example  | —           | Yes      |

### Invoices

| Invoice | Customer | State  | Number | Currency | Due date   | Lines              | Notes                                                    |
| ------- | -------- | ------ | ------ | -------- | ---------- | ------------------ | -------------------------------------------------------- |
| I-1     | Ada      | Issued | 1      | EUR      | 2026-09-30 | one line           | Overdue                                                  |
| I-2     | Grace    | Void   | 2      | EUR      | 2026-10-31 | one line           | Voided after issue; keeps number 2                       |
| D-1     | Ada      | Draft  | —      | EUR      | 2026-11-30 | three lines, below | Its bill-to email was copied as `old@ada.example`        |
| D-2     | Grace    | Draft  | —      | EUR      | 2026-11-30 | none               |                                                          |
| D-3     | Linus    | Draft  | —      | EUR      | 2026-11-30 | one line           | Drafted before Linus was archived                        |
| D-4     | Grace    | Draft  | —      | USD      | 2026-12-15 | one line           | Used for the concurrent-issue scenario                   |

D-1's lines, and the totals every implementation must arrive at:

| Line             | Quantity | Unit amount | Tax rate | Line amount | Line tax                  |
| ---------------- | -------- | ----------- | -------- | ----------- | ------------------------- |
| Consulting hours | 3        | EUR 120.00  | standard | EUR 360.00  | EUR 75.60                 |
| Notebook         | 1        | EUR 0.50    | standard | EUR 0.50    | EUR 0.11 (0.105 → up)     |
| Books            | 2        | EUR 19.99   | reduced  | EUR 39.98   | EUR 4.20 (4.1979 → 4.20)  |
| **Subtotal**     |          |             |          | EUR 400.48  |                           |
| **Tax amount**   |          |             |          |             | EUR 79.91                 |
| **Total**        |          |             |          | EUR 480.39  |                           |

## Acceptance scenarios

Each holds through the endpoint and through the screen.

1. **Issuing a draft.** Given D-1 at the version just read, when it is issued, then it is Issued with number 3, issued at the organization's current instant, with subtotal EUR 400.48, tax amount EUR 79.91, total EUR 480.39, and its version moved forward by one.
2. **The bill-to is refreshed, then frozen.** Given D-1's bill-to email is `old@ada.example` and Ada's email is now `billing@ada.example`, when D-1 is issued, then its bill-to email is `billing@ada.example`. When Ada's email later changes again, D-1's bill-to does not.
3. **The announcement.** When D-1 is issued, then **Invoice Issued** is announced once, with number 3, customer Ada, currency EUR, total EUR 480.39, due date 2026-11-30 and the issue instant. When any rule refuses an issue, nothing is announced.
4. **Numbers continue past a void.** Given invoice 2 was voided, the next issue receives 3, not 2.
5. **No lines.** When D-2 is issued, the outcome is _Invoice has no lines_; D-2 stays a draft at the same version, and the next issue still receives the next unused number.
6. **Archived customer.** When D-3 is issued, the outcome is _Customer cannot be billed_; D-3 stays a draft.
7. **Not a draft.** When I-1 is issued at its current version, the outcome is _Invoice is not a draft_, stating Issued.
8. **Stale version.** Given someone else changed D-1 after it was read, when it is issued at the old version, the outcome is _Invoice changed since it was seen_ and D-1 is not issued.
9. **Same draft, same moment.** When D-4 is issued twice at the same moment at the same version, exactly one succeeds and receives a number; the other is refused; D-4 holds one number only.
10. **Different drafts, same moment.** When D-1 and D-4 are issued at the same moment, they receive 3 and 4 in some order, and no number is skipped or repeated.
11. **Retry with a key.** When D-1 is issued with key `k-1` and the request is sent again with `k-1`, the second answer is the first answer, D-1 holds number 3, and **Invoice Issued** was announced once.
12. **Key reused.** When D-2 is then issued with key `k-1`, the outcome is _Request key reused for a different request_.
13. **Unknown invoice.** When an invoice that does not exist is issued, the outcome is _Invoice not found_.
14. **Not allowed.** When someone not acting for the organization issues D-1, the outcome is _Not allowed_ and D-1 is unchanged.
15. **Unexpected failure.** Given the place invoices are kept cannot be reached, when D-1 is issued, the caller is told something went wrong, and once that place is reachable again D-1 is either still a draft with no number used, or issued exactly once.
16. **Overdue is read, not stored.** I-1 (due 2026-09-30) shows as overdue on 2026-10-01 and after, not on 2026-09-30; nothing on I-1 changed for that to be so.
17. **Rounding is per line.** D-1's tax amount is the sum of each line's rounded tax (EUR 79.91), not the tax of the subtotal.

## Out of scope

Creating, editing, paying, voiding or listing invoices; registering, changing or archiving customers; sending or scheduling payment reminders; anything that consumes **Invoice Issued**; more than one organization; currency conversion; credit notes. The world above is put in place by whatever means the implementation prefers; doing so is not a capability of the proof of concept.

## Decisions left open

These are not decided by this spec, on purpose. Each implementation decides them and states what it chose, so the comparison can look at the choice:

- How invoices, customers, numbers and request keys are kept.
- How the endpoint encodes requests, outcomes and the version.
- How the screen obtains the invoice it shows and performs the issue.
- How Invoicing asks Customers its one question.
- How **Invoice Issued** is announced, and what guarantee it has when announcing fails after the issue is recorded.
- How "acting on behalf of the organization" is established.
- How the organization's clock is read, and how tests control it.
- How the work is observed (what was asked, what happened, how long it took) and how failures are reported internally.
