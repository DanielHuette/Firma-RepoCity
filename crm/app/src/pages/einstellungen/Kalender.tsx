// Business hours and days for callbacks the phone assistant books, how long before an appointment the
// reminder comes, and the secret link that shows the appointments in the phone's calendar.
import { useEffect, useState } from "preact/hooks";
import { supabaseConfig } from "../../api/config";
import { saveSettings } from "../../api/crm";
import type { Settings } from "../../api/types";
import { ErrorNote, Field, Loading } from "../../components/ui";
import { useSettings } from "../../hooks/settings";
import { useAction } from "../../hooks/useAsync";
import { calendarSettingsProblem, feedLink, shortClock, type CalendarSettings } from "../../lib/calendar";

const DAYS: [number, string][] = [[1, "Montag"], [2, "Dienstag"], [3, "Mittwoch"], [4, "Donnerstag"], [5, "Freitag"], [6, "Samstag"], [7, "Sonntag"]];

interface CalendarForm { start: string; end: string; days: number[]; reminder: string }

function fromSettings(settings: Settings): CalendarForm {
  return {
    start: shortClock(settings.business_hours_start), end: shortClock(settings.business_hours_end),
    days: [...settings.business_days].sort((a, b) => a - b), reminder: String(settings.reminder_minutes),
  };
}

async function saveCalendar(form: CalendarForm): Promise<void> {
  const values: CalendarSettings = { start: form.start, end: form.end, days: form.days, reminder: Number(form.reminder) };
  const problem = calendarSettingsProblem(values);
  if (problem !== null) throw new Error(problem);
  await saveSettings({ business_hours_start: values.start, business_hours_end: values.end, business_days: values.days, reminder_minutes: values.reminder });
}

export function Kalender() {
  const { settings } = useSettings();
  if (settings === undefined) return <Loading />;
  return (
    <div class="stack">
      <HoursForm settings={settings} />
      <FeedLink token={settings.calendar_token} />
    </div>
  );
}

function HoursForm({ settings }: { settings: Settings }) {
  const { reload } = useSettings();
  const [form, setForm] = useState<CalendarForm>(() => fromSettings(settings));
  const [saved, setSaved] = useState(false);
  const action = useAction();
  useEffect(() => { setForm(fromSettings(settings)); }, [settings]);
  const change = (next: CalendarForm) => { setForm(next); setSaved(false); };
  const submit = (event: Event) => {
    event.preventDefault();
    void action.run(async () => { await saveCalendar(form); reload(); setSaved(true); });
  };
  return (
    <form class="panel stack" onSubmit={submit}>
      <h2>Geschäftszeiten und Erinnerung</h2>
      <p class="muted">In diesen Zeiten trägt der Telefonassistent einen Rückruf zur gewünschten Uhrzeit ein. Liegt der Wunsch außerhalb, steht der Rückruf heute ohne Uhrzeit im Kalender.</p>
      <HoursFields form={form} onChange={change} />
      <ErrorNote message={action.error} />
      <div class="cluster">
        <button class="button button--gold" type="submit" disabled={action.busy}>{action.busy ? "Speichert …" : "Speichern"}</button>
        {saved && <span class="small muted">Gespeichert.</span>}
      </div>
    </form>
  );
}

function HoursFields({ form, onChange }: { form: CalendarForm; onChange: (next: CalendarForm) => void }) {
  return (
    <>
      <div class="form-grid">
        <Field label="Beginn"><input type="time" value={form.start} onInput={(event) => { onChange({ ...form, start: event.currentTarget.value }); }} /></Field>
        <Field label="Ende"><input type="time" value={form.end} onInput={(event) => { onChange({ ...form, end: event.currentTarget.value }); }} /></Field>
        <Field label="Erinnerung, Minuten vor dem Termin">
          <input class="input--short num" type="number" min={5} max={1440} step={5} value={form.reminder} onInput={(event) => { onChange({ ...form, reminder: event.currentTarget.value }); }} />
        </Field>
      </div>
      <DaysField days={form.days} onChange={(days) => { onChange({ ...form, days }); }} />
    </>
  );
}

function DaysField({ days, onChange }: { days: number[]; onChange: (next: number[]) => void }) {
  const toggle = (day: number) => {
    onChange(days.includes(day) ? days.filter((entry) => entry !== day) : [...days, day].sort((a, b) => a - b));
  };
  return (
    <div class="field">
      <span id="business-days">Geschäftstage</span>
      <div class="segmented segmented--days" role="group" aria-labelledby="business-days">
        {DAYS.map(([day, label]) => (
          <button key={day} type="button" role="checkbox" aria-checked={days.includes(day)} onClick={() => { toggle(day); }}>{label}</button>
        ))}
      </div>
    </div>
  );
}

function FeedLink({ token }: { token: string }) {
  const link = feedLink(supabaseConfig()?.url ?? "", token);
  const [copied, setCopied] = useState(false);
  const action = useAction();
  const { reload } = useSettings();
  const copy = () => {
    void action.run(async () => {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    });
  };
  return (
    <section class="panel stack" aria-labelledby="feed-head">
      <h2 id="feed-head">Kalender-Link</h2>
      <div class="cluster">
        <input class="grow num" readOnly value={link} aria-labelledby="feed-head" onFocus={(event) => { event.currentTarget.select(); }} />
        <button class="button button--gold" type="button" onClick={copy}>{copied ? "Kopiert" : "Link kopieren"}</button>
      </div>
      <RenewLink onRenewed={() => { setCopied(false); reload(); }} />
      <ErrorNote message={action.error} />
    </section>
  );
}

// A new secret makes every copy of the old link useless, for example on a lost phone.
function RenewLink({ onRenewed }: { onRenewed: () => void }) {
  const [asking, setAsking] = useState(false);
  const action = useAction();
  const renew = () => {
    void action.run(async () => {
      await saveSettings({ calendar_token: crypto.randomUUID() });
      setAsking(false);
      onRenewed();
    });
  };
  if (!asking) return <div><button class="button" type="button" onClick={() => { setAsking(true); }}>Neuen Link erzeugen</button></div>;
  return (
    <div class="stack stack--tight">
      <p class="small muted">Der bisherige Link zeigt danach keine Termine mehr; im Kalender des Handys muss der neue Link eingetragen werden.</p>
      <div class="cluster">
        <button class="button button--gold" type="button" disabled={action.busy} onClick={renew}>{action.busy ? "Erzeugt …" : "Neuen Link jetzt erzeugen"}</button>
        <button class="button" type="button" onClick={() => { setAsking(false); }}>Abbrechen</button>
      </div>
      <ErrorNote message={action.error} />
    </div>
  );
}
