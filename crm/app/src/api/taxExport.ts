// Loads everything the tax adviser package needs for one period, expenses and receipts included, and assembles the zip.
import { mapLimited } from "../lib/concurrency";
import { datevSettingsFrom, type DatevNumbers } from "../lib/datev";
import { ledgerEntries } from "../lib/ledger";
import { assemblePackage, periodRange, type TaxPackage, type TaxPeriod } from "../lib/taxPackage";
import { invoicesForPeriod } from "./crm";
import { countedExpenses } from "../lib/finance";
import { downloadReceipt, listAccounts, listExpenses, listNettedReversals } from "./finance";
import type { Expense } from "./types";
import { downloadDocument, invoiceItems, invoicePdfPaths, paymentsForPeriod } from "./flow";

const PARALLEL_DOWNLOADS = 4;

export type Progress = (done: number, total: number) => void;

async function downloadPdfs(paths: Map<string, string>, onProgress: Progress): Promise<Map<string, Uint8Array>> {
  const entries = [...paths.entries()];
  let done = 0;
  onProgress(0, entries.length);
  const files = await mapLimited(entries, PARALLEL_DOWNLOADS, async ([invoiceId, path]) => {
    const bytes = await downloadDocument(path);
    done += 1;
    onProgress(done, entries.length);
    return [invoiceId, bytes] as const;
  });
  return new Map(files);
}

async function downloadReceipts(expenses: Expense[]): Promise<Map<string, Uint8Array>> {
  const paths = expenses.flatMap((expense) => (expense.receipts ?? []).map((receipt) => receipt.path));
  const files = await mapLimited(paths, PARALLEL_DOWNLOADS, async (path) => [path, await downloadReceipt(path)] as const);
  return new Map(files);
}

export interface PackageResult extends TaxPackage {
  invoiceCount: number;
  paymentCount: number;
  expenseCount: number;
}

export async function buildTaxPackage(period: TaxPeriod, numbers: DatevNumbers & { small_business: boolean }, onProgress: Progress): Promise<PackageResult> {
  const { from, to } = periodRange(period);
  const [invoices, payments, listed, accounts, reversals] = await Promise.all([
    invoicesForPeriod(from, to), paymentsForPeriod(from, to), listExpenses(from, to), listAccounts(), listNettedReversals(from, to),
  ]);
  const expenses = countedExpenses(listed);
  const ids = invoices.map((invoice) => invoice.id);
  const [items, paths] = await Promise.all([invoiceItems(ids), invoicePdfPaths(ids)]);
  const [pdfs, receipts] = await Promise.all([downloadPdfs(paths, onProgress), downloadReceipts(expenses)]);
  const datev = datevSettingsFrom(numbers);
  const result = assemblePackage({
    period, entries: ledgerEntries(invoices, payments), payments, pdfs, items, datev, created: new Date(),
    expenses: { list: [...expenses].reverse(), accounts, receipts, smallBusiness: numbers.small_business }, reversals,
  });
  return { ...result, invoiceCount: invoices.length, paymentCount: payments.length, expenseCount: expenses.length };
}
