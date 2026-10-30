import { assert, assertEquals, assertRejects, assertStringIncludes } from "jsr:@std/assert@1";
import { Attachments, berlinDate, type DocumentStore, type GeneratedDocument, type MailAppointment, renderMissingInvoices, storedPdfQuery } from "./documents.ts";
import type { OutboxRow, RadarQuote } from "./outbox.ts";
import { toDunningData } from "./pdf/dunning.ts";
import { type InvoiceData, toInvoiceData } from "./pdf/invoice.ts";
import { type QuoteData, toQuoteData } from "./pdf/quote.ts";
import { newReport } from "./state.ts";
import { customer, seller } from "./testing/fixtures.ts";

const items = [{ position: 1, title: "Webseite", description: "", quantity: 1, unit: "Stück", unit_price_net: 500, vat_rate: 19 }];
const settings = { ...seller, small_business: true };
const invoiceRow = { number: "RE-2026-0007", issue_date: "2026-10-24", service_date: "2026-10-20", due_date: "2026-11-07", intro: "", outro: "",
  net: 500, vat: 0, gross: 500, seller_snapshot: settings, customer_snapshot: customer, invoice_items: items };

const MAILBOX = "post@beispiel.test";
const appointment: MailAppointment = {
  id: "7d5c1c1e-4f0a-4a51-9a52-3f1d2a7b9c10", kind: "visit", title: "Vor-Ort-Gespräch Bäckerei Größe GmbH", starts_on: "2026-10-31",
  starts_at: "2026-10-31T09:00:00+00:00", ends_at: "2026-10-31T10:00:00+00:00", location: "Hauptstraße 5", note: "nur für Daniel",
  updated_at: "2026-10-29T12:00:00+00:00", status: "planned",
};

class FakeDocuments implements DocumentStore {
  saved: GeneratedDocument[] = [];
  reads: { path: string; bucket: string }[] = [];
  existingPath: string | null = null;
  radar: RadarQuote = { state: "none" };
  missing: string[] = [];
  appointmentRow: MailAppointment | null = appointment;
  existing(_kind: "quote" | "invoice", _id: string) { return Promise.resolve(this.existingPath); }
  read(path: string, bucket: "crm" | "radar") { this.reads.push({ path, bucket }); return Promise.resolve(new Uint8Array([37, 80, 68, 70])); }
  save(doc: GeneratedDocument) { this.saved.push(doc); return Promise.resolve(); }
  radarQuote() { return Promise.resolve(this.radar); }
  contract() { return Promise.resolve({ id: "k1", number: "VT-2026-0001", title: "Wartungsvertrag", body: "Wartungsvertrag\n\n§ 1 Gegenstand\nText" }); }
  seller() { return Promise.resolve(seller); }
  quote(): Promise<QuoteData> {
    return Promise.resolve(toQuoteData({ number: "AN-2026-0004", issue_date: "2026-10-24", valid_until: "2026-11-23", net: 500, vat: 0, gross: 500, customers: customer, quote_items: items }, settings));
  }
  invoice(): Promise<{ customerId: string; data: InvoiceData }> { return Promise.resolve({ customerId: "c1", data: toInvoiceData(invoiceRow, null) }); }
  dunning(_id: string, level: number, today: string) {
    return Promise.resolve(toDunningData({ number: "RE-2026-0007", issue_date: "2026-10-01", due_date: "2026-10-15", gross: 500, paid_amount: 0, customers: customer }, level, settings, today));
  }
  invoicesWithoutPdf() { return Promise.resolve(this.missing); }
  appointment(_id: string) { return Promise.resolve(this.appointmentRow); }
}

const mail = (overrides: Partial<OutboxRow>): OutboxRow => ({
  id: "o1", customer_id: "c1", to_address: "kunde@example.org", subject: "x", body: "x", kind: "invoice", contract_id: null, quote_id: null,
  invoice_id: "i1", dunning_level: null, appointment_id: null, list_unsubscribe: "", attempts: 0, created_at: "2026-10-24T08:00:00Z", ...overrides,
});
const created = Date.parse("2026-10-24T08:00:00Z");

Deno.test("an invoice PDF is rendered once and stored with its invoice id", async () => {
  const store = new FakeDocuments();
  const prepared = await new Attachments(store, MAILBOX).prepare(mail({}), created);
  assert(prepared.status === "ready" && prepared.attachment !== null);
  assertEquals(prepared.attachment.path, "customers/c1/rechnungen/Rechnung_RE-2026-0007.pdf");
  assertEquals(prepared.attachment.name, "Rechnung_RE-2026-0007.pdf");
  assertEquals(store.saved.map((doc) => [doc.kind, doc.invoice_id, doc.title, doc.file_path]),
    [["invoice", "i1", "Rechnung RE-2026-0007.pdf", "customers/c1/rechnungen/Rechnung_RE-2026-0007.pdf"]]);
});

