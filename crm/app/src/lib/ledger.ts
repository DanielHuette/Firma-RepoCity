// Invoices of a period combined with the payments received in it, as in the RadarAuditor tax
// export: an invoice's open amount is its gross minus payments plus the (negative) gross of the
// cancellations that cancel it. A cancellation carries no open amount of its own, and a payment
// outside the period lowers nothing.
import type { Invoice, Payment } from "../api/types";
import { roundCents } from "./money";

export interface LedgerEntry {
  invoice: Invoice;
  customerName: string;
  isCredit: boolean;
  paid: number;
  paidOn: string | null;
  openAmount: number;
}

function paymentTotals(payments: Payment[]): { paid: Map<string, number>; paidOn: Map<string, string> } {
  const paid = new Map<string, number>();
  const paidOn = new Map<string, string>();
  for (const payment of payments) {
    paid.set(payment.invoice_id, roundCents((paid.get(payment.invoice_id) ?? 0) + payment.amount));
    const latest = paidOn.get(payment.invoice_id);
    if (latest === undefined || payment.paid_on > latest) paidOn.set(payment.invoice_id, payment.paid_on);
  }
  return { paid, paidOn };
}

function creditedTotals(invoices: Invoice[]): Map<string, number> {
  const credited = new Map<string, number>();
  for (const invoice of invoices) {
    const cancels = invoice.cancels_invoice_id;
    if (cancels !== null) credited.set(cancels, roundCents((credited.get(cancels) ?? 0) + invoice.gross));
  }
  return credited;
}

export function customerName(invoice: Invoice): string {
  return invoice.customer_snapshot?.name ?? invoice.customer?.name ?? invoice.customer_id;
}

/** One entry per invoice, in the given order. */
export function ledgerEntries(invoices: Invoice[], payments: Payment[]): LedgerEntry[] {
  const { paid, paidOn } = paymentTotals(payments);
  const credited = creditedTotals(invoices);
  return invoices.map((invoice) => {
    const isCredit = invoice.cancels_invoice_id !== null;
    const received = paid.get(invoice.id) ?? 0;
    const open = isCredit ? 0 : roundCents(invoice.gross + (credited.get(invoice.id) ?? 0) - received);
    return { invoice, customerName: customerName(invoice), isCredit, paid: received, paidOn: paidOn.get(invoice.id) ?? null, openAmount: open };
  });
}
