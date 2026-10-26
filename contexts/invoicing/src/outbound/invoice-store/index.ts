import { Context, type DateTime, type Effect, type Option } from "effect";

import type { BillTo, Invoice, InvoiceId, IssuedInvoice, Version } from "#entities/invoice/index";
import type { InvoiceIssued } from "#entities/invoice-issued/index";
import type { InvoiceChangedSinceSeen } from "#entities/refusals/index";

/** What it takes to record an issue: which draft, at which version, and the bill-to and instant to stamp it with. */
export interface IssueToRecord {
  readonly invoiceId: InvoiceId;
  readonly versionSeen: Version;
  readonly billTo: BillTo;
  readonly issuedAt: DateTime.Utc;
}

/**
 * Where invoices, the invoice number sequence and the announcements still to be made are kept.
 *
 * A store that cannot be reached is an unexpected failure and surfaces as a defect: no caller can do anything about it but report it.
 */
export class InvoiceStore extends Context.Service<
  InvoiceStore,
  {
    find(id: InvoiceId): Effect.Effect<Option.Option<Invoice>>;
    /**
     * Records an issue as one indivisible change: if the invoice is still a draft at `versionSeen`, it takes the next invoice number,
     * becomes Issued, and its **Invoice Issued** announcement is queued. Otherwise nothing changes, no number is used, and the issue
     * fails with `InvoiceChangedSinceSeen`.
     */
    recordIssue(issue: IssueToRecord): Effect.Effect<IssuedInvoice, InvoiceChangedSinceSeen>;
    /** The announcements recorded with an issue and not yet marked as made, oldest first. */
    readonly pendingAnnouncements: Effect.Effect<ReadonlyArray<InvoiceIssued>>;
    markAnnounced(invoiceId: InvoiceId): Effect.Effect<void>;
  }
>()("@repo/invoicing/outbound/InvoiceStore") {}
