// The package for the tax adviser: one zip per month, quarter or year with every invoice PDF of the
// period, the invoice journal, payments and open items as CSV, and the DATEV posting batch; with the
// expenses of the period also their list, their own posting batch and every receipt.
// Folder layout and file names follow the RadarAuditor tax export.
import { strToU8, zipSync, type Zippable } from "fflate";
import type { Expense, ExpenseAccount, LineItem, NettedReversal, PaymentWithInvoice } from "../api/types";
import { csvAmount, csvDocument, germanDate } from "./csv";
import { DEFAULT_DATEV, datevFile, datevHeader, datevRows, missingTaxFreeAccount, type DateRange, type DatevSettings } from "./datev";
import { countedExpenses, expenseRows, expensesCsv, expensesWithoutAccount, receiptFileName, reversalsCsv } from "./finance";
import { MONTHS, PAYMENT_METHOD } from "./format";
import type { LedgerEntry } from "./ledger";

export type PeriodKind = "month" | "quarter" | "year";

/** A period; index is the month (1–12) or quarter (1–4) and is ignored for a year. */
export interface TaxPeriod {
  kind: PeriodKind;
  year: number;
  index: number;
}

function day(year: number, month: number, dayOfMonth: number): string {
  return `${String(year)}-${String(month).padStart(2, "0")}-${String(dayOfMonth).padStart(2, "0")}`;
}

