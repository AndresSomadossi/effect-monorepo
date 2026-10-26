import { Schema } from "effect";

import { Amount, Currency, TaxRate } from "#entities/money/index";

export const InvoiceId = Schema.NonEmptyString.pipe(Schema.brand("InvoiceId"));
export type InvoiceId = typeof InvoiceId.Type;

/**
 * Invoicing's own name for the customer an invoice bills. It never reaches into Customers' model: the `customer-bill-to` port is the one
 * place the two meet.
 */
export const CustomerId = Schema.NonEmptyString.pipe(Schema.brand("CustomerId"));
export type CustomerId = typeof CustomerId.Type;

/** The sequential, gapless identifier an invoice receives when it is issued. */
export const InvoiceNumber = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)).pipe(Schema.brand("InvoiceNumber"));
export type InvoiceNumber = typeof InvoiceNumber.Type;

/** Which revision of an invoice someone is looking at. Starts at 1 and moves forward on every change. */
export const Version = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)).pipe(Schema.brand("Version"));
export type Version = typeof Version.Type;

/** A calendar date in ISO form, `YYYY-MM-DD`, with no time or zone. */
export const CalendarDate = Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/)).pipe(Schema.brand("CalendarDate"));
export type CalendarDate = typeof CalendarDate.Type;

/** The customer's display name, email and tax ID copied onto an invoice; frozen once the invoice is issued. */
export class BillTo extends Schema.Class<BillTo>("@repo/invoicing/entities/BillTo")({
  displayName: Schema.NonEmptyString,
  email: Schema.NonEmptyString,
  taxId: Schema.OptionFromNullOr(Schema.NonEmptyString),
}) {}

/** One billed item. The unit amount is stated before tax. */
export class Line extends Schema.Class<Line>("@repo/invoicing/entities/Line")({
  description: Schema.NonEmptyString,
  quantity: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  unitAmount: Amount,
  taxRate: TaxRate,
}) {}

const invoiceFields = {
  id: InvoiceId,
  version: Version,
  customerId: CustomerId,
  billTo: BillTo,
  currency: Currency,
  dueDate: CalendarDate,
  lines: Schema.Array(Line),
};

/** An invoice still being prepared. Drafts have no invoice number. */
export class DraftInvoice extends Schema.TaggedClass<DraftInvoice>("@repo/invoicing/entities/DraftInvoice")("Draft", invoiceFields) {}

/** An invoice that has been sent and awaits payment; its content can no longer change. */
export class IssuedInvoice extends Schema.TaggedClass<IssuedInvoice>("@repo/invoicing/entities/IssuedInvoice")("Issued", {
  ...invoiceFields,
  number: InvoiceNumber,
  issuedAt: Schema.DateTimeUtc,
}) {}

/** An issued invoice settled by one payment of its full total. */
export class PaidInvoice extends Schema.TaggedClass<PaidInvoice>("@repo/invoicing/entities/PaidInvoice")("Paid", {
  ...invoiceFields,
  number: InvoiceNumber,
  issuedAt: Schema.DateTimeUtc,
  paidAt: Schema.DateTimeUtc,
}) {}

/** An invoice cancelled before being paid. One voided after issue keeps its invoice number. */
export class VoidInvoice extends Schema.TaggedClass<VoidInvoice>("@repo/invoicing/entities/VoidInvoice")("Void", {
  ...invoiceFields,
  number: Schema.OptionFromNullOr(InvoiceNumber),
  issuedAt: Schema.OptionFromNullOr(Schema.DateTimeUtc),
}) {}

/** A request for payment of a stated total, in one currency, due by a stated date, in one of its lifecycle states. */
export const Invoice = Schema.Union([DraftInvoice, IssuedInvoice, PaidInvoice, VoidInvoice]);
export type Invoice = typeof Invoice.Type;

export const InvoiceState = Schema.Literals(["Draft", "Issued", "Paid", "Void"]);
export type InvoiceState = typeof InvoiceState.Type;
