// Invoice and cancellation invoice PDF. Mandatory content per § 14 Abs. 4 UStG: name and address of
// seller and customer, tax number or VAT identification number, issue date, invoice number, quantity
// and kind of service, date or period of service, net amount split by rate with rate and tax amount, or the
// small business note of § 34a UStDV. Seller and customer come from the snapshots taken when the
// invoice was finalised, never from the current settings.
import { WorkerError } from "../errors.ts";
import { type Item, itemTable, SMALL_BUSINESS_NOTE, type Totals, toItems, totalRows } from "./items.ts";
import { type Block, letterHead, type Party, salutation, type Seller, toParty, toSeller } from "./model.ts";
import { renderPdf } from "./render.ts";
import { dateDe, euro, cents } from "./text.ts";

export interface InvoiceData {
  number: string;
  issueDate: string;
  serviceDate: string;
  /** Last day of the service period of a monthly invoice; null for a single date of service. */
  servicePeriodEnd: string | null;
  dueDate: string;
  intro: string;
  outro: string;
  totals: Totals;
  smallBusiness: boolean;
  seller: Seller;
  customer: Party;
  items: Item[];
  cancels: { number: string; issue_date: string } | null;
}

function required(row: Record<string, unknown>, key: string, label: string): string {
  const value = row[key];
  if (typeof value !== "string" || value === "") throw new WorkerError(`Rechnung ${String(row.number ?? "ohne Nummer")}: ${label} fehlt.`);
  return value;
}

/** Validates a finalised invoice row with embedded invoice_items; original is the cancelled invoice. */
export function toInvoiceData(row: Record<string, unknown>, original: { number: string; issue_date: string } | null): InvoiceData {
  const number = required(row, "number", "Rechnungsnummer");
  const issueDate = required(row, "issue_date", "Rechnungsdatum");
  if (row.seller_snapshot == null || row.customer_snapshot == null) throw new WorkerError(`Rechnung ${number}: gespeicherte Firmen- oder Kundendaten fehlen.`);
  const snapshot = row.seller_snapshot as Record<string, unknown>;
  return {
    number, issueDate, serviceDate: typeof row.service_date === "string" ? row.service_date : issueDate,
    servicePeriodEnd: typeof row.service_period_end === "string" ? row.service_period_end : null,
    dueDate: typeof row.due_date === "string" ? row.due_date : issueDate, intro: String(row.intro ?? ""), outro: String(row.outro ?? ""),
    totals: { net: Number(row.net ?? 0), vat: Number(row.vat ?? 0), gross: Number(row.gross ?? 0) },
    smallBusiness: snapshot.small_business === true, seller: toSeller(snapshot), customer: toParty(row.customer_snapshot),
    items: toItems(row.invoice_items), cancels: original,
  };
}

function serviceFact(invoice: InvoiceData): [string, string] {
  if (invoice.servicePeriodEnd === null) return ["Leistungsdatum", dateDe(invoice.serviceDate)];
  return ["Leistungszeitraum", `${dateDe(invoice.serviceDate)} – ${dateDe(invoice.servicePeriodEnd)}`];
}

function facts(invoice: InvoiceData): Block {
  const optional = (label: string, value: string): [string, string][] => (value === "" ? [] : [[label, value]]);
  const reference: [string, string] = invoice.cancels === null
    ? ["Zahlbar bis", dateDe(invoice.dueDate)]
    : ["Storniert", `Rechnung ${invoice.cancels.number} vom ${dateDe(invoice.cancels.issue_date)}`];
  return { kind: "facts", rows: [
    ["Rechnungsnummer", invoice.number], ["Rechnungsdatum", dateDe(invoice.issueDate)], serviceFact(invoice), reference,
    ...optional("Steuernummer", invoice.seller.tax_number), ...optional("USt-IdNr.", invoice.seller.vat_id),
    ...optional("Ihre USt-IdNr.", invoice.customer.vat_id), ...optional("Ihr Zeichen", invoice.customer.buyer_reference),
  ] };
}

function paymentText(invoice: InvoiceData): string {
  if (invoice.cancels !== null) return `Mit dieser Stornorechnung wird die Rechnung ${invoice.cancels.number} vom ${dateDe(invoice.cancels.issue_date)} vollständig aufgehoben.`;
  const bank = invoice.seller.iban === "" ? "" : ` auf das Konto ${invoice.seller.iban}${invoice.seller.bank_name === "" ? "" : ` bei der ${invoice.seller.bank_name}`}`;
  return `Bitte überweisen Sie ${euro(cents(invoice.totals.gross))} ohne Abzug bis zum ${dateDe(invoice.dueDate)}${bank}. Bitte geben Sie als Verwendungszweck die Rechnungsnummer ${invoice.number} an.`;
}

export function invoiceBlocks(invoice: InvoiceData): Block[] {
  return [
    ...letterHead(invoice.seller, invoice.customer),
    { kind: "title", text: invoice.cancels === null ? "Rechnung" : "Stornorechnung" },
    facts(invoice), { kind: "space", height: 16 },
    { kind: "paragraph", text: salutation(invoice.customer) }, { kind: "paragraph", text: invoice.intro },
    itemTable(invoice.items, !invoice.smallBusiness),
    { kind: "totals", rows: totalRows(invoice.items, invoice.totals, invoice.smallBusiness) },
    ...(invoice.smallBusiness ? [{ kind: "paragraph", text: SMALL_BUSINESS_NOTE } as Block] : []),
    { kind: "paragraph", text: paymentText(invoice) }, { kind: "paragraph", text: invoice.outro },
  ];
}

export function invoiceTitle(invoice: InvoiceData): string {
  return `${invoice.cancels === null ? "Rechnung" : "Stornorechnung"} ${invoice.number}`;
}

export function invoicePdf(invoice: InvoiceData): Promise<Uint8Array> {
  return renderPdf({ title: invoiceTitle(invoice), seller: invoice.seller, blocks: invoiceBlocks(invoice) });
}