function lastDay(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function periodRange(period: TaxPeriod): DateRange {
  const [first, last] = period.kind === "year" ? [1, 12] : period.kind === "quarter" ? [period.index * 3 - 2, period.index * 3] : [period.index, period.index];
  return { from: day(period.year, first, 1), to: day(period.year, last, lastDay(period.year, last)) };
}

export function periodLabel(period: TaxPeriod): string {
  if (period.kind === "year") return String(period.year);
  if (period.kind === "quarter") return `${String(period.index)}. Quartal ${String(period.year)}`;
  return `${MONTHS[period.index - 1] ?? ""} ${String(period.year)}`;
}

function periodSlug(period: TaxPeriod): string {
  if (period.kind === "year") return String(period.year);
  if (period.kind === "quarter") return `${String(period.year)}-Q${String(period.index)}`;
  return `${String(period.year)}-${String(period.index).padStart(2, "0")}`;
}

/** The month before the given YYYY-MM-DD day. */
export function previousMonth(today: string): TaxPeriod {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  return month === 1 ? { kind: "month", year: year - 1, index: 12 } : { kind: "month", year, index: month - 1 };
}

const TRANSLITERATION: Record<string, string> = { "ä": "ae", "ö": "oe", "ü": "ue", "Ä": "Ae", "Ö": "Oe", "Ü": "Ue", "ß": "ss" };

/** ASCII file-name part, words joined by underscores; "x" when nothing usable is left. */
export function filenameSlug(text: string): string {
  const transliterated = text.replace(/[äöüÄÖÜß]/g, (letter) => TRANSLITERATION[letter] ?? letter).normalize("NFKD");
  const ascii = transliterated.replace(/[^\x20-\x7E]/g, "");
  const slug = ascii.replace(/[^A-Za-z0-9-]+/g, "_").replace(/^_+|_+$/g, "");
  return slug === "" ? "x" : slug;
}

/** <number>_<issue date>_<customer>.pdf */
export function pdfName(entry: LedgerEntry): string {
  const { invoice } = entry;
  return `${filenameSlug(invoice.number ?? invoice.id)}_${invoice.issue_date ?? "ohne-datum"}_${filenameSlug(entry.customerName)}.pdf`;
}

function kindLabel(entry: LedgerEntry): string {
  return entry.isCredit ? "Stornorechnung" : "Rechnung";
}

export function invoicesCsv(entries: LedgerEntry[]): string {
  const numbers = new Map(entries.map((entry) => [entry.invoice.id, entry.invoice.number ?? ""]));
  const rows = entries.map(({ invoice, ...entry }) => [
    invoice.number ?? "", germanDate(invoice.issue_date), germanDate(invoice.service_date), kindLabel({ invoice, ...entry }), entry.customerName,
    csvAmount(invoice.net), csvAmount(invoice.vat), csvAmount(invoice.gross), germanDate(entry.paidOn), csvAmount(entry.paid),
    csvAmount(entry.openAmount), invoice.cancels_invoice_id === null ? "" : numbers.get(invoice.cancels_invoice_id) ?? "",
  ]);
  return csvDocument(
    ["Rechnungsnummer", "Datum", "Leistungsdatum", "Art", "Kunde", "Netto", "USt", "Brutto", "Zuletzt bezahlt am", "Bezahlt", "Offen", "Storno zu"], rows);
}

export function openItemsCsv(entries: LedgerEntry[]): string {
  const rows = entries.filter((entry) => entry.openAmount !== 0).map(({ invoice, customerName, paid, openAmount }) => [
    invoice.number ?? "", germanDate(invoice.issue_date), customerName, csvAmount(invoice.gross), csvAmount(paid), csvAmount(openAmount),
  ]);
  return csvDocument(["Rechnungsnummer", "Datum", "Kunde", "Brutto", "Bezahlt", "Offen"], rows);
}

export function paymentsCsv(payments: PaymentWithInvoice[]): string {
  const rows = payments.map((payment) => [
    germanDate(payment.paid_on), csvAmount(payment.amount), payment.invoice.number ?? "",
    payment.invoice.customer_snapshot?.name ?? payment.invoice.customer?.name ?? "", PAYMENT_METHOD[payment.method], payment.reference,
  ]);
  return csvDocument(["Eingang am", "Betrag", "Rechnungsnummer", "Kunde", "Art", "Verwendungszweck"], rows);
}

export interface PackageInput {
  period: TaxPeriod;
  entries: LedgerEntry[];
  payments: PaymentWithInvoice[];
  /** Invoice PDFs by invoice id. */
  pdfs: Map<string, Uint8Array>;
  /** Invoice items by invoice id, for one DATEV posting per VAT rate. */
  items?: Map<string, Pick<LineItem, "quantity" | "unit_price_net" | "vat_rate">[]>;
  created: Date;
  datev?: DatevSettings;
  expenses?: ExpenseInput;
  /** Reversals netted in the period; the bookings they took back may lie in an earlier one. */
  reversals?: NettedReversal[];
}

export interface ExpenseInput {
  list: Expense[];
  accounts: ExpenseAccount[];
  /** Receipt files by storage path. */
  receipts: Map<string, Uint8Array>;
  smallBusiness: boolean;
}

export interface TaxPackage {
  fileName: string;
  zip: Uint8Array;
  /** Numbers of invoices whose PDF is not in the package. */
  missing: string[];
  /** Numbers of invoices with tax-free lines that have no account while none is set. */
  missingTaxFreeAccount: string[];
  /** Expenses of the period still without an account, so not in their posting batch. */
  expensesWithoutAccount: string[];
}

function missingNote(missing: string[]): string {
  return `Zu diesen Rechnungen gab es beim Erstellen des Pakets noch kein PDF:\r\n${missing.join("\r\n")}\r\n`;
}

function pdfFiles(input: PackageInput): { files: Zippable; missing: string[] } {
  const files: Zippable = {};
  const missing: string[] = [];
  for (const entry of input.entries) {
    const pdf = input.pdfs.get(entry.invoice.id);
    if (pdf === undefined) missing.push(entry.invoice.number ?? entry.invoice.id);
    else files[`${entry.isCredit ? "Stornorechnungen" : "Rechnungen"}/${pdfName(entry)}`] = [pdf, { level: 0 }];
  }
  return { files, missing };
}

/** Belege/<receipt field>_<original name>, so each receipt can be found from its posting. */
export function receiptEntryName(expense: Pick<Expense, "id" | "spent_on">, fileName: string): string {
  const extension = /\.[A-Za-z0-9]{1,5}$/.exec(fileName)?.[0]?.toLowerCase() ?? "";
  return `Belege/${filenameSlug(receiptFileName(expense, fileName.slice(0, fileName.length - extension.length)))}${extension}`;
}

function uniqueName(files: Zippable, name: string): string {
  if (!(name in files)) return name;
  const dot = name.lastIndexOf(".");
  for (let copy = 2; ; copy += 1) {
    const candidate = dot > name.lastIndexOf("/") ? `${name.slice(0, dot)}_${String(copy)}${name.slice(dot)}` : `${name}_${String(copy)}`;
    if (!(candidate in files)) return candidate;
  }
}

// The expense batch is a file of its own: whether the tax adviser books it or the bank statement is
// his decision, and the two must not be booked twice.
function expenseFiles(input: PackageInput, settings: DatevSettings, files: Zippable): string[] {
  if (input.expenses === undefined) return [];
  const expenses = { ...input.expenses, list: countedExpenses(input.expenses.list) };
  const header = datevHeader(periodRange(input.period), settings, `Ausgaben ${periodLabel(input.period)}`, input.created);
  files["ausgaben.csv"] = strToU8(expensesCsv(expenses.list, expenses.accounts, (expense, name) => receiptEntryName(expense, name).slice("Belege/".length)));
  files["datev-ausgaben.csv"] = strToU8(datevFile(header, expenseRows(expenses.list, expenses.smallBusiness)));
  for (const expense of expenses.list) {
    for (const receipt of expense.receipts ?? []) {
      const bytes = expenses.receipts.get(receipt.path);
      if (bytes !== undefined) files[uniqueName(files, receiptEntryName(expense, receipt.file_name))] = [bytes, { level: 0 }];
    }
  }
  const unassigned = expensesWithoutAccount(expenses.list);
  if (unassigned.length > 0) files["ausgaben-ohne-konto.txt"] = strToU8(`Diese Ausgaben haben noch kein Konto und fehlen in datev-ausgaben.csv:\r\n${unassigned.join("\r\n")}\r\n`);
  return unassigned;
}

export function assemblePackage(input: PackageInput): TaxPackage {
  const settings = input.datev ?? DEFAULT_DATEV;
  const header = datevHeader(periodRange(input.period), settings, `Ausgangsrechnungen ${periodLabel(input.period)}`, input.created);
  const { files, missing } = pdfFiles(input);
  files["rechnungen.csv"] = strToU8(invoicesCsv(input.entries));
  files["zahlungen.csv"] = strToU8(paymentsCsv(input.payments));
  files["offene-posten.csv"] = strToU8(openItemsCsv(input.entries));
  files["datev-buchungsstapel.csv"] = strToU8(datevFile(header, datevRows(input.entries, settings, input.items)));
  if (missing.length > 0) files["fehlende-pdfs.txt"] = strToU8(missingNote(missing));
  if ((input.reversals ?? []).length > 0) files["rueckbuchungen.csv"] = strToU8(reversalsCsv(input.reversals ?? []));
  const unassigned = expenseFiles(input, settings, files);
  const folder = `Steuer_${periodSlug(input.period)}`;
  return {
    fileName: `${folder}.zip`, zip: zipSync({ [folder]: files }), missing, missingTaxFreeAccount: missingTaxFreeAccount(input.entries, settings, input.items),
    expensesWithoutAccount: unassigned,
  };
}
