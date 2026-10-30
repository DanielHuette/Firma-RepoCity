// The files the worker generates and attaches: contract, quote (the RadarAuditor's audit-plus-quote
// PDF when there is one), invoice and payment reminder as PDF, each stored in crm-documents under
// customers/<customer id>/ and as a crm.documents row, so the customer file and the tax adviser
// package hold exactly what was sent; an invoice keeps its first PDF and later mails send that file.
// An appointment confirmation carries the appointment as iCalendar file, made for the mail alone; the
// cancellation of a replaced appointment travels in a mail of its own, one calendar object per mail, so
// every mail program reads it as what it is.
import { type AppointmentRow, cancellationEvent, confirmationEvent } from "../_shared/appointment.ts";
import { buildCalendar, type Organizer } from "../_shared/ical.ts";
import { INVOICE_PDFS_PER_RUN } from "./config.ts";
import { errorText, WorkerError } from "./errors.ts";
import { safeName } from "./mail.ts";
import { type AttachmentSource, attachmentKind, type MailOnlyFile, type OutboxRow, type Prepared, quoteSource, type RadarQuote, type StoredPdf } from "./outbox.ts";
import { contractPdf } from "./pdf/contract.ts";
import { type DunningData, dunningPdf, dunningTitle } from "./pdf/dunning.ts";
import { type InvoiceData, invoicePdf, invoiceTitle } from "./pdf/invoice.ts";
import type { Seller } from "./pdf/model.ts";
import { type QuoteData, quotePdf } from "./pdf/quote.ts";
import type { Report } from "./state.ts";

export interface GeneratedDocument {
  customer_id: string;
  kind: "contract" | "quote" | "invoice" | "other";
  title: string;
  file_path: string;
  source: "generated";
  contract_id?: string;
  quote_id?: string;
  invoice_id?: string;
}

export interface MailAppointment extends AppointmentRow { status: string }

export interface DocumentStore {
  /** File path of the stored quote or invoice PDF of that id, if there is one. */
  existing(kind: "quote" | "invoice", id: string): Promise<string | null>;
  read(path: string, bucket: "crm" | "radar"): Promise<Uint8Array>;
  /** Uploads the file and inserts its crm.documents row; both are idempotent by path. */
  save(doc: GeneratedDocument, bytes: Uint8Array): Promise<void>;
  radarQuote(quoteId: string): Promise<RadarQuote>;
  contract(id: string): Promise<{ id: string; number: string; title: string; body: string }>;
  seller(): Promise<Seller>;
  quote(id: string): Promise<QuoteData>;
  invoice(id: string): Promise<{ customerId: string; data: InvoiceData }>;
  dunning(invoiceId: string, level: number, today: string): Promise<DunningData>;
  /** Finalised invoices, cancellation invoices included, that have no invoice PDF yet. */
  invoicesWithoutPdf(limit: number): Promise<string[]>;
  /** The appointment row, null when it was deleted. */
  appointment(id: string): Promise<MailAppointment | null>;
}

const PDF = "application/pdf";
// PUBLISH (RFC 5546, section 3.2.1) posts an event without asking for an answer: the customer's
// calendar program offers to add it, sends no acceptance back and expects no attendee list. REQUEST
// would be an invitation that waits for replies, which a confirmation of an agreed time is not.
const CALENDAR = "text/calendar; charset=utf-8; method=PUBLISH";
// CANCEL (RFC 5546, section 3.2.5) takes the published event of the same UID out of the calendar.
const CANCELLATION = "text/calendar; charset=utf-8; method=CANCEL";

/** Reminder letters also carry an invoice_id (kind other), so the invoice PDF is looked up by kind. */
export function storedPdfQuery(kind: "quote" | "invoice", id: string): string {
  return `documents?kind=eq.${kind}&${kind}_id=eq.${id}&select=file_path&order=created_at.asc&limit=1`;
}

/** Calendar day in Germany as YYYY-MM-DD; letters carry the date Daniel's customers live in. */
export function berlinDate(now: number): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(now);
}

const fileName = (title: string) => `${safeName(title)}.pdf`;
const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1);

async function store(documents: DocumentStore, doc: Omit<GeneratedDocument, "file_path" | "source" | "title">, folder: string, title: string, bytes: Uint8Array): Promise<StoredPdf> {
  const name = fileName(title);
  const path = `customers/${doc.customer_id}/${folder}/${name}`;
  await documents.save({ ...doc, title: `${title}.pdf`, file_path: path, source: "generated" }, bytes);
  return { name, bytes, type: PDF, path };
}

async function storedFile(documents: DocumentStore, path: string): Promise<StoredPdf> {
  return { name: baseName(path), bytes: await documents.read(path, "crm"), type: PDF, path };
}

/** Renders and stores the PDF of a finalised invoice. */
export async function invoiceDocument(documents: DocumentStore, invoiceId: string): Promise<StoredPdf> {
  const { customerId, data } = await documents.invoice(invoiceId);
  return store(documents, { customer_id: customerId, kind: "invoice", invoice_id: invoiceId }, "rechnungen", invoiceTitle(data), await invoicePdf(data));
}

export class Attachments implements AttachmentSource {
  /** mailbox: the sending address, the organizer of confirmed appointments. */
  constructor(private readonly documents: DocumentStore, private readonly mailbox: string) {}

