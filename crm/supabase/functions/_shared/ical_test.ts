import ICAL from "npm:ical.js@2.2.1";
import { assert, assertEquals, assertStringIncludes, assertThrows } from "jsr:@std/assert@1";
import { buildCalendar, type CalendarEvent, CalendarError, escapeText, foldLine } from "./ical.ts";

const encoder = new TextEncoder();
const octets = (line: string) => encoder.encode(line).length;
const unfold = (text: string) => text.replace(/\r\n[ \t]/g, "");

const timed = (overrides: Partial<CalendarEvent> = {}): CalendarEvent => ({
  uid: "a1@crm.beispiel.test",
  stamp: new Date("2026-10-30T07:15:00Z"),
  time: { kind: "timed", start: new Date("2026-10-31T09:00:00Z"), end: new Date("2026-10-31T10:30:00Z") },
  summary: "Vor-Ort-Gespräch Bäckerei Größe GmbH",
  location: "Hauptstraße 5, 48143 Münster",
  description: "Vor-Ort-Gespräch\nBitte Zugang zum Server mitbringen",
  ...overrides,
});

Deno.test("text values escape backslash, semicolon, comma and every kind of line break", () => {
  assertEquals(escapeText("a\\b;c,d\r\ne\nf\rg"), "a\\\\b\\;c\\,d\\ne\\nf\\ng");
  assertEquals(escapeText("Uhrzeit: 10:00"), "Uhrzeit: 10:00");
});

Deno.test("long lines are folded at 75 octets without splitting a multi-byte character", () => {
  const line = `DESCRIPTION:${"Größe äöü ".repeat(20)}`;
  const folded = foldLine(line);
  const parts = folded.split("\r\n");
  assert(parts.length > 1);
  for (const part of parts) assert(octets(part) <= 75, `${String(octets(part))} octets: ${part}`);
  for (const part of parts.slice(1)) assert(part.startsWith(" "));
  assertEquals(unfold(folded), line);
  assertEquals(foldLine("SUMMARY:kurz"), "SUMMARY:kurz");
});

Deno.test("every line ends with CRLF and none is longer than 75 octets", () => {
  const text = buildCalendar({ events: [timed({ description: "x".repeat(400) })] });
  assert(text.endsWith("\r\n"));
  assertEquals(text.replace(/\r\n/g, "").includes("\n"), false);
  assertEquals(text.replace(/\r\n/g, "").includes("\r"), false);
  for (const line of text.split("\r\n")) assert(octets(line) <= 75);
});

Deno.test("a timed event carries UID, DTSTAMP, start and end in UTC, summary, place and description", () => {
  const lines = unfold(buildCalendar({ events: [timed()] })).split("\r\n");
  for (const expected of [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//RepoCity//CRM//DE", "CALSCALE:GREGORIAN", "BEGIN:VEVENT",
    "UID:a1@crm.beispiel.test", "DTSTAMP:20261030T071500Z", "DTSTART:20261031T090000Z", "DTEND:20261031T103000Z",
    "SUMMARY:Vor-Ort-Gespräch Bäckerei Größe GmbH", "LOCATION:Hauptstraße 5\\, 48143 Münster",
    "DESCRIPTION:Vor-Ort-Gespräch\\nBitte Zugang zum Server mitbringen", "END:VEVENT", "END:VCALENDAR",
  ]) assert(lines.includes(expected), expected);
  assertEquals(lines.some((line) => line.startsWith("METHOD:")), false);
});

Deno.test("an event without time is an all-day event whose end is the next day", () => {
  const text = unfold(buildCalendar({ events: [timed({ time: { kind: "allDay", day: "2026-12-31" } })] }));
  assertStringIncludes(text, "\r\nDTSTART;VALUE=DATE:20261231\r\n");
  assertStringIncludes(text, "\r\nDTEND;VALUE=DATE:20270101\r\n");
});

Deno.test("empty place and description are left out, the last change is given when known", () => {
  const text = buildCalendar({ events: [timed({ location: "", description: " ", lastModified: new Date("2026-10-29T12:00:00Z") })] });
  assertEquals(/^(LOCATION|DESCRIPTION)/m.test(text), false);
  assertStringIncludes(text, "\r\nLAST-MODIFIED:20261029T120000Z\r\n");
});

Deno.test("a published calendar names its method and the organizer with a quoted name", () => {
  const organizer = { name: 'Erika "E." Beispiel | Beispielfirma; Münster', address: "post@beispiel.test" };
  const text = unfold(buildCalendar({ method: "PUBLISH", events: [timed({ organizer })] }));
  assertStringIncludes(text, "\r\nMETHOD:PUBLISH\r\n");
  assertStringIncludes(text, '\r\nORGANIZER;CN="Erika E. Beispiel | Beispielfirma; Münster":mailto:post@beispiel.test\r\n');
  assertEquals(text.includes("ATTENDEE"), false);
});

