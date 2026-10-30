// Rows of the crm schema as the app reads them. Amounts arrive as numbers from the REST interface.

export type CustomerKind = "company" | "person";
export type CustomerSource = "manual" | "website" | "phone" | "email" | "referral" | "agent" | "radarauditor" | "other";
export type InquiryStatus = "new" | "in_progress" | "done" | "rejected";
export type DealStage = "new" | "meeting" | "quote" | "won" | "lost";
export type QuoteStatus = "draft" | "sent" | "accepted" | "declined" | "expired";
export type OrderStatus = "open" | "in_progress" | "done" | "invoiced";
export type InvoiceStatus = "draft" | "open" | "paid" | "cancelled";
export type TicketStatus = "open" | "waiting" | "solved";
export type Priority = "low" | "normal" | "high";
export type ActivityKind = "note" | "call" | "email" | "meeting" | "system";
export type PaymentMethod = "transfer" | "cash" | "paypal" | "card" | "other";
export type ApprovalKind = "dunning" | "publication" | "quote" | "invoice" | "payment" | "contract" | "reversal" | "follow_up" | "assistant_mail" | "other";
export type ApprovalStatus = "pending" | "approved" | "rejected";
export type VatRate = 0 | 7 | 19;
export type Billing = "once" | "monthly";
/** Where a customer or inquiry came from in detail (migration 011_herkunft.sql); null is unknown. */
export type Channel = "google_search" | "google_maps" | "linkedin" | "instagram" | "facebook" | "xing" | "youtube" | "tiktok" | "x" | "threads"
  | "reddit" | "forum" | "newsletter" | "referral" | "other";

export interface Settings {
  contract_prefix: string;
  notice_months: number;
  company_name: string;
  owner_name: string;
  street: string;
  postal_code: string;
  city: string;
  country_code: string;
  email: string;
  phone: string;
  website: string;
  tax_number: string;
  vat_id: string;
  iban: string;
  bic: string;
  bank_name: string;
  small_business: boolean;
  payment_days: number;
  quote_valid_days: number;
  invoice_prefix: string;
  quote_prefix: string;
  order_prefix: string;
  google_review_url: string;
  review_reminder_days: number;
  datev_consultant_number: string;
  datev_client_number: string;
  datev_tax_free_account: string;
  assistant_greeting: string;
  assistant_facts: string;
  /** "08:00:00" as the database writes a time. */
  business_hours_start: string;
  business_hours_end: string;
  /** ISO weekdays, 1 = Monday. */
  business_days: number[];
  reminder_minutes: number;
  /** The secret part of the calendar feed link. */
  calendar_token: string;
}

export interface Customer {
  id: string;
  kind: CustomerKind;
  name: string;
  contact_person: string;
  email: string | null;
  phone: string;
  street: string;
  postal_code: string;
  city: string;
  country_code: string;
  vat_id: string;
  buyer_reference: string;
  source: CustomerSource;
  marketing_consent: boolean;
  no_review_requests: boolean;
  /** No follow-up mails on quotes; the customer may also set it through the link in such a mail. */
  no_follow_ups: boolean;
  channel: Channel | null;
  campaign: string;
  notes: string;
  created_at: string;
}

export type CustomerDraft = Omit<Customer, "id" | "created_at">;

export interface Inquiry {
  id: string;
  customer_id: string;
  channel: string;
  subject: string;
  message: string;
  status: InquiryStatus;
  source_channel: Channel | null;
  campaign: string;
  created_at: string;
  customer?: Pick<Customer, "id" | "name">;
}

export interface Deal {
  id: string;
  customer_id: string;
  title: string;
  stage: DealStage;
  value_net: number;
  next_step: string;
  next_step_due: string | null;
  created_at: string;
  customer?: Pick<Customer, "id" | "name">;
}

export interface Product {
  id: string;
  name: string;
  description: string;
  unit: string;
  price_net: number;
  vat_rate: VatRate;
  billing: Billing;
  active: boolean;
}

export interface LineItem {
  id?: string;
  position: number;
  product_id: string | null;
  title: string;
  description: string;
  quantity: number;
  unit: string;
  unit_price_net: number;
  vat_rate: VatRate;
}

export interface Quote {
  id: string;
  number: string;
  customer_id: string;
  deal_id: string | null;
  status: QuoteStatus;
  issue_date: string;
  valid_until: string;
  intro: string;
  outro: string;
  net: number;
  vat: number;
  gross: number;
  created_at: string;
  customer?: Pick<Customer, "id" | "name">;
}

