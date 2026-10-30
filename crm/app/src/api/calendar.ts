// Reads and writes of the calendar. Booking rules, texts of refusals and the confirmation mail live
// in the database (migration 009_kalender.sql); this module only calls them.
import type { AppointmentArgs } from "../lib/calendar";
import { check, unwrap } from "./result";
import { supabase } from "./supabase";
import type { Appointment } from "./types";

const WITH_CUSTOMER = "*, customer:customers(id, name, email)";
const UPCOMING_LIMIT = 30;

/** Every appointment from one Berlin day to another, cancelled ones included. */
export async function listAppointments(from: string, to: string): Promise<Appointment[]> {
  return unwrap("Termine laden", await supabase.from("appointments").select(WITH_CUSTOMER).gte("starts_on", from).lte("starts_on", to)
    .order("starts_on").order("starts_at", { ascending: true, nullsFirst: true }).overrideTypes<Appointment[], { merge: false }>());
}

/** The planned appointments from the given day on, the nearest first. */
export async function listUpcoming(from: string): Promise<Appointment[]> {
  return unwrap("Termine laden", await supabase.from("appointments").select(WITH_CUSTOMER).eq("status", "planned").gte("starts_on", from)
    .order("starts_on").order("starts_at", { ascending: true, nullsFirst: true }).limit(UPCOMING_LIMIT).overrideTypes<Appointment[], { merge: false }>());
}

export async function createAppointment(args: AppointmentArgs, confirm: boolean): Promise<Appointment> {
  return unwrap("Termin eintragen", await supabase.rpc("create_appointment", {
    p_kind: args.kind, p_title: args.title, p_starts_at: args.startsAt, p_duration: args.duration, p_customer: args.customerId,
    p_location: args.location, p_note: args.note, p_confirm: confirm, p_starts_on: args.startsOn,
  }).single<Appointment>());
}

export async function updateAppointment(id: string, args: AppointmentArgs): Promise<Appointment> {
  return unwrap("Termin speichern", await supabase.rpc("update_appointment", {
    p_appointment: id, p_kind: args.kind, p_title: args.title, p_starts_at: args.startsAt, p_duration: args.duration,
    p_customer: args.customerId, p_location: args.location, p_note: args.note, p_starts_on: args.startsOn,
  }).single<Appointment>());
}

/** Queues the confirmation with the calendar file for the customer of a saved appointment. */
export async function confirmAppointment(id: string): Promise<void> {
  check("Bestätigung schicken", await supabase.rpc("confirm_appointment", { p_appointment: id }));
}

export async function setAppointmentStatus(id: string, status: "done" | "cancelled"): Promise<void> {
  check("Termin ändern", await supabase.rpc("set_appointment_status", { p_appointment: id, p_status: status }));
}
