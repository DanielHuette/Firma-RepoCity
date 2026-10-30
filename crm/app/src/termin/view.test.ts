import { describe, expect, it } from "vitest";
import { appointmentView } from "./view";

const FUNCTION = "https://yizvntdwdajlgcbjcves.supabase.co/functions/v1/crm-termin";
const TOKEN = "3f8e2a10-6b7c-4d5e-8f90-a1b2c3d4e5f6";
// 10:00 in Berlin in winter.
const ZEIT = encodeURIComponent("2026-11-03T09:00:00+00:00");
const INVALID = {
  heading: "Link nicht gültig",
  text: "Dieser Link gilt nicht mehr, zum Beispiel weil der Termin vorbei ist oder neue Vorschläge ihn ersetzt haben. Antworten Sie gern einfach auf unsere E-Mail.",
  action: null,
  field: null,
  button: null,
};

describe("appointmentView", () => {
  it("shows a proposed hour with the button that books it by POST", () => {
    expect(appointmentView(`?buchen=${TOKEN.toUpperCase()}&zeit=${ZEIT}&art=video`, FUNCTION)).toEqual({
      heading: "Termin buchen",
      text: "Dienstag, 3. November 2026, 10:00 Uhr, Videogespräch, eine Stunde. Mit dem Knopf ist der Termin für Sie gebucht; die Bestätigung mit Kalenderdatei kommt per E-Mail.",
      action: `${FUNCTION}?buchen=${TOKEN}`,
      field: "buchen",
      button: "Diesen Termin buchen",
    });
  });

  it("names the kind of meeting in plain words", () => {
    expect(appointmentView(`?buchen=${TOKEN}&zeit=${ZEIT}&art=visit`, FUNCTION).text).toContain("Gespräch vor Ort");
    expect(appointmentView(`?buchen=${TOKEN}&zeit=${ZEIT}&art=call`, FUNCTION).text).toContain("Telefonat");
  });

  it("shows a proposal whose reservation ran out with the button for new proposals", () => {
    expect(appointmentView(`?abgelaufen=${TOKEN}&zeit=${ZEIT}&art=call`, FUNCTION)).toEqual({
      heading: "Reservierung abgelaufen",
      text: "Die Zeit am Dienstag, 3. November 2026, 10:00 Uhr war 48 Stunden für Sie reserviert; diese Frist ist vorbei. Mit dem Knopf bitten Sie uns um neue Terminvorschläge.",
      action: `${FUNCTION}?buchen=${TOKEN}`,
      field: "buchen",
      button: "Neue Vorschläge anfordern",
    });
  });

  it("shows the current appointment with the button for another time", () => {
    expect(appointmentView(`?anders=${TOKEN}&zeit=${ZEIT}`, FUNCTION)).toEqual({
      heading: "Anderen Termin wünschen",
      text: "Ihr Termin am Dienstag, 3. November 2026, 10:00 Uhr bleibt bestehen, bis Sie einen neuen gebucht haben. Wir schicken Ihnen dafür neue Vorschläge per E-Mail.",
      action: `${FUNCTION}?anders=${TOKEN}`,
      field: "anders",
      button: "Anderen Termin wünschen",
    });
  });

  it.each([
    [`?ergebnis=gebucht&zeit=${ZEIT}`, "Termin gebucht", "Ihr Termin am Dienstag, 3. November 2026, 10:00 Uhr ist gebucht. Die Bestätigung mit Kalenderdatei kommt per E-Mail."],
    ["?ergebnis=gebucht", "Termin gebucht", "Ihr Termin ist gebucht. Die Bestätigung mit Kalenderdatei kommt per E-Mail."],
    ["?ergebnis=abgelaufen", "Neue Vorschläge folgen", "Wir schicken Ihnen neue Terminvorschläge per E-Mail."],
    ["?ergebnis=belegt", "Zeit schon vergeben", "Diese Zeit ist leider inzwischen vergeben. Wir melden uns mit neuen Vorschlägen bei Ihnen."],
    ["?ergebnis=gewuenscht", "Wunsch angekommen", "Wir schicken Ihnen neue Terminvorschläge per E-Mail. Bis Sie einen davon gebucht haben, bleibt Ihr bisheriger Termin bestehen."],
    ["?ergebnis=fehler", "Nicht geklappt", "Das hat gerade nicht geklappt. Bitte versuchen Sie es später noch einmal."],
  ])("answers %s without a button", (search, heading, text) => {
    expect(appointmentView(search, FUNCTION)).toEqual({ heading, text, action: null, field: null, button: null });
  });

  it.each([
    [""],
    ["?ergebnis=ungueltig"],
    ["?ergebnis=irgendwas"],
    [`?buchen=${TOKEN}0&zeit=${ZEIT}&art=video`],
    [`?buchen=${TOKEN}&zeit=morgen&art=video`],
    [`?buchen=${TOKEN}&zeit=${ZEIT}&art=party`],
    [`?anders=${TOKEN}`],
  ])("answers %s as an invalid link", (search) => {
    expect(appointmentView(search, FUNCTION)).toEqual(INVALID);
  });

  it("never puts anything but a checked token into the address it posts to", () => {
    expect(appointmentView(`?buchen=%22%3E%3Cscript%3E&zeit=${ZEIT}&art=video`, FUNCTION).action).toBeNull();
  });
});
