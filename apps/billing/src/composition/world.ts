import { DateTime, Option } from "effect";

import { Customer, CustomerId as CustomersCustomerId } from "@repo/customers";
import { Amount, BillTo, CalendarDate, CustomerId, DraftInvoice, type Invoice, InvoiceId, InvoiceNumber, IssuedInvoice, Line, Version, VoidInvoice } from "@repo/invoicing";

// The synthetic world the proof of concept starts with. The organization has already issued two invoices, so the next number is 3.

export interface World {
  readonly customers: ReadonlyArray<Customer>;
  readonly invoices: ReadonlyArray<Invoice>;
  readonly lastNumber: number;
}

const customer = (id: string, displayName: string, email: string, taxId: string | undefined, archived: boolean) => new Customer({ id: CustomersCustomerId.make(id), displayName, email, taxId: Option.fromUndefinedOr(taxId), archived });

const billTo = (displayName: string, email: string, taxId?: string) => new BillTo({ displayName, email, taxId: Option.fromUndefinedOr(taxId) });

const line = (description: string, quantity: number, unitAmount: number, taxRate: Line["taxRate"]) => new Line({ description, quantity, unitAmount: Amount.make(unitAmount), taxRate });

const ada = billTo("Ada Lovelace Ltd", "billing@ada.example", "GB123456789");
const grace = billTo("Grace Hopper Co", "ap@grace.example");
const linus = billTo("Linus Torvalds", "linus@linus.example");

export const world: World = {
  customers: [customer("Ada", "Ada Lovelace Ltd", "billing@ada.example", "GB123456789", false), customer("Grace", "Grace Hopper Co", "ap@grace.example", undefined, false), customer("Linus", "Linus Torvalds", "linus@linus.example", undefined, true)],
  invoices: [
    new IssuedInvoice({
      id: InvoiceId.make("I-1"),
      version: Version.make(2),
      customerId: CustomerId.make("Ada"),
      billTo: ada,
      currency: "EUR",
      dueDate: CalendarDate.make("2026-09-30"),
      lines: [line("Consulting hours", 1, 120_00, "standard")],
      number: InvoiceNumber.make(1),
      issuedAt: DateTime.makeUnsafe("2026-09-01T09:00:00Z"),
    }),
    new VoidInvoice({
      id: InvoiceId.make("I-2"),
      version: Version.make(3),
      customerId: CustomerId.make("Grace"),
      billTo: grace,
      currency: "EUR",
      dueDate: CalendarDate.make("2026-10-31"),
      lines: [line("Workshop", 1, 500_00, "standard")],
      number: Option.some(InvoiceNumber.make(2)),
      issuedAt: Option.some(DateTime.makeUnsafe("2026-10-01T09:00:00Z")),
    }),
    new DraftInvoice({
      id: InvoiceId.make("D-1"),
      version: Version.make(1),
      customerId: CustomerId.make("Ada"),
      billTo: billTo("Ada Lovelace Ltd", "old@ada.example", "GB123456789"),
      currency: "EUR",
      dueDate: CalendarDate.make("2026-11-30"),
      lines: [line("Consulting hours", 3, 120_00, "standard"), line("Notebook", 1, 50, "standard"), line("Books", 2, 19_99, "reduced")],
    }),
    new DraftInvoice({
      id: InvoiceId.make("D-2"),
      version: Version.make(1),
      customerId: CustomerId.make("Grace"),
      billTo: grace,
      currency: "EUR",
      dueDate: CalendarDate.make("2026-11-30"),
      lines: [],
    }),
    new DraftInvoice({
      id: InvoiceId.make("D-3"),
      version: Version.make(1),
      customerId: CustomerId.make("Linus"),
      billTo: linus,
      currency: "EUR",
      dueDate: CalendarDate.make("2026-11-30"),
      lines: [line("Kernel review", 1, 250_00, "exempt")],
    }),
    new DraftInvoice({
      id: InvoiceId.make("D-4"),
      version: Version.make(1),
      customerId: CustomerId.make("Grace"),
      billTo: grace,
      currency: "USD",
      dueDate: CalendarDate.make("2026-12-15"),
      lines: [line("Compiler audit", 1, 900_00, "standard")],
    }),
  ],
  lastNumber: 2,
};
