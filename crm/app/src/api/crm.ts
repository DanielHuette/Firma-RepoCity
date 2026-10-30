// Every read and write of the app. Rules that must hold no matter who writes (numbering, totals,
// immutability of finalised invoices) live in the database; this module only calls them.
import { transcriptLines } from "../lib/calls";
import { QueryError } from "../lib/errors";
import { check, unwrap } from "./result";
import { supabase } from "./supabase";
import type {
  Activity, ActivityKind, Approval, AuditRequest, Call, CallRow, ChannelReportRow, Contract, ContractTemplate, CrmDocument, Customer, CustomerDraft, CustomerOverview, Deal, DealStage,
  DocumentKind, Email, Inquiry, InquiryStatus, Invoice, LineItem, MailReview, MailSync, Order, OrderStatus, Overview, Payment,
  PaymentMethod, Priority, Product, Quote, Settings, Subscription, Task, Ticket, TicketStatus,
} from "./types";

const WITH_CUSTOMER = "*, customer:customers(id, name)";

// Session and role

export async function isAdmin(): Promise<boolean> {
  return unwrap("Rolle prüfen", await supabase.schema("public").rpc("is_admin")) === true;
}

export async function signIn(email: string, password: string): Promise<void> {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error !== null) throw new QueryError("Anmelden", error.message, error.code ?? null);
}

export async function requestPasswordReset(email: string, redirectTo: string): Promise<void> {
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
  if (error !== null) throw new QueryError("Passwort zurücksetzen", error.message, error.code ?? null);
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}

// Overview

export async function loadOverview(): Promise<Overview> {
  return unwrap("Überblick laden", await supabase.rpc("today_overview")) as Overview;
}

/** Per channel the inquiries and new customers of the period and the payments received in it. */
export async function channelReport(from: string, to: string): Promise<ChannelReportRow[]> {
  return unwrap("Herkunft laden", await supabase.rpc("channel_report", { p_from: from, p_to: to })) as ChannelReportRow[];
}

// Settings

export async function loadSettings(): Promise<Settings> {
  return unwrap("Einstellungen laden", await supabase.from("settings").select("*").eq("id", 1).single<Settings>());
}

export async function saveSettings(settings: Partial<Settings>): Promise<void> {
  check("Einstellungen speichern", await supabase.from("settings").update(settings).eq("id", 1));
}

// Customers

export async function listCustomers(search = ""): Promise<Customer[]> {
  let query = supabase.from("customers").select("*").order("name");
  const term = search.trim().replace(/[%,()]/g, " ");
  if (term !== "") query = query.or(`name.ilike.%${term}%,email.ilike.%${term}%,contact_person.ilike.%${term}%,city.ilike.%${term}%`);
  return unwrap("Kunden laden", await query.overrideTypes<Customer[], { merge: false }>());
}

export async function loadCustomer(id: string): Promise<Customer> {
  return unwrap("Kunde laden", await supabase.from("customers").select("*").eq("id", id).single<Customer>());
}

export async function createCustomer(draft: CustomerDraft): Promise<Customer> {
  return unwrap("Kunde anlegen", await supabase.from("customers").insert(normaliseCustomer(draft)).select().single<Customer>());
}

export async function updateCustomer(id: string, draft: CustomerDraft): Promise<void> {
  check("Kunde speichern", await supabase.from("customers").update(normaliseCustomer(draft)).eq("id", id));
}

function normaliseCustomer(draft: CustomerDraft): CustomerDraft {
  const email = draft.email?.trim() ?? "";
  return {
    kind: draft.kind, name: draft.name.trim(), contact_person: draft.contact_person.trim(), email: email === "" ? null : email.toLowerCase(),
    phone: draft.phone.trim(), street: draft.street.trim(), postal_code: draft.postal_code.trim(), city: draft.city.trim(),
    country_code: draft.country_code.trim() || "DE", vat_id: draft.vat_id.trim(), buyer_reference: draft.buyer_reference.trim(),
    source: draft.source, marketing_consent: draft.marketing_consent, no_review_requests: draft.no_review_requests,
    no_follow_ups: draft.no_follow_ups, channel: draft.channel, campaign: draft.campaign.trim(), notes: draft.notes,
  };
}

