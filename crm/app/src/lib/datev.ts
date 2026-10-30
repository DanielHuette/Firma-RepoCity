// DATEV posting batch for the tax adviser, ported from the tested RadarAuditor export
// (src/radarauditor/exports/tax.py). Chart of accounts SKR03:
// - 8400 revenue at 19 % VAT and 8300 revenue at 7 % VAT, automatic accounts that derive the VAT;
// - 8195 revenue of a small business under § 19 UStG, used for every line of a small business;
// - a 0 % line under normal taxation goes to the tax-free account the tax adviser names;
// - 1400 receivables from customers.
// An invoice is booked per VAT rate with the gross amount of that rate on debit ("S") of the debtor
// account against the revenue account of the rate; a cancellation with its absolute gross on
// credit ("H").
import type { LineItem, Settings, VatRate } from "../api/types";
import { BOM, LINE_END, SEPARATOR, csvAmount, csvLine } from "./csv";
import type { LedgerEntry } from "./ledger";
import { documentTotals } from "./money";

export interface DatevSettings {
  revenueAccount: number;
  reducedRevenueAccount: number;
  smallBusinessAccount: number;
  taxFreeAccount: number | null;
  debtorAccount: number;
  consultantNumber: number | null;
  clientNumber: number | null;
  accountLength: number;
}

export const DEFAULT_DATEV: DatevSettings = {
  revenueAccount: 8400, reducedRevenueAccount: 8300, smallBusinessAccount: 8195, taxFreeAccount: null, debtorAccount: 1400, consultantNumber: null, clientNumber: null, accountLength: 4,
};

export interface DateRange {
  from: string;
  to: string;
}

export const DATEV_COLUMNS = [
  "Umsatz (ohne Soll/Haben-Kz)", "Soll/Haben-Kennzeichen", "WKZ Umsatz", "Kurs", "Basis-Umsatz", "WKZ Basis-Umsatz", "Konto",
  "Gegenkonto (ohne BU-Schlüssel)", "BU-Schlüssel", "Belegdatum", "Belegfeld 1", "Belegfeld 2", "Skonto", "Buchungstext",
];

const TEXT_LIMIT = 60;
const RECEIPT_LIMIT = 36;
const CURRENCY = "EUR";

function compactDay(value: string): string {
  return value.replace(/-/g, "");
}

function timestamp(created: Date): string {
  const pad = (value: number, length = 2) => String(value).padStart(length, "0");
  return `${String(created.getUTCFullYear())}${pad(created.getUTCMonth() + 1)}${pad(created.getUTCDate())}`
    + `${pad(created.getUTCHours())}${pad(created.getUTCMinutes())}${pad(created.getUTCSeconds())}${pad(created.getUTCMilliseconds(), 3)}`;
}

function optionalNumber(value: number | null): string {
  return value === null ? "" : String(value);
}

/** First line of the batch (format EXTF, version 700, category 21); the fiscal year starts on 1 January. */
export function datevHeader(period: DateRange, settings: DatevSettings, description: string, created: Date): string {
  return [
    '"EXTF"', "700", "21", '"Buchungsstapel"', "13", timestamp(created), "", '"RA"', '""', '""',
    optionalNumber(settings.consultantNumber), optionalNumber(settings.clientNumber), `${period.from.slice(0, 4)}0101`,
    String(settings.accountLength), compactDay(period.from), compactDay(period.to), `"${description}"`, '""', "1", "0", "0", `"${CURRENCY}"`,
  ].join(SEPARATOR);
}

export type DatevNumbers = Pick<Settings, "datev_consultant_number" | "datev_client_number" | "datev_tax_free_account">;

function storedNumber(value: string): number | null {
  return /^\d+$/.test(value.trim()) ? Number(value.trim()) : null;
}

