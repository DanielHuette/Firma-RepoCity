// The calendar: one week from Monday to Sunday in Berlin time and the coming appointments, each with
// the buttons to change it, tick it off or cancel it. Reminders and the phone feed run in the database.
import { useState } from "preact/hooks";
import { listAppointments, listUpcoming, setAppointmentStatus } from "../api/calendar";
import type { Appointment } from "../api/types";
import { AppointmentForm } from "../components/AppointmentForm";
import { Badge, Empty, ErrorNote, Loading, PageHead } from "../components/ui";
import { useAction, useAsync } from "../hooks/useAsync";
import {
  EMPTY_APPOINTMENT, addDays, appointmentWhen, berlinClock, berlinDay, draftFrom, groupByDay, meetingLink, weekDays, weekStart, weekTitle, weekdayName,
  type AppointmentDraft,
} from "../lib/calendar";
import { APPOINTMENT_KIND, APPOINTMENT_STATUS } from "../lib/format";

interface Editing { existing: Appointment | null; initial: AppointmentDraft }

export function Kalender() {
  const today = berlinDay(new Date());
  const [monday, setMonday] = useState(() => weekStart(today));
  const [editing, setEditing] = useState<Editing | null>(null);
  const week = useAsync(() => listAppointments(monday, addDays(monday, 6)), [monday]);
  const upcoming = useAsync(() => listUpcoming(today), [today]);
  const reload = () => { week.reload(); upcoming.reload(); };
  const open = (next: Editing) => { setEditing(next); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const edit = (appointment: Appointment) => { open({ existing: appointment, initial: draftFrom(appointment) }); };
  return (
    <div class="stack stack--loose">
      <PageHead kicker="Kalender" title="Termine">
        <button class="button button--gold" type="button" onClick={() => { open({ existing: null, initial: { ...EMPTY_APPOINTMENT, day: today } }); }}>+ Neuer Termin</button>
      </PageHead>
      {editing !== null && (
        <AppointmentForm key={editing.existing?.id ?? "neu"} existing={editing.existing} initial={editing.initial}
          onDone={() => { setEditing(null); reload(); }} onCancel={() => { setEditing(null); }} />
      )}
      <WeekNav monday={monday} today={today} onChange={setMonday} />
      <ErrorNote message={week.error} />
      {week.data === undefined ? <Loading /> : <Week monday={monday} today={today} appointments={week.data} onEdit={edit}
        onNew={(day) => { open({ existing: null, initial: { ...EMPTY_APPOINTMENT, day } }); }} />}
      <Upcoming appointments={upcoming.data} error={upcoming.error} onEdit={edit} onChange={reload} />
    </div>
  );
}

function WeekNav({ monday, today, onChange }: { monday: string; today: string; onChange: (monday: string) => void }) {
  const current = weekStart(today);
  return (
    <div class="spread week-nav">
      <h2 class="week-nav__title">{weekTitle(monday)}</h2>
      <div class="cluster">
        <button class="button" type="button" onClick={() => { onChange(addDays(monday, -7)); }}>Vorige Woche</button>
        <button class="button" type="button" disabled={monday === current} onClick={() => { onChange(current); }}>Heute</button>
        <button class="button" type="button" onClick={() => { onChange(addDays(monday, 7)); }}>Nächste Woche</button>
      </div>
    </div>
  );
}

function Week({ monday, today, appointments, onEdit, onNew }: {
  monday: string; today: string; appointments: Appointment[]; onEdit: (appointment: Appointment) => void; onNew: (day: string) => void;
}) {
  const days = weekDays(monday);
  const grouped = groupByDay(appointments, days);
  return (
    <ol class="week" aria-label={`Woche ${weekTitle(monday)}`}>
      {days.map((day) => (
        <li key={day} class={day === today ? "week__day week__day--today" : "week__day"}>
          <button class="week__head" type="button" onClick={() => { onNew(day); }} aria-label={`Neuer Termin am ${weekdayName(day)}, ${day.slice(8)}.${day.slice(5, 7)}.`}>
            <span class="week__name">{weekdayName(day).slice(0, 2)}</span>
            <span class="week__date num">{day.slice(8)}.{day.slice(5, 7)}.</span>
            <span class="week__add" aria-hidden="true">+</span>
          </button>
          <ul class="week__list">
            {(grouped.get(day) ?? []).map((appointment) => <WeekEntry key={appointment.id} appointment={appointment} onEdit={onEdit} />)}
          </ul>
        </li>
      ))}
    </ol>
  );
}

function WeekEntry({ appointment, onEdit }: { appointment: Appointment; onEdit: (appointment: Appointment) => void }) {
  return (
    <li>
      <button class={`slot slot--${appointment.kind} slot--${appointment.status}`} type="button" onClick={() => { onEdit(appointment); }}>
        <span class="slot__time num">{appointment.starts_at === null ? "ohne Uhrzeit" : berlinClock(appointment.starts_at)}</span>
        <span class="slot__title">{appointment.title}</span>
        <span class="slot__meta">
          {APPOINTMENT_KIND[appointment.kind]}
          {appointment.customer !== null && appointment.customer !== undefined && ` · ${appointment.customer.name}`}
          {appointment.status !== "planned" && ` · ${APPOINTMENT_STATUS[appointment.status]}`}
        </span>
      </button>
    </li>
  );
}

function Upcoming({ appointments, error, onEdit, onChange }: {
  appointments: Appointment[] | undefined; error: string | null; onEdit: (appointment: Appointment) => void; onChange: () => void;
}) {
  return (
    <section class="panel stack" aria-labelledby="upcoming-head">
      <h2 id="upcoming-head">Nächste Termine</h2>
      <ErrorNote message={error} />
      {appointments === undefined ? <Loading /> : appointments.length === 0 ? <Empty>Keine geplanten Termine.</Empty> : (
        <ul class="cards">{appointments.map((appointment) => <UpcomingRow key={appointment.id} appointment={appointment} onEdit={onEdit} onChange={onChange} />)}</ul>
      )}
    </section>
  );
}

// A video call links its Jitsi room; any other place is plain text.
function Place({ appointment }: { appointment: Appointment }) {
  const link = meetingLink(appointment);
  if (link !== null) return <a href={link} target="_blank" rel="noopener noreferrer">Videogespräch öffnen</a>;
  return appointment.location === "" ? null : <span class="muted">{appointment.location}</span>;
}

function UpcomingRow({ appointment, onEdit, onChange }: { appointment: Appointment; onEdit: (appointment: Appointment) => void; onChange: () => void }) {
  const action = useAction();
  const setStatus = (status: "done" | "cancelled") => { void action.run(async () => { await setAppointmentStatus(appointment.id, status); onChange(); }); };
  return (
    <li class="appointment">
      <div class="appointment__main">
        <span class="small muted num">{appointmentWhen(appointment)}</span>
        <strong class="appointment__title">{appointment.title}</strong>
        <span class="cluster small">
          <Badge tone="gold">{APPOINTMENT_KIND[appointment.kind]}</Badge>
          {appointment.customer !== null && appointment.customer !== undefined && <a href={`/kunde/${appointment.customer.id}`}>{appointment.customer.name}</a>}
          <Place appointment={appointment} />
        </span>
        {appointment.note !== "" && <p class="small muted appointment__note">{appointment.note}</p>}
      </div>
      <div class="cluster appointment__actions">
        <button class="button" type="button" disabled={action.busy} onClick={() => { onEdit(appointment); }}>Ändern</button>
        <button class="button" type="button" disabled={action.busy} onClick={() => { setStatus("done"); }}>Erledigt</button>
        <button class="button button--quiet" type="button" disabled={action.busy} onClick={() => { setStatus("cancelled"); }}>Absagen</button>
      </div>
      <ErrorNote message={action.error} />
    </li>
  );
}
