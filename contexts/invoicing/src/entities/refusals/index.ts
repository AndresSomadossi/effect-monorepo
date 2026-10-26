import { Schema } from "effect";

import { CustomerId, InvoiceId, Version } from "#entities/invoice/index";
import { RequestKey } from "#entities/request/index";

// The expected outcomes that refuse an issue. Each failed rule leaves the invoice exactly as it was.

export class InvoiceNotFound extends Schema.TaggedError<InvoiceNotFound>()("InvoiceNotFound", {
  invoiceId: InvoiceId,
}) {}

/** The version given is not the current one, or a concurrent change won the race. The caller must look again before deciding. */
export class InvoiceChangedSinceSeen extends Schema.TaggedError<InvoiceChangedSinceSeen>()("InvoiceChangedSinceSeen", {
  invoiceId: InvoiceId,
  versionSeen: Version,
}) {}

export class InvoiceNotDraft extends Schema.TaggedError<InvoiceNotDraft>()("InvoiceNotDraft", {
  invoiceId: InvoiceId,
  state: Schema.Literals(["Issued", "Paid", "Void"]),
}) {}

export class InvoiceHasNoLines extends Schema.TaggedError<InvoiceHasNoLines>()("InvoiceHasNoLines", {
  invoiceId: InvoiceId,
}) {}

export class UnknownCustomer extends Schema.TaggedError<UnknownCustomer>()("UnknownCustomer", {
  customerId: CustomerId,
}) {}

/** The customer is archived. */
export class CustomerCannotBeBilled extends Schema.TaggedError<CustomerCannotBeBilled>()("CustomerCannotBeBilled", {
  customerId: CustomerId,
}) {}

export class RequestKeyReused extends Schema.TaggedError<RequestKeyReused>()("RequestKeyReused", {
  requestKey: RequestKey,
}) {}

/** The same key arrived while its first request is still being handled; the caller may try again shortly. */
export class RequestStillInProgress extends Schema.TaggedError<RequestStillInProgress>()("RequestStillInProgress", {
  requestKey: RequestKey,
}) {}

/** Every expected outcome of issuing that is not the issue itself. */
export const IssueRefusal = Schema.Union([InvoiceNotFound, InvoiceChangedSinceSeen, InvoiceNotDraft, InvoiceHasNoLines, UnknownCustomer, CustomerCannotBeBilled, RequestKeyReused, RequestStillInProgress]);
export type IssueRefusal = typeof IssueRefusal.Type;