export interface CustomerFile {
  inquiries: Inquiry[];
  auditRequests: AuditRequest[];
  deals: Deal[];
  quotes: Quote[];
  orders: Order[];
  invoices: Invoice[];
  tickets: Ticket[];
  activities: Activity[];
}

export async function loadCustomerFile(id: string): Promise<CustomerFile> {
  const [inquiries, auditRequests, deals, quotes, orders, invoices, tickets, activities] = await Promise.all([
    supabase.from("inquiries").select("*").eq("customer_id", id).order("created_at", { ascending: false }).overrideTypes<Inquiry[], { merge: false }>(),
    supabase.from("audit_requests").select("id,customer_id,kind,wished_at,website,status,appointment_id,audit_id,created_at").eq("customer_id", id)
      .order("created_at", { ascending: false }).overrideTypes<AuditRequest[], { merge: false }>(),
    supabase.from("deals").select("*").eq("customer_id", id).order("created_at", { ascending: false }).overrideTypes<Deal[], { merge: false }>(),
    supabase.from("quotes").select("*").eq("customer_id", id).order("created_at", { ascending: false }).overrideTypes<Quote[], { merge: false }>(),
    supabase.from("orders").select("*").eq("customer_id", id).order("created_at", { ascending: false }).overrideTypes<Order[], { merge: false }>(),
    supabase.from("invoices").select("*").eq("customer_id", id).order("created_at", { ascending: false }).overrideTypes<Invoice[], { merge: false }>(),
    supabase.from("tickets").select("*").eq("customer_id", id).order("created_at", { ascending: false }).overrideTypes<Ticket[], { merge: false }>(),
    supabase.from("activities").select("*").eq("customer_id", id).order("happened_at", { ascending: false }).limit(200).overrideTypes<Activity[], { merge: false }>(),
  ]);
  return {
    inquiries: unwrap("Anfragen laden", inquiries),
    auditRequests: unwrap("Audit-Anfragen laden", auditRequests),
    deals: unwrap("Verkaufschancen laden", deals),
    quotes: unwrap("Angebote laden", quotes),
    orders: unwrap("Aufträge laden", orders),
    invoices: unwrap("Rechnungen laden", invoices),
    tickets: unwrap("Tickets laden", tickets),
    activities: unwrap("Verlauf laden", activities),
  };
}

export async function addActivity(customerId: string, kind: ActivityKind, body: string): Promise<void> {
  check("Eintrag speichern", await supabase.from("activities").insert({ customer_id: customerId, kind, body: body.trim() }));
}

// Inquiries and deals

export async function listInquiries(): Promise<Inquiry[]> {
  return unwrap("Anfragen laden", await supabase.from("inquiries").select(WITH_CUSTOMER).order("created_at", { ascending: false }).limit(300).overrideTypes<Inquiry[], { merge: false }>());
}

export async function createInquiry(customerId: string, channel: string, subject: string, message: string): Promise<void> {
  check("Anfrage anlegen", await supabase.from("inquiries").insert({ customer_id: customerId, channel, subject: subject.trim(), message: message.trim() }));
}

export async function setInquiryStatus(id: string, status: InquiryStatus): Promise<void> {
  check("Anfrage ändern", await supabase.from("inquiries").update({ status }).eq("id", id));
}

export async function dealFromInquiry(inquiryId: string): Promise<Deal> {
  return unwrap("Verkaufschance anlegen", await supabase.rpc("deal_from_inquiry", { p_inquiry: inquiryId }).single<Deal>());
}

export async function listDeals(): Promise<Deal[]> {
  return unwrap("Verkaufschancen laden", await supabase.from("deals").select(WITH_CUSTOMER).order("next_step_due", { ascending: true, nullsFirst: false }).overrideTypes<Deal[], { merge: false }>());
}

export async function createDeal(customerId: string, title: string, valueNet: number): Promise<Deal> {
  return unwrap("Verkaufschance anlegen", await supabase.from("deals")
    .insert({ customer_id: customerId, title: title.trim(), value_net: valueNet, next_step: "Erstgespräch vereinbaren" })
    .select().single<Deal>());
}

export async function updateDeal(id: string, changes: Partial<Pick<Deal, "stage" | "next_step" | "next_step_due" | "value_net" | "title">>): Promise<void> {
  const closing = changes.stage === "won" || changes.stage === "lost";
  check("Verkaufschance ändern", await supabase.from("deals").update(closing ? { ...changes, closed_at: new Date().toISOString() } : changes).eq("id", id));
}

