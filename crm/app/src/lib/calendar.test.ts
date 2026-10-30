import { describe, expect, it } from "vitest";
import type { Appointment } from "../api/types";
import {
  EMPTY_APPOINTMENT, addDays, appointmentArgs, appointmentWhen, berlinClock, berlinDay, berlinInstant, calendarSettingsProblem, canConfirm,
  confirmHint, draftFrom, draftProblem, meetingLink, durationMinutes, feedLink, groupByDay, shortClock, weekDays, weekStart, weekTitle,
} from "./calendar";

const APPOINTMENT: Appointment = {
  id: "a-1", kind: "visit", title: "Erstgespräch", starts_on: "2026-10-30", starts_at: "2026-10-30T09:00:00+00:00", ends_at: "2026-10-30T10:30:00+00:00",
  customer_id: "c-1", location: "Münster", note: "", origin: "person", status: "planned", reminded_at: null, created_at: "2026-10-01T08:00:00Z",
  updated_at: "2026-10-01T08:00:00Z", customer: { id: "c-1", name: "Muster GmbH", email: "info@muster.de" },
};

describe("Berlin days and clocks", () => {
  it("names the Berlin day of an instant, also around midnight", () => {
    expect(berlinDay(new Date("2026-10-30T22:30:00Z"))).toBe("2026-10-30");
    expect(berlinDay(new Date("2026-10-30T23:30:00Z"))).toBe("2026-10-31");
    expect(berlinDay(new Date("2026-07-15T22:30:00Z"))).toBe("2026-07-16");
  });

  it("reads the Berlin clock of a stored instant in summer and winter time", () => {
    expect(berlinClock("2026-07-15T08:00:00+00:00")).toBe("10:00");
    expect(berlinClock("2026-12-01T08:00:00+00:00")).toBe("09:00");
  });

  it("turns a Berlin day and clock into an instant with the right offset", () => {
    expect(berlinInstant("2026-10-24", "10:00")).toBe("2026-10-24T10:00:00+02:00");
    expect(berlinInstant("2026-10-25", "10:00")).toBe("2026-10-25T10:00:00+01:00");
    expect(berlinInstant("2026-03-29", "01:30")).toBe("2026-03-29T01:30:00+01:00");
    expect(berlinInstant("2026-03-29", "10:00")).toBe("2026-03-29T10:00:00+02:00");
  });

  it("goes round from clock to instant and back across both switches", () => {
    for (const day of ["2026-03-28", "2026-03-29", "2026-03-30", "2026-10-24", "2026-10-25", "2026-10-26"]) {
      const instant = berlinInstant(day, "08:15");
      expect(berlinDay(new Date(instant))).toBe(day);
      expect(berlinClock(instant)).toBe("08:15");
    }
  });

  it("cuts the seconds off a time of the database", () => {
    expect(shortClock("08:00:00")).toBe("08:00");
    expect(shortClock("18:30")).toBe("18:30");
  });
});

describe("weeks", () => {
  it("starts every week on Monday", () => {
    expect(weekStart("2026-10-30")).toBe("2026-10-26");
    expect(weekStart("2026-10-26")).toBe("2026-10-26");
    expect(weekStart("2026-11-01")).toBe("2026-10-26");
  });

  it("lists seven days through the end of summer time", () => {
    expect(weekDays("2026-10-19")).toEqual(["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25"]);
    expect(weekDays(weekStart("2026-03-29"))).toEqual(["2026-03-23", "2026-03-24", "2026-03-25", "2026-03-26", "2026-03-27", "2026-03-28", "2026-03-29"]);
  });

  it("moves by days over month and year ends", () => {
    expect(addDays("2026-12-28", 7)).toBe("2027-01-04");
    expect(addDays("2026-03-02", -7)).toBe("2026-02-23");
  });

  it("names the week from Monday to Sunday", () => {
    expect(weekTitle("2026-10-26")).toBe("26. Oktober – 1. November 2026");
    expect(weekTitle("2026-12-28")).toBe("28. Dezember 2026 – 3. Januar 2027");
  });

  it("sorts appointments into their days, those without time first", () => {
    const later = { ...APPOINTMENT, id: "a-2", starts_at: "2026-10-30T13:00:00+00:00", ends_at: "2026-10-30T13:15:00+00:00" };
    const untimed = { ...APPOINTMENT, id: "a-3", starts_at: null, ends_at: null };
    const other = { ...APPOINTMENT, id: "a-4", starts_on: "2026-10-27", starts_at: null, ends_at: null };
    const days = groupByDay([later, APPOINTMENT, untimed, other], weekDays("2026-10-26"));
    expect(days.get("2026-10-30")?.map((item) => item.id)).toEqual(["a-3", "a-1", "a-2"]);
    expect(days.get("2026-10-27")?.map((item) => item.id)).toEqual(["a-4"]);
    expect(days.get("2026-10-26")).toEqual([]);
  });
});

describe("appointment words", () => {
  it("says when an appointment is, with or without a time", () => {
    expect(appointmentWhen(APPOINTMENT)).toBe("Freitag, 30.10.2026, 10:00 bis 11:30 Uhr");
    expect(appointmentWhen({ ...APPOINTMENT, starts_at: null, ends_at: null })).toBe("Freitag, 30.10.2026, ohne Uhrzeit");
  });

  it("measures the duration in minutes", () => {
    expect(durationMinutes(APPOINTMENT)).toBe(90);
    expect(durationMinutes({ ...APPOINTMENT, starts_at: null, ends_at: null })).toBeNull();
  });
});

