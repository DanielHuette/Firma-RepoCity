import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { type AttachmentSource, attachmentKind, nextFailure, type OutboxRow, type OutboxStore, type Prepared, quoteSource, sendOutbox, type SentMail, type Transport } from "./outbox.ts";
import { newReport } from "./state.ts";

const row = (overrides: Partial<OutboxRow> = {}): OutboxRow => ({
  id: "o1", customer_id: "c1", to_address: "kunde@example.org", subject: "Rechnung RE-2026-0007", body: "Guten Tag", kind: "invoice",
  contract_id: null, quote_id: null, invoice_id: "i1", dunning_level: null, appointment_id: null, list_unsubscribe: "", attempts: 0, created_at: "2026-10-24T08:00:00Z",
  ...overrides,
});

Deno.test("each kind gets its attachment, review mails none", () => {
  assertEquals(attachmentKind(row({ kind: "contract", contract_id: "k1", invoice_id: null })), "contract");
  assertEquals(attachmentKind(row({ kind: "quote", quote_id: "q1", invoice_id: null })), "quote");
  assertEquals(attachmentKind(row()), "invoice");
  assertEquals(attachmentKind(row({ kind: "dunning", dunning_level: 2 })), "dunning");
  assertEquals(attachmentKind(row({ kind: "review_request", invoice_id: null })), null);
  assertEquals(attachmentKind(row({ kind: "review_reminder", invoice_id: null })), null);
  assertEquals(attachmentKind(row({ kind: "contract", contract_id: null, invoice_id: null })), null);
  assertEquals(attachmentKind(row({ kind: "appointment", appointment_id: "a1", invoice_id: null })), "appointment");
  assertEquals(attachmentKind(row({ kind: "appointment_cancel", appointment_id: "a1", invoice_id: null })), "appointment_cancel");
});

Deno.test("follow-ups and mails drafted by the assistant are ordinary mails without attachment", () => {
  assertEquals(attachmentKind(row({ kind: "follow_up", quote_id: "q1", invoice_id: null })), null);
  assertEquals(attachmentKind(row({ kind: "assistant", invoice_id: null })), null);
});

Deno.test("an invoice or quote mail without its reference is an error, not a mail without attachment", () => {
  assertThrows(() => attachmentKind(row({ invoice_id: null })), Error, "Rechnung");
  assertThrows(() => attachmentKind(row({ kind: "quote", quote_id: null })), Error, "Angebot");
  assertThrows(() => attachmentKind(row({ kind: "dunning", invoice_id: null })), Error, "Rechnung");
  assertThrows(() => attachmentKind(row({ kind: "appointment", invoice_id: null })), Error, "Termin");
  assertThrows(() => attachmentKind(row({ kind: "appointment_cancel", invoice_id: null })), Error, "Termin");
});

Deno.test("the RadarAuditor PDF is used when ready, awaited for 30 minutes, otherwise replaced", () => {
  const created = "2026-10-24T08:00:00Z";
  const at = (minutes: number) => Date.parse(created) + minutes * 60_000;
  assertEquals(quoteSource({ state: "ready", path: "c/d/x.pdf" }, created, at(1)), "radar");
  assertEquals(quoteSource({ state: "pending" }, created, at(29)), "wait");
  assertEquals(quoteSource({ state: "pending" }, created, at(30)), "own");
  assertEquals(quoteSource({ state: "failed" }, created, at(1)), "own");
  assertEquals(quoteSource({ state: "none" }, created, at(1)), "own");
});

Deno.test("failures are retried twice, the third marks the mail failed", () => {
  assertEquals(nextFailure(0), { attempts: 1, status: "queued" });
  assertEquals(nextFailure(1), { attempts: 2, status: "queued" });
  assertEquals(nextFailure(2), { attempts: 3, status: "failed" });
});

class FakeOutbox implements OutboxStore {
  sent: { id: string; path: string | null }[] = [];
  failures: { id: string; attempts: number; status: string; error: string }[] = [];
  recorded: string[] = [];
  status = new Map<string, string>();
  markSentFailures = 0;
  recordError: string | null = null;
  constructor(private readonly rows: OutboxRow[]) {
    rows.forEach((mail) => this.status.set(mail.id, "queued"));
  }
  queued() { return Promise.resolve(this.rows.filter((mail) => this.status.get(mail.id) === "queued")); }
  markSent(mail: OutboxRow, _sentAt: string, path: string | null) {
    if (this.markSentFailures-- > 0) return Promise.reject(new Error("Datenbank outbox: 503"));
    this.status.set(mail.id, "sent");
    this.sent.push({ id: mail.id, path });
    return Promise.resolve();
  }
  markFailed(id: string, attempts: number, status: string, error: string) {
    this.status.set(id, status);
    this.failures.push({ id, attempts, status, error });
    return Promise.resolve();
  }
  record(mail: OutboxRow) {
    if (this.recordError !== null) return Promise.reject(new Error(this.recordError));
    this.recorded.push(mail.id);
    return Promise.resolve();
  }
}

class FakeTransport implements Transport {
  attachments: (string | null)[] = [];
  unsubscribe: string[] = [];
  constructor(private readonly error: string | null = null) {}
  send(mail: OutboxRow, attachment: { name: string } | null): Promise<SentMail> {
    if (this.error !== null) return Promise.reject(new Error(this.error));
    this.attachments.push(attachment?.name ?? null);
    this.unsubscribe.push(mail.list_unsubscribe);
    return Promise.resolve({ messageId: "<m@beispiel.test>", fromName: "Erika Beispiel" });
  }
}

