// Appointments of crm.appointments as calendar events: for Daniel's phone calendar feed (with
// customer and note) and for the confirmation the customer gets by mail (without Daniel's note).
// Context: shared by crm-calendar and crm-mail; the customer also gets a cancellation of an appointment
// replaced by another. | Input: rows of crm.calendar_events and
// crm.appointments. | Output: CalendarEvent values and the feed text.
import { buildCalendar, type CalendarEvent, type EventTime, type Organizer } from "./ical.ts";

export interface AppointmentRow {
  id: string;
  kind: string;
  title: string;
  starts_on: string;
  starts_at: string | null;
  ends_at: string | null;
  location: string;
  note: string;
  updated_at: string;
}

/** One row of crm.calendar_events. */
export interface FeedRow extends AppointmentRow {
  customer_name: string | null;
  status: string;
}

const UID_DOMAIN = "crm.speedofthespirit.dev";
const FEED_NAME = "CRM-Termine";

/** The same words as crm.appointment_kind_label. */
export function appointmentKindLabel(kind: string): string {
  switch (kind) {
    case "visit": return "Vor-Ort-Gespräch";
    case "callback": return "Rückruf";
    case "call": return "Telefonat";
    case "video": return "Videogespräch";
    default: return "Termin";
  }
}

export function appointmentUid(id: string): string {
  return `${id}@${UID_DOMAIN}`;
}

function appointmentTime(row: AppointmentRow): EventTime {
  return row.starts_at !== null && row.ends_at !== null
    ? { kind: "timed", start: new Date(row.starts_at), end: new Date(row.ends_at) }
    : { kind: "allDay", day: row.starts_on };
}

function baseEvent(row: AppointmentRow, stamp: Date): CalendarEvent {
  return { uid: appointmentUid(row.id), stamp, time: appointmentTime(row), summary: row.title, location: row.location };
}

/** A feed is no scheduling message, so its DTSTAMP is the last change (RFC 5545, section 3.8.7.2). */
export function feedEvent(row: FeedRow): CalendarEvent {
  const changed = new Date(row.updated_at);
  const description = [appointmentKindLabel(row.kind), row.customer_name ?? "", row.note].filter((part) => part.trim() !== "").join("\n");
  return { ...baseEvent(row, changed), description, lastModified: changed };
}

export function confirmationEvent(row: AppointmentRow, organizer: Organizer, now: Date): CalendarEvent {
  return { ...baseEvent(row, now), description: `${appointmentKindLabel(row.kind)} mit ${organizer.name}`, organizer };
}

// The organizer cancels a published event with CANCEL and the same UID (RFC 5546, section 3.2.1: "The
// Organizer may subsequently update (with another PUBLISH method), or cancel (with a CANCEL method) a
// previously published VEVENT calendar component"); the confirmation had sequence 0.
export function cancellationEvent(row: AppointmentRow, organizer: Organizer, now: Date): CalendarEvent {
  return {
    ...baseEvent(row, now), description: `Abgesagt: ${appointmentKindLabel(row.kind)} mit ${organizer.name}`, organizer,
    status: "CANCELLED", sequence: 1,
  };
}

export function feedCalendar(rows: FeedRow[]): string {
  return buildCalendar({ name: FEED_NAME, events: rows.map(feedEvent) });
}
