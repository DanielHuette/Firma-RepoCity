// Unknown senders. The worker no longer judges them itself: the original mail goes to the file store
// and one crm.mail_triage row per address waits for the server worker, which classifies it with
// Claude Code. Further mails of the same address before that are kept next to the first one. Once
// classified, a customer is taken in and all stored mails are filed; every other verdict lands on
// Daniel's review list, as before. Nothing a sender writes is dropped by a classification.
import { TRIAGE_TEXT_LIMIT } from "./config.ts";
import { errorText } from "./errors.ts";
import { automatedReason, type Direction, type Header, headers, type MailParty, mailDate, type Parsed, plainText, sha256 } from "./mail.ts";
import type { Directory, Report, Review } from "./state.ts";

export type ReviewVerdict = "unsure" | "not_customer" | "automated";

export interface UnknownTriage {
  id: string;
  kind: "unknown_sender";
  status: "queued";
  direction: Direction;
  address: string;
  name: string;
  subject: string;
  body_text: string;
  folder: string;
  raw_path: string;
}

export interface TriageRow {
  id: string;
  status: "classified" | "failed";
  direction: Direction;
  address: string;
  name: string;
  subject: string;
  body_text: string;
  folder: string;
  raw_path: string;
  result: Record<string, unknown> | null;
  created_at: string;
}

export interface ReviewRow {
  address: string;
  name: string;
  company: string;
  direction: Direction;
  subject: string;
  snippet: string;
  sent_at: string;
  mail_count: number;
  verdict: ReviewVerdict;
  reason: string;
}

export interface Intake { email: string; name: string; company: string; subject: string | null; message: string | null }

export interface TriageStore {
  saveRaw(path: string, raw: Uint8Array): Promise<void>;
  queueUnknown(row: UnknownTriage): Promise<void>;
  countReview(id: string, count: number, sentAt: string, subject: string): Promise<void>;
  /** Inserts the review row unless the address has one; returns the new id or null. */
  addReview(row: ReviewRow): Promise<string | null>;
  /** Unknown-sender rows that are classified, or failed for good. */
  verdicts(): Promise<TriageRow[]>;
  /** The first stored mail and every further one of the row. */
  rawFiles(row: TriageRow): Promise<string[]>;
  readRaw(path: string): Promise<Uint8Array>;
  dropRaw(paths: string[]): Promise<void>;
  intake(contact: Intake): Promise<string>;
  markApplied(id: string): Promise<void>;
}

/** Files one stored mail with the new customer; folder null means "the folder of its direction". */
export type FileRaw = (customerId: string, raw: Uint8Array, folder: string | null) => Promise<void>;

export interface UnknownMail { parsed: Parsed; raw: Uint8Array; direction: Direction; party: MailParty; folder: string }

export type UnknownAction =
  | { kind: "ignore" }
  | { kind: "review_seen"; review: Review }
  | { kind: "attach"; triageId: string }
  | { kind: "automated"; reason: string }
  | { kind: "queue" };

export const rawPath = (triageId: string) => `triage/${triageId}.eml`;
export const extraRawPath = (triageId: string, hash: string) => `triage/${triageId}/${hash}.eml`;

export function unknownAction(dir: Directory, address: string, direction: Direction, mailHeaders: Header[]): UnknownAction {
  if (dir.ignored.has(address)) return { kind: "ignore" };
  const review = dir.reviews.get(address);
  if (review !== undefined) return { kind: "review_seen", review };
  const triageId = dir.triage.get(address);
  if (triageId !== undefined) return { kind: "attach", triageId };
  const reason = direction === "in" ? automatedReason(address, mailHeaders) : null;
  return reason === null ? { kind: "queue" } : { kind: "automated", reason };
}

function reviewRow(mail: UnknownMail, reason: string): ReviewRow {
  return {
    address: mail.party.address, name: mail.party.name, company: "", direction: mail.direction, subject: (mail.parsed.subject ?? "").slice(0, 300),
    snippet: plainText(mail.parsed).slice(0, 600), sent_at: mailDate(mail.parsed, new Date()), mail_count: 1, verdict: "automated", reason,
  };
}