  async prepare(mail: OutboxRow, now: number): Promise<Prepared> {
    switch (attachmentKind(mail)) {
      case null: return { status: "ready", attachment: null };
      case "quote": return this.quote(mail, now);
      case "contract": return { status: "ready", attachment: await this.contract(mail) };
      case "invoice": return { status: "ready", attachment: await this.invoice(this.id(mail.invoice_id)) };
      case "dunning": return { status: "ready", attachment: await this.dunning(mail, now) };
      case "appointment": return { status: "ready", attachment: await this.appointment(mail, now) };
      case "appointment_cancel": return { status: "ready", attachment: await this.cancellation(mail, now) };
    }
  }

  private id(value: string | null): string {
    if (value === null) throw new WorkerError("Verweis der Mail fehlt.");
    return value;
  }

  private async contract(mail: OutboxRow): Promise<StoredPdf> {
    const contract = await this.documents.contract(this.id(mail.contract_id));
    const title = `${contract.title} ${contract.number}`;
    const bytes = await contractPdf(title, contract.body, await this.documents.seller());
    return store(this.documents, { customer_id: mail.customer_id, kind: "contract", contract_id: contract.id }, "vertraege", title, bytes);
  }

  private async invoice(invoiceId: string): Promise<StoredPdf> {
    const path = await this.documents.existing("invoice", invoiceId);
    return path === null ? invoiceDocument(this.documents, invoiceId) : storedFile(this.documents, path);
  }

  private async quote(mail: OutboxRow, now: number): Promise<Prepared> {
    const quoteId = this.id(mail.quote_id);
    const path = await this.documents.existing("quote", quoteId);
    if (path !== null) return { status: "ready", attachment: await storedFile(this.documents, path) };
    const radar = await this.documents.radarQuote(quoteId);
    const source = quoteSource(radar, mail.created_at, now);
    if (source === "wait") return { status: "wait" };
    const quote = await this.documents.quote(quoteId);
    const doc = { customer_id: mail.customer_id, kind: "quote" as const, quote_id: quoteId };
    const attachment = radar.state === "ready" && source === "radar"
      ? await store(this.documents, doc, "angebote", `Prüfbericht und Angebot ${quote.number}`, await this.documents.read(radar.path, "radar"))
      : await store(this.documents, doc, "angebote", `Angebot ${quote.number}`, await quotePdf(quote));
    return { status: "ready", attachment };
  }

  private async organizer(): Promise<Organizer> {
    const seller = await this.documents.seller();
    return { name: seller.owner_name !== "" ? seller.owner_name : seller.company_name, address: this.mailbox };
  }

  private async appointmentRow(mail: OutboxRow): Promise<MailAppointment> {
    const row = await this.documents.appointment(this.id(mail.appointment_id));
    if (row === null) throw new WorkerError(`Mail „${mail.subject}“: Der Termin ist gelöscht.`);
    return row;
  }

  private async appointment(mail: OutboxRow, now: number): Promise<MailOnlyFile> {
    const row = await this.appointmentRow(mail);
    if (row.status === "cancelled") throw new WorkerError(`Mail „${mail.subject}“: Der Termin wurde abgesagt.`);
    const text = buildCalendar({ method: "PUBLISH", events: [confirmationEvent(row, await this.organizer(), new Date(now))] });
    return { name: `Termin_${row.starts_on}.ics`, bytes: new TextEncoder().encode(text), type: CALENDAR, path: null };
  }

  private async cancellation(mail: OutboxRow, now: number): Promise<MailOnlyFile> {
    const row = await this.appointmentRow(mail);
    if (row.status !== "cancelled") throw new WorkerError(`Mail „${mail.subject}“: Der Termin ist nicht abgesagt.`);
    const text = buildCalendar({ method: "CANCEL", events: [cancellationEvent(row, await this.organizer(), new Date(now))] });
    return { name: `Absage_${row.starts_on}.ics`, bytes: new TextEncoder().encode(text), type: CANCELLATION, path: null };
  }

  private async dunning(mail: OutboxRow, now: number): Promise<StoredPdf> {
    const invoiceId = this.id(mail.invoice_id);
    if (mail.dunning_level === null) throw new WorkerError(`Mail „${mail.subject}“: Mahnstufe fehlt.`);
    const data = await this.documents.dunning(invoiceId, mail.dunning_level, berlinDate(now));
    const title = `${dunningTitle(data.level)} ${data.invoiceNumber}`;
    return store(this.documents, { customer_id: mail.customer_id, kind: "other", invoice_id: invoiceId }, "mahnungen", title, await dunningPdf(data));
  }
}

/** Gives every finalised invoice its PDF, so the tax adviser package is complete. */
export async function renderMissingInvoices(documents: DocumentStore, report: Report, hasTime: () => boolean): Promise<void> {
  for (const invoiceId of await documents.invoicesWithoutPdf(INVOICE_PDFS_PER_RUN)) {
    if (!hasTime()) return;
    try {
      if (await documents.existing("invoice", invoiceId) !== null) continue;
      await invoiceDocument(documents, invoiceId);
      report.documents++;
    } catch (error) {
      report.errors.push(`Rechnungs-PDF ${invoiceId}: ${errorText(error)}`);
    }
  }
}
