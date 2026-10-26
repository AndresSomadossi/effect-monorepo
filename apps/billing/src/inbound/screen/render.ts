import { DateTime, Option } from "effect";

import type { Amount, Currency, InvoiceView } from "@repo/invoicing";

const escapeHtml = (text: string): string => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");

/** Major units with the currency, e.g. `EUR 480.39`. Amounts are whole minor units, so nothing is rounded for display. */
export const formatAmount = (currency: Currency, amount: Amount): string => `${currency} ${Math.floor(amount / 100)}.${String(amount % 100).padStart(2, "0")}`;

/** The request key the screen sends with an issue. Deterministic per invoice and version, so pressing twice or reloading is a retry. */
export const screenRequestKey = (view: InvoiceView): string => `screen:${view.id}:v${view.version}`;

const styles = `
:root { color-scheme: light dark; --fg: #1d1d1f; --bg: #fff; --muted: #6e6e73; --line: #d2d2d7; --accent: #0057d9; --warn: #b3261e; }
@media (prefers-color-scheme: dark) { :root { --fg: #f5f5f7; --bg: #161617; --muted: #a1a1a6; --line: #3a3a3c; --accent: #6aa5ff; --warn: #ff8a80; } }
body { font: 15px/1.5 system-ui, sans-serif; color: var(--fg); background: var(--bg); margin: 0 auto; max-width: 860px; padding: 24px 16px; }
h1 { margin: 0 0 4px; } .state { color: var(--muted); margin: 0 0 16px; }
.notice { border-left: 4px solid var(--warn); padding: 8px 12px; margin: 0 0 16px; }
.overdue { color: var(--warn); font-weight: 600; }
table { border-collapse: collapse; width: 100%; margin: 16px 0; } th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--line); }
td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; } tfoot td { font-weight: 600; border-bottom: none; }
dl { display: grid; grid-template-columns: max-content 1fr; gap: 4px 16px; } dt { color: var(--muted); } dd { margin: 0; }
button { font: inherit; padding: 8px 16px; background: var(--accent); color: #fff; border: 0; border-radius: 6px; cursor: pointer; }
.wrap { overflow-x: auto; }
`;

export const page = (title: string, body: string): string =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title><style>${styles}</style></head><body>${body}</body></html>`;

export const messagePage = (message: string): string => page("Invoice", `<p class="notice" role="alert">${escapeHtml(message)}</p>`);

export const signInPage = (next: string, notice: Option.Option<string>): string =>
  page(
    "Sign in",
    `<h1>Sign in</h1>${Option.match(notice, { onNone: () => "", onSome: (text) => `<p class="notice" role="alert">${escapeHtml(text)}</p>` })}
<form method="post" action="/screen/sign-in"><input type="hidden" name="next" value="${escapeHtml(next)}">
<p><label>Access token <input type="password" name="token" required autocomplete="current-password"></label></p><button type="submit">Sign in</button></form>`,
  );

/** The Invoice screen: one invoice, with the one action a draft allows. */
export const invoicePage = (view: InvoiceView, notice: Option.Option<string>): string => {
  const money = (amount: Amount) => escapeHtml(formatAmount(view.currency, amount));
  const heading = Option.match(view.number, { onNone: () => "Draft", onSome: (number) => `Invoice ${number}` });
  const lines = view.lines
    .map(
      (line) =>
        `<tr><td>${escapeHtml(line.description)}</td><td class="num">${line.quantity}</td><td class="num">${money(line.unitAmount)}</td><td>${escapeHtml(line.taxRateName)}</td><td class="num">${money(line.lineAmount)}</td><td class="num">${money(line.lineTax)}</td></tr>`,
    )
    .join("");
  const action =
    view.state === "Draft"
      ? `<form method="post" action="/screen/invoices/${encodeURIComponent(view.id)}/issue"><input type="hidden" name="version" value="${view.version}"><input type="hidden" name="requestKey" value="${escapeHtml(screenRequestKey(view))}"><button type="submit">Issue invoice</button></form>`
      : "";
  return page(
    heading,
    `${Option.match(notice, { onNone: () => "", onSome: (text) => `<p class="notice" role="alert">${escapeHtml(text)}</p>` })}
<h1>${escapeHtml(heading)}</h1><p class="state">${escapeHtml(view.state)}${view.overdue ? ` · <span class="overdue">Overdue</span>` : ""}</p>
<h2>Bill to</h2><dl><dt>Display name</dt><dd>${escapeHtml(view.billTo.displayName)}</dd><dt>Email</dt><dd>${escapeHtml(view.billTo.email)}</dd>${Option.match(view.billTo.taxId, { onNone: () => "", onSome: (taxId) => `<dt>Tax ID</dt><dd>${escapeHtml(taxId)}</dd>` })}</dl>
<dl><dt>Currency</dt><dd>${escapeHtml(view.currency)}</dd><dt>Due date</dt><dd>${escapeHtml(view.dueDate)}</dd>${Option.match(view.issuedAt, { onNone: () => "", onSome: (issuedAt) => `<dt>Issued at</dt><dd>${escapeHtml(DateTime.formatIso(issuedAt))}</dd>` })}</dl>
<div class="wrap"><table><thead><tr><th>Description</th><th class="num">Quantity</th><th class="num">Unit amount</th><th>Tax rate</th><th class="num">Line amount</th><th class="num">Line tax</th></tr></thead><tbody>${lines}</tbody>
<tfoot><tr><td colspan="5">Subtotal</td><td class="num">${money(view.subtotal)}</td></tr><tr><td colspan="5">Tax amount</td><td class="num">${money(view.taxAmount)}</td></tr><tr><td colspan="5">Total</td><td class="num">${money(view.total)}</td></tr></tfoot></table></div>
${action}`,
  );
};
