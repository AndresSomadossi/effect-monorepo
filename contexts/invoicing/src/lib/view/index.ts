import { type DateTime, Option } from "effect";

import type { Invoice } from "#entities/invoice/index";
import { InvoiceView, LineView } from "#entities/invoice-view/index";
import { isOverdue } from "#lib/overdue/index";
import { taxRates } from "#lib/tax-rates/index";
import { lineAmount, lineTax, totalsOf } from "#lib/totals/index";

const numberOf = (invoice: Invoice) => {
  switch (invoice._tag) {
    case "Draft":
      return { number: Option.none(), issuedAt: Option.none() };
    case "Void":
      return { number: invoice.number, issuedAt: invoice.issuedAt };
    default:
      return { number: Option.some(invoice.number), issuedAt: Option.some(invoice.issuedAt) };
  }
};

/** The invoice as it reads at `now`: amounts derived from its lines and overdue read from its due date. */
export const viewOf = (invoice: Invoice, now: DateTime.Utc): InvoiceView =>
  new InvoiceView({
    id: invoice.id,
    state: invoice._tag,
    ...numberOf(invoice),
    customerId: invoice.customerId,
    billTo: invoice.billTo,
    currency: invoice.currency,
    dueDate: invoice.dueDate,
    overdue: isOverdue(invoice, now),
    lines: invoice.lines.map(
      (line) =>
        new LineView({
          description: line.description,
          quantity: line.quantity,
          unitAmount: line.unitAmount,
          taxRate: line.taxRate,
          taxRateName: taxRates[line.taxRate].name,
          lineAmount: lineAmount(line),
          lineTax: lineTax(line),
        }),
    ),
    ...totalsOf(invoice.lines),
    version: invoice.version,
  });
