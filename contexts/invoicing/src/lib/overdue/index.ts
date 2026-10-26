import { DateTime } from "effect";

import type { Invoice } from "#entities/invoice/index";

/**
 * An issued invoice is overdue once its due date has passed without payment. A due date passes at the end of that day in UTC, so the
 * invoice is not overdue on its due date, only from the next UTC day. Overdue is read, never stored.
 */
export const isOverdue = (invoice: Invoice, now: DateTime.Utc): boolean => invoice._tag === "Issued" && DateTime.formatIsoDateUtc(now) > invoice.dueDate;
