// Days, weeks and clocks of the calendar in Berlin time, whatever time zone the device is set to,
// and the rules of the appointment form as the database checks them (migration 009_kalender.sql).
import type { Appointment, AppointmentKind } from "../api/types";
import { MONTHS } from "./format";

const ZONE = "Europe/Berlin";
const MINUTE_MS = 60_000;
const PARTS = new Intl.DateTimeFormat("en-GB", {
  timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});
const WEEKDAYS = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
export const MIN_DURATION = 5;
export const MAX_DURATION = 720;

interface WallClock { year: number; month: number; day: number; hour: number; minute: number }

function wallClock(instant: Date): WallClock {
  const parts = Object.fromEntries(PARTS.formatToParts(instant).map((part) => [part.type, part.value]));
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day), hour: Number(parts.hour), minute: Number(parts.minute) };
}

const two = (value: number) => String(value).padStart(2, "0");

/** The Berlin day of an instant as YYYY-MM-DD. */
export function berlinDay(instant: Date): string {
  const wall = wallClock(instant);
  return `${String(wall.year)}-${two(wall.month)}-${two(wall.day)}`;
}

/** The Berlin clock of a stored instant as HH:MM. */
export function berlinClock(iso: string): string {
  const wall = wallClock(new Date(iso));
  return `${two(wall.hour)}:${two(wall.minute)}`;
}

/** Minutes Berlin is ahead of UTC at an instant: 60 in winter, 120 in summer. */
function berlinOffset(utcMs: number): number {
  const wall = wallClock(new Date(utcMs));
  return Math.round((Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute) - utcMs) / MINUTE_MS);
}

/** A Berlin day and clock as an ISO instant with its offset, e.g. 2026-10-25T10:00:00+01:00. */
export function berlinInstant(day: string, clock: string): string {
  const [year = 0, month = 1, date = 1] = day.split("-").map(Number);
  const [hour = 0, minute = 0] = clock.split(":").map(Number);
  const wall = Date.UTC(year, month - 1, date, hour, minute);
  let offset = berlinOffset(wall);
  offset = berlinOffset(wall - offset * MINUTE_MS);
  return `${day}T${two(hour)}:${two(minute)}:00+${two(Math.floor(offset / 60))}:${two(offset % 60)}`;
}

/** "08:00:00" of the database as "08:00". */
export function shortClock(time: string): string {
  return time.slice(0, 5);
}

function dayDate(day: string): Date {
  return new Date(`${day}T00:00:00Z`);
}

