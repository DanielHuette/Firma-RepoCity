// The database side of filing, triage, outbox and documents, over PostgREST and Storage. The
// modules that decide what happens only see the interfaces, so they are tested without a database.
import { WorkerError } from "./errors.ts";
import type { FilingStore } from "./filing.ts";
import { type DocumentStore, type MailAppointment, storedPdfQuery } from "./documents.ts";
import type { OutboxRow, OutboxStore, RadarQuote } from "./outbox.ts";
import { toDunningData } from "./pdf/dunning.ts";
import { toInvoiceData } from "./pdf/invoice.ts";
import { toSeller } from "./pdf/model.ts";
import { toQuoteData } from "./pdf/quote.ts";
import { CRM_BUCKET, download, insert, list, patch, RADAR_BUCKET, remove, rpc, select, selectAll, upload } from "./rest.ts";
import type { TriageRow, TriageStore } from "./triage.ts";

type Row = Record<string, unknown>;
const PDF = "application/pdf";

async function first(path: string, what: string): Promise<Row> {
  const rows = await select<Row[]>(path);
  if (rows.length === 0) throw new WorkerError(`${what} nicht gefunden.`);
  return rows[0];
}

export const filingStore: FilingStore = {
  async addEmail(row) {
    const rows = await insert<{ id: string }[]>("emails", row, "message_id");
    return rows[0]?.id ?? null;
  },
  async addAttachment(file) {
    await upload(file.path, file.bytes, file.type);
    await insert("documents", { customer_id: file.customerId, kind: "attachment", title: file.name.slice(0, 300), file_path: file.path, mime_type: file.type,
      size_bytes: file.bytes.length, source: "email", email_id: file.emailId }, "file_path");
  },
  async queueCustomerMail(row) {
    await insert("mail_triage", row);
  },
};

const TRIAGE_COLUMNS = "id,status,direction,address,name,subject,body_text,folder,raw_path,result,created_at";

export const triageStore: TriageStore = {
  saveRaw: (path, raw) => upload(path, raw, "message/rfc822"),
  async queueUnknown(row) {
    await insert("mail_triage", row);
  },
  countReview: (id, count, sentAt, subject) => patch("mail_review", `id=eq.${id}`, { mail_count: count, sent_at: sentAt, subject }).then(() => undefined),
  async addReview(row) {
    const rows = await insert<{ id: string }[]>("mail_review", row, "address");
    return rows[0]?.id ?? null;
  },
  verdicts: () => select<TriageRow[]>(`mail_triage?kind=eq.unknown_sender&status=in.(classified,failed)&order=created_at&limit=25&select=${TRIAGE_COLUMNS}`),
  async rawFiles(row) {
    return [...(row.raw_path === "" ? [] : [row.raw_path]), ...await list(`triage/${row.id}/`)];
  },
  readRaw: (path) => download(path),
  dropRaw: (paths) => remove(paths),
  intake: (contact) => rpc<string>("intake_contact", {
    p_channel: "email", p_email: contact.email, p_name: contact.name, p_company: contact.company, p_phone: "", p_subject: contact.subject, p_message: contact.message,
  }),
  markApplied: (id) => patch("mail_triage", `id=eq.${id}`, { status: "applied", applied_at: new Date().toISOString() }).then(() => undefined),
};

const OUTBOX_COLUMNS = "id,customer_id,to_address,subject,body,kind,contract_id,quote_id,invoice_id,dunning_level,appointment_id,list_unsubscribe,attempts,created_at";