Deno.test("an invoice that already has its PDF sends exactly that file", async () => {
  const store = new FakeDocuments();
  store.existingPath = "customers/c1/rechnungen/Rechnung_RE-2026-0007.pdf";
  const prepared = await new Attachments(store, MAILBOX).prepare(mail({}), created);
  assertEquals(store.saved.length, 0);
  assertEquals(store.reads, [{ path: store.existingPath, bucket: "crm" }]);
  assert(prepared.status === "ready" && prepared.attachment?.path === store.existingPath);
});

Deno.test("a quote takes the finished RadarAuditor PDF and keeps a copy in the customer file", async () => {
  const store = new FakeDocuments();
  store.radar = { state: "ready", path: "p1/d1/audit-angebot.pdf" };
  const prepared = await new Attachments(store, MAILBOX).prepare(mail({ kind: "quote", quote_id: "q1", invoice_id: null }), created);
  assertEquals(store.reads, [{ path: "p1/d1/audit-angebot.pdf", bucket: "radar" }]);
  assertEquals(store.saved.map((doc) => [doc.kind, doc.quote_id, doc.title]), [["quote", "q1", "Prüfbericht und Angebot AN-2026-0004.pdf"]]);
  assert(prepared.status === "ready" && prepared.attachment?.name === "Pruefbericht_und_Angebot_AN-2026-0004.pdf");
});

Deno.test("a quote waits while the RadarAuditor PDF is in the making, then gets the CRM's own PDF", async () => {
  const store = new FakeDocuments();
  store.radar = { state: "pending" };
  const quote = mail({ kind: "quote", quote_id: "q1", invoice_id: null });
  assertEquals(await new Attachments(store, MAILBOX).prepare(quote, created + 5 * 60_000), { status: "wait" });
  const late = await new Attachments(store, MAILBOX).prepare(quote, created + 31 * 60_000);
  assert(late.status === "ready" && late.attachment?.path === "customers/c1/angebote/Angebot_AN-2026-0004.pdf");
  assertEquals(store.saved.map((doc) => [doc.kind, doc.source, doc.quote_id]), [["quote", "generated", "q1"]]);
});

Deno.test("a reminder PDF is stored as other document of the invoice, per level", async () => {
  const store = new FakeDocuments();
  const prepared = await new Attachments(store, MAILBOX).prepare(mail({ kind: "dunning", dunning_level: 2 }), created);
  assert(prepared.status === "ready" && prepared.attachment?.path === "customers/c1/mahnungen/1._Mahnung_RE-2026-0007.pdf");
  assertEquals(store.saved.map((doc) => [doc.kind, doc.invoice_id, doc.title]), [["other", "i1", "1. Mahnung RE-2026-0007.pdf"]]);
});

Deno.test("contract mails carry the contract PDF, review mails nothing", async () => {
  const store = new FakeDocuments();
  const contract = await new Attachments(store, MAILBOX).prepare(mail({ kind: "contract", contract_id: "k1", invoice_id: null }), created);
  assert(contract.status === "ready" && contract.attachment?.path === "customers/c1/vertraege/Wartungsvertrag_VT-2026-0001.pdf");
  assertEquals(store.saved[0].contract_id, "k1");
  assertEquals(await new Attachments(store, MAILBOX).prepare(mail({ kind: "review_request", invoice_id: null }), created), { status: "ready", attachment: null });
});

Deno.test("finalised invoices without PDF get one, a broken one is reported and the rest continue", async () => {
  const store = new FakeDocuments();
  store.missing = ["i1", "i2"];
  let calls = 0;
  store.invoice = () => (++calls === 1 ? Promise.reject(new Error("Rechnung RE-1: gespeicherte Firmen- oder Kundendaten fehlen.")) : Promise.resolve({ customerId: "c1", data: toInvoiceData(invoiceRow, null) }));
  const report = newReport();
  await renderMissingInvoices(store, report, () => true);
  assertEquals([store.saved.length, report.documents], [1, 1]);
  assertEquals(report.errors, ["Rechnungs-PDF i1: Rechnung RE-1: gespeicherte Firmen- oder Kundendaten fehlen."]);
});

Deno.test("dates of letters follow the German calendar day", () => {
  assertEquals(berlinDate(Date.parse("2026-10-24T22:30:00Z")), "2026-10-25");
  assertEquals(berlinDate(Date.parse("2026-12-31T12:00:00Z")), "2026-12-31");
});

