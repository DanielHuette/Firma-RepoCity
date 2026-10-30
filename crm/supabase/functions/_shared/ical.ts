// iCalendar (RFC 5545) for the CRM's appointments: the phone calendar feed of crm-calendar and the
// confirmation and cancellation attachments of crm-mail. Shared code of several Edge Functions lives in this folder,
// whose leading underscore keeps it from being deployed as a function of its own; each function
// imports it by relative path and the Supabase CLI bundles it into every function that does.
// Context: pure text building, no input or output. | Input: events. | Output: the calendar text.

export class CalendarError extends Error {
  override name = "CalendarError";
}

export type EventTime =
  | { kind: "timed"; start: Date; end: Date }
  /** A day without time, as YYYY-MM-DD. */
  | { kind: "allDay"; day: string };

export interface Organizer { name: string; address: string }

export interface CalendarEvent {
  uid: string;
  /** DTSTAMP: with a method the moment the calendar is made, without one the last change. */
  stamp: Date;
  time: EventTime;
  summary: string;
  location?: string;
  description?: string;
  lastModified?: Date;
  organizer?: Organizer;
  /** CANCELLED in a cancellation, which takes back the whole event. */
  status?: "CANCELLED";
  /** Revision of the event; a cancellation needs one above that of the confirmation (0 when unset). */
  sequence?: number;
}

export interface Calendar {
  /** Set for a calendar sent as a scheduling message (RFC 5546), left out for a feed. */
  method?: "PUBLISH" | "CANCEL";
  /** Name calendar apps show for a subscribed feed. */
  name?: string;
  events: CalendarEvent[];
}

const PRODUCT = "-//RepoCity//CRM//DE";
const LINE_OCTETS = 75;
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const MAILBOX = /^[^\s<>()":;,\\]+@[^\s<>()":;,\\]+$/;
const encoder = new TextEncoder();

/** TEXT value escaping of RFC 5545 section 3.3.11. */
export function escapeText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r\n|\r|\n/g, "\\n");
}

/** Folds a content line into parts of at most 75 octets; continuation parts start with a space. */
export function foldLine(line: string): string {
  const parts: string[] = [];
  let part = "";
  let size = 0;
  for (const char of line) {
    const width = encoder.encode(char).length;
    if (size + width > LINE_OCTETS) {
      parts.push(part);
      part = " ";
      size = 1;
    }
    part += char;
    size += width;
  }
  parts.push(part);
  return parts.join("\r\n");
}

function utc(date: Date): string {
  if (Number.isNaN(date.getTime())) throw new CalendarError("Ungültige Zeit im Kalender.");
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function dayValue(day: string, offsetDays = 0): string {
  const match = DAY.exec(day);
  const date = match === null ? new Date(Number.NaN) : new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + offsetDays));
  if (match === null || Number.isNaN(date.getTime()) || (offsetDays === 0 && date.toISOString().slice(0, 10) !== day)) {
    throw new CalendarError(`Ungültiger Tag im Kalender: ${day}`);
  }
  return date.toISOString().slice(0, 10).replace(/-/g, "");
}

function timeLines(time: EventTime): string[] {
  if (time.kind === "allDay") return [`DTSTART;VALUE=DATE:${dayValue(time.day)}`, `DTEND;VALUE=DATE:${dayValue(time.day, 1)}`];
  const start = utc(time.start);
  const end = utc(time.end);
  if (time.end.getTime() <= time.start.getTime()) throw new CalendarError("Das Ende eines Termins muss nach seinem Beginn liegen.");
  return [`DTSTART:${start}`, `DTEND:${end}`];
}

function organizerLine(organizer: Organizer): string {
  if (!MAILBOX.test(organizer.address)) throw new CalendarError("Ungültige Adresse des Organisators.");
  // A quoted parameter value may hold ; : and , but no double quote and no control character.
  const name = organizer.name.replace(/["\p{Cc}]/gu, "").trim();
  return `ORGANIZER${name === "" ? "" : `;CN="${name}"`}:mailto:${organizer.address}`;
}

function textLine(name: string, value: string | undefined): string[] {
  return value === undefined || value.trim() === "" ? [] : [`${name}:${escapeText(value)}`];
}

function eventLines(event: CalendarEvent, method: Calendar["method"]): string[] {
  if (event.uid === "" || /[\p{Cc}]/u.test(event.uid)) throw new CalendarError("Ungültige UID im Kalender.");
  // PUBLISH requires an organizer and no attendees (RFC 5546, section 3.2.1); so does CANCEL, which
  // also requires the sequence (section 3.2.5). Neither carries attendees here: none were published.
  if (method !== undefined && event.organizer === undefined) throw new CalendarError("Ein veröffentlichter Termin braucht einen Organisator.");
  if (method === "CANCEL" && event.sequence === undefined) throw new CalendarError("Eine Absage braucht eine Folgenummer (SEQUENCE).");
  return [
    "BEGIN:VEVENT", `UID:${event.uid}`, `DTSTAMP:${utc(event.stamp)}`, ...timeLines(event.time),
    ...(event.sequence === undefined ? [] : [`SEQUENCE:${String(event.sequence)}`]),
    ...(event.status === undefined ? [] : [`STATUS:${event.status}`]),
    `SUMMARY:${escapeText(event.summary)}`, ...textLine("LOCATION", event.location), ...textLine("DESCRIPTION", event.description),
    ...(event.lastModified === undefined ? [] : [`LAST-MODIFIED:${utc(event.lastModified)}`]),
    ...(event.organizer === undefined ? [] : [organizerLine(event.organizer)]),
    "END:VEVENT",
  ];
}

/** The calendar as text with CRLF line ends and folded lines. */
export function buildCalendar(calendar: Calendar): string {
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", `PRODID:${PRODUCT}`, "CALSCALE:GREGORIAN",
    ...(calendar.method === undefined ? [] : [`METHOD:${calendar.method}`]),
    ...textLine("X-WR-CALNAME", calendar.name),
    ...calendar.events.flatMap((event) => eventLines(event, calendar.method)),
    "END:VCALENDAR",
  ];
  return lines.map(foldLine).join("\r\n") + "\r\n";
}