export interface Order {
  id: string;
  number: string;
  customer_id: string;
  quote_id: string | null;
  title: string;
  status: OrderStatus;
  due_date: string | null;
  created_at: string;
  customer?: Pick<Customer, "id" | "name">;
}

export interface Party {
  name: string;
  contact_person?: string;
  street: string;
  postal_code: string;
  city: string;
  country_code: string;
  email?: string | null;
  phone?: string;
  vat_id?: string;
  buyer_reference?: string;
}

export interface SellerSnapshot extends Party {
  company_name: string;
  owner_name: string;
  tax_number: string;
  iban: string;
  bic: string;
  bank_name: string;
  small_business: boolean;
  website: string;
}

export interface Invoice {
  id: string;
  number: string | null;
  customer_id: string;
  order_id: string | null;
  cancels_invoice_id: string | null;
  status: InvoiceStatus;
  issue_date: string | null;
  service_date: string | null;
  due_date: string | null;
  intro: string;
  outro: string;
  net: number;
  vat: number;
  gross: number;
  paid_amount: number;
  dunning_level: number;
  seller_snapshot: SellerSnapshot | null;
  customer_snapshot: Party | null;
  created_at: string;
  customer?: Pick<Customer, "id" | "name">;
}

export interface Payment {
  id: string;
  invoice_id: string;
  amount: number;
  paid_on: string;
  method: PaymentMethod;
  reference: string;
}

export interface Ticket {
  id: string;
  number: string;
  customer_id: string | null;
  subject: string;
  body: string;
  status: TicketStatus;
  priority: Priority;
  created_at: string;
  customer?: Pick<Customer, "id" | "name"> | null;
}

export interface Task {
  id: string;
  title: string;
  due_date: string;
  done: boolean;
  customer_id: string | null;
  order_id: string | null;
  invoice_id: string | null;
  ticket_id: string | null;
  origin: "person" | "system" | "agent";
  customer?: Pick<Customer, "id" | "name"> | null;
}

export interface Activity {
  id: string;
  customer_id: string | null;
  kind: ActivityKind;
  body: string;
  actor: string;
  happened_at: string;
}

export interface Subscription {
  id: string;
  customer_id: string;
  product_id: string;
  quantity: number;
  start_date: string;
  next_invoice_date: string;
  end_date: string | null;
  active: boolean;
  quote_id: string | null;
  unit_price_net: number | null;
  next_audit_date: string | null;
  customer?: Pick<Customer, "id" | "name">;
  product?: Pick<Product, "id" | "name" | "price_net">;
}

export interface Approval {
  id: string;
  kind: ApprovalKind;
  title: string;
  body: string;
  payload: Record<string, unknown>;
  customer_id: string | null;
  invoice_id: string | null;
  requested_by: string;
  status: ApprovalStatus;
  created_at: string;
  customer?: Pick<Customer, "id" | "name"> | null;
}

export interface Overview {
  new_inquiries: number;
  due_deals: number;
  expiring_quotes: number;
  open_orders: number;
  draft_invoices: number;
  overdue_invoices: number;
  pending_approvals: number;
  open_tickets: number;
  tasks_due: number;
  receivables: number;
  paid_this_month: number;
  open_quotes_value: number;
  pipeline_value: number;
  unknown_senders: number;
  failed_mails: number;
  mailbox_stale: boolean;
  due_audits: number;
  mail_triage_waiting: number;
  mail_triage_failed: number;
  appointments_today: number;
  /** "10:00 Erstgespräch", or the title alone without a time; those without time first. */
  appointments_today_list: string[];
  /** The same appointments with kind and place (migration 013_audit_anfragen.sql). */
  appointments_today_items: TodayAppointment[];
}

export interface TodayAppointment {
  /** HH:MM in Berlin time, null without a time. */
  clock: string | null;
  title: string;
  kind: AppointmentKind;
  location: string;
}

export type ContractStatus = "draft" | "queued" | "sent" | "signed" | "ended" | "rejected";
export type DocumentKind = "contract" | "signed_contract" | "quote" | "invoice" | "attachment" | "other";
export type TemplateKey = "maintenance" | "order_confirmation";

export interface Email {
  id: string;
  customer_id: string;
  direction: "in" | "out";
  from_address: string;
  from_name: string;
  to_addresses: string[];
  subject: string;
  body_text: string;
  sent_at: string;
  has_attachments: boolean;
}

export interface CrmDocument {
  id: string;
  customer_id: string;
  kind: DocumentKind;
  title: string;
  file_path: string;
  mime_type: string;
  size_bytes: number;
  source: "upload" | "email" | "generated";
  email_id: string | null;
  contract_id: string | null;
  quote_id: string | null;
  invoice_id: string | null;
  created_at: string;
}