Deno.test("the stored PDF of an invoice or quote is the oldest one of exactly that kind", () => {
  assertEquals(storedPdfQuery("invoice", "i1"), "documents?kind=eq.invoice&invoice_id=eq.i1&select=file_path&order=created_at.asc&limit=1");
  assertEquals(storedPdfQuery("quote", "q1"), "documents?kind=eq.quote&quote_id=eq.q1&select=file_path&order=created_at.asc&limit=1");
});

const appointmentMail = mail({ kind: "appointment", appointment_id: appointment.id, invoice_id: null });
const unfolded = (bytes: Uint8Array) => new TextDecoder().decode(bytes).replace(/\r\n[ \t]/g, "");

Deno.test("an appointment confirmation carries the appointment as published calendar file, not stored", async () => {
  const store = new FakeDocuments();
  const prepared = await new Attachments(store, MAILBOX).prepare(appointmentMail, created);
  assert(prepared.status === "ready" && prepared.attachment !== null);
  assertEquals([prepared.attachment.name, prepared.attachment.type, prepared.attachment.path],
    ["Termin_2026-10-31.ics", "text/calendar; charset=utf-8; method=PUBLISH", null]);
  const text = unfolded(prepared.attachment.bytes);
  for (const line of ["METHOD:PUBLISH", "UID:7d5c1c1e-4f0a-4a51-9a52-3f1d2a7b9c10@crm.speedofthespirit.dev", "DTSTAMP:20261024T080000Z",
    "DTSTART:20261031T090000Z", "DTEND:20261031T100000Z", "SUMMARY:Vor-Ort-Gespräch Bäckerei Größe GmbH", "LOCATION:Hauptstraße 5",
    "DESCRIPTION:Vor-Ort-Gespräch mit Erika Beispiel", 'ORGANIZER;CN="Erika Beispiel":mailto:post@beispiel.test']) {
    assertStringIncludes(text, `\r\n${line}\r\n`);
  }
  assertEquals(text.includes("nur für Daniel"), false);
  assertEquals(store.saved.length, 0);
});

Deno.test("an appointment that lost its time is confirmed as an all-day appointment", async () => {
  const store = new FakeDocuments();
  store.appointmentRow = { ...appointment, starts_at: null, ends_at: null };
  const prepared = await new Attachments(store, MAILBOX).prepare(appointmentMail, created);
  assert(prepared.status === "ready" && prepared.attachment !== null);
  assertStringIncludes(unfolded(prepared.attachment.bytes), "\r\nDTSTART;VALUE=DATE:20261031\r\n");
});

Deno.test("a confirmation of a deleted or cancelled appointment is an error, not a mail", async () => {
  const store = new FakeDocuments();
  store.appointmentRow = null;
  await assertRejects(() => new Attachments(store, MAILBOX).prepare(appointmentMail, created), Error, "Termin");
  store.appointmentRow = { ...appointment, status: "cancelled" };
  await assertRejects(() => new Attachments(store, MAILBOX).prepare(appointmentMail, created), Error, "abgesagt");
});

const cancelMail = mail({ kind: "appointment_cancel", appointment_id: appointment.id, invoice_id: null });

Deno.test("a cancellation carries the cancelled appointment as calendar file with METHOD:CANCEL, not stored", async () => {
  const store = new FakeDocuments();
  store.appointmentRow = { ...appointment, status: "cancelled" };
  const prepared = await new Attachments(store, MAILBOX).prepare(cancelMail, created);
  assert(prepared.status === "ready" && prepared.attachment !== null);
  assertEquals([prepared.attachment.name, prepared.attachment.type, prepared.attachment.path],
    ["Absage_2026-10-31.ics", "text/calendar; charset=utf-8; method=CANCEL", null]);
  const text = unfolded(prepared.attachment.bytes);
  for (const line of ["METHOD:CANCEL", "UID:7d5c1c1e-4f0a-4a51-9a52-3f1d2a7b9c10@crm.speedofthespirit.dev", "STATUS:CANCELLED", "SEQUENCE:1",
    "DTSTART:20261031T090000Z", 'ORGANIZER;CN="Erika Beispiel":mailto:post@beispiel.test']) {
    assertStringIncludes(text, `\r\n${line}\r\n`);
  }
  assertEquals(store.saved.length, 0);
});

Deno.test("a cancellation of a deleted or still planned appointment is an error, not a mail", async () => {
  const store = new FakeDocuments();
  store.appointmentRow = null;
  await assertRejects(() => new Attachments(store, MAILBOX).prepare(cancelMail, created), Error, "gelöscht");
  store.appointmentRow = appointment;
  await assertRejects(() => new Attachments(store, MAILBOX).prepare(cancelMail, created), Error, "nicht abgesagt");
});
