import { Schema } from "effect";

import { InvoiceId, Version } from "#entities/invoice/index";

/** Someone established to be acting on behalf of the organization. Request keys belong to them. */
export const Actor = Schema.NonEmptyString.pipe(Schema.brand("Actor"));
export type Actor = typeof Actor.Type;

/** A label the caller chooses so that a request they are unsure arrived can be sent again without being handled twice. */
export const RequestKey = Schema.NonEmptyString.check(Schema.isMaxLength(200)).pipe(Schema.brand("RequestKey"));
export type RequestKey = typeof RequestKey.Type;

/** What is asked to issue a draft: which invoice, the version the caller saw, and optionally a request key. */
export class IssueRequest extends Schema.Class<IssueRequest>("@repo/invoicing/entities/IssueRequest")({
  actor: Actor,
  invoiceId: InvoiceId,
  versionSeen: Version,
  requestKey: Schema.Option(RequestKey),
}) {}