/** The default accounts with the numbers and the tax-free account the tax adviser gave. */
export function datevSettingsFrom(numbers: DatevNumbers): DatevSettings {
  return {
    ...DEFAULT_DATEV, consultantNumber: storedNumber(numbers.datev_consultant_number), clientNumber: storedNumber(numbers.datev_client_number),
    taxFreeAccount: storedNumber(numbers.datev_tax_free_account),
  };
}

/** Why a consultant (7 digits) or client number (5 digits) is not valid; null when it is or when empty. */
export function datevNumberProblem(text: string, maxDigits: number): string | null {
  const value = text.trim();
  if (value === "" || new RegExp(`^\\d{1,${String(maxDigits)}}$`).test(value)) return null;
  return `Bitte nur Ziffern eingeben, höchstens ${String(maxDigits)}.`;
}

export function taxFreeAccountProblem(text: string): string | null {
  const value = text.trim();
  return value === "" || /^\d{4}$/.test(value) ? null : "Das Konto für steuerfreie Umsätze hat genau vier Ziffern.";
}

type RateItem = Pick<LineItem, "quantity" | "unit_price_net" | "vat_rate">;

interface Posting {
  gross: number;
  account: number | null;
}

function accountFor(rate: VatRate, settings: DatevSettings): number | null {
  if (rate === 0) return settings.taxFreeAccount;
  return rate === 7 ? settings.reducedRevenueAccount : settings.revenueAccount;
}

// Without items the invoice is booked whole, as the RadarAuditor export did.
function postings(entry: LedgerEntry, items: RateItem[] | undefined, settings: DatevSettings): Posting[] {
  const { invoice } = entry;
  const smallBusiness = invoice.seller_snapshot?.small_business === true;
  if (smallBusiness) return [{ gross: invoice.gross, account: settings.smallBusinessAccount }];
  if (items === undefined || items.length === 0) return [{ gross: invoice.gross, account: invoice.vat === 0 ? settings.taxFreeAccount : settings.revenueAccount }];
  return documentTotals(items, false).groups.filter((group) => group.net !== 0)
    .map((group) => ({ gross: group.net + group.vat, account: accountFor(group.rate, settings) }));
}

function datevRow(entry: LedgerEntry, posting: Posting, settings: DatevSettings): string[] {
  const { invoice } = entry;
  const isCredit = entry.isCredit || posting.gross < 0;
  const receipt = (invoice.number ?? "").slice(0, RECEIPT_LIMIT);
  const bookedOn = invoice.issue_date === null ? "" : `${invoice.issue_date.slice(8, 10)}${invoice.issue_date.slice(5, 7)}`;
  return [
    csvAmount(Math.abs(posting.gross)), isCredit ? "H" : "S", CURRENCY, "", "", "", String(settings.debtorAccount),
    posting.account === null ? "" : String(posting.account), "", bookedOn, receipt, "", "", `${receipt} ${entry.customerName}`.slice(0, TEXT_LIMIT),
  ];
}

/** Postings in the column order of DATEV_COLUMNS: one per invoice and VAT rate. */
export function datevRows(entries: LedgerEntry[], settings: DatevSettings, items = new Map<string, RateItem[]>()): string[][] {
  return entries.flatMap((entry) => postings(entry, items.get(entry.invoice.id), settings).map((posting) => datevRow(entry, posting, settings)));
}

/** Numbers of invoices with tax-free lines that cannot be booked while the tax-free account is missing. */
export function missingTaxFreeAccount(entries: LedgerEntry[], settings: DatevSettings, items = new Map<string, RateItem[]>()): string[] {
  return entries.filter((entry) => postings(entry, items.get(entry.invoice.id), settings).some((posting) => posting.account === null))
    .map((entry) => entry.invoice.number ?? entry.invoice.id);
}

export function datevFile(header: string, rows: string[][]): string {
  return BOM + [header, csvLine(DATEV_COLUMNS), ...rows.map(csvLine)].join(LINE_END) + LINE_END;
}
