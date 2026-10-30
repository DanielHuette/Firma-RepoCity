import { describe, expect, it } from "vitest";
import {
  APPOINTMENT_KIND, APPOINTMENT_STATUS, APPROVAL_KIND, AUDIT_REQUEST_STATUS, CHANNEL, MAIL_TEXT_KEY, OUTBOX_KIND, SOURCE, channelLabel, monthName,
} from "./format";

describe("labels", () => {
  it("names the month of a monthly audit", () => {
    expect(monthName("2026-10-01")).toBe("Oktober 2026");
    expect(monthName("2027-01-01")).toBe("Januar 2027");
  });

  it("names customers that came from the RadarAuditor", () => {
    expect(SOURCE.radarauditor).toBe("RadarAuditor");
  });

  it("names the kinds of appointments as the database does", () => {
    expect(APPOINTMENT_KIND).toEqual({ visit: "Vor-Ort-Gespräch", callback: "Rückruf", call: "Telefonat", video: "Videogespräch", other: "Termin" });
    expect(APPOINTMENT_STATUS).toEqual({ planned: "Geplant", done: "Erledigt", cancelled: "Abgesagt" });
  });

  it("names the approvals of follow-ups and of the assistant", () => {
    expect(APPROVAL_KIND.follow_up).toBe("Nachfass-Mail");
    expect(APPROVAL_KIND.assistant_mail).toBe("Mail vom Assistenten");
  });

  it("names the new mail texts and mails", () => {
    expect(MAIL_TEXT_KEY.appointment).toBe("Terminbestätigung");
    expect(MAIL_TEXT_KEY.follow_up_1).toBe("1. Nachfass-Mail (nach 5 Tagen)");
    expect(MAIL_TEXT_KEY.follow_up_2).toBe("2. Nachfass-Mail (nach 12 Tagen)");
    expect(OUTBOX_KIND.appointment).toBe("Terminbestätigung");
    expect(OUTBOX_KIND.follow_up).toBe("Nachfass-Mail");
    expect(OUTBOX_KIND.assistant).toBe("Mail vom Assistenten");
  });

  it("names the mails and states of audit requests", () => {
    expect(MAIL_TEXT_KEY.audit_confirmation).toBe("Bestätigung einer Audit-Anfrage");
    expect(MAIL_TEXT_KEY.audit_proposal).toBe("Terminvorschläge zu einer Audit-Anfrage");
    expect(MAIL_TEXT_KEY.appointment_reminder).toBe("Erinnerung am Tag vor dem Termin");
    expect(MAIL_TEXT_KEY.audit_rebooking).toBe("Bestätigung eines geänderten Termins");
    expect(MAIL_TEXT_KEY.audit_cancellation).toBe("Absage des bisherigen Termins");
    expect(OUTBOX_KIND.appointment_cancel).toBe("Terminabsage");
    expect(OUTBOX_KIND.audit_proposal).toBe("Terminvorschläge");
    expect(OUTBOX_KIND.appointment_reminder).toBe("Terminerinnerung");
    expect(AUDIT_REQUEST_STATUS).toEqual({ open: "Wartet auf dich", proposed: "Vorschläge verschickt", booked: "Termin gebucht" });
  });
});

describe("channels", () => {
  it("uses the labels of crm.source_channel_label in its order", () => {
    expect(Object.entries(CHANNEL)).toEqual([
      ["google_search", "Google-Suche"], ["google_maps", "Google Maps"], ["linkedin", "LinkedIn"], ["instagram", "Instagram"],
      ["facebook", "Facebook"], ["xing", "Xing"], ["youtube", "YouTube"], ["tiktok", "TikTok"], ["x", "X"], ["threads", "Threads"],
      ["reddit", "Reddit"], ["forum", "Forum"], ["newsletter", "Newsletter"], ["referral", "Empfehlung"], ["other", "Sonstiges"],
    ]);
  });

  it("calls a missing channel Unbekannt", () => {
    expect(channelLabel(null)).toBe("Unbekannt");
    expect(channelLabel("unknown")).toBe("Unbekannt");
    expect(channelLabel("linkedin")).toBe("LinkedIn");
  });
});
