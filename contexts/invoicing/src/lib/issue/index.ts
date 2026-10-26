import { type DateTime, Result } from "effect";

import { type BillTo, type DraftInvoice, type Invoice, type InvoiceNumber, IssuedInvoice, Version } from "#entities/invoice/index";
import { InvoiceIssued } from "#entities/invoice-issued/index";
import { InvoiceChangedSinceSeen, InvoiceHasNoLines, InvoiceNotDraft } from "#entities/refusals/index";
import { totalsOf } from "#lib/totals/index";

/**
 * The rules an invoice itself must satisfy to be issued, in the order they are checked: still at the version the caller saw, a draft,
 * and with at least one line.
 */
export const checkIssuable = (invoice: Invoice, versionSeen: Version): Result.Result<DraftInvoice, InvoiceChangedSinceSeen | InvoiceNotDraft | InvoiceHasNoLines> => {
  if (invoice.version !== versionSeen) {
    return Result.fail(new InvoiceChangedSinceSeen({ invoiceId: invoice.id, versionSeen }));
  }
  if (invoice._tag !== "Draft") {
    return Result.fail(new InvoiceNotDraft({ invoiceId: invoice.id, state: invoice._tag }));
  }
  if (invoice.lines.length === 0) {
    return Result.fail(new InvoiceHasNoLines({ invoiceId: invoice.id }));
  }
  return Result.succeed(invoice);
};

/** The issue transition: the bill-to copied again and frozen, the next number, the issue instant, and the version moved forward by one. */
export const issueDraft = (draft: DraftInvoice, issue: { readonly number: InvoiceNumber; readonly billTo: BillTo; readonly issuedAt: DateTime.Utc }): IssuedInvoice =>
  new IssuedInvoice({
    id: draft.id,
    customerId: draft.customerId,
    currency: draft.currency,
    dueDate: draft.dueDate,
    lines: draft.lines,
    billTo: issue.billTo,
    number: issue.number,
    issuedAt: issue.issuedAt,
    version: Version.make(draft.version + 1),
  });

/** The announcement of an issued invoice. */
export const invoiceIssuedOf = (invoice: IssuedInvoice): InvoiceIssued =>
  new InvoiceIssued({
    invoiceId: invoice.id,
    number: invoice.number,
    customerId: invoice.customerId,
    currency: invoice.currency,
    total: totalsOf(invoice.lines).total,
    dueDate: invoice.dueDate,
    issuedAt: invoice.issuedAt,
  });
