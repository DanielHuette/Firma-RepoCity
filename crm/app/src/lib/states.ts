// Plain-language states of mails, monthly audits and review requests, and what may be done next.
import type { AuditRunStatus, CrmDocument, OutboxMail, ReviewStatus } from "../api/types";
import { dateTime } from "./format";

export type StateTone = "gold" | "good" | "bad";

export interface MailStateView {
  label: string;
  tone: StateTone;
  detail: string;
}

export function mailState(mail: OutboxMail): MailStateView {
  const base = `${mail.subject} an ${mail.to_address}`;
  if (mail.status === "sent") return { label: "Verschickt", tone: "good", detail: mail.sent_at === null ? base : `${base} · ${dateTime(mail.sent_at)}` };
  if (mail.status === "failed") return { label: "Fehlgeschlagen", tone: "bad", detail: mail.error === "" ? base : `${base} · ${mail.error}` };
  return { label: "Wartet", tone: "gold", detail: base };
}

export function canStartAuditRun(status: AuditRunStatus): boolean {
  return status === "due" || status === "failed";
}

export function canMarkReviewDone(status: ReviewStatus): boolean {
  return status !== "done" && status !== "cancelled";
}

const SCORE = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 });

export function auditScore(before: number | null, after: number | null): string {
  if (after === null) return before === null ? "–" : SCORE.format(before);
  return before === null ? SCORE.format(after) : `${SCORE.format(before)} → ${SCORE.format(after)}`;
}

export interface DeliveredDocuments {
  /** The PDF that went out with the quote or invoice: the oldest generated one of that kind. */
  main: CrmDocument | undefined;
  /** Dunning letters of an invoice, oldest first; they carry the invoice id but kind "other". */
  dunning: CrmDocument[];
}

export function deliveredDocuments(documents: CrmDocument[], kind: "quote" | "invoice"): DeliveredDocuments {
  const oldestFirst = [...documents].sort((a, b) => a.created_at.localeCompare(b.created_at));
  return {
    main: oldestFirst.find((document) => document.kind === kind),
    dunning: kind === "invoice" ? oldestFirst.filter((document) => document.kind === "other") : [],
  };
}