export interface Contract {
  id: string;
  number: string;
  customer_id: string;
  template_key: TemplateKey;
  title: string;
  body: string;
  status: ContractStatus;
  subscription_id: string | null;
  order_id: string | null;
  start_date: string | null;
  end_date: string | null;
  monthly_net: number | null;
  created_at: string;
  sent_at: string | null;
  signed_at: string | null;
}

export interface ContractTemplate {
  key: TemplateKey;
  title: string;
  body: string;
  mail_text: string;
  needs_signature: boolean;
}

export interface Purchase {
  date: string;
  title: string;
  quantity: number;
  unit: string;
  net: number;
  invoice_id: string;
  invoice_number: string;
  cancelled: boolean;
}

export interface CustomerSubscription {
  id: string;
  product: string;
  quantity: number;
  unit: string;
  monthly_net: number;
  start_date: string;
  next_invoice_date: string;
  end_date: string | null;
  active: boolean;
  contract_id: string | null;
  contract_number: string | null;
  contract_status: ContractStatus | null;
}

export interface CustomerOverview {
  purchases: Purchase[];
  subscriptions: CustomerSubscription[];
  contracts: Pick<Contract, "id" | "number" | "title" | "status" | "start_date" | "end_date" | "created_at" | "sent_at" | "signed_at">[];
  revenue_net: number;
  open_amount: number;
  monthly_net: number;
  customer_since: string;
}

export interface MailReview {
  id: string;
  address: string;
  name: string;
  company: string;
  direction: "in" | "out";
  subject: string;
  snippet: string;
  sent_at: string;
  mail_count: number;
  verdict: "unsure" | "not_customer" | "automated";
  reason: string;
  status: "open" | "customer" | "ignored";
}

export interface MailSync {
  folder: string;
  synced_at: string | null;
  last_error: string;
}

export type OutboxKind = "contract" | "quote" | "invoice" | "dunning" | "review_request" | "review_reminder" | "appointment" | "follow_up" | "assistant"
  | "audit_proposal" | "appointment_cancel" | "appointment_reminder";
export type OutboxStatus = "queued" | "sent" | "failed";

export interface OutboxMail {
  id: string;
  kind: OutboxKind;
  status: OutboxStatus;
  to_address: string;
  subject: string;
  error: string;
  attempts: number;
  created_at: string;
  sent_at: string | null;
}

export type MailTextKey = "quote" | "invoice" | "dunning_1" | "dunning_2" | "dunning_3" | "review_request" | "review_reminder" | "appointment"
  | "follow_up_1" | "follow_up_2" | "audit_confirmation" | "audit_rebooking" | "audit_cancellation" | "audit_proposal" | "appointment_reminder";

export interface MailText {
  key: MailTextKey;
  subject: string;
  body: string;
  updated_at: string;
}

export type ReviewStatus = "waiting_link" | "due" | "sent" | "reminded" | "done" | "cancelled";

export interface ReviewRequest {
  id: string;
  customer_id: string;
  order_id: string;
  status: ReviewStatus;
  sent_at: string | null;
  reminder_due: string | null;
  reminded_at: string | null;
  created_at: string;
}

export type AuditRunStatus = "due" | "started" | "reported" | "failed";

export interface AuditRun {
  id: string;
  subscription_id: string;
  customer_id: string;
  month: string;
  status: AuditRunStatus;
  audit_id: string | null;
  score_before: number | null;
  score_after: number | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  customer?: Pick<Customer, "id" | "name">;
}

export type AuditStatus = "requested" | "collecting" | "collected" | "scored" | "awaiting_analysis" | "analysed" | "reported" | "failed";
export type AuditPurpose = "sales" | "monthly";

/** A RadarAuditor audit (schema public) of a website that belongs to a CRM customer. */
export interface Audit {
  id: string;
  status: AuditStatus;
  purpose: AuditPurpose;
  total_score: number | null;
  requested_at: string;
  finished_at: string | null;
  report_path: string | null;
}

export type TriageStatus = "queued" | "claimed" | "classified" | "applied" | "failed";

export interface MailTriage {
  id: string;
  kind: "unknown_sender" | "customer_mail";
  status: TriageStatus;
  address: string;
  name: string;
  subject: string;
  attempts: number;
  error: string | null;
  created_at: string;
}

export interface PaymentWithInvoice extends Payment {
  invoice: Pick<Invoice, "id" | "number" | "customer_snapshot"> & { customer?: Pick<Customer, "id" | "name"> };
}

export type CallOutcome = "inquiry" | "quote_accepted" | "quote_declined" | "callback" | "info" | "dropped";
export type CallSpeaker = "caller" | "assistant";

