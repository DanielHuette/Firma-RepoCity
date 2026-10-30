// What the appointment page shows for the address it was opened with.
// Context: static page /termin/ of the CRM site; the links in a proposal mail and in a confirmation
// lead here through the Edge Function crm-termin, which adds the hour to show and whose button POST
// answers with a redirect back here. | Input: the query of the page address (?buchen=<token>&zeit=&art=,
// ?abgelaufen=<token>&zeit=&art=, ?anders=<token>&zeit= or ?ergebnis=<outcome>) and the address of the function. | Output: heading,
// text and, for a valid link, the form address, its field and the button label.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ZONE = "Europe/Berlin";
const DAY = new Intl.DateTimeFormat("de-DE", { timeZone: ZONE, weekday: "long", day: "numeric", month: "long", year: "numeric" });
const CLOCK = new Intl.DateTimeFormat("de-DE", { timeZone: ZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const KIND: Record<string, string> = { visit: "Gespräch vor Ort", call: "Telefonat", video: "Videogespräch" };
const CONFIRMATION = "Die Bestätigung mit Kalenderdatei kommt per E-Mail.";

export type ButtonField = "buchen" | "anders";
type LinkField = ButtonField | "abgelaufen";

export interface AppointmentView {
  heading: string;
  text: string;
  action: string | null;
  field: ButtonField | null;
  button: string | null;
}

const INVALID = {
  heading: "Link nicht gültig",
  text: "Dieser Link gilt nicht mehr, zum Beispiel weil der Termin vorbei ist oder neue Vorschläge ihn ersetzt haben. Antworten Sie gern einfach auf unsere E-Mail.",
};

function when(value: string | null): string | null {
  if (value === null || value === "") return null;
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) return null;
  return `${DAY.format(instant)}, ${CLOCK.format(instant)} Uhr`;
}

function message(heading: string, text: string): AppointmentView {
  return { heading, text, action: null, field: null, button: null };
}

function outcome(result: string, time: string | null): AppointmentView {
  switch (result) {
    case "gebucht": return message("Termin gebucht", `${time === null ? "Ihr Termin ist gebucht." : `Ihr Termin am ${time} ist gebucht.`} ${CONFIRMATION}`);
    case "abgelaufen": return message("Neue Vorschläge folgen", "Wir schicken Ihnen neue Terminvorschläge per E-Mail.");
    case "belegt": return message("Zeit schon vergeben", "Diese Zeit ist leider inzwischen vergeben. Wir melden uns mit neuen Vorschlägen bei Ihnen.");
    case "gewuenscht":
      return message("Wunsch angekommen", "Wir schicken Ihnen neue Terminvorschläge per E-Mail. Bis Sie einen davon gebucht haben, bleibt Ihr bisheriger Termin bestehen.");
    case "fehler": return message("Nicht geklappt", "Das hat gerade nicht geklappt. Bitte versuchen Sie es später noch einmal.");
    default: return message(INVALID.heading, INVALID.text);
  }
}

function token(query: URLSearchParams, field: LinkField): string | null {
  const value = query.get(field) ?? "";
  return UUID.test(value) ? value.toLowerCase() : null;
}

function withButton(heading: string, text: string, action: string, field: ButtonField, button: string): AppointmentView {
  return { heading, text, action, field, button };
}

// The views of a link with a checked token, the hour and, for proposals, the kind of meeting.
function linkView(query: URLSearchParams, functionUrl: string, time: string): AppointmentView | null {
  const kind = KIND[query.get("art") ?? ""];
  const offer = token(query, "buchen");
  if (offer !== null && kind !== undefined) {
    return withButton("Termin buchen",
      `${time}, ${kind}, eine Stunde. Mit dem Knopf ist der Termin für Sie gebucht; die Bestätigung mit Kalenderdatei kommt per E-Mail.`,
      `${functionUrl}?buchen=${offer}`, "buchen", "Diesen Termin buchen");
  }
  // The button of an expired proposal posts to the same link; the database then asks Daniel again.
  const expired = token(query, "abgelaufen");
  if (expired !== null && kind !== undefined) {
    return withButton("Reservierung abgelaufen",
      `Die Zeit am ${time} war 48 Stunden für Sie reserviert; diese Frist ist vorbei. Mit dem Knopf bitten Sie uns um neue Terminvorschläge.`,
      `${functionUrl}?buchen=${expired}`, "buchen", "Neue Vorschläge anfordern");
  }
  const current = token(query, "anders");
  if (current !== null) {
    return withButton("Anderen Termin wünschen",
      `Ihr Termin am ${time} bleibt bestehen, bis Sie einen neuen gebucht haben. Wir schicken Ihnen dafür neue Vorschläge per E-Mail.`,
      `${functionUrl}?anders=${current}`, "anders", "Anderen Termin wünschen");
  }
  return null;
}

export function appointmentView(search: string, functionUrl: string): AppointmentView {
  const query = new URLSearchParams(search);
  const time = when(query.get("zeit"));
  const link = time === null ? null : linkView(query, functionUrl, time);
  return link ?? outcome(query.get("ergebnis") ?? "", time);
}
