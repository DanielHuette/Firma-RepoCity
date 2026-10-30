import { assert, assertEquals } from "jsr:@std/assert@1";
import { parse } from "./mail.ts";
import { emptyDirectory, newReport } from "./state.ts";
import { applyVerdicts, type Intake, parkUnknown, type ReviewRow, type TriageRow, type TriageStore, type UnknownTriage, unknownAction, verdictOf } from "./triage.ts";

class FakeTriageStore implements TriageStore {
  files = new Map<string, Uint8Array>();
  queued: UnknownTriage[] = [];
  reviews: ReviewRow[] = [];
  counted: { id: string; count: number }[] = [];
  intakes: Intake[] = [];
  applied: string[] = [];
  rows: TriageRow[] = [];
  saveRaw(path: string, raw: Uint8Array) { this.files.set(path, raw); return Promise.resolve(); }
  queueUnknown(row: UnknownTriage) { this.queued.push(row); return Promise.resolve(); }
  countReview(id: string, count: number) { this.counted.push({ id, count }); return Promise.resolve(); }
  addReview(row: ReviewRow) { this.reviews.push(row); return Promise.resolve(`review-${String(this.reviews.length)}`); }
  verdicts() { return Promise.resolve(this.rows); }
  rawFiles(row: TriageRow) {
    return Promise.resolve([...this.files.keys()].filter((path) => path === row.raw_path || path.startsWith(`triage/${row.id}/`)).sort());
  }
  readRaw(path: string) { return Promise.resolve(this.files.get(path) ?? new Uint8Array()); }
  dropRaw(paths: string[]) { paths.forEach((path) => this.files.delete(path)); return Promise.resolve(); }
  intake(contact: Intake) { this.intakes.push(contact); return Promise.resolve("customer-9"); }
  markApplied(id: string) { this.applied.push(id); return Promise.resolve(); }
}

const mail = (from: string, subject: string, extra = "", body = "Was kostet eine Webseite?") =>
  new TextEncoder().encode(`From: Erika <${from}>\r\nTo: post@beispiel.test\r\nSubject: ${subject}\r\n${extra}\r\n${body}`);

async function park(store: FakeTriageStore, dir = emptyDirectory("beispiel.test"), raw = mail("erika@neu.de", "Anfrage")) {
  const report = newReport();
  const parsed = await parse(raw);
  await parkUnknown(store, dir, report, { parsed, raw, direction: "in", party: { address: (parsed.from?.address ?? "").toLowerCase(), name: "Erika" }, folder: "INBOX" });
  return { dir, report };
}

Deno.test("the first mail of an unknown sender is stored and queued once", async () => {
  const store = new FakeTriageStore();
  const { dir, report } = await park(store, undefined, mail("erika@neu.de", "Anfrage", "", "y".repeat(9000)));
  assertEquals(store.queued.length, 1);
  const row = store.queued[0];
  assertEquals([row.kind, row.status, row.address, row.name, row.subject, row.direction, row.folder], ["unknown_sender", "queued", "erika@neu.de", "Erika", "Anfrage", "in", "INBOX"]);
  assertEquals(row.raw_path, `triage/${row.id}.eml`);
  assert(store.files.has(row.raw_path));
  assertEquals(row.body_text.length, 8000);
  assertEquals(dir.triage.get("erika@neu.de"), row.id);
  assertEquals([report.queued, report.parked], [1, 1]);
});

Deno.test("further mails of a queued address are kept next to the first, without a new row", async () => {
  const store = new FakeTriageStore();
  const { dir } = await park(store);
  await park(store, dir, mail("erika@neu.de", "Nachtrag"));
  const id = store.queued[0].id;
  assertEquals(store.queued.length, 1);
  assertEquals([...store.files.keys()].filter((path) => path.startsWith(`triage/${id}/`)).length, 1);
});

Deno.test("automatic senders go straight to the review list, ignored addresses are dropped", async () => {
  const store = new FakeTriageStore();
  const { report } = await park(store, undefined, mail("newsletter@shop.de", "Angebote", "List-Unsubscribe: <mailto:x@shop.de>\r\n"));
  assertEquals(store.reviews.map((row) => [row.address, row.verdict]), [["newsletter@shop.de", "automated"]]);
  assertEquals([store.queued.length, report.parked], [0, 1]);
  const dir = emptyDirectory("beispiel.test");
  dir.ignored.add("erika@neu.de");
  const ignored = new FakeTriageStore();
  await park(ignored, dir);
  assertEquals([ignored.queued.length, ignored.reviews.length, ignored.files.size], [0, 0, 0]);
});

Deno.test("an address already waiting for Daniel's decision only counts the mail", async () => {
  const store = new FakeTriageStore();
  const dir = emptyDirectory("beispiel.test");
  dir.reviews.set("erika@neu.de", { id: "review-1", mail_count: 2, status: "open" });
  await park(store, dir);
  assertEquals(store.counted, [{ id: "review-1", count: 3 }]);
  assertEquals(store.queued.length, 0);
});

