import { describe, expect, it } from "vitest";
import type { CrmDocument, OutboxMail } from "../api/types";
import { auditScore, canMarkReviewDone, canStartAuditRun, deliveredDocuments, mailState } from "./states";

const MAIL: OutboxMail = {
  id: "m-1", kind: "invoice", status: "queued", to_address: "a@b.de", subject: "Rechnung", error: "", attempts: 0,
  created_at: "2026-10-24T08:00:00Z", sent_at: null,
};

describe("mailState", () => {
  it("names waiting, sent and failed mails", () => {
    expect(mailState(MAIL)).toEqual({ label: "Wartet", tone: "gold", detail: "Rechnung an a@b.de" });
    expect(mailState({ ...MAIL, status: "sent", sent_at: "2026-10-24T08:05:00Z" }).label).toBe("Verschickt");
    expect(mailState({ ...MAIL, status: "sent", sent_at: "2026-10-24T08:05:00Z" }).detail).toMatch(/^Rechnung an a@b\.de · 24\.10\.2026/);
    expect(mailState({ ...MAIL, status: "failed", error: "Postfach voll" })).toEqual({ label: "Fehlgeschlagen", tone: "bad", detail: "Rechnung an a@b.de · Postfach voll" });
  });
});

describe("audit runs and review requests", () => {
  it("allows starting only due or failed runs", () => {
    expect(canStartAuditRun("due")).toBe(true);
    expect(canStartAuditRun("failed")).toBe(true);
    expect(canStartAuditRun("started")).toBe(false);
    expect(canStartAuditRun("reported")).toBe(false);
  });

  it("allows ticking off a review only while it is open", () => {
    expect(canMarkReviewDone("sent")).toBe(true);
    expect(canMarkReviewDone("waiting_link")).toBe(true);
    expect(canMarkReviewDone("done")).toBe(false);
    expect(canMarkReviewDone("cancelled")).toBe(false);
  });

  it("shows the score before and after a monthly audit", () => {
    expect(auditScore(null, null)).toBe("–");
    expect(auditScore(null, 71.5)).toBe("71,5");
    expect(auditScore(64, 71.5)).toBe("64 → 71,5");
  });
});

describe("deliveredDocuments", () => {
  const doc = (id: string, kind: CrmDocument["kind"], created: string): CrmDocument => ({
    id, customer_id: "c-1", kind, title: id, file_path: `${id}.pdf`, mime_type: "application/pdf", size_bytes: 1, source: "generated",
    email_id: null, contract_id: null, quote_id: null, invoice_id: "inv-1", created_at: created,
  });

  it("takes the oldest invoice PDF and never a dunning letter for it", () => {
    const result = deliveredDocuments([doc("mahnung", "other", "2026-10-01"), doc("neu", "invoice", "2026-10-03"), doc("alt", "invoice", "2026-09-01")], "invoice");
    expect(result.main?.id).toBe("alt");
    expect(result.dunning.map((item) => item.id)).toEqual(["mahnung"]);
  });

  it("finds no invoice PDF when only dunning letters exist", () => {
    expect(deliveredDocuments([doc("mahnung", "other", "2026-10-01")], "invoice").main).toBeUndefined();
  });

  it("takes the oldest quote PDF", () => {
    expect(deliveredDocuments([doc("b", "quote", "2026-10-02"), doc("a", "quote", "2026-10-01")], "quote").main?.id).toBe("a");
  });
});