Deno.test("the calendar name is set for calendar apps when given", () => {
  assertStringIncludes(buildCalendar({ name: "Termine, RepoCity", events: [] }), "\r\nX-WR-CALNAME:Termine\\, RepoCity\r\n");
});

Deno.test("what no calendar may hold is refused", () => {
  assertThrows(() => buildCalendar({ method: "PUBLISH", events: [timed()] }), CalendarError, "Organisator");
  const backwards = { kind: "timed" as const, start: new Date("2026-10-31T10:00:00Z"), end: new Date("2026-10-31T10:00:00Z") };
  assertThrows(() => buildCalendar({ events: [timed({ time: backwards })] }), CalendarError, "Ende");
  assertThrows(() => buildCalendar({ events: [timed({ time: { kind: "allDay", day: "31.10.2026" } })] }), CalendarError, "Tag");
  assertThrows(() => buildCalendar({ events: [timed({ stamp: new Date("x") })] }), CalendarError, "Zeit");
  assertThrows(() => buildCalendar({ events: [timed({ uid: "a\r\nb" })] }), CalendarError, "UID");
  const mailto = { name: "Erika", address: "post@beispiel.test\r\nX: y" };
  assertThrows(() => buildCalendar({ method: "PUBLISH", events: [timed({ organizer: mailto })] }), CalendarError, "Adresse");
});

Deno.test("an independent iCalendar parser reads back every value unchanged", () => {
  const organizer = { name: "Erika Beispiel", address: "post@beispiel.test" };
  const description = "Zeile 1; mit Komma, Backslash \\ und Umlaut ä\nZeile 2 ".repeat(5).trim();
  const text = buildCalendar({ method: "PUBLISH", events: [timed({ organizer, description }), timed({ uid: "a2", organizer, time: { kind: "allDay", day: "2026-11-02" } })] });
  const calendar = new ICAL.Component(ICAL.parse(text));
  const [first, second] = calendar.getAllSubcomponents("vevent").map((component) => new ICAL.Event(component));
  assertEquals(first.uid, "a1@crm.beispiel.test");
  assertEquals(first.summary, "Vor-Ort-Gespräch Bäckerei Größe GmbH");
  assertEquals(first.location, "Hauptstraße 5, 48143 Münster");
  assertEquals(first.description, description);
  assertEquals(first.startDate.toJSDate().toISOString(), "2026-10-31T09:00:00.000Z");
  assertEquals(first.endDate.toJSDate().toISOString(), "2026-10-31T10:30:00.000Z");
  assertEquals(first.organizer, "mailto:post@beispiel.test");
  assertEquals([second.startDate.isDate, second.startDate.toString(), second.endDate.toString()], [true, "2026-11-02", "2026-11-03"]);
});

Deno.test("a cancellation names its method, the cancelled status and a sequence above the confirmation's", () => {
  const organizer = { name: "Erika Beispiel", address: "post@beispiel.test" };
  const text = unfold(buildCalendar({ method: "CANCEL", events: [timed({ organizer, status: "CANCELLED", sequence: 1 })] }));
  assertStringIncludes(text, "\r\nMETHOD:CANCEL\r\n");
  assertStringIncludes(text, "\r\nUID:a1@crm.beispiel.test\r\n");
  assertStringIncludes(text, "\r\nSTATUS:CANCELLED\r\n");
  assertStringIncludes(text, "\r\nSEQUENCE:1\r\n");
  assertStringIncludes(text, "\r\nORGANIZER;CN=\"Erika Beispiel\":mailto:post@beispiel.test\r\n");
  const [event] = new ICAL.Component(ICAL.parse(text)).getAllSubcomponents("vevent").map((component) => new ICAL.Event(component));
  assertEquals([event?.uid, event?.sequence], ["a1@crm.beispiel.test", 1]);
});

Deno.test("a cancellation without organizer or sequence is refused (RFC 5546, section 3.2.5)", () => {
  const organizer = { name: "Erika", address: "post@beispiel.test" };
  assertThrows(() => buildCalendar({ method: "CANCEL", events: [timed({ status: "CANCELLED", sequence: 1 })] }), CalendarError, "Organisator");
  assertThrows(() => buildCalendar({ method: "CANCEL", events: [timed({ organizer, status: "CANCELLED" })] }), CalendarError, "Absage");
});