const source = (prepared: Prepared): AttachmentSource => ({ prepare: () => Promise.resolve(prepared) });
const pdf = { name: "RE-2026-0007.pdf", bytes: new Uint8Array([1]), type: "application/pdf", path: "customers/c1/rechnungen/RE-2026-0007.pdf" };

Deno.test("a sent mail is marked sent with its attachment path and recorded", async () => {
  const store = new FakeOutbox([row()]);
  const transport = new FakeTransport();
  const report = newReport();
  await sendOutbox({ store, attachments: source({ status: "ready", attachment: pdf }), transport, report, now: () => 0, hasTime: () => true });
  assertEquals([store.sent, store.recorded, transport.attachments, report.sent], [[{ id: "o1", path: pdf.path }], ["o1"], ["RE-2026-0007.pdf"], 1]);
});

Deno.test("a quote waiting for its RadarAuditor PDF stays queued without counting as attempt", async () => {
  const store = new FakeOutbox([row({ kind: "quote", quote_id: "q1", invoice_id: null })]);
  const transport = new FakeTransport();
  await sendOutbox({ store, attachments: source({ status: "wait" }), transport, report: newReport(), now: () => 0, hasTime: () => true });
  assertEquals([store.sent.length, store.failures.length, transport.attachments.length], [0, 0, 0]);
});

Deno.test("a failed send counts the attempt and keeps the error", async () => {
  const store = new FakeOutbox([row({ attempts: 2 })]);
  const report = newReport();
  await sendOutbox({ store, attachments: source({ status: "ready", attachment: null }), transport: new FakeTransport("Versand: 550 rejected"), report, now: () => 0, hasTime: () => true });
  assertEquals(store.failures, [{ id: "o1", attempts: 3, status: "failed", error: "Versand: 550 rejected" }]);
  assertEquals(report.failed, 1);
});

Deno.test("no mail is started once the run's time is used up", async () => {
  const store = new FakeOutbox([row()]);
  const transport = new FakeTransport();
  await sendOutbox({ store, attachments: source({ status: "ready", attachment: null }), transport, report: newReport(), now: () => 0, hasTime: () => false });
  assertEquals(transport.attachments.length, 0);
});

Deno.test("a mail the mail server accepted is never sent again, even when filing it fails", async () => {
  const store = new FakeOutbox([row()]);
  store.recordError = "Datenbank emails: 500";
  const transport = new FakeTransport();
  const first = newReport();
  const run = { store, attachments: source({ status: "ready", attachment: pdf }), transport, now: () => 0, hasTime: () => true };
  await sendOutbox({ ...run, report: first });
  await sendOutbox({ ...run, report: newReport() });
  assertEquals(transport.attachments.length, 1);
  assertEquals([store.status.get("o1"), store.failures.length, first.sent, first.failed], ["sent", 0, 1, 0]);
  assertEquals(first.errors, ["Mail „Rechnung RE-2026-0007“ verschickt, aber nicht vollständig abgelegt: Datenbank emails: 500"]);
});

Deno.test("marking a sent mail is retried before it is given up", async () => {
  const store = new FakeOutbox([row()]);
  store.markSentFailures = 2;
  const transport = new FakeTransport();
  const report = newReport();
  await sendOutbox({ store, attachments: source({ status: "ready", attachment: null }), transport, report, now: () => 0, hasTime: () => true });
  assertEquals([store.status.get("o1"), store.failures.length, report.sent], ["sent", 0, 1]);
});

Deno.test("follow-ups and assistant mails go out with the rest of the queue", async () => {
  const unsubscribe = "https://beispiel.supabase.co/functions/v1/crm-abmelden?t=3f8e2a10-6b7c-4d5e-8f90-a1b2c3d4e5f6";
  const store = new FakeOutbox([
    row({ id: "f1", kind: "follow_up", quote_id: "q1", invoice_id: null, list_unsubscribe: unsubscribe }),
    row({ id: "s1", kind: "assistant", invoice_id: null }),
  ]);
  const transport = new FakeTransport();
  const report = newReport();
  await sendOutbox({ store, attachments: source({ status: "ready", attachment: null }), transport, report, now: () => 0, hasTime: () => true });
  assertEquals([store.sent, transport.unsubscribe, report.sent], [[{ id: "f1", path: null }, { id: "s1", path: null }], [unsubscribe, ""], 2]);
});

Deno.test("proposals and appointment reminders go out without attachment and without the opt-out header", async () => {
  assertEquals(attachmentKind(row({ kind: "audit_proposal", invoice_id: null })), null);
  assertEquals(attachmentKind(row({ kind: "appointment_reminder", appointment_id: "a1", invoice_id: null })), null);
  const store = new FakeOutbox([
    row({ id: "p1", kind: "audit_proposal", invoice_id: null }),
    row({ id: "r1", kind: "appointment_reminder", appointment_id: "a1", invoice_id: null }),
  ]);
  const transport = new FakeTransport();
  const report = newReport();
  await sendOutbox({ store, attachments: source({ status: "ready", attachment: null }), transport, report, now: () => 0, hasTime: () => true });
  assertEquals([store.sent, transport.unsubscribe, report.sent], [[{ id: "p1", path: null }, { id: "r1", path: null }], ["", ""], 2]);
});
