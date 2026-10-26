import { Context, type Effect } from "effect";

import type { InvoiceIssued } from "#entities/invoice-issued/index";

/**
 * Announces **Invoice Issued** to whoever is interested. An announcement that cannot be made is an unexpected failure and surfaces as a
 * defect; the announcement stays pending and is tried again.
 */
export class InvoiceIssuedAnnouncer extends Context.Service<
  InvoiceIssuedAnnouncer,
  {
    announce(event: InvoiceIssued): Effect.Effect<void>;
  }
>()("@repo/invoicing/outbound/InvoiceIssuedAnnouncer") {}
