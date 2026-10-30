// Expenses for the tax adviser and the month comparison of the profit, without any reading or writing.
// Accounts of the chart SKR03 ("DATEV-Kontenrahmen ... Standardkontenrahmen (SKR 03), gültig für
// 2023", DATEV Art.-Nr. 11174): 1200 Bank and 1000 Kasse as the account the money left from. Input
// VAT keys of DATEV since 01.01.2021: 9 for 19 %, 8 for 7 % (Lexware, "DATEV-Steuerschlüssel
// hinterlegen", FAQ 000002619). As a small business there is no input VAT, so no key is set.
import type { Expense, ExpenseAccount, NettedReversal, ProfitMonth, VatRate } from "../api/types";
import { csvAmount, csvDocument } from "./csv";
import { QueryError } from "./errors";
import { roundCents } from "./money";

/** The text of the file in the encoding its XML declaration names; UTF-8 when it names none. */
export function decodeStatement(bytes: Uint8Array): string {
  const head = new TextDecoder("latin1").decode(bytes.slice(0, 200));
  const declared = /encoding\s*=\s*["']([A-Za-z0-9._-]+)["']/.exec(head)?.[1]?.toLowerCase() ?? "utf-8";
  try {
    return new TextDecoder(declared, { fatal: true }).decode(bytes);
  } catch {
    throw new QueryError("Kontoauszug lesen", `Die Datei passt nicht zu ihrer Angabe „${declared}“.`, null);
  }
}

export const BANK_ACCOUNT = 1200;
export const CASH_ACCOUNT = 1000;
const INPUT_VAT_KEY: Record<VatRate, string> = { 0: "", 7: "8", 19: "9" };
const TEXT_LIMIT = 60;
const RECEIPT_LIMIT = 36;

export const RECEIPT_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/heic", "image/webp"] as const;
export const MAX_RECEIPT_BYTES = 15 * 1024 * 1024;

/** Expenses that count: one the bank took back stays visible, but is neither booked nor handed over. */
export function countedExpenses(expenses: Expense[]): Expense[] {
  return expenses.filter((expense) => expense.reversed_by === null);
}

/** The store's answer when a retried upload finds the file of its own earlier try (HTTP 409). */
export function alreadyStored(error: { status?: number; statusCode?: string; code?: string }): boolean {
  return error.status === 409 || error.statusCode === "409" || error.code === "ResourceAlreadyExists";
}

// PostgREST codes PGRST000-003: the database could not be reached; an empty code: the request never arrived.
const TRANSIENT_CODE = /^(PGRST00[0-3]|5[0-9]{2}|429|)$/;

/** A failure worth another try: no connection, a busy or unreachable server; never a refusal. */
export function isTransient(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  return error instanceof QueryError && TRANSIENT_CODE.test(error.code ?? "");
}

/** Why a file cannot be stored as a receipt; null when it can. */
export function receiptProblem(file: { type: string; size: number }): string | null {
  if (!(RECEIPT_TYPES as readonly string[]).includes(file.type)) return "Als Beleg gehen PDF, JPEG, PNG, HEIC oder WebP.";
  if (file.size <= 0) return "Die Datei ist leer.";
  if (file.size > MAX_RECEIPT_BYTES) return "Ein Beleg darf höchstens 15 MB groß sein.";
  return null;
}

/** belege/<expense id>/<random>-<name>, the place the database accepts for a receipt of this expense. */
export function receiptPath(expenseId: string, fileName: string, random: string): string {
  const cleaned = fileName.normalize("NFKD").replace(/[^\w.-]+/g, "_").replace(/_+/g, "_").slice(-100) || "beleg";
  return `belege/${expenseId}/${random}-${cleaned}`;
}

function bookedOn(day: string): string {
  return `${day.slice(8, 10)}${day.slice(5, 7)}`;
}

/** The receipt field of DATEV for an expense: its date and the start of its id, unique and short. */
export function expenseReference(expense: Pick<Expense, "id" | "spent_on">): string {
  return `A${expense.spent_on.replace(/-/g, "")}-${expense.id.slice(0, 8)}`.slice(0, RECEIPT_LIMIT);
}

/** One posting per expense with an account, in the column order of DATEV_COLUMNS: the account in debit against bank or cash. */
export function expenseRows(expenses: Expense[], smallBusiness: boolean): string[][] {
  return expenses.filter((expense) => expense.account !== null).map((expense) => [
    csvAmount(expense.amount), "S", "EUR", "", "", "", expense.account ?? "",
    String(expense.method === "cash" ? CASH_ACCOUNT : BANK_ACCOUNT), smallBusiness ? "" : INPUT_VAT_KEY[expense.vat_rate],
    bookedOn(expense.spent_on), expenseReference(expense), "", "", `${expense.counterparty} ${expense.purpose}`.trim().slice(0, TEXT_LIMIT),
  ]);
}

/** Expenses that cannot be booked yet because no account is chosen, as "date payee amount". */
export function expensesWithoutAccount(expenses: Expense[]): string[] {
  return expenses.filter((expense) => expense.account === null)
    .map((expense) => `${expense.spent_on} ${expense.counterparty} ${csvAmount(expense.amount)} €`.trim());
}

export function receiptFileName(expense: Pick<Expense, "id" | "spent_on">, original: string): string {
  return `${expenseReference(expense)}_${original.replace(/^[0-9a-f-]{36}-/, "")}`;
}

/** The list for the tax adviser; receiptName names each receipt as the package stores it. */
export function expensesCsv(expenses: Expense[], accounts: ExpenseAccount[],
  receiptName: (expense: Expense, fileName: string) => string = receiptFileName): string {
  const names = new Map(accounts.map((account) => [account.number, account.name]));
  const rows = expenses.map((expense) => [
    expense.spent_on.split("-").reverse().join("."), csvAmount(expense.amount), expense.counterparty, expense.purpose,
    expense.account ?? "", expense.account === null ? "ohne Konto" : names.get(expense.account) ?? "", `${String(expense.vat_rate)} %`,
    expense.method === "cash" ? "Bar" : "Bank", expenseReference(expense),
    (expense.receipts ?? []).map((receipt) => receiptName(expense, receipt.file_name)).join(", "),
  ]);
  return csvDocument(["Datum", "Betrag", "Empfänger", "Verwendungszweck", "Konto", "Kontobezeichnung", "USt-Satz laut Beleg", "Bezahlt über", "Belegfeld", "Belege"], rows);
}

export interface MonthRow extends ProfitMonth {
  /** Profit minus the profit of the month before; null for the first month shown. */
  change: number | null;
}

export function monthRows(months: ProfitMonth[]): MonthRow[] {
  return months.map((month, index) => {
    const before = index === 0 ? undefined : months[index - 1];
    return { ...month, change: before === undefined ? null : roundCents(month.profit - before.profit) };
  });
}

export interface YearTotal {
  year: number;
  income: number;
  expenses: number;
  profit: number;
}

/** Totals of the calendar year of the last month in the list, up to that month. */
export function yearToDate(months: ProfitMonth[]): YearTotal | null {
  const last = months.at(-1);
  if (last === undefined) return null;
  const year = Number(last.month.slice(0, 4));
  const sameYear = months.filter((month) => Number(month.month.slice(0, 4)) === year);
  const sum = (pick: (month: ProfitMonth) => number) => roundCents(sameYear.reduce((total, month) => total + pick(month), 0));
  return { year, income: sum((month) => month.income), expenses: sum((month) => month.expenses), profit: sum((month) => month.profit) };
}

/** The first day of the month twelve months before the given YYYY-MM-DD day's month, so a year is shown. */
export function yearBefore(day: string): string {
  const year = Number(day.slice(0, 4));
  const month = Number(day.slice(5, 7));
  const startMonth = month === 12 ? 1 : month + 1;
  const startYear = month === 12 ? year : year - 1;
  return `${String(startYear)}-${String(startMonth).padStart(2, "0")}-01`;
}

/** The reversals netted in the period: each says which earlier income or expense no longer counts. */
export function reversalsCsv(rows: NettedReversal[]): string {
  const day = (value: string) => value.split("-").reverse().join(".");
  return csvDocument(["Rückbuchung am", "Betrag", "Gegenüber", "Ursprüngliche Buchung vom", "Verwendungszweck", "Rechnung", "Wirkung"],
    rows.map((row) => [day(row.booked_on), csvAmount(row.amount), row.counterparty, day(row.original_on), row.purpose, row.invoice_number ?? "",
      `${row.original_direction === "in" ? "Einnahme" : "Ausgabe"} vom ${day(row.original_on)} zählt nicht mehr`]));
}
