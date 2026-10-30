// Sends the queued outgoing mails. Subject and body are final in crm.outbox; the worker only adds
// the attachment of each kind and, for a follow-up, the opt-out headers. Every kind is sent; only the
// attachment differs. A quote waits up to 30 minutes for the audit-plus-quote PDF of the
// RadarAuditor; a failed send is retried on the next runs and marked failed after the third try.
// A mail the mail server accepted is marked sent and never queued again.
import { QUOTE_PDF_WAIT_MS } from "./config.ts";
import { errorText, WorkerError } from "./errors.ts";
import type { Attachment } from "./smtp.ts";
import type { Report } from "./state.ts";

export type OutboxKind = "contract" | "quote" | "invoice" | "dunning" | "review_request" | "review_reminder" | "appointment" | "follow_up"
  | "assistant" | "audit_proposal" | "appointment_cancel" | "appointment_reminder";
export type AttachmentKind = "contract" | "quote" | "invoice" | "dunning" | "appointment" | "appointment_cancel";

export interface OutboxRow {
  id: string;
  customer_id: string;
  to_address: string;
  subject: string;
  body: string;
  kind: OutboxKind;
  contract_id: string | null;
  quote_id: string | null;
  invoice_id: string | null;
  dunning_level: number | null;
  appointment_id: string | null;
  /** Opt-out address for the List-Unsubscribe header, empty for mails without one. */
  list_unsubscribe: string;
  attempts: number;
  created_at: string;
}

/** An attachment together with its path in crm-documents. */
export interface StoredPdf extends Attachment { path: string }
/** An attachment made for the mail alone, kept nowhere else. */
export interface MailOnlyFile extends Attachment { path: null }
export type Prepared = { status: "ready"; attachment: StoredPdf | MailOnlyFile | null } | { status: "wait" };
export type RadarQuote = { state: "none" } | { state: "ready"; path: string } | { state: "pending" } | { state: "failed" };
export interface SentMail { messageId: string; fromName: string }

export interface AttachmentSource { prepare(mail: OutboxRow, now: number): Promise<Prepared> }
export interface Transport { send(mail: OutboxRow, attachment: Attachment | null): Promise<SentMail> }

export interface OutboxStore {
  queued(): Promise<OutboxRow[]>;
  markSent(mail: OutboxRow, sentAt: string, attachmentPath: string | null): Promise<void>;
  markFailed(id: string, attempts: number, status: "queued" | "failed", error: string): Promise<void>;
  /** Files the sent mail with the customer, logs it and moves a contract to sent. */
  record(mail: OutboxRow, sent: SentMail, sentAt: string, hasAttachment: boolean): Promise<void>;
}

const MAX_ATTEMPTS = 3;
const MARK_SENT_TRIES = 3;
const MARK_SENT_PAUSE_MS = 200;

function needs(id: string | null, what: string, mail: OutboxRow): void {
  if (id === null) throw new WorkerError(`Mail „${mail.subject}“: ${what} fehlt.`);
}

export function attachmentKind(mail: OutboxRow): AttachmentKind | null {
  switch (mail.kind) {
    case "contract": return mail.contract_id === null ? null : "contract";
    case "quote": needs(mail.quote_id, "Angebot", mail); return "quote";
    case "invoice": needs(mail.invoice_id, "Rechnung", mail); return "invoice";
    case "dunning": needs(mail.invoice_id, "Rechnung", mail); return "dunning";
    case "appointment": needs(mail.appointment_id, "Termin", mail); return "appointment";
    case "appointment_cancel": needs(mail.appointment_id, "Termin", mail); return "appointment_cancel";
    default: return null;
  }
}

export function quoteSource(radar: RadarQuote, createdAt: string, now: number): "radar" | "wait" | "own" {
  if (radar.state === "ready") return "radar";
  if (radar.state === "pending" && now - Date.parse(createdAt) < QUOTE_PDF_WAIT_MS) return "wait";
  return "own";
}

export function nextFailure(attempts: number): { attempts: number; status: "queued" | "failed" } {
  const next = attempts + 1;
  return { attempts: next, status: next >= MAX_ATTEMPTS ? "failed" : "queued" };
}

export interface OutboxRun {
  store: OutboxStore;
  attachments: AttachmentSource;
  transport: Transport;
  report: Report;
  now: () => number;
  hasTime: () => boolean;
}

interface Delivery { sent: SentMail; attachment: StoredPdf | MailOnlyFile | null }

async function deliver(run: OutboxRun, mail: OutboxRow): Promise<Delivery | null> {
  const prepared = await run.attachments.prepare(mail, run.now());
  if (prepared.status === "wait") return null;
  return { sent: await run.transport.send(mail, prepared.attachment), attachment: prepared.attachment };
}

async function withRetries(write: () => Promise<void>): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await write();
    } catch (error) {
      if (attempt >= MARK_SENT_TRIES) throw error;
      await new Promise((resolve) => setTimeout(resolve, MARK_SENT_PAUSE_MS * attempt));
    }
  }
}

// Once the mail server accepted the mail, nothing may put it back in the queue: a failed write
// afterwards is reported, the mail is not sent a second time.
async function settle(run: OutboxRun, mail: OutboxRow, delivery: Delivery): Promise<void> {
  const sentAt = new Date(run.now()).toISOString();
  try {
    await withRetries(() => run.store.markSent(mail, sentAt, delivery.attachment?.path ?? null));
    await run.store.record(mail, delivery.sent, sentAt, delivery.attachment !== null);
  } catch (error) {
    run.report.errors.push(`Mail „${mail.subject}“ verschickt, aber nicht vollständig abgelegt: ${errorText(error)}`);
  }
}

async function markFailure(run: OutboxRun, mail: OutboxRow, error: unknown): Promise<void> {
  const failure = nextFailure(mail.attempts);
  await run.store.markFailed(mail.id, failure.attempts, failure.status, errorText(error).slice(0, 500));
  run.report.failed++;
}

export async function sendOutbox(run: OutboxRun): Promise<void> {
  for (const mail of await run.store.queued()) {
    if (!run.hasTime()) return;
    let delivery: Delivery | null;
    try {
      delivery = await deliver(run, mail);
    } catch (error) {
      await markFailure(run, mail, error);
      continue;
    }
    if (delivery === null) continue;
    run.report.sent++;
    await settle(run, mail, delivery);
  }
}