export const DEAL_FLOW: DealStage[] = ["new", "meeting", "quote", "won"];

// Products and subscriptions

export async function listProducts(includeInactive = false): Promise<Product[]> {
  let query = supabase.from("products").select("*").order("name");
  if (!includeInactive) query = query.eq("active", true);
  return unwrap("Produkte laden", await query.overrideTypes<Product[], { merge: false }>());
}

export async function saveProduct(product: Omit<Product, "id"> & { id?: string }): Promise<void> {
  const { id, ...fields } = product;
  if (id === undefined) check("Produkt anlegen", await supabase.from("products").insert(fields));
  else check("Produkt speichern", await supabase.from("products").update(fields).eq("id", id));
}

export async function listSubscriptions(): Promise<Subscription[]> {
  return unwrap("Abos laden", await supabase.from("subscriptions")
    .select("*, customer:customers(id, name), product:products(id, name, price_net)").order("next_invoice_date").overrideTypes<Subscription[], { merge: false }>());
}

export async function createSubscription(customerId: string, productId: string, quantity: number, startDate: string): Promise<void> {
  check("Abo anlegen", await supabase.from("subscriptions")
    .insert({ customer_id: customerId, product_id: productId, quantity, start_date: startDate, next_invoice_date: startDate }));
}

export async function setSubscriptionActive(id: string, active: boolean): Promise<void> {
  check("Abo ändern", await supabase.from("subscriptions").update({ active }).eq("id", id));
}

// Quotes

export async function listQuotes(): Promise<Quote[]> {
  return unwrap("Angebote laden", await supabase.from("quotes").select(WITH_CUSTOMER).order("created_at", { ascending: false }).limit(300).overrideTypes<Quote[], { merge: false }>());
}

export async function loadQuote(id: string): Promise<{ quote: Quote; items: LineItem[] }> {
  const [quote, items] = await Promise.all([
    supabase.from("quotes").select(WITH_CUSTOMER).eq("id", id).single<Quote>(),
    supabase.from("quote_items").select("*").eq("quote_id", id).order("position").overrideTypes<LineItem[], { merge: false }>(),
  ]);
  return { quote: unwrap("Angebot laden", quote), items: unwrap("Positionen laden", items) };
}

export async function createQuote(customerId: string, dealId: string | null): Promise<Quote> {
  return unwrap("Angebot anlegen", await supabase.rpc("create_quote", { p_customer: customerId, p_deal: dealId }).single<Quote>());
}

export async function saveQuote(id: string, fields: Pick<Quote, "intro" | "outro" | "valid_until">, items: LineItem[]): Promise<void> {
  check("Angebot speichern", await supabase.from("quotes").update(fields).eq("id", id));
  await replaceItems("quote_items", "quote_id", id, items);
}


async function replaceItems(table: "quote_items" | "invoice_items", key: "quote_id" | "invoice_id", id: string, items: LineItem[]): Promise<void> {
  check("Positionen speichern", await supabase.from(table).delete().eq(key, id));
  if (items.length === 0) return;
  const rows = items.map((item, index) => ({
    [key]: id,
    position: index + 1,
    product_id: item.product_id,
    title: item.title.trim(),
    description: item.description.trim(),
    quantity: item.quantity,
    unit: item.unit,
    unit_price_net: item.unit_price_net,
    vat_rate: item.vat_rate,
  }));
  check("Positionen speichern", await supabase.from(table).insert(rows));
}

// Orders

export async function listOrders(): Promise<Order[]> {
  return unwrap("Aufträge laden", await supabase.from("orders").select(WITH_CUSTOMER).order("created_at", { ascending: false }).limit(300).overrideTypes<Order[], { merge: false }>());
}

export async function setOrderStatus(id: string, status: OrderStatus): Promise<void> {
  const done = status === "done" ? { done_at: new Date().toISOString() } : {};
  check("Auftrag ändern", await supabase.from("orders").update({ status, ...done }).eq("id", id));
}