Deno.test("the decision order is ignore list, review list, queued address, automatic sender", () => {
  const dir = emptyDirectory("beispiel.test");
  dir.triage.set("a@x.de", "t1");
  assertEquals(unknownAction(dir, "a@x.de", "in", [{ key: "list-id", value: "x" }]), { kind: "attach", triageId: "t1" });
  dir.reviews.set("a@x.de", { id: "r1", mail_count: 1, status: "ignored" });
  assertEquals(unknownAction(dir, "a@x.de", "in", []).kind, "review_seen");
  dir.ignored.add("a@x.de");
  assertEquals(unknownAction(dir, "a@x.de", "in", []).kind, "ignore");
  assertEquals(unknownAction(dir, "noreply@x.de", "out", []).kind, "queue");
});

const row = (overrides: Partial<TriageRow>): TriageRow => ({
  id: "t1", status: "classified", direction: "in", address: "erika@neu.de", name: "Erika", subject: "Anfrage", body_text: "Was kostet eine Webseite?",
  folder: "INBOX", raw_path: "triage/t1.eml", result: { verdict: "customer", name: "Erika Muster", company: "Muster GmbH", reason: "fragt nach Preis" },
  created_at: "2026-10-24T08:00:00Z", ...overrides,
});

Deno.test("verdicts map to customer intake or the review list, failed classification means unsure", () => {
  assertEquals(verdictOf(row({})), { kind: "customer", name: "Erika Muster", company: "Muster GmbH" });
  assertEquals(verdictOf(row({ result: { verdict: "not_customer", reason: "Lieferant" } })), { kind: "review", verdict: "not_customer", reason: "Lieferant", name: "Erika", company: "" });
  assertEquals(verdictOf(row({ result: { verdict: "automated" } })).kind, "review");
  assertEquals(verdictOf(row({ result: { verdict: "spam" } })), { kind: "review", verdict: "unsure", reason: "", name: "Erika", company: "" });
  const failed = verdictOf(row({ status: "failed", result: null }));
  assert(failed.kind === "review" && failed.verdict === "unsure" && failed.reason.startsWith("Der Server konnte"));
});

Deno.test("a sender classified as customer is taken in and every stored mail is filed, then the store is cleared", async () => {
  const store = new FakeTriageStore();
  store.files.set("triage/t1.eml", mail("erika@neu.de", "Anfrage"));
  store.files.set("triage/t1/abc.eml", mail("erika@neu.de", "Nachtrag"));
  store.rows = [row({})];
  const dir = emptyDirectory("beispiel.test");
  dir.triage.set("erika@neu.de", "t1");
  const filed: { customer: string; folder: string | null }[] = [];
  const report = newReport();
  await applyVerdicts(store, dir, report, (customer, _raw, folder) => { filed.push({ customer, folder }); return Promise.resolve(); });
  assertEquals(store.intakes, [{ email: "erika@neu.de", name: "Erika Muster", company: "Muster GmbH", subject: "Anfrage", message: "Was kostet eine Webseite?" }]);
  assertEquals(filed, [{ customer: "customer-9", folder: "INBOX" }, { customer: "customer-9", folder: null }]);
  assertEquals([store.files.size, store.applied, dir.customers.get("erika@neu.de"), dir.triage.has("erika@neu.de"), report.created], [0, ["t1"], "customer-9", false, 1]);
});

Deno.test("an outgoing first contact creates the customer without an inquiry", async () => {
  const store = new FakeTriageStore();
  store.files.set("triage/t1.eml", mail("post@beispiel.test", "Angebot"));
  store.rows = [row({ direction: "out" })];
  await applyVerdicts(store, emptyDirectory("beispiel.test"), newReport(), () => Promise.resolve());
  assertEquals([store.intakes[0].subject, store.intakes[0].message], [null, null]);
});

Deno.test("other verdicts land on the review list with the number of stored mails", async () => {
  const store = new FakeTriageStore();
  store.files.set("triage/t1.eml", mail("erika@neu.de", "Anfrage"));
  store.files.set("triage/t1/abc.eml", mail("erika@neu.de", "Nachtrag"));
  store.rows = [row({ result: { verdict: "not_customer", name: "Erika", company: "Lieferant GmbH", reason: "Lieferant" } })];
  const report = newReport();
  await applyVerdicts(store, emptyDirectory("beispiel.test"), report, () => Promise.reject(new Error("must not file")));
  const review = store.reviews[0];
  assertEquals([review.address, review.verdict, review.mail_count, review.company, review.reason, review.sent_at], ["erika@neu.de", "not_customer", 2, "Lieferant GmbH", "Lieferant", "2026-10-24T08:00:00Z"]);
  assertEquals([store.files.size, store.applied, report.created], [0, ["t1"], 0]);
});

Deno.test("when filing fails the row stays classified and keeps its mails for the next run", async () => {
  const store = new FakeTriageStore();
  store.files.set("triage/t1.eml", mail("erika@neu.de", "Anfrage"));
  store.rows = [row({})];
  const report = newReport();
  await applyVerdicts(store, emptyDirectory("beispiel.test"), report, () => Promise.reject(new Error("Speicher: 503")));
  assertEquals([store.files.size, store.applied.length], [1, 0]);
  assertEquals(report.errors, ["Einordnung erika@neu.de: Speicher: 503"]);
});