export function outboxStore(mailbox: string): OutboxStore {
  return {
    queued: () => select<OutboxRow[]>(`outbox?status=eq.queued&order=created_at&limit=25&select=${OUTBOX_COLUMNS}`),
    markSent: (mail, sentAt, attachmentPath) =>
      patch("outbox", `id=eq.${mail.id}`, { status: "sent", sent_at: sentAt, error: "", attachment_path: attachmentPath }).then(() => undefined),
    markFailed: (id, attempts, status, error) => patch("outbox", `id=eq.${id}`, { attempts, status, error }).then(() => undefined),
    async record(mail, sent, sentAt, hasAttachment) {
      await insert("emails", { customer_id: mail.customer_id, message_id: sent.messageId, direction: "out", from_address: mailbox, from_name: sent.fromName,
        to_addresses: [mail.to_address], subject: mail.subject, body_text: mail.body, sent_at: sentAt, folder: "CRM", has_attachments: hasAttachment }, "message_id");
      if (mail.kind === "contract" && mail.contract_id !== null) await patch("contracts", `id=eq.${mail.contract_id}`, { status: "sent", sent_at: sentAt });
      await insert("activities", { customer_id: mail.customer_id, kind: "email", body: `„${mail.subject}“ per E-Mail an ${mail.to_address} gesendet.`, actor: "Postfach" });
    },
  };
}

function radarState(rows: { file_path: string | null; data: Row | null }[]): RadarQuote {
  if (rows.length === 0) return { state: "none" };
  const [request] = rows;
  if (request.file_path !== null && request.file_path !== "") return { state: "ready", path: request.file_path };
  const error = request.data?.error;
  return typeof error === "string" && error.trim() !== "" ? { state: "failed" } : { state: "pending" };
}

const settingsRow = () => first("settings?id=eq.1&select=*", "Firmendaten");

async function invoicesWithoutPdf(limit: number): Promise<string[]> {
  const [finalised, documented] = await Promise.all([
    selectAll<{ id: string }>("invoices?status=in.(open,paid,cancelled)&select=id&order=finalized_at"),
    selectAll<{ invoice_id: string }>("documents?kind=eq.invoice&invoice_id=not.is.null&select=invoice_id&order=created_at"),
  ]);
  const done = new Set(documented.map((row) => row.invoice_id));
  return finalised.map((row) => row.id).filter((id) => !done.has(id)).slice(0, limit);
}

export const documentStore: DocumentStore = {
  async existing(kind, id) {
    const rows = await select<{ file_path: string }[]>(storedPdfQuery(kind, id));
    return rows[0]?.file_path ?? null;
  },
  read: (path, bucket) => download(path, bucket === "radar" ? RADAR_BUCKET : CRM_BUCKET),
  async save(doc, bytes) {
    await upload(doc.file_path, bytes, PDF);
    await insert("documents", { ...doc, mime_type: PDF, size_bytes: bytes.length }, "file_path");
  },
  radarQuote: async (quoteId) =>
    radarState(await select(`documents?kind=eq.audit_quote&data->>quote_id=eq.${quoteId}&order=created_at.desc&limit=1&select=file_path,data`, "public")),
  contract: async (id) => (await first(`contracts?id=eq.${id}&select=id,number,title,body`, "Vertrag")) as { id: string; number: string; title: string; body: string },
  seller: async () => toSeller(await settingsRow()),
  quote: async (id) => toQuoteData(await first(`quotes?id=eq.${id}&select=*,quote_items(*),customers(*)`, "Angebot"), await settingsRow()),
  async invoice(id) {
    const row = await first(`invoices?id=eq.${id}&select=*,invoice_items(*)`, "Rechnung");
    const original = typeof row.cancels_invoice_id === "string"
      ? await first(`invoices?id=eq.${row.cancels_invoice_id}&select=number,issue_date`, "Stornierte Rechnung") as { number: string; issue_date: string } : null;
    return { customerId: String(row.customer_id), data: toInvoiceData(row, original) };
  },
  dunning: async (invoiceId, level, today) =>
    toDunningData(await first(`invoices?id=eq.${invoiceId}&select=number,issue_date,due_date,gross,paid_amount,customers(*)`, "Rechnung"), level, await settingsRow(), today),
  invoicesWithoutPdf,
  appointment: async (id) =>
    (await select<MailAppointment[]>(`appointments?id=eq.${id}&select=id,kind,title,starts_on,starts_at,ends_at,location,note,updated_at,status`))[0] ?? null,
};
