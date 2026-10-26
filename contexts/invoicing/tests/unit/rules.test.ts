import { assert, describe, it } from "@effect/vitest";
import { DateTime, Option, Result } from "effect";

import { Amount, BillTo, CalendarDate, CustomerId, DraftInvoice, InvoiceId, InvoiceNumber, isOverdue, Line, lineTax, totalsOf, Version } from "#index";
import { checkIssuable, invoiceIssuedOf, issueDraft } from "#lib/issue/index";

const line = (description: string, quantity: number, unitAmount: number, taxRate: Line["taxRate"]) => new Line({ description, quantity, unitAmount: Amount.make(unitAmount), taxRate });

const d1Lines = [line("Consulting hours", 3, 120_00, "standard"), line("Notebook", 1, 50, "standard"), line("Books", 2, 19_99, "reduced")];

const draft = (fields: Partial<ConstructorParameters<typeof DraftInvoice>[0]> = {}) =>
  new DraftInvoice({
    id: InvoiceId.make("D-1"),
    version: Version.make(1),
    customerId: CustomerId.make("Ada"),
    billTo: new BillTo({ displayName: "Ada Lovelace Ltd", email: "old@ada.example", taxId: Option.some("GB123456789") }),
    currency: "EUR",
    dueDate: CalendarDate.make("2026-11-30"),
    lines: d1Lines,
    ...fields,
  });

const issuedFrom = (invoice: DraftInvoice) => issueDraft(invoice, { number: InvoiceNumber.make(1), billTo: invoice.billTo, issuedAt: DateTime.makeUnsafe("2026-09-01T00:00:00Z") });

describe("totals", () => {
  it("rounds each line's tax on its own, an exact half up", () => {
    assert.deepStrictEqual(d1Lines.map(lineTax), [Amount.make(75_60), Amount.make(11), Amount.make(4_20)]);
  });

  it("states D-1's subtotal, tax amount and total", () => {
    assert.deepStrictEqual(totalsOf(d1Lines), { subtotal: Amount.make(400_48), taxAmount: Amount.make(79_91), total: Amount.make(480_39) });
  });

  it("sums the line taxes, never the tax of the subtotal", () => {
    // Each 0.50 line taxes 0.105 → 0.11, so the tax amount is 0.22; 21% of the 1.00 subtotal would be 0.21.
    const lines = [line("A", 1, 50, "standard"), line("B", 1, 50, "standard")];
    assert.deepStrictEqual(totalsOf(lines), { subtotal: Amount.make(1_00), taxAmount: Amount.make(22), total: Amount.make(1_22) });
  });

  it("has nothing to tax on an exempt line", () => {
    assert.strictEqual(lineTax(line("A", 7, 13_33, "exempt")), Amount.make(0));
  });

  it("is zero for no lines", () => {
    assert.deepStrictEqual(totalsOf([]), { subtotal: Amount.make(0), taxAmount: Amount.make(0), total: Amount.make(0) });
  });
});

describe("overdue", () => {
  const issued = issuedFrom(draft({ dueDate: CalendarDate.make("2026-09-30") }));

  it("is not overdue on its due date, even at its last instant in UTC", () => {
    assert.isFalse(isOverdue(issued, DateTime.makeUnsafe("2026-09-30T23:59:59.999Z")));
  });

  it("is overdue from the next UTC day", () => {
    assert.isTrue(isOverdue(issued, DateTime.makeUnsafe("2026-10-01T00:00:00Z")));
    assert.isTrue(isOverdue(issued, DateTime.makeUnsafe("2027-01-01T00:00:00Z")));
  });

  it("only applies to issued invoices", () => {
    assert.isFalse(isOverdue(draft({ dueDate: CalendarDate.make("2026-09-30") }), DateTime.makeUnsafe("2026-10-01T00:00:00Z")));
  });
});

describe("checkIssuable", () => {
  it("accepts a draft with lines at the version seen", () => {
    assert.isTrue(Result.isSuccess(checkIssuable(draft(), Version.make(1))));
  });

  it("checks the version before the state", () => {
    const result = checkIssuable(issuedFrom(draft()), Version.make(1));
    assert.isTrue(Result.isFailure(result) && result.failure._tag === "InvoiceChangedSinceSeen");
  });

  it("refuses an invoice that is not a draft, stating its state", () => {
    const result = checkIssuable(issuedFrom(draft()), Version.make(2));
    assert.isTrue(Result.isFailure(result) && result.failure._tag === "InvoiceNotDraft" && result.failure.state === "Issued");
  });

  it("refuses a draft with no lines", () => {
    const result = checkIssuable(draft({ lines: [] }), Version.make(1));
    assert.isTrue(Result.isFailure(result) && result.failure._tag === "InvoiceHasNoLines");
  });
});

describe("issueDraft", () => {
  it("refreshes the bill-to, numbers and stamps the invoice, and moves its version forward by one", () => {
    const billTo = new BillTo({ displayName: "Ada Lovelace Ltd", email: "billing@ada.example", taxId: Option.some("GB123456789") });
    const issuedAt = DateTime.makeUnsafe("2026-10-25T12:00:00Z");
    const issued = issueDraft(draft(), { number: InvoiceNumber.make(3), billTo, issuedAt });
    assert.strictEqual(issued._tag, "Issued");
    assert.strictEqual(issued.number, 3);
    assert.strictEqual(issued.version, 2);
    assert.strictEqual(issued.billTo.email, "billing@ada.example");
    assert.deepStrictEqual(issued.issuedAt, issuedAt);

    const announcement = invoiceIssuedOf(issued);
    assert.strictEqual(announcement.total, 480_39);
    assert.strictEqual(announcement.number, 3);
    assert.strictEqual(announcement.dueDate, "2026-11-30");
  });
});
