import { assertEquals } from "jsr:@std/assert@1";
import { type CustomerMailTriage, type EmailRow, fileMail, type FilingStore, type StoredAttachment } from "./filing.ts";
import { parse } from "./mail.ts";
import { emptyDirectory, newReport } from "./state.ts";

class FakeFilingStore implements FilingStore {
  emails: EmailRow[] = [];
  attachments: StoredAttachment[] = [];
  triage: CustomerMailTriage[] = [];
  addEmail(row: EmailRow): Promise<string | null> {
    if (this.emails.some((email) => email.message_id === row.message_id)) return Promise.resolve(null);
    this.emails.push(row);
    return Promise.resolve(`email-${String(this.emails.length)}`);
  }
  addAttachment(file: StoredAttachment): Promise<void> {
    this.attachments.push(file);
    return Promise.resolve();
  }
  queueCustomerMail(row: CustomerMailTriage): Promise<void> {
    this.triage.push(row);
    return Promise.resolve();
  }
}

const raw = (date: string, body = "Ich nehme das Angebot an.", extraHeaders: string[] = []) => new TextEncoder().encode([
  ...extraHeaders, "From: Erika <erika@kunde.de>", "To: post@beispiel.test", "Subject: Angebot", `Date: ${date}`, "Message-ID: <m1@kunde.de>",
  "Content-Type: multipart/mixed; boundary=b", "", "--b", "Content-Type: text/plain; charset=utf-8", "", body, "--b",
  "Content-Type: application/pdf", "Content-Disposition: attachment; filename=unterschrift.pdf", "Content-Transfer-Encoding: base64", "", "JVBERi0=", "--b--", "",
].join("\r\n"));

function directory(quoteSentAt?: string) {
  const dir = emptyDirectory("beispiel.test");
  dir.customers.set("erika@kunde.de", "customer-1");
  if (quoteSentAt !== undefined) dir.quoteSince.set("customer-1", Date.parse(quoteSentAt));
  return dir;
}

async function file(store: FakeFilingStore, bytes: Uint8Array, quoteSentAt?: string, direction: "in" | "out" = "in") {
  const report = newReport();
  await fileMail(store, directory(quoteSentAt), report, { customerId: "customer-1", parsed: await parse(bytes), raw: bytes, direction, folder: "INBOX" });
  return report;
}

Deno.test("a known customer's mail is filed with its attachment", async () => {
  const store = new FakeFilingStore();
  const report = await file(store, raw("Sat, 24 Oct 2026 10:00:00 +0200"));
  assertEquals(report.imported, 1);
  assertEquals(store.emails[0].customer_id, "customer-1");
  assertEquals(store.emails[0].has_attachments, true);
  assertEquals(store.attachments.map((item) => item.path), ["customers/customer-1/mail/email-1/unterschrift.pdf"]);
  assertEquals(store.triage, []);
});

Deno.test("a mail already filed is neither filed nor queued again", async () => {
  const store = new FakeFilingStore();
  await file(store, raw("Sat, 24 Oct 2026 10:00:00 +0200"), "2026-10-20T08:00:00Z");
  const report = await file(store, raw("Sat, 24 Oct 2026 10:00:00 +0200"), "2026-10-20T08:00:00Z");
  assertEquals(report.imported, 0);
  assertEquals(store.attachments.length, 1);
  assertEquals(store.triage.length, 1);
});

Deno.test("an incoming mail after a sent quote is queued for Claude Code", async () => {
  const store = new FakeFilingStore();
  await file(store, raw("Sat, 24 Oct 2026 10:00:00 +0200", "x".repeat(9000)), "2026-10-20T08:00:00Z");
  assertEquals(store.triage.length, 1);
  const row = store.triage[0];
  assertEquals([row.kind, row.status, row.email_id, row.customer_id, row.subject, row.direction, row.address], ["customer_mail", "queued", "email-1", "customer-1", "Angebot", "in", "erika@kunde.de"]);
  assertEquals(row.body_text.length, 8000);
});

Deno.test("mails older than the sent quote, outgoing mails and customers without sent quote are not queued", async () => {
  const older = new FakeFilingStore();
  await file(older, raw("Mon, 19 Oct 2026 10:00:00 +0200"), "2026-10-20T08:00:00Z");
  const outgoing = new FakeFilingStore();
  await file(outgoing, raw("Sat, 24 Oct 2026 10:00:00 +0200"), "2026-10-20T08:00:00Z", "out");
  const noQuote = new FakeFilingStore();
  await file(noQuote, raw("Sat, 24 Oct 2026 10:00:00 +0200"));
  assertEquals([older.triage.length, outgoing.triage.length, noQuote.triage.length], [0, 0, 0]);
});

Deno.test("the queued customer mail says whether Zoho confirmed the sender", async () => {
  const signed = new FakeFilingStore();
  const header = "Authentication-Results: mx.zohomail.com; dkim=pass header.i=@kunde.de; spf=pass smtp.mailfrom=erika@kunde.de; dmarc=pass header.from=<erika@kunde.de>";
  await file(signed, raw("Sat, 24 Oct 2026 10:00:00 +0200", "Angenommen.", [header]), "2026-10-20T08:00:00Z");
  const unsigned = new FakeFilingStore();
  await file(unsigned, raw("Sat, 24 Oct 2026 10:00:00 +0200"), "2026-10-20T08:00:00Z");
  assertEquals([signed.triage[0].sender_verified, unsigned.triage[0].sender_verified], [true, false]);
});
