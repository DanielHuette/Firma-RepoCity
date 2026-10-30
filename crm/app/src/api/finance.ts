// Reads and writes of the page Finanzen: bank statements, incoming payments, expenses with receipts
// and the profit per month. Reading the statement, matching and every rule live in the database
// (migration 007_finanzen.sql); this module only calls it.
import { QueryError } from "../lib/errors";
import { alreadyStored, decodeStatement, isTransient, receiptPath, receiptProblem } from "../lib/finance";
import { retry } from "../lib/retry";
import { check, unwrap } from "./result";
import { supabase } from "./supabase";
import type { BankImport, BankTransaction, Expense, ExpenseAccount, ImportResult, Invoice, NettedReversal, ProfitMonth, Receipt, UnlinkedPayment, VatRate } from "./types";

export const RECEIPTS_BUCKET = "crm-receipts";
const MAX_STATEMENT_BYTES = 1024 * 1024;
const PAGE = 1000;
const LINK_SECONDS = 120;
// Three tries in all; a file stored without its entry is added by the hourly check of the database.
const SAVE_WAITS = [1000, 4000];

export async function importStatement(file: File): Promise<ImportResult> {
  if (file.size > MAX_STATEMENT_BYTES) throw new QueryError("Kontoauszug lesen", "Der Kontoauszug ist größer als 1 MB. Bitte kürzere Zeiträume einzeln herunterladen.", null);
  const text = decodeStatement(new Uint8Array(await file.arrayBuffer()));
  return unwrap("Kontoauszug einlesen", await supabase.rpc("import_bank_statement", { p_file_name: file.name, p_xml: text })) as ImportResult;
}

export async function listImports(): Promise<BankImport[]> {
  return unwrap("Kontoauszüge laden", await supabase.from("bank_imports").select("*").order("imported_at", { ascending: false }).limit(5)
    .overrideTypes<BankImport[], { merge: false }>());
}

/** The transactions since the given day and every unclear one, however old: those hold the reminders. */
export async function listTransactions(from: string): Promise<BankTransaction[]> {
  const select = "*, invoice:invoices(id, number)";
  const [recent, unclear] = await Promise.all([
    supabase.from("bank_transactions").select(select).gte("booking_date", from).order("booking_date", { ascending: false })
      .order("created_at", { ascending: false }).limit(PAGE).overrideTypes<BankTransaction[], { merge: false }>(),
    supabase.from("bank_transactions").select(select).lt("booking_date", from).in("status", ["open", "suggested"])
      .order("booking_date", { ascending: false }).limit(PAGE).overrideTypes<BankTransaction[], { merge: false }>(),
  ]);
  return [...unwrap("Buchungen laden", recent), ...unwrap("Unklare Buchungen laden", unclear)];
}

export type OpenInvoice = Pick<Invoice, "id" | "number" | "gross" | "paid_amount" | "customer">;

export async function listOpenInvoices(): Promise<OpenInvoice[]> {
  return unwrap("Offene Rechnungen laden", await supabase.from("invoices").select("id, number, gross, paid_amount, customer:customers(id, name)")
    .eq("status", "open").is("cancels_invoice_id", null).order("number").overrideTypes<OpenInvoice[], { merge: false }>());
}

export async function assignToInvoice(transaction: string, invoice: string): Promise<void> {
  check("Zahlung zuordnen", await supabase.rpc("classify_incoming", { p_transaction: transaction, p_status: "paid", p_invoice: invoice }));
}

export async function classifyIncoming(transaction: string, status: "other_income" | "private"): Promise<void> {
  check("Zahlung einordnen", await supabase.rpc("classify_incoming", { p_transaction: transaction, p_status: status }));
}

export async function classifyOutgoing(transaction: string, status: "expense" | "private"): Promise<void> {
  check("Buchung einordnen", await supabase.rpc("classify_outgoing", { p_transaction: transaction, p_status: status }));
}

export async function listUnlinkedPayments(amount: number): Promise<UnlinkedPayment[]> {
  return unwrap("Erfasste Zahlungen laden", await supabase.rpc("unlinked_payments", { p_amount: amount })) as UnlinkedPayment[];
}

export async function linkPayment(transaction: string, payment: string): Promise<void> {
  check("Zahlung verknüpfen", await supabase.rpc("link_payment", { p_transaction: transaction, p_payment: payment }));
}

/** Bookings this reversal may take back, the best fits first. */
export async function listReversalCandidates(reversal: string): Promise<BankTransaction[]> {
  return unwrap("Passende Buchungen laden", await supabase.rpc("reversal_candidates", { p_reversal: reversal }).select("*, invoice:invoices(id, number)")) as BankTransaction[];
}

export async function netReversal(reversal: string, original: string): Promise<void> {
  check("Rückbuchung verrechnen", await supabase.rpc("net_reversal", { p_reversal: reversal, p_original: original }));
}

