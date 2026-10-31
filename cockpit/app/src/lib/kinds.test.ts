import { describe, expect, it } from "vitest";
import { kindLabel } from "./kinds";

describe("kindLabel", () => {
  it.each([
    ["mail-erstellt", "Mail erstellt"],
    ["mail-verschickt", "Mail verschickt"],
    ["auftrag", "Neuer Auftrag"],
    ["pruefung-faellig", "Monatsprüfung fällig"],
    ["pruefung-gestartet", "Prüfung gestartet"],
    ["pruefung-fertig", "Monatsprüfung fertig"],
    ["pruefung-fehlgeschlagen", "Monatsprüfung fehlgeschlagen"],
    ["mail-auswertung-fehler", "Mail nicht ausgewertet"],
    ["mail-auswertung-stau", "Mails werden nicht gelesen"],
    ["bewertungslink-fehlt", "Bewertungslink fehlt"],
    ["freigabe", "Freigabe nötig"],
    ["annahme", "Mögliche Annahme"],
    ["kundenmail", "Kundenmail"],
    ["rechnung-offen", "Rechnung offen"],
    ["tagesablauf", "Tagesablauf"],
    ["auftrag-fehler", "Auftrag nicht abgeschlossen"],
    ["anruf", "Anruf"],
    ["termin", "Termin"],
    ["assistent", "Assistent"],
    ["beleg", "Beleg"],
    ["audit-anfrage", "Audit-Anfrage"],
    ["audit-vorschlag", "Terminvorschlag"],
    ["audit-termin", "Audit-Termin"],
    ["monatsservice", "Monatsservice"],
  ])("names %s as %s", (kind, label) => {
    expect(kindLabel(kind)).toBe(label);
  });

  it("shows nothing for a kind it does not know", () => {
    expect(kindLabel("neu-und-unbekannt")).toBe("");
  });
});
