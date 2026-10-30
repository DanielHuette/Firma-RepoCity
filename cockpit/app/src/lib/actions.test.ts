import { describe, expect, it } from "vitest";
import type { Message } from "../api/types";
import { actedSummary, messageActions, openActions, parseOutcome } from "./actions";

const MESSAGE: Message = {
  id: "m-1", app: "crm", kind: "freigabe", title: "Freigabe nötig: 1. Mahnung", body: "", link: "/", priority: "wichtig",
  created_at: "2026-10-24T08:00:00Z", read_at: null, pushed_at: null, push_error: "", tag: null,
  actions: [{ action: "approve", title: "Senden" }, { action: "reject", title: "Nicht senden" }],
  action_token: "t-1", acted_at: null, acted_action: null, action_result: "",
};

describe("messageActions", () => {
  it("keeps at most three well-formed buttons in their order", () => {
    const stored = [
      { action: "audit_confirm", title: "Bestätigen" }, { title: "ohne Aktion" }, { action: "audit_propose", title: "Anderen Termin vorschlagen" },
      { action: "audit_check", title: "Prüfen" }, { action: "x", title: "Vier" },
    ];
    expect(messageActions(stored)).toEqual([
      { action: "audit_confirm", title: "Bestätigen" }, { action: "audit_propose", title: "Anderen Termin vorschlagen" }, { action: "audit_check", title: "Prüfen" },
    ]);
  });

  it("reads anything that is not a list as no buttons", () => {
    expect(messageActions(null)).toEqual([]);
    expect(messageActions({ action: "approve", title: "Senden" })).toEqual([]);
  });
});

describe("openActions", () => {
  it("offers the buttons while nothing was done", () => {
    expect(openActions(MESSAGE)).toEqual(MESSAGE.actions);
  });

  it("offers nothing once an action was taken", () => {
    expect(openActions({ ...MESSAGE, acted_at: "2026-10-24T09:00:00Z", acted_action: "approve" })).toEqual([]);
  });
});

describe("actedSummary", () => {
  it("is empty while nothing was done", () => {
    expect(actedSummary(MESSAGE)).toBeNull();
  });

  it("names the button that was used and the outcome", () => {
    const summary = actedSummary({ ...MESSAGE, acted_at: "2026-10-24T09:05:00Z", acted_action: "reject", action_result: "Mahnung wird nicht gesendet." });
    expect(summary?.label).toMatch(/^„Nicht senden“ am 24\.10\.2026, \d{2}:05$/);
    expect(summary?.result).toBe("Mahnung wird nicht gesendet.");
  });

  it("names an action that is no longer offered by its key", () => {
    expect(actedSummary({ ...MESSAGE, acted_at: "2026-10-24T09:05:00Z", acted_action: "start_audit" })?.label).toMatch(/^„start_audit“/);
  });
});

describe("parseOutcome", () => {
  it("reads the answer of cockpit.run_action", () => {
    expect(parseOutcome({ ok: true, text: "Prüfung gestartet." })).toEqual({ ok: true, text: "Prüfung gestartet." });
    expect(parseOutcome({ ok: false, text: "Schon erledigt." })).toEqual({ ok: false, text: "Schon erledigt." });
  });

  it("turns a malformed answer into a failure Daniel can act on", () => {
    expect(parseOutcome("ok")).toEqual({ ok: false, text: "Die Antwort des Servers war unvollständig. Lade die Seite neu und schau nach, ob es geklappt hat." });
    expect(parseOutcome({ ok: true })).toEqual({ ok: false, text: "Die Antwort des Servers war unvollständig. Lade die Seite neu und schau nach, ob es geklappt hat." });
  });
});
