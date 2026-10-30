// Payment reminder letter: names the invoice, its date, the original due date, invoice amount,
// what was paid, the open amount and the reminder level. It is a new letter, so it uses the current
// company settings and customer address.
import { WorkerError } from "../errors.ts";
import { type Block, letterHead, type Party, salutation, type Seller, toParty, toSeller } from "./model.ts";
import { renderPdf } from "./render.ts";
import { cents, dateDe, euro } from "./text.ts";

const TITLES = ["Zahlungserinnerung", "1. Mahnung", "2. Mahnung"];

export interface DunningData {
  level: number;
  date: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  grossCents: number;
  paidCents: number;
  seller: Seller;
  customer: Party;
}

export function dunningTitle(level: number): string {
  return TITLES[level - 1];
}

/** An invoice row with embedded customers, the reminder level, the settings row and today's date. */
export function toDunningData(invoice: Record<string, unknown>, level: number, settings: Record<string, unknown>, today: string): DunningData {
  const number = String(invoice.number ?? "");
  if (!Number.isInteger(level) || level < 1 || level > TITLES.length) throw new WorkerError(`Rechnung ${number}: Mahnstufe ${String(level)} gibt es nicht.`);
  if (invoice.customers == null) throw new WorkerError(`Rechnung ${number}: Kundendaten fehlen.`);
  return {
    level, date: today, invoiceNumber: number, invoiceDate: String(invoice.issue_date ?? ""), dueDate: String(invoice.due_date ?? ""),
    grossCents: cents(Number(invoice.gross ?? 0)), paidCents: cents(Number(invoice.paid_amount ?? 0)), seller: toSeller(settings), customer: toParty(invoice.customers),
  };
}

function letterText(data: DunningData): string {
  const open = euro(data.grossCents - data.paidCents);
  const bank = data.seller.iban === "" ? "" : ` auf das Konto ${data.seller.iban}${data.seller.bank_name === "" ? "" : ` bei der ${data.seller.bank_name}`}`;
  return `zu meiner Rechnung ${data.invoiceNumber} vom ${dateDe(data.invoiceDate)} ist bis heute ein Betrag von ${open} offen. `
    + `Die Rechnung war am ${dateDe(data.dueDate)} fällig. Bitte überweisen Sie den offenen Betrag${bank} `
    + `und geben Sie als Verwendungszweck die Rechnungsnummer ${data.invoiceNumber} an.`;
}

export function dunningBlocks(data: DunningData): Block[] {
  const paid = data.paidCents === 0 ? [] : [{ label: "Bereits bezahlt", value: euro(data.paidCents) }];
  return [
    ...letterHead(data.seller, data.customer),
    { kind: "title", text: dunningTitle(data.level) },
    { kind: "facts", rows: [["Datum", dateDe(data.date)], ["Rechnung", data.invoiceNumber], ["Rechnungsdatum", dateDe(data.invoiceDate)],
      ["Ursprünglich fällig am", dateDe(data.dueDate)], ["Mahnstufe", `${String(data.level)} von ${String(TITLES.length)}`]] },
    { kind: "space", height: 16 },
    { kind: "paragraph", text: salutation(data.customer) }, { kind: "paragraph", text: letterText(data) },
    { kind: "totals", rows: [{ label: "Rechnungsbetrag", value: euro(data.grossCents) }, ...paid,
      { label: "Offener Betrag", value: euro(data.grossCents - data.paidCents), strong: true }] },
    { kind: "paragraph", text: "Falls Sie die Zahlung inzwischen veranlasst haben, betrachten Sie dieses Schreiben bitte als gegenstandslos." },
    { kind: "paragraph", text: `Mit freundlichen Grüßen\n${data.seller.owner_name || data.seller.company_name}` },
  ];
}

export function dunningPdf(data: DunningData): Promise<Uint8Array> {
  return renderPdf({ title: `${dunningTitle(data.level)} ${data.invoiceNumber}`, seller: data.seller, blocks: dunningBlocks(data) });
}