/** Reversals netted in the period, each with the booking it took back. */
export async function listNettedReversals(from: string, to: string): Promise<NettedReversal[]> {
  const reversals = unwrap("Rückbuchungen laden", await supabase.from("bank_transactions").select("booking_date, amount, reverses_transaction_id")
    .eq("reversal", true).eq("status", "reversed").gte("booking_date", from).lte("booking_date", to).order("booking_date").limit(PAGE)
    .overrideTypes<Pick<BankTransaction, "booking_date" | "amount" | "reverses_transaction_id">[], { merge: false }>());
  const ids = reversals.flatMap((row) => (row.reverses_transaction_id === null ? [] : [row.reverses_transaction_id]));
  if (ids.length === 0) return [];
  const originals = unwrap("Rückbuchungen laden", await supabase.from("bank_transactions").select("id, booking_date, direction, counterparty, purpose, invoice:invoices(id, number)")
    .in("id", ids).overrideTypes<Pick<BankTransaction, "id" | "booking_date" | "direction" | "counterparty" | "purpose" | "invoice">[], { merge: false }>());
  const byId = new Map(originals.map((row) => [row.id, row]));
  return reversals.flatMap((row) => {
    const original = row.reverses_transaction_id === null ? undefined : byId.get(row.reverses_transaction_id);
    if (original === undefined) return [];
    return [{ booked_on: row.booking_date, amount: row.amount, counterparty: original.counterparty, original_on: original.booking_date,
      original_direction: original.direction, purpose: original.purpose, invoice_number: original.invoice?.number ?? null }];
  });
}

export async function releaseTransaction(transaction: string): Promise<void> {
  check("Zuordnung zurücknehmen", await supabase.rpc("release_transaction", { p_transaction: transaction }));
}

export async function listAccounts(): Promise<ExpenseAccount[]> {
  return unwrap("Konten laden", await supabase.from("expense_accounts").select("*").order("position").overrideTypes<ExpenseAccount[], { merge: false }>());
}

/** Every expense of the period, read in pages because the server returns at most 1000 rows at once. */
export async function listExpenses(from: string, to: string): Promise<Expense[]> {
  const all: Expense[] = [];
  for (let start = 0; ; start += PAGE) {
    const page = unwrap("Ausgaben laden", await supabase.from("expenses").select("*, receipts(*)").gte("spent_on", from).lte("spent_on", to)
      .order("spent_on", { ascending: false }).order("created_at", { ascending: false }).order("id").range(start, start + PAGE - 1)
      .overrideTypes<Expense[], { merge: false }>());
    all.push(...page);
    if (page.length < PAGE) return all;
  }
}

export async function setExpenseAccount(expense: string, account: string, vatRate: VatRate): Promise<void> {
  check("Konto speichern", await supabase.rpc("set_expense_account", { p_expense: expense, p_account: account, p_vat_rate: vatRate }));
}

export interface CashExpense {
  spentOn: string;
  amount: number;
  counterparty: string;
  purpose: string;
  account: string;
  vatRate: VatRate;
}

export async function addCashExpense(input: CashExpense): Promise<Expense> {
  return unwrap("Barausgabe speichern", await supabase.rpc("add_cash_expense", {
    p_spent_on: input.spentOn, p_amount: input.amount, p_counterparty: input.counterparty, p_purpose: input.purpose,
    p_account: input.account, p_vat_rate: input.vatRate,
  }).single<Expense>());
}

async function storeFile(path: string, file: File): Promise<void> {
  const upload = await supabase.storage.from(RECEIPTS_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
  if (upload.error === null || alreadyStored(upload.error)) return;
  const status = "status" in upload.error && typeof upload.error.status === "number" ? String(upload.error.status) : null;
  throw new QueryError("Beleg hochladen", upload.error.message, status);
}

async function saveReceipt(expense: string, path: string, file: File): Promise<Receipt> {
  return unwrap("Beleg speichern", await supabase.rpc("add_receipt", {
    p_expense: expense, p_path: path, p_file_name: file.name, p_content_type: file.type, p_size: file.size,
  }).single<Receipt>());
}

/** Upload and entry each get three tries while the connection fails; saving the same path twice keeps one receipt. */
export async function uploadReceipt(expense: string, file: File): Promise<Receipt> {
  const problem = receiptProblem(file);
  if (problem !== null) throw new QueryError("Beleg hochladen", problem, null);
  const path = receiptPath(expense, file.name, crypto.randomUUID());
  await retry(() => storeFile(path, file), SAVE_WAITS, { retryable: isTransient });
  try {
    return await retry(() => saveReceipt(expense, path, file), SAVE_WAITS, { retryable: isTransient });
  } catch (error) {
    if (!isTransient(error)) throw error;
    throw new QueryError("Beleg speichern",
      "Der Beleg ist hochgeladen, ließ sich wegen der Verbindung aber nicht eintragen. Das CRM trägt ihn innerhalb einer Stunde selbst nach; klappt auch das nicht, kommt eine Nachricht ins Cockpit.", null);
  }
}

export async function receiptLink(path: string): Promise<string> {
  const result = await supabase.storage.from(RECEIPTS_BUCKET).createSignedUrl(path, LINK_SECONDS);
  if (result.error !== null) throw new QueryError("Beleg öffnen", result.error.message, null);
  return result.data.signedUrl;
}

export async function downloadReceipt(path: string): Promise<Uint8Array> {
  const result = await supabase.storage.from(RECEIPTS_BUCKET).download(path);
  if (result.error !== null) throw new QueryError("Beleg herunterladen", result.error.message, null);
  return new Uint8Array(await result.data.arrayBuffer());
}

export async function profitByMonth(from: string, to: string): Promise<ProfitMonth[]> {
  return unwrap("Gewinn rechnen", await supabase.rpc("profit_by_month", { p_from: from, p_to: to })) as ProfitMonth[];
}