async function queue(store: TriageStore, dir: Directory, report: Report, mail: UnknownMail): Promise<void> {
  const id = crypto.randomUUID();
  await store.saveRaw(rawPath(id), mail.raw);
  await store.queueUnknown({
    id, kind: "unknown_sender", status: "queued", direction: mail.direction, address: mail.party.address, name: mail.party.name,
    subject: (mail.parsed.subject ?? "").slice(0, 500), body_text: plainText(mail.parsed).slice(0, TRIAGE_TEXT_LIMIT), folder: mail.folder, raw_path: rawPath(id),
  });
  dir.triage.set(mail.party.address, id);
  report.queued++;
  report.parked++;
}

export async function parkUnknown(store: TriageStore, dir: Directory, report: Report, mail: UnknownMail): Promise<void> {
  const action = unknownAction(dir, mail.party.address, mail.direction, headers(mail.parsed));
  switch (action.kind) {
    case "ignore": return;
    case "review_seen":
      if (action.review.status !== "open") return;
      action.review.mail_count++;
      return store.countReview(action.review.id, action.review.mail_count, mailDate(mail.parsed, new Date()), (mail.parsed.subject ?? "").slice(0, 300));
    case "attach": return store.saveRaw(extraRawPath(action.triageId, await sha256(mail.raw)), mail.raw);
    case "automated": {
      const id = await store.addReview(reviewRow(mail, action.reason));
      if (id !== null) dir.reviews.set(mail.party.address, { id, mail_count: 1, status: "open" });
      report.parked++;
      return;
    }
    case "queue": return queue(store, dir, report, mail);
  }
}

export type Verdict =
  | { kind: "customer"; name: string; company: string }
  | { kind: "review"; verdict: ReviewVerdict; reason: string; name: string; company: string };

const text = (value: unknown, limit: number) => (typeof value === "string" ? value.slice(0, limit) : "");

export function verdictOf(row: TriageRow): Verdict {
  if (row.status === "failed") {
    return { kind: "review", verdict: "unsure", reason: "Der Server konnte die Mail nicht einordnen, bitte selbst entscheiden.", name: row.name, company: "" };
  }
  const result = row.result ?? {};
  const name = text(result.name, 200) || row.name;
  const company = text(result.company, 200);
  if (result.verdict === "customer") return { kind: "customer", name, company };
  const verdict: ReviewVerdict = result.verdict === "not_customer" || result.verdict === "automated" ? result.verdict : "unsure";
  return { kind: "review", verdict, reason: text(result.reason, 300), name, company };
}

async function takeIn(store: TriageStore, dir: Directory, row: TriageRow, verdict: { name: string; company: string }, paths: string[], file: FileRaw): Promise<void> {
  const incoming = row.direction === "in";
  const customerId = await store.intake({
    email: row.address, name: verdict.name, company: verdict.company,
    subject: incoming ? row.subject || "E-Mail-Anfrage" : null, message: incoming ? row.body_text.slice(0, 5000) : null,
  });
  dir.customers.set(row.address, customerId);
  for (const path of paths) await file(customerId, await store.readRaw(path), path === row.raw_path ? row.folder : null);
}

async function applyRow(store: TriageStore, dir: Directory, report: Report, row: TriageRow, file: FileRaw): Promise<void> {
  const verdict = verdictOf(row);
  const paths = await store.rawFiles(row);
  if (verdict.kind === "customer") {
    await takeIn(store, dir, row, verdict, paths, file);
    report.created++;
  } else {
    const id = await store.addReview({ address: row.address, name: verdict.name, company: verdict.company, direction: row.direction, subject: row.subject.slice(0, 300),
      snippet: row.body_text.slice(0, 600), sent_at: row.created_at, mail_count: Math.max(paths.length, 1), verdict: verdict.verdict, reason: verdict.reason });
    if (id !== null) dir.reviews.set(row.address, { id, mail_count: Math.max(paths.length, 1), status: "open" });
  }
  await store.dropRaw(paths);
  await store.markApplied(row.id);
  dir.triage.delete(row.address);
}

export async function applyVerdicts(store: TriageStore, dir: Directory, report: Report, file: FileRaw): Promise<void> {
  for (const row of await store.verdicts()) {
    try {
      await applyRow(store, dir, report, row, file);
    } catch (error) {
      report.errors.push(`Einordnung ${row.address}: ${errorText(error)}`);
    }
  }
}