describe("appointment form", () => {
  const draft = { ...EMPTY_APPOINTMENT, day: "2026-10-30", time: "10:00", customerId: "c-1" };

  it("needs a day and, with a time, a duration from 5 minutes to 12 hours", () => {
    expect(draftProblem({ ...draft, day: "" })).toBe("Bitte einen Tag angeben.");
    expect(draftProblem({ ...draft, duration: "4" })).toBe("Die Dauer muss zwischen 5 Minuten und 12 Stunden liegen.");
    expect(draftProblem({ ...draft, duration: "721" })).toBe("Die Dauer muss zwischen 5 Minuten und 12 Stunden liegen.");
    expect(draftProblem({ ...draft, duration: "abc" })).toBe("Die Dauer muss zwischen 5 Minuten und 12 Stunden liegen.");
    expect(draftProblem({ ...draft, time: "", duration: "" })).toBeNull();
    expect(draftProblem(draft)).toBeNull();
  });

  it("refuses a malformed time", () => {
    expect(draftProblem({ ...draft, time: "25:00" })).toBe("Bitte eine Uhrzeit wie 09:30 angeben.");
  });

  it("allows a confirmation only with a customer that has an e-mail and with a time", () => {
    expect(canConfirm(draft, "info@muster.de")).toBe(true);
    expect(canConfirm(draft, "")).toBe(false);
    expect(canConfirm(draft, null)).toBe(false);
    expect(canConfirm({ ...draft, time: "" }, "info@muster.de")).toBe(false);
    expect(canConfirm({ ...draft, customerId: "" }, "info@muster.de")).toBe(false);
  });

  it("explains why the confirmation cannot be ticked", () => {
    expect(confirmHint(draft, "info@muster.de")).toBeNull();
    expect(confirmHint({ ...draft, customerId: "" }, null)).toBe("Geht nur mit einem Kunden.");
    expect(confirmHint(draft, "")).toBe("Beim Kunden fehlt die E-Mail-Adresse.");
    expect(confirmHint({ ...draft, time: "" }, "info@muster.de")).toBe("Geht nur mit einer Uhrzeit.");
  });

  it("builds the arguments of the database with the Berlin offset", () => {
    expect(appointmentArgs({ ...draft, title: "  Erstgespräch ", location: "Münster", duration: "45" })).toEqual({
      kind: "visit", title: "Erstgespräch", startsAt: "2026-10-30T10:00:00+01:00", startsOn: "2026-10-30", duration: 45,
      customerId: "c-1", location: "Münster", note: "",
    });
  });

  it("sends a day without time and no customer as such", () => {
    const args = appointmentArgs({ ...draft, kind: "callback", time: "", duration: "", customerId: "" });
    expect(args.startsAt).toBeNull();
    expect(args.startsOn).toBe("2026-10-30");
    expect(args.duration).toBeNull();
    expect(args.customerId).toBeNull();
  });

  it("fills the form from a stored appointment", () => {
    expect(draftFrom(APPOINTMENT)).toEqual({
      kind: "visit", title: "Erstgespräch", day: "2026-10-30", time: "10:00", duration: "90", customerId: "c-1", location: "Münster", note: "",
      confirm: false,
    });
    expect(draftFrom({ ...APPOINTMENT, starts_at: null, ends_at: null, customer_id: null }).time).toBe("");
  });
});

describe("calendar settings", () => {
  const good = { start: "08:00", end: "18:00", days: [1, 2, 3, 4, 5], reminder: 60 };

  it("accepts the business hours of the database defaults", () => {
    expect(calendarSettingsProblem(good)).toBeNull();
  });

  it("refuses what the database refuses", () => {
    expect(calendarSettingsProblem({ ...good, end: "08:00" })).toBe("Das Ende der Geschäftszeit muss nach dem Beginn liegen.");
    expect(calendarSettingsProblem({ ...good, start: "" })).toBe("Bitte Beginn und Ende der Geschäftszeit angeben.");
    expect(calendarSettingsProblem({ ...good, days: [] })).toBe("Bitte mindestens einen Geschäftstag wählen.");
    expect(calendarSettingsProblem({ ...good, reminder: 4 })).toBe("Die Erinnerung muss zwischen 5 und 1440 Minuten vorher liegen.");
    expect(calendarSettingsProblem({ ...good, reminder: 1441 })).toBe("Die Erinnerung muss zwischen 5 und 1440 Minuten vorher liegen.");
    expect(calendarSettingsProblem({ ...good, reminder: 7.5 })).toBe("Die Erinnerung muss zwischen 5 und 1440 Minuten vorher liegen.");
  });

  it("builds the feed link from the token", () => {
    expect(feedLink("https://yizvntdwdajlgcbjcves.supabase.co/", "0f8c6a1e-1111-4222-8333-944455556666"))
      .toBe("https://yizvntdwdajlgcbjcves.supabase.co/functions/v1/crm-calendar?t=0f8c6a1e-1111-4222-8333-944455556666");
  });
});

describe("meetingLink", () => {
  it("finds the Jitsi link of a video call in its place", () => {
    const link = "https://meet.jit.si/RepoCity-0123456789abcdef0123456789abcdef";
    expect(meetingLink({ kind: "video", location: link })).toBe(link);
  });

  it("finds nothing in an address, a number or another site", () => {
    expect(meetingLink({ kind: "visit", location: "Ludgeristraße 1, 48143 Münster" })).toBeNull();
    expect(meetingLink({ kind: "call", location: "0251 123456" })).toBeNull();
    expect(meetingLink({ kind: "video", location: "https://meet.jit.si.example.com/x" })).toBeNull();
    expect(meetingLink({ kind: "video", location: "javascript:alert(1)" })).toBeNull();
  });
});
