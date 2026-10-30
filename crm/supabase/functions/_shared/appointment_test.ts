import { assertEquals } from "jsr:@std/assert@1";
import { appointmentKindLabel, appointmentUid, cancellationEvent, confirmationEvent, feedCalendar, feedEvent, type FeedRow } from "./appointment.ts";

const row = (overrides: Partial<FeedRow> = {}): FeedRow => ({
  id: "7d5c1c1e-4f0a-4a51-9a52-3f1d2a7b9c10", kind: "visit", title: "Vor-Ort-Gespräch Bäckerei Größe GmbH", starts_on: "2026-10-31",
  starts_at: "2026-10-31T09:00:00+00:00", ends_at: "2026-10-31T10:00:00+00:00", location: "Hauptstraße 5", note: "Zugang zum Server klären",
  updated_at: "2026-10-29T12:00:00.123456+00:00", customer_name: "Bäckerei Größe GmbH", status: "planned", ...overrides,
});

Deno.test("the kind labels are the ones of crm.appointment_kind_label", async () => {
  // The latest definition of the function, migration 013 added video calls.
  const sql = await Deno.readTextFile(new URL("../../migrations/013_audit_anfragen.sql", import.meta.url));
  const body = /function crm\.appointment_kind_label[\s\S]*?\$\$([\s\S]*?)\$\$/.exec(sql)?.[1] ?? "";
  const labels = Object.fromEntries([...body.matchAll(/when '(\w+)' then '([^']+)'/g)].map((match) => [match[1], match[2]]));
  const fallback = /else '([^']+)'/.exec(body)?.[1];
  assertEquals(Object.keys(labels).length, 4);
  for (const [kind, label] of Object.entries(labels)) assertEquals(appointmentKindLabel(kind), label);
  assertEquals(appointmentKindLabel("other"), fallback);
});

Deno.test("a video call carries its Jitsi link as the place, in the feed and in the confirmation", () => {
  const link = "https://meet.jit.si/RepoCity-0123456789abcdef0123456789abcdef";
  const video = row({ kind: "video", location: link });
  assertEquals(feedEvent(video).location, link);
  assertEquals(feedEvent(video).description?.split("\n")[0], "Videogespräch");
  assertEquals(confirmationEvent(video, { name: "Daniel", address: "post@beispiel.test" }, new Date()).location, link);
});

Deno.test("an appointment keeps one UID wherever it appears", () => {
  assertEquals(appointmentUid(row().id), "7d5c1c1e-4f0a-4a51-9a52-3f1d2a7b9c10@crm.speedofthespirit.dev");
  assertEquals(feedEvent(row()).uid, confirmationEvent(row(), { name: "Erika Beispiel", address: "post@beispiel.test" }, new Date()).uid);
});

Deno.test("the feed shows kind, customer and note, and the last change as stamp", () => {
  const event = feedEvent(row());
  assertEquals(event.description, "Vor-Ort-Gespräch\nBäckerei Größe GmbH\nZugang zum Server klären");
  assertEquals(event.stamp.toISOString(), "2026-10-29T12:00:00.123Z");
  assertEquals(event.lastModified?.toISOString(), "2026-10-29T12:00:00.123Z");
  assertEquals(event.time, { kind: "timed", start: new Date("2026-10-31T09:00:00Z"), end: new Date("2026-10-31T10:00:00Z") });
  assertEquals(feedEvent(row({ customer_name: null, note: "" })).description, "Vor-Ort-Gespräch");
});

Deno.test("an appointment without time is an all-day event on its day", () => {
  assertEquals(feedEvent(row({ kind: "callback", starts_at: null, ends_at: null })).time, { kind: "allDay", day: "2026-10-31" });
});

Deno.test("the customer's confirmation names the organizer and leaves out Daniel's note", () => {
  const now = new Date("2026-10-30T07:00:00Z");
  const event = confirmationEvent(row(), { name: "Erika Beispiel | Beispielfirma", address: "post@beispiel.test" }, now);
  assertEquals(event.description, "Vor-Ort-Gespräch mit Erika Beispiel | Beispielfirma");
  assertEquals([event.stamp, event.summary, event.location], [now, "Vor-Ort-Gespräch Bäckerei Größe GmbH", "Hauptstraße 5"]);
  assertEquals(event.organizer, { name: "Erika Beispiel | Beispielfirma", address: "post@beispiel.test" });
});

Deno.test("the cancellation takes back the confirmed event: same UID, cancelled, next sequence", () => {
  const organizer = { name: "Erika Beispiel", address: "post@beispiel.test" };
  const now = new Date("2026-10-30T07:00:00Z");
  const confirmed = confirmationEvent(row(), organizer, now);
  const cancelled = cancellationEvent(row({ status: "cancelled" }), organizer, now);
  assertEquals(cancelled.uid, confirmed.uid);
  assertEquals([cancelled.status, cancelled.sequence, cancelled.time, cancelled.organizer], ["CANCELLED", 1, confirmed.time, organizer]);
  assertEquals(cancelled.description, "Abgesagt: Vor-Ort-Gespräch mit Erika Beispiel");
});

Deno.test("the feed is a calendar without method under the name the phone shows", () => {
  const text = feedCalendar([row(), row({ id: "b2", starts_at: null, ends_at: null })]);
  assertEquals(text.match(/BEGIN:VEVENT/g)?.length, 2);
  assertEquals(text.includes("METHOD:"), false);
  assertEquals(text.includes("\r\nX-WR-CALNAME:CRM-Termine\r\n"), true);
  assertEquals(feedCalendar([]).includes("BEGIN:VEVENT"), false);
});
