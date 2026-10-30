// German formatting and the plain-language labels of every status.
import type {
  ActivityKind, AppointmentKind, AppointmentStatus, ApprovalKind, AuditRequestStatus, Channel, AuditPurpose, AuditRunStatus, AuditStatus, ContractStatus, CustomerSource, DealStage, DocumentKind, InquiryStatus,
  InvoiceStatus, MailTextKey, OrderStatus, OutboxKind, PaymentMethod, Priority, QuoteStatus, ReviewStatus, TicketStatus, TransactionStatus, TriageStatus,
} from "../api/types";

const EURO = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
const NUMBER = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 3 });
const DATE = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
const DATE_TIME = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

export function euro(amount: number): string {
  return EURO.format(amount);
}

export function quantity(value: number): string {
  return NUMBER.format(value);
}

/** Dates from the database come as YYYY-MM-DD and are read as calendar days, not instants. */
export function date(value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "–";
  const day = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date(value);
  return DATE.format(day);
}

export function dateTime(value: string): string {
  return DATE_TIME.format(new Date(value));
}

/** Today as YYYY-MM-DD in local time. */
export function today(offsetDays = 0): string {
  const now = new Date();
  now.setDate(now.getDate() + offsetDays);
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${String(now.getFullYear())}-${month}-${day}`;
}

export function daysUntil(value: string, from = today()): number {
  const target = Date.parse(`${value}T12:00:00`);
  const start = Date.parse(`${from}T12:00:00`);
  return Math.round((target - start) / 86_400_000);
}

export const INQUIRY_STATUS: Record<InquiryStatus, string> = { new: "Neu", in_progress: "In Arbeit", done: "Erledigt", rejected: "Abgelehnt" };
export const DEAL_STAGE: Record<DealStage, string> = { new: "Neu", meeting: "Gespräch", quote: "Angebot", won: "Gewonnen", lost: "Verloren" };
export const QUOTE_STATUS: Record<QuoteStatus, string> = { draft: "Entwurf", sent: "Versendet", accepted: "Angenommen", declined: "Abgelehnt", expired: "Abgelaufen" };
export const ORDER_STATUS: Record<OrderStatus, string> = { open: "Offen", in_progress: "In Arbeit", done: "Fertig", invoiced: "Abgerechnet" };
export const INVOICE_STATUS: Record<InvoiceStatus, string> = { draft: "Entwurf", open: "Offen", paid: "Bezahlt", cancelled: "Storniert" };
export const TICKET_STATUS: Record<TicketStatus, string> = { open: "Offen", waiting: "Wartet auf Kunde", solved: "Gelöst" };
export const PRIORITY: Record<Priority, string> = { low: "Niedrig", normal: "Normal", high: "Hoch" };
export const ACTIVITY_KIND: Record<ActivityKind, string> = { note: "Notiz", call: "Anruf", email: "E-Mail", meeting: "Termin", system: "System" };
export const PAYMENT_METHOD: Record<PaymentMethod, string> = { transfer: "Überweisung", cash: "Bar", paypal: "PayPal", card: "Karte", other: "Sonstiges" };
export const APPROVAL_KIND: Record<ApprovalKind, string> = {
  dunning: "Mahnung", publication: "Veröffentlichung", quote: "Angebot", invoice: "Rechnung", payment: "Zahlung", contract: "Vertrag", reversal: "Rückbuchung",
  follow_up: "Nachfass-Mail", assistant_mail: "Mail vom Assistenten", other: "Sonstiges",
};
export const SOURCE: Record<CustomerSource, string> = {
  manual: "Selbst angelegt", website: "Webseite", phone: "Telefon", email: "E-Mail", referral: "Empfehlung", agent: "Agent", radarauditor: "RadarAuditor",
  other: "Sonstiges",
};
export const DUNNING_LEVEL = ["Keine", "Zahlungserinnerung", "1. Mahnung", "2. Mahnung"] as const;
export const CONTRACT_STATUS: Record<ContractStatus, string> = {
  draft: "Wartet auf Freigabe", queued: "Wird versendet", sent: "Versendet", signed: "Unterschrieben", ended: "Beendet", rejected: "Nicht versendet",
};
export const DOCUMENT_KIND: Record<DocumentKind, string> = {
  contract: "Vertrag", signed_contract: "Unterschriebener Vertrag", quote: "Angebot", invoice: "Rechnung", attachment: "E-Mail-Anhang", other: "Sonstiges",
};

export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${NUMBER.format(Math.round(bytes / 102.4) / 10)} KB`;
  return `${NUMBER.format(Math.round(bytes / (1024 * 102.4)) / 10)} MB`;
}