/** The draft of the one-off items, or null when the order holds only monthly items. */
export async function invoiceFromOrder(orderId: string): Promise<Invoice | null> {
  const result = await supabase.rpc("invoice_from_order", { p_order: orderId }).maybeSingle<Invoice>();
  check("Rechnung anlegen", result);
  // A function that returns a null row arrives either as null or as a row of nulls.
  return result.data === null || (result.data.id as string | null) === null ? null : result.data;
}

// Invoices

export async function listInvoices(): Promise<Invoice[]> {
  return unwrap("Rechnungen laden", await supabase.from("invoices").select(WITH_CUSTOMER).order("created_at", { ascending: false }).limit(500).overrideTypes<Invoice[], { merge: false }>());
}

export async function loadInvoice(id: string): Promise<{ invoice: Invoice; items: LineItem[]; payments: Payment[] }> {
  const [invoice, items, payments] = await Promise.all([
    supabase.from("invoices").select(WITH_CUSTOMER).eq("id", id).single<Invoice>(),
    supabase.from("invoice_items").select("*").eq("invoice_id", id).order("position").overrideTypes<LineItem[], { merge: false }>(),
    supabase.from("payments").select("*").eq("invoice_id", id).order("paid_on").overrideTypes<Payment[], { merge: false }>(),
  ]);
  return { invoice: unwrap("Rechnung laden", invoice), items: unwrap("Positionen laden", items), payments: unwrap("Zahlungen laden", payments) };
}

export async function createInvoice(customerId: string): Promise<Invoice> {
  return unwrap("Rechnung anlegen", await supabase.from("invoices")
    .insert({ customer_id: customerId, intro: "für die erbrachten Leistungen erlaube ich mir, folgende Rechnung zu stellen:", outro: "Vielen Dank für Ihren Auftrag." })
    .select().single<Invoice>());
}

export async function saveInvoiceDraft(id: string, fields: Pick<Invoice, "intro" | "outro" | "service_date">, items: LineItem[]): Promise<void> {
  check("Rechnung speichern", await supabase.from("invoices").update(fields).eq("id", id));
  await replaceItems("invoice_items", "invoice_id", id, items);
}

export async function deleteInvoiceDraft(id: string): Promise<void> {
  check("Entwurf löschen", await supabase.from("invoices").delete().eq("id", id).eq("status", "draft"));
}

export async function finalizeInvoice(id: string, serviceDate: string | null): Promise<void> {
  check("Rechnung festschreiben", await supabase.rpc("finalize_invoice", { p_invoice: id, p_service_date: serviceDate }));
}

export async function recordPayment(id: string, amount: number, paidOn: string, method: PaymentMethod, reference: string): Promise<void> {
  check("Zahlung erfassen", await supabase.rpc("record_payment", {
    p_invoice: id, p_amount: amount, p_paid_on: paidOn, p_method: method, p_reference: reference,
  }));
}

export async function cancelInvoice(id: string): Promise<Invoice> {
  return unwrap("Rechnung stornieren", await supabase.rpc("cancel_invoice", { p_invoice: id }).single<Invoice>());
}

export async function runDunning(): Promise<number> {
  return unwrap("Mahnlauf", await supabase.rpc("run_dunning")) as number;
}

// Approvals, tasks, tickets

export async function listApprovals(onlyPending: boolean): Promise<Approval[]> {
  let query = supabase.from("approvals").select(WITH_CUSTOMER).order("created_at", { ascending: false }).limit(200);
  if (onlyPending) query = query.eq("status", "pending");
  return unwrap("Freigaben laden", await query.overrideTypes<Approval[], { merge: false }>());
}

export async function decideApproval(id: string, approve: boolean): Promise<void> {
  check("Freigabe entscheiden", await supabase.rpc("decide_approval", { p_approval: id, p_approve: approve }));
}

export async function listTasks(includeDone = false): Promise<Task[]> {
  let query = supabase.from("tasks").select(WITH_CUSTOMER).order("due_date").limit(300);
  if (!includeDone) query = query.eq("done", false);
  return unwrap("Aufgaben laden", await query.overrideTypes<Task[], { merge: false }>());
}

export async function createTask(title: string, dueDate: string, customerId: string | null): Promise<void> {
  check("Aufgabe anlegen", await supabase.from("tasks").insert({ title: title.trim(), due_date: dueDate, customer_id: customerId }));
}