export function addDays(day: string, days: number): string {
  const date = dayDate(day);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** The Monday of the week a day lies in. */
export function weekStart(day: string): string {
  return addDays(day, -((dayDate(day).getUTCDay() + 6) % 7));
}

export function weekDays(monday: string): string[] {
  return Array.from({ length: 7 }, (_, index) => addDays(monday, index));
}

export function weekdayName(day: string): string {
  return WEEKDAYS[dayDate(day).getUTCDay()] ?? "";
}

function longDate(day: string, withYear: boolean): string {
  const date = dayDate(day);
  const text = `${String(date.getUTCDate())}. ${MONTHS[date.getUTCMonth()] ?? ""}`;
  return withYear ? `${text} ${String(date.getUTCFullYear())}` : text;
}

/** "26. Oktober – 1. November 2026"; the year twice only when the week spans the new year. */
export function weekTitle(monday: string): string {
  const sunday = addDays(monday, 6);
  if (monday.slice(0, 4) !== sunday.slice(0, 4)) return `${longDate(monday, true)} – ${longDate(sunday, true)}`;
  if (monday.slice(0, 7) === sunday.slice(0, 7)) return `${String(dayDate(monday).getUTCDate())}. – ${longDate(sunday, true)}`;
  return `${longDate(monday, false)} – ${longDate(sunday, true)}`;
}

function byStart(a: Appointment, b: Appointment): number {
  if (a.starts_at === null || b.starts_at === null) return a.starts_at === null ? (b.starts_at === null ? 0 : -1) : 1;
  return Date.parse(a.starts_at) - Date.parse(b.starts_at);
}

/** The appointments of each day in order, those without a time first. */
export function groupByDay(appointments: Appointment[], days: string[]): Map<string, Appointment[]> {
  const grouped = new Map(days.map((day) => [day, [] as Appointment[]]));
  for (const appointment of appointments) grouped.get(appointment.starts_on)?.push(appointment);
  for (const list of grouped.values()) list.sort(byStart);
  return grouped;
}

export function durationMinutes(appointment: Appointment): number | null {
  if (appointment.starts_at === null || appointment.ends_at === null) return null;
  return Math.round((Date.parse(appointment.ends_at) - Date.parse(appointment.starts_at)) / MINUTE_MS);
}

/** The time of day of an appointment: "10:00 bis 11:30 Uhr" or "ohne Uhrzeit". */
export function appointmentClock(appointment: Appointment): string {
  if (appointment.starts_at === null || appointment.ends_at === null) return "ohne Uhrzeit";
  return `${berlinClock(appointment.starts_at)} bis ${berlinClock(appointment.ends_at)} Uhr`;
}

/** "Freitag, 30.10.2026, 10:00 bis 11:30 Uhr" or "Freitag, 30.10.2026, ohne Uhrzeit". */
export function appointmentWhen(appointment: Appointment): string {
  const [year, month, date] = appointment.starts_on.split("-");
  return `${weekdayName(appointment.starts_on)}, ${date ?? ""}.${month ?? ""}.${year ?? ""}, ${appointmentClock(appointment)}`;
}

const JITSI = /^https:\/\/meet\.jit\.si\/[\w-]+$/;

/** The Jitsi link of a video call, kept as its place; null for every other place. */
export function meetingLink(appointment: Pick<Appointment, "kind" | "location">): string | null {
  return appointment.kind === "video" && JITSI.test(appointment.location) ? appointment.location : null;
}

// The form

export interface AppointmentDraft {
  kind: AppointmentKind;
  title: string;
  day: string;
  /** HH:MM, or empty for an appointment without a time. */
  time: string;
  /** Minutes as typed. */
  duration: string;
  customerId: string;
  location: string;
  note: string;
  confirm: boolean;
}

export const EMPTY_APPOINTMENT: AppointmentDraft = {
  kind: "visit", title: "", day: "", time: "", duration: "60", customerId: "", location: "", note: "", confirm: false,
};

/** What the database would refuse, in its words; null when the draft can be saved. */
export function draftProblem(draft: AppointmentDraft): string | null {
  if (!DAY.test(draft.day)) return "Bitte einen Tag angeben.";
  if (draft.time === "") return null;
  if (!CLOCK.test(draft.time)) return "Bitte eine Uhrzeit wie 09:30 angeben.";
  const minutes = Number(draft.duration);
  if (draft.duration.trim() === "" || !Number.isInteger(minutes) || minutes < MIN_DURATION || minutes > MAX_DURATION) {
    return "Die Dauer muss zwischen 5 Minuten und 12 Stunden liegen.";
  }
  return null;
}

/** Why the confirmation cannot be ticked, or null when it can. */
export function confirmHint(draft: AppointmentDraft, customerEmail: string | null): string | null {
  if (draft.customerId === "") return "Geht nur mit einem Kunden.";
  if (customerEmail === null || customerEmail.trim() === "") return "Beim Kunden fehlt die E-Mail-Adresse.";
  if (draft.time === "") return "Geht nur mit einer Uhrzeit.";
  return null;
}

export function canConfirm(draft: AppointmentDraft, customerEmail: string | null): boolean {
  return confirmHint(draft, customerEmail) === null;
}

export interface AppointmentArgs {
  kind: AppointmentKind;
  title: string;
  startsAt: string | null;
  startsOn: string;
  duration: number | null;
  customerId: string | null;
  location: string;
  note: string;
}

export function appointmentArgs(draft: AppointmentDraft): AppointmentArgs {
  const timed = draft.time !== "";
  return {
    kind: draft.kind, title: draft.title.trim(), startsAt: timed ? berlinInstant(draft.day, draft.time) : null, startsOn: draft.day,
    duration: timed ? Number(draft.duration) : null, customerId: draft.customerId === "" ? null : draft.customerId,
    location: draft.location.trim(), note: draft.note.trim(),
  };
}

export function draftFrom(appointment: Appointment): AppointmentDraft {
  return {
    kind: appointment.kind, title: appointment.title, day: appointment.starts_on,
    time: appointment.starts_at === null ? "" : berlinClock(appointment.starts_at), duration: String(durationMinutes(appointment) ?? 60),
    customerId: appointment.customer_id ?? "", location: appointment.location, note: appointment.note, confirm: false,
  };
}

// Settings

export interface CalendarSettings {
  start: string;
  end: string;
  days: number[];
  reminder: number;
}

/** The checks of crm.settings for business hours, business days and the reminder. */
export function calendarSettingsProblem(settings: CalendarSettings): string | null {
  if (!CLOCK.test(settings.start) || !CLOCK.test(settings.end)) return "Bitte Beginn und Ende der Geschäftszeit angeben.";
  if (settings.end <= settings.start) return "Das Ende der Geschäftszeit muss nach dem Beginn liegen.";
  if (settings.days.length === 0) return "Bitte mindestens einen Geschäftstag wählen.";
  if (!Number.isInteger(settings.reminder) || settings.reminder < 5 || settings.reminder > 1440) {
    return "Die Erinnerung muss zwischen 5 und 1440 Minuten vorher liegen.";
  }
  return null;
}

/** The secret address of the calendar feed for the phone. */
export function feedLink(supabaseUrl: string, token: string): string {
  return `${supabaseUrl.replace(/\/+$/, "")}/functions/v1/crm-calendar?t=${encodeURIComponent(token)}`;
}
