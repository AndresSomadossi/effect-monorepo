import { Schema } from "effect";

import { CalendarDate, CustomerId, InvoiceId, InvoiceNumber } from "#entities/invoice/index";
import { Amount, Currency } from "#entities/money/index";

/** The fact, announced by Invoicing to whoever is interested, that an invoice was issued. */
export class InvoiceIssued extends Schema.TaggedClass<InvoiceIssued>("@repo/invoicing/entities/InvoiceIssued")("InvoiceIssued", {
  invoiceId: InvoiceId,
  number: InvoiceNumber,
  customerId: CustomerId,
  currency: Currency,
  total: Amount,
  dueDate: CalendarDate,
  issuedAt: Schema.DateTimeUtc,
}) {}