export async function setTaskDone(id: string, done: boolean): Promise<void> {
  check("Aufgabe ändern", await supabase.from("tasks").update({ done, done_at: done ? new Date().toISOString() : null }).eq("id", id));
}

export async function listTickets(): Promise<Ticket[]> {
  return unwrap("Tickets laden", await supabase.from("tickets").select(WITH_CUSTOMER).order("created_at", { ascending: false }).limit(300).overrideTypes<Ticket[], { merge: false }>());
}

export async function createTicket(customerId: string | null, subject: string, body: string, priority: Priority): Promise<void> {
  check("Ticket anlegen", await supabase.rpc("create_ticket", { p_customer: customerId, p_subject: subject.trim(), p_body: body.trim(), p_priority: priority }));
}

export async function setTicketStatus(id: string, status: TicketStatus): Promise<void> {
  const solved = status === "solved" ? new Date().toISOString() : null;
  check("Ticket ändern", await supabase.from("tickets").update({ status, solved_at: solved }).eq("id", id));
  if (status === "solved") check("Aufgabe erledigen", await supabase.from("tasks").update({ done: true, done_at: solved }).eq("ticket_id", id).eq("done", false));
}

// Export for the tax adviser

export async function invoicesForPeriod(from: string, to: string): Promise<Invoice[]> {
  return unwrap("Rechnungen laden", await supabase.from("invoices").select(WITH_CUSTOMER)
    .neq("status", "draft").gte("issue_date", from).lte("issue_date", to).order("number").overrideTypes<Invoice[], { merge: false }>());
}

// Customer file: overview, mails, documents, contracts

export async function loadCustomerOverview(id: string): Promise<CustomerOverview> {
  return unwrap("Überblick laden", await supabase.rpc("customer_overview", { p_customer: id })) as CustomerOverview;
}

export async function listEmails(customerId: string): Promise<Email[]> {
  return unwrap("E-Mails laden", await supabase.from("emails")
    .select("id, customer_id, direction, from_address, from_name, to_addresses, subject, body_text, sent_at, has_attachments")
    .eq("customer_id", customerId).order("sent_at", { ascending: false }).limit(300).overrideTypes<Email[], { merge: false }>());
}

export async function listDocuments(customerId: string): Promise<CrmDocument[]> {
  return unwrap("Dokumente laden", await supabase.from("documents").select("*").eq("customer_id", customerId)
    .order("created_at", { ascending: false }).overrideTypes<CrmDocument[], { merge: false }>());
}

export const BUCKET = "crm-documents";
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

function safeFileName(name: string): string {
  const cleaned = name.normalize("NFKD").replace(/[^\w.-]+/g, "_").replace(/_+/g, "_");
  return cleaned.slice(-120) || "datei";
}

export async function uploadDocument(customerId: string, file: File, kind: DocumentKind, contractId: string | null = null): Promise<void> {
  if (file.size > MAX_UPLOAD_BYTES) throw new QueryError("Hochladen", "Die Datei ist größer als 25 MB.", null);
  const path = `customers/${customerId}/${crypto.randomUUID()}-${safeFileName(file.name)}`;
  const upload = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type || "application/octet-stream", upsert: false });
  if (upload.error !== null) throw new QueryError("Hochladen", upload.error.message, null);
  check("Dokument speichern", await supabase.from("documents").insert({
    customer_id: customerId, kind, title: file.name, file_path: path, mime_type: file.type || "application/octet-stream",
    size_bytes: file.size, source: "upload", contract_id: contractId,
  }));
}

export async function documentLink(path: string): Promise<string> {
  const result = await supabase.storage.from(BUCKET).createSignedUrl(path, 120);
  if (result.error !== null) throw new QueryError("Dokument öffnen", result.error.message, null);
  return result.data.signedUrl;
}

export async function deleteUpload(document: CrmDocument): Promise<void> {
  if (document.source !== "upload") throw new QueryError("Entfernen", "Nur selbst hochgeladene Dateien lassen sich entfernen.", null);
  check("Dokument entfernen", await supabase.from("documents").delete().eq("id", document.id));
  const removed = await supabase.storage.from(BUCKET).remove([document.file_path]);
  if (removed.error !== null) throw new QueryError("Datei entfernen", removed.error.message, null);
}

