// Reads and writes of the automated flow: sending quotes and invoices through the outbox, the mail
// state, generated PDFs, RadarAuditor audits, monthly audit runs, review requests, mail texts, mail
// triage and the data of the tax adviser package.
import { QueryError } from "../lib/errors";
import { BUCKET } from "./crm";
import { check, unwrap } from "./result";
import { supabase } from "./supabase";
import type {
  Audit, LineItem, AuditRun, CrmDocument, MailText, MailTextKey, MailTriage, OutboxMail, PaymentWithInvoice, ReviewRequest, Subscription,
} from "./types";

export type MailOwner = "quote_id" | "invoice_id" | "customer_id";

const REPORTS_BUCKET = "reports";
const LINK_SECONDS = 120;
const ID_BATCH = 100;

// Sending

export async function acceptQuoteInCrm(id: string): Promise<void> {
  check("Angebot annehmen", await supabase.rpc("accept_quote_via", { p_quote: id, p_channel: "crm" }));
}

export async function declineQuoteInCrm(id: string): Promise<void> {
  check("Angebot ablehnen", await supabase.rpc("decline_quote_via", { p_quote: id, p_channel: "crm" }));
}

export async function completeOrder(id: string): Promise<void> {
  check("Auftrag abschließen", await supabase.rpc("complete_order", { p_order: id }));
}

export async function sendQuote(id: string): Promise<void> {
  check("Angebot abschicken", await supabase.rpc("send_quote", { p_quote: id }));
}

export async function sendInvoice(id: string): Promise<void> {
  check("Rechnung senden", await supabase.rpc("send_invoice", { p_invoice: id }));
}

export async function listMails(owner: MailOwner, id: string): Promise<OutboxMail[]> {
  return unwrap("Versand laden", await supabase.from("outbox")
    .select("id, kind, status, to_address, subject, error, attempts, created_at, sent_at")
    .eq(owner, id).order("created_at", { ascending: false }).limit(50).overrideTypes<OutboxMail[], { merge: false }>());
}

export async function listGeneratedPdfs(owner: "quote_id" | "invoice_id", id: string): Promise<CrmDocument[]> {
  return unwrap("PDF laden", await supabase.from("documents").select("*").eq(owner, id).eq("source", "generated")
    .order("created_at").overrideTypes<CrmDocument[], { merge: false }>());
}

// RadarAuditor audits, monthly audit runs and review requests

export async function listCustomerAudits(customerId: string): Promise<Audit[]> {
  return unwrap("Prüfungen laden", await supabase.schema("public").from("audits")
    .select("id, status, purpose, total_score, requested_at, finished_at, report_path, customers!inner(crm_customer_id)")
    .eq("customers.crm_customer_id", customerId).order("requested_at", { ascending: false }).overrideTypes<Audit[], { merge: false }>());
}

export async function reportLink(path: string): Promise<string> {
  const result = await supabase.storage.from(REPORTS_BUCKET).createSignedUrl(path, LINK_SECONDS);
  if (result.error !== null) throw new QueryError("Bericht öffnen", result.error.message, null);
  return result.data.signedUrl;
}

const RUN_FIELDS = "*, customer:customers(id, name)";

export async function listAuditRuns(customerId: string): Promise<AuditRun[]> {
  return unwrap("Monatsprüfungen laden", await supabase.from("audit_runs").select(RUN_FIELDS).eq("customer_id", customerId)
    .order("month", { ascending: false }).overrideTypes<AuditRun[], { merge: false }>());
}

export async function listOpenAuditRuns(): Promise<AuditRun[]> {
  return unwrap("Monatsprüfungen laden", await supabase.from("audit_runs").select(RUN_FIELDS).in("status", ["due", "failed"])
    .order("month").overrideTypes<AuditRun[], { merge: false }>());
}

export async function startAuditRun(id: string): Promise<void> {
  check("Prüfung starten", await supabase.rpc("start_audit_run", { p_run: id }));
}