export const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];

/** "Oktober 2026" for any day of that month given as YYYY-MM-DD. */
export function monthName(value: string): string {
  return `${MONTHS[Number(value.slice(5, 7)) - 1] ?? ""} ${value.slice(0, 4)}`;
}

export const OUTBOX_KIND: Record<OutboxKind, string> = {
  contract: "Vertrag", quote: "Angebot", invoice: "Rechnung", dunning: "Mahnung", review_request: "Bitte um Bewertung", review_reminder: "Erinnerung an die Bewertung",
  appointment: "Terminbestätigung", follow_up: "Nachfass-Mail", assistant: "Mail vom Assistenten", audit_proposal: "Terminvorschläge",
  appointment_cancel: "Terminabsage", appointment_reminder: "Terminerinnerung",
};
export const MAIL_TEXT_KEY: Record<MailTextKey, string> = {
  quote: "Angebot", invoice: "Rechnung", dunning_1: "Zahlungserinnerung", dunning_2: "1. Mahnung", dunning_3: "2. Mahnung",
  review_request: "Bitte um Bewertung", review_reminder: "Erinnerung an die Bewertung", appointment: "Terminbestätigung",
  follow_up_1: "1. Nachfass-Mail (nach 5 Tagen)", follow_up_2: "2. Nachfass-Mail (nach 12 Tagen)",
  audit_confirmation: "Bestätigung einer Audit-Anfrage", audit_rebooking: "Bestätigung eines geänderten Termins",
  audit_cancellation: "Absage des bisherigen Termins", audit_proposal: "Terminvorschläge zu einer Audit-Anfrage",
  appointment_reminder: "Erinnerung am Tag vor dem Termin",
};
export const AUDIT_STATUS: Record<AuditStatus, string> = {
  requested: "Angefordert", collecting: "Sammelt Daten", collected: "Daten gesammelt", scored: "Bewertet", awaiting_analysis: "Wartet auf Auswertung",
  analysed: "Ausgewertet", reported: "Bericht fertig", failed: "Fehlgeschlagen",
};
export const AUDIT_PURPOSE: Record<AuditPurpose, string> = { sales: "Verkaufsprüfung", monthly: "Monatsprüfung" };
export const AUDIT_RUN_STATUS: Record<AuditRunStatus, string> = { due: "Fällig", started: "Läuft", reported: "Fertig", failed: "Fehlgeschlagen" };
export const REVIEW_STATUS: Record<ReviewStatus, string> = {
  waiting_link: "Wartet auf den Bewertungslink", due: "Wird verschickt", sent: "Bitte verschickt", reminded: "Erinnerung verschickt",
  done: "Bewertung ist da", cancelled: "Abgebrochen",
};
export const TRIAGE_STATUS: Record<TriageStatus, string> = {
  queued: "Wartet auf den Server", claimed: "Wird gerade gelesen", classified: "Gelesen", applied: "Erledigt", failed: "Konnte nicht gelesen werden",
};
export const TRANSACTION_STATUS: Record<TransactionStatus, string> = {
  paid: "Rechnung bezahlt", suggested: "Vorschlag wartet", open: "Unklar", other_income: "Sonstige Einnahme", private: "Privat", expense: "Ausgabe",
  reversed: "Verrechnet",
};

export const APPOINTMENT_KIND: Record<AppointmentKind, string> = {
  visit: "Vor-Ort-Gespräch", callback: "Rückruf", call: "Telefonat", video: "Videogespräch", other: "Termin",
};
export const AUDIT_REQUEST_STATUS: Record<AuditRequestStatus, string> = { open: "Wartet auf dich", proposed: "Vorschläge verschickt", booked: "Termin gebucht" };
export const APPOINTMENT_STATUS: Record<AppointmentStatus, string> = { planned: "Geplant", done: "Erledigt", cancelled: "Abgesagt" };

/** The labels of crm.source_channel_label, in its order. */
export const CHANNEL: Record<Channel, string> = {
  google_search: "Google-Suche", google_maps: "Google Maps", linkedin: "LinkedIn", instagram: "Instagram", facebook: "Facebook", xing: "Xing",
  youtube: "YouTube", tiktok: "TikTok", x: "X", threads: "Threads", reddit: "Reddit", forum: "Forum", newsletter: "Newsletter",
  referral: "Empfehlung", other: "Sonstiges",
};

export function channelLabel(channel: string | null): string {
  return channel !== null && channel in CHANNEL ? CHANNEL[channel as Channel] : "Unbekannt";
}