export interface TranscriptLine {
  speaker: CallSpeaker;
  text: string;
}

/** A finished call of the phone assistant; the transcript arrives as JSON and is checked before use. */
export interface CallRow {
  id: string;
  customer_id: string | null;
  caller_number: string;
  started_at: string;
  ended_at: string | null;
  transcript: unknown;
  summary: string | null;
  outcome: CallOutcome;
  customer?: Pick<Customer, "id" | "name"> | null;
}

export type Call = Omit<CallRow, "transcript" | "summary"> & { transcript: TranscriptLine[]; summary: string };

// Finances (migration 007_finanzen.sql)

export type TransactionDirection = "in" | "out";
export type TransactionStatus = "paid" | "suggested" | "open" | "other_income" | "private" | "expense" | "reversed";
export type AccountKind = "expense" | "tax" | "private";
export type ExpenseMethod = "bank" | "cash";

export interface BankTransaction {
  id: string;
  import_id: string;
  booking_date: string;
  value_date: string | null;
  direction: TransactionDirection;
  amount: number;
  counterparty: string;
  counterparty_iban: string;
  purpose: string;
  bank_reference: string;
  status: TransactionStatus;
  reversal: boolean;
  end_to_end_id: string;
  /** On a netted reversal: the booking it took back. */
  reverses_transaction_id: string | null;
  invoice_id: string | null;
  payment_id: string | null;
  payment_created: boolean;
  invoice?: Pick<Invoice, "id" | "number"> | null;
}

/** A reversal netted in the period with the booking it took back, for the tax adviser. */
export interface NettedReversal {
  booked_on: string;
  amount: number;
  counterparty: string;
  original_on: string;
  original_direction: TransactionDirection;
  purpose: string;
  invoice_number: string | null;
}

export interface BankImport {
  id: string;
  file_name: string;
  iban: string;
  statement_from: string | null;
  statement_to: string | null;
  entries: number;
  new_entries: number;
  imported_at: string;
}

export interface ImportResult {
  entries: number;
  new: number;
  skipped: number;
  paid: number;
  suggested: number;
  open: number;
  expenses: number;
  reversals: number;
}

export interface UnlinkedPayment {
  id: string;
  invoice_id: string;
  invoice_number: string | null;
  customer_name: string | null;
  amount: number;
  paid_on: string;
}

export interface ExpenseAccount {
  number: string;
  name: string;
  kind: AccountKind;
  position: number;
}

export interface Receipt {
  id: string;
  expense_id: string;
  path: string;
  file_name: string;
  content_type: string;
  size_bytes: number;
  uploaded_at: string;
}

export interface Expense {
  id: string;
  transaction_id: string | null;
  method: ExpenseMethod;
  spent_on: string;
  amount: number;
  counterparty: string;
  purpose: string;
  account: string | null;
  vat_rate: VatRate;
  created_at: string;
  /** The reversal that took this expense back; it then no longer counts. */
  reversed_by: string | null;
  receipts?: Receipt[];
}

export interface ProfitMonth {
  month: string;
  income: number;
  expenses: number;
  unassigned: number;
  profit: number;
}

// Calendar (migration 009_kalender.sql)

export type AppointmentKind = "visit" | "callback" | "call" | "video" | "other";
export type AppointmentStatus = "planned" | "done" | "cancelled";

export interface Appointment {
  id: string;
  kind: AppointmentKind;
  title: string;
  /** The Berlin day; a callback without a time has only this. */
  starts_on: string;
  starts_at: string | null;
  ends_at: string | null;
  customer_id: string | null;
  location: string;
  note: string;
  origin: "person" | "phone" | "assistant";
  status: AppointmentStatus;
  reminded_at: string | null;
  created_at: string;
  updated_at: string;
  customer?: Pick<Customer, "id" | "name" | "email"> | null;
}

// Where customers come from (migration 011_herkunft.sql)

export interface ChannelReportRow {
  /** One of Channel, or "unknown" for customers and inquiries without one. */
  channel: Channel | "unknown";
  label: string;
  inquiries: number;
  customers: number;
  revenue: number;
}

// Audit requests from the website (migration 013_audit_anfragen.sql)

export type AuditRequestKind = "visit" | "call" | "video";
export type AuditRequestStatus = "open" | "proposed" | "booked";

export interface AuditRequest {
  id: string;
  customer_id: string;
  kind: AuditRequestKind;
  wished_at: string;
  website: string;
  status: AuditRequestStatus;
  appointment_id: string | null;
  audit_id: string | null;
  created_at: string;
}
