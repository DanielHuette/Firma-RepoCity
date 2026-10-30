// Entering and changing an appointment. The database checks everything again and answers in German;
// its answer is shown as it comes.
import { useState } from "preact/hooks";
import { confirmAppointment, createAppointment, setAppointmentStatus, updateAppointment } from "../api/calendar";
import { loadCustomer } from "../api/crm";
import type { Appointment, AppointmentKind } from "../api/types";
import { useAction, useAsync } from "../hooks/useAsync";
import { MAX_DURATION, MIN_DURATION, appointmentArgs, canConfirm, confirmHint, draftProblem, type AppointmentDraft } from "../lib/calendar";
import { APPOINTMENT_KIND } from "../lib/format";
import { CustomerPicker } from "./CustomerPicker";
import { ErrorNote, Field } from "./ui";

type Setter = <K extends keyof AppointmentDraft>(key: K, value: AppointmentDraft[K]) => void;

async function save(existing: Appointment | null, draft: AppointmentDraft, confirm: boolean): Promise<void> {
  const problem = draftProblem(draft);
  if (problem !== null) throw new Error(problem);
  const args = appointmentArgs(draft);
  if (existing === null) {
    await createAppointment(args, confirm);
    return;
  }
  await updateAppointment(existing.id, args);
  if (confirm) await confirmAppointment(existing.id);
}

function useCustomerEmail(customerId: string): string | null {
  const customer = useAsync(() => (customerId === "" ? Promise.resolve(null) : loadCustomer(customerId)), [customerId]);
  return customer.data?.email ?? null;
}

export function AppointmentForm({ existing, initial, onDone, onCancel }: {
  existing: Appointment | null; initial: AppointmentDraft; onDone: () => void; onCancel: () => void;
}) {
  const [draft, setDraft] = useState<AppointmentDraft>(initial);
  const email = useCustomerEmail(draft.customerId);
  const action = useAction();
  const set: Setter = (key, value) => { setDraft({ ...draft, [key]: value }); };
  const confirm = draft.confirm && canConfirm(draft, email);
  const submit = (event: Event) => {
    event.preventDefault();
    void action.run(async () => { await save(existing, draft, confirm); onDone(); });
  };
  return (
    <form class="panel stack" onSubmit={submit} aria-labelledby="appointment-head">
      <h2 id="appointment-head">{existing === null ? "Neuer Termin" : "Termin ändern"}</h2>
      <KindSwitch kind={draft.kind} onChange={(kind) => { set("kind", kind); }} />
      <WhenFields draft={draft} set={set} />
      <CustomerField draft={draft} set={set} />
      <PlaceFields draft={draft} set={set} />
      <ConfirmField draft={draft} email={email} checked={confirm} set={set} />
      <ErrorNote message={action.error} />
      <div class="cluster">
        <button class="button button--gold" type="submit" disabled={action.busy}>{action.busy ? "Speichert …" : existing === null ? "Termin eintragen" : "Speichern"}</button>
        <button class="button" type="button" onClick={onCancel}>Abbrechen</button>
        {existing?.status === "planned" && <StatusButtons id={existing.id} onDone={onDone} />}
      </div>
    </form>
  );
}

function StatusButtons({ id, onDone }: { id: string; onDone: () => void }) {
  const action = useAction();
  const setStatus = (status: "done" | "cancelled") => { void action.run(async () => { await setAppointmentStatus(id, status); onDone(); }); };
  return (
    <>
      <button class="button" type="button" disabled={action.busy} onClick={() => { setStatus("done"); }}>Erledigt</button>
      <button class="button button--quiet" type="button" disabled={action.busy} onClick={() => { setStatus("cancelled"); }}>Termin absagen</button>
      <ErrorNote message={action.error} />
    </>
  );
}

function KindSwitch({ kind, onChange }: { kind: AppointmentKind; onChange: (kind: AppointmentKind) => void }) {
  return (
    <div class="segmented" role="radiogroup" aria-label="Art des Termins">
      {(Object.keys(APPOINTMENT_KIND) as AppointmentKind[]).map((option) => (
        <button key={option} type="button" role="radio" aria-checked={kind === option} onClick={() => { onChange(option); }}>{APPOINTMENT_KIND[option]}</button>
      ))}
    </div>
  );
}

function WhenFields({ draft, set }: { draft: AppointmentDraft; set: Setter }) {
  return (
    <div class="form-grid">
      <Field label="Titel" wide>
        <input value={draft.title} maxLength={200} placeholder="Leer lassen: Art und Kunde werden der Titel" onInput={(event) => { set("title", event.currentTarget.value); }} />
      </Field>
      <Field label="Tag"><input type="date" required value={draft.day} onInput={(event) => { set("day", event.currentTarget.value); }} /></Field>
      <Field label="Uhrzeit (leer: ohne Uhrzeit)"><input type="time" value={draft.time} onInput={(event) => { set("time", event.currentTarget.value); }} /></Field>
      <Field label="Dauer in Minuten">
        <input class="input--short num" type="number" min={MIN_DURATION} max={MAX_DURATION} step={5} disabled={draft.time === ""} value={draft.duration}
          onInput={(event) => { set("duration", event.currentTarget.value); }} />
      </Field>
    </div>
  );
}

function CustomerField({ draft, set }: { draft: AppointmentDraft; set: Setter }) {
  const [choosing, setChoosing] = useState(draft.customerId !== "");
  const toggle = () => { if (choosing) set("customerId", ""); setChoosing(!choosing); };
  return (
    <div class="stack stack--tight">
      <div><button class="button button--quiet" type="button" onClick={toggle}>{choosing ? "Ohne Kunde" : "Kunde zuordnen"}</button></div>
      {choosing && <CustomerPicker value={draft.customerId} onChange={(id) => { set("customerId", id); }} label="Kunde" />}
    </div>
  );
}

function PlaceFields({ draft, set }: { draft: AppointmentDraft; set: Setter }) {
  return (
    <div class="form-grid">
      <Field label="Ort" wide><input value={draft.location} maxLength={300} onInput={(event) => { set("location", event.currentTarget.value); }} /></Field>
      <Field label="Notiz" wide>
        <textarea class="textarea--short" value={draft.note} maxLength={2000} onInput={(event) => { set("note", event.currentTarget.value); }} />
      </Field>
    </div>
  );
}

function ConfirmField({ draft, email, checked, set }: { draft: AppointmentDraft; email: string | null; checked: boolean; set: Setter }) {
  const hint = confirmHint(draft, email);
  return (
    <div class="stack stack--tight">
      <label class="check">
        <input type="checkbox" checked={checked} disabled={hint !== null} onChange={(event) => { set("confirm", event.currentTarget.checked); }} />
        <span>Bestätigung mit Kalenderdatei an den Kunden schicken</span>
      </label>
      {hint !== null && <p class="small muted">{hint}</p>}
    </div>
  );
}
