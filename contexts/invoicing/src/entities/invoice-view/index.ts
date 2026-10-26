import { Schema } from "effect";

import { BillTo, CalendarDate, CustomerId, InvoiceId, InvoiceNumber, InvoiceState, Version } from "#entities/invoice/index";
import { Amount, Currency, TaxRate } from "#entities/money/index";

/** A line as it is answered and shown: what was billed, plus its line amount and line tax. */
export class LineView extends Schema.Class<LineView>("@repo/invoicing/entities/LineView")({
  description: Schema.String,
  quantity: Schema.Int,
  unitAmount: Amount,
  taxRate: TaxRate,
  taxRateName: Schema.String,
  lineAmount: Amount,
  lineTax: Amount,
}) {}

/**
 * An invoice as the endpoint answers it and the screen shows it, on a given day: derived amounts computed and overdue read from the
 * due date. One shape for both, so the two cannot drift apart.
 */
export class InvoiceView extends Schema.Class<InvoiceView>("@repo/invoicing/entities/InvoiceView")({
  id: InvoiceId,
  state: InvoiceState,
  number: Schema.OptionFromNullOr(InvoiceNumber),
  issuedAt: Schema.OptionFromNullOr(Schema.DateTimeUtcFromString),
  customerId: CustomerId,
  billTo: BillTo,
  currency: Currency,
  dueDate: CalendarDate,
  overdue: Schema.Boolean,
  lines: Schema.Array(LineView),
  subtotal: Amount,
  taxAmount: Amount,
  total: Amount,
  version: Version,
}) {}