export async function loadContract(id: string): Promise<Contract> {
  return unwrap("Vertrag laden", await supabase.from("contracts").select("*").eq("id", id).single<Contract>());
}

export async function markContractSigned(id: string): Promise<void> {
  check("Vertrag ändern", await supabase.rpc("mark_contract_signed", { p_contract: id }));
}

export async function cancelSubscription(id: string, endDate: string): Promise<void> {
  check("Abo kündigen", await supabase.rpc("cancel_subscription", { p_subscription: id, p_end: endDate }));
}

export async function listTemplates(): Promise<ContractTemplate[]> {
  return unwrap("Vorlagen laden", await supabase.from("contract_templates").select("key, title, body, mail_text, needs_signature")
    .order("key").overrideTypes<ContractTemplate[], { merge: false }>());
}

export async function saveTemplate(template: ContractTemplate): Promise<void> {
  const { key, ...fields } = template;
  check("Vorlage speichern", await supabase.from("contract_templates").update({ ...fields, updated_at: new Date().toISOString() }).eq("key", key));
}

export async function dismissCustomer(id: string): Promise<void> {
  check("Kunde entfernen", await supabase.rpc("dismiss_customer", { p_customer: id }));
}

// Calls of the phone assistant

const CALL_COLUMNS = "id, customer_id, caller_number, started_at, ended_at, transcript, summary, outcome";

function toCall(row: CallRow): Call {
  return { ...row, summary: row.summary ?? "", transcript: transcriptLines(row.transcript) };
}

export async function listCalls(customerId: string): Promise<Call[]> {
  const rows = unwrap("Anrufe laden", await supabase.from("calls").select(CALL_COLUMNS)
    .eq("customer_id", customerId).order("started_at", { ascending: false }).limit(200).overrideTypes<CallRow[], { merge: false }>());
  return rows.map(toCall);
}

/** Every call since the given instant, also those of callers the CRM does not know yet. */
export async function listCallsSince(since: string): Promise<Call[]> {
  const rows = unwrap("Anrufe laden", await supabase.from("calls").select(`${CALL_COLUMNS}, customer:customers(id, name)`)
    .gte("started_at", since).order("started_at", { ascending: false }).limit(100).overrideTypes<CallRow[], { merge: false }>());
  return rows.map(toCall);
}

// Unknown senders and the mailbox

export async function listMailReview(): Promise<MailReview[]> {
  return unwrap("Unbekannte Absender laden", await supabase.from("mail_review").select("*").eq("status", "open")
    .order("sent_at", { ascending: false }).limit(300).overrideTypes<MailReview[], { merge: false }>());
}

export async function decideMailReview(id: string, isCustomer: boolean): Promise<string | null> {
  return unwrap("Absender entscheiden", await supabase.rpc("decide_mail_review", { p_review: id, p_customer: isCustomer })) as string | null;
}

export async function listMailSync(): Promise<MailSync[]> {
  return unwrap("Postfach-Stand laden", await supabase.from("mail_sync").select("folder, synced_at, last_error")
    .overrideTypes<MailSync[], { merge: false }>());
}

export interface FailedMail {
  id: string;
  to_address: string;
  subject: string;
  error: string;
  attempts: number;
  created_at: string;
}

export async function listFailedMails(): Promise<FailedMail[]> {
  return unwrap("Versandfehler laden", await supabase.from("outbox").select("id, to_address, subject, error, attempts, created_at")
    .eq("status", "failed").order("created_at", { ascending: false }).overrideTypes<FailedMail[], { merge: false }>());
}

export async function retryMail(id: string): Promise<void> {
  check("Erneut senden", await supabase.from("outbox").update({ status: "queued", attempts: 0, error: "" }).eq("id", id).eq("status", "failed"));
}

export interface MailRun {
  imported: number;
  created: number;
  parked: number;
  sent: number;
  failed: number;
  errors: string[];
}

export async function runMailbox(): Promise<MailRun> {
  const result = await supabase.functions.invoke<MailRun>("crm-mail", { body: {} });
  const failure: unknown = result.error;
  if (failure !== null) throw new QueryError("Postfach abrufen", failure instanceof Error ? failure.message : "Der Abruf ist fehlgeschlagen.", null);
  if (result.data === null) throw new QueryError("Postfach abrufen", "keine Antwort", null);
  return result.data;
}
