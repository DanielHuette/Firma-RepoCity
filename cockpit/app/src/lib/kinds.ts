// German names of the message kinds the database writes into cockpit.messages.kind.
const KIND_LABEL: Record<string, string> = {
  kunde: "Neuer Kunde",
  freigabe: "Freigabe nötig",
  zahlung: "Zahlung eingegangen",
  absender: "Möglicher Kunde",
  "mail-fehler": "Mail nicht verschickt",
  "mail-erstellt": "Mail erstellt",
  "mail-verschickt": "Mail verschickt",
  auftrag: "Neuer Auftrag",
  "auftrag-fehler": "Auftrag nicht abgeschlossen",
  annahme: "Mögliche Annahme",
  kundenmail: "Kundenmail",
  anruf: "Anruf",
  termin: "Termin",
  assistent: "Assistent",
  beleg: "Beleg",
  "audit-anfrage": "Audit-Anfrage",
  "audit-vorschlag": "Terminvorschlag",
  "audit-termin": "Audit-Termin",
  monatsservice: "Monatsservice",
  "rechnung-offen": "Rechnung offen",
  tagesablauf: "Tagesablauf",
  "pruefung-faellig": "Monatsprüfung fällig",
  "pruefung-gestartet": "Prüfung gestartet",
  "pruefung-fertig": "Monatsprüfung fertig",
  "pruefung-fehlgeschlagen": "Monatsprüfung fehlgeschlagen",
  "mail-auswertung-fehler": "Mail nicht ausgewertet",
  "mail-auswertung-stau": "Mails werden nicht gelesen",
  "bewertungslink-fehlt": "Bewertungslink fehlt",
  postfach: "Postfach",
  tagesueberblick: "Tagesüberblick",
  test: "Testnachricht",
};

/** Name of a message kind; empty for kinds this version of the app does not know yet. */
export function kindLabel(kind: string): string {
  return KIND_LABEL[kind] ?? "";
}