export async function listReviewRequests(customerId: string): Promise<ReviewRequest[]> {
  return unwrap("Bewertungen laden", await supabase.from("review_requests").select("*").eq("customer_id", customerId)
    .order("created_at", { ascending: false }).overrideTypes<ReviewRequest[], { merge: false }>());
}

export async function markReviewDone(id: string): Promise<void> {
  check("Bewertung abhaken", await supabase.rpc("mark_review_done", { p_request: id }));
}

export async function listCustomerSubscriptions(customerId: string): Promise<Subscription[]> {
  return unwrap("Abos laden", await supabase.from("subscriptions").select("*, product:products(id, name, price_net)")
    .eq("customer_id", customerId).overrideTypes<Subscription[], { merge: false }>());
}

// Mail texts and mail triage

export async function listMailTexts(): Promise<MailText[]> {
  return unwrap("Mail-Texte laden", await supabase.from("mail_texts").select("*").order("key").overrideTypes<MailText[], { merge: false }>());
}

export async function saveMailText(key: MailTextKey, subject: string, body: string): Promise<void> {
  check("Mail-Text speichern", await supabase.from("mail_texts").update({ subject, body, updated_at: new Date().toISOString() }).eq("key", key));
}

export async function listMailTriage(): Promise<MailTriage[]> {
  return unwrap("Mail-Prüfung laden", await supabase.from("mail_triage")
    .select("id, kind, status, address, name, subject, attempts, error, created_at").in("status", ["queued", "claimed", "failed"])
    .order("created_at").limit(200).overrideTypes<MailTriage[], { merge: false }>());
}

// Tax adviser package

export async function paymentsForPeriod(from: string, to: string): Promise<PaymentWithInvoice[]> {
  return unwrap("Zahlungen laden", await supabase.from("payments")
    .select("*, invoice:invoices(id, number, customer_snapshot, customer:customers(id, name))")
    .gte("paid_on", from).lte("paid_on", to).order("paid_on").overrideTypes<PaymentWithInvoice[], { merge: false }>());
}

/** Storage path of the invoice PDF per invoice: the oldest document of kind invoice, never a dunning letter. */
export async function invoicePdfPaths(invoiceIds: string[]): Promise<Map<string, string>> {
  const paths = new Map<string, string>();
  for (let start = 0; start < invoiceIds.length; start += ID_BATCH) {
    const rows = unwrap("PDFs suchen", await supabase.from("documents").select("invoice_id, file_path").eq("kind", "invoice")
      .in("invoice_id", invoiceIds.slice(start, start + ID_BATCH)).order("created_at").overrideTypes<{ invoice_id: string; file_path: string }[], { merge: false }>());
    for (const row of rows) if (!paths.has(row.invoice_id)) paths.set(row.invoice_id, row.file_path);
  }
  return paths;
}

export type RateItem = Pick<LineItem, "quantity" | "unit_price_net" | "vat_rate">;

/** Items of the given invoices grouped by invoice, for the DATEV postings per VAT rate. */
export async function invoiceItems(invoiceIds: string[]): Promise<Map<string, RateItem[]>> {
  const byInvoice = new Map<string, RateItem[]>();
  for (let start = 0; start < invoiceIds.length; start += ID_BATCH) {
    const rows = unwrap("Positionen laden", await supabase.from("invoice_items").select("invoice_id, quantity, unit_price_net, vat_rate")
      .in("invoice_id", invoiceIds.slice(start, start + ID_BATCH)).overrideTypes<(RateItem & { invoice_id: string })[], { merge: false }>());
    for (const row of rows) byInvoice.set(row.invoice_id, [...(byInvoice.get(row.invoice_id) ?? []), row]);
  }
  return byInvoice;
}

export async function downloadDocument(path: string): Promise<Uint8Array> {
  const result = await supabase.storage.from(BUCKET).download(path);
  if (result.error !== null) throw new QueryError("PDF herunterladen", result.error.message, null);
  return new Uint8Array(await result.data.arrayBuffer());
}
