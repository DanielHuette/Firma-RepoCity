// Start page: only what needs Daniel today, each with the one button that leads there. Dunning,
// subscription billing, due audits and review requests run in the daily routine of the database.
import { useState } from "preact/hooks";
import { createTask, listCallsSince, listTasks, loadOverview, setTaskDone } from "../api/crm";
import { listOpenAuditRuns, startAuditRun } from "../api/flow";
import type { AuditRun, Overview, Task } from "../api/types";
import { CallList } from "../components/Anrufe";
import { CustomerPicker } from "../components/CustomerPicker";
import { Badge, Empty, ErrorNote, Kpi, Loading, PageHead } from "../components/ui";
import { useAction, useAsync, type AsyncState } from "../hooks/useAsync";
import { meetingLink } from "../lib/calendar";
import { APPOINTMENT_KIND, AUDIT_RUN_STATUS, date, euro, monthName, today } from "../lib/format";

interface Todo {
  count: number;
  text: (count: number) => string;
  href: string;
  button: string;
  urgent?: boolean;
}

const plural = (n: number, one: string, many: string) => `${String(n)} ${n === 1 ? one : many}`;
const SETTINGS_MAIL = "/einstellungen?bereich=anbindungen";

function urgentTodos(overview: Overview): Todo[] {
  const list: Todo[] = [
    { count: overview.pending_approvals, text: (n) => `${plural(n, "Freigabe wartet", "Freigaben warten")} auf dich`, href: "/freigaben", button: "Freigeben" },
    { count: overview.due_audits, text: (n) => `${plural(n, "Monatsprüfung ist", "Monatsprüfungen sind")} fällig`, href: "#monatspruefungen", button: "Ansehen" },
    { count: overview.mailbox_stale ? 1 : 0, text: () => "Das Postfach wird gerade nicht abgerufen", href: SETTINGS_MAIL, button: "Ansehen" },
    { count: overview.failed_mails, text: (n) => `${plural(n, "E-Mail konnte", "E-Mails konnten")} nicht versendet werden`, href: SETTINGS_MAIL, button: "Ansehen" },
    { count: overview.mail_triage_failed, text: (n) => `${plural(n, "eingegangene E-Mail konnte", "eingegangene E-Mails konnten")} nicht gelesen werden`, href: SETTINGS_MAIL, button: "Ansehen" },
    { count: overview.unknown_senders, text: (n) => `${plural(n, "unbekannter Absender wartet", "unbekannte Absender warten")} auf deine Entscheidung`, href: "/freigaben?ansicht=absender", button: "Entscheiden" },
    { count: overview.new_inquiries, text: (n) => `${String(n)} neue ${n === 1 ? "Anfrage" : "Anfragen"}`, href: "/verkauf?tab=anfragen", button: "Beantworten" },
    { count: overview.overdue_invoices, text: (n) => `${plural(n, "Rechnung ist", "Rechnungen sind")} überfällig`, href: "/rechnungen?filter=ueberfaellig", button: "Ansehen" },
  ];
  return list.map((todo) => ({ ...todo, urgent: true }));
}

function todos(overview: Overview): Todo[] {
  const list: Todo[] = [
    ...urgentTodos(overview),
    { count: overview.mail_triage_waiting, text: (n) => plural(n, "Mail, die der Server noch nicht gelesen hat", "Mails, die der Server noch nicht gelesen hat"), href: SETTINGS_MAIL, button: "Ansehen" },
    { count: overview.due_deals, text: (n) => `Bei ${plural(n, "Verkaufschance", "Verkaufschancen")} ist der nächste Schritt fällig`, href: "/verkauf?tab=chancen", button: "Weitermachen" },
    { count: overview.expiring_quotes, text: (n) => `${plural(n, "Angebot läuft", "Angebote laufen")} in den nächsten 7 Tagen ab`, href: "/verkauf?tab=angebote", button: "Nachfassen" },
    { count: overview.draft_invoices, text: (n) => `${plural(n, "Rechnungsentwurf", "Rechnungsentwürfe")} noch nicht festgeschrieben`, href: "/rechnungen?filter=entwurf", button: "Prüfen" },
    { count: overview.open_orders, text: (n) => `${plural(n, "Auftrag", "Aufträge")} in Arbeit`, href: "/verkauf?tab=auftraege", button: "Öffnen" },
    { count: overview.open_tickets, text: (n) => `${String(n)} offene ${n === 1 ? "Kundenanfrage" : "Kundenanfragen"} im Service`, href: "/service", button: "Bearbeiten" },
  ];
  return list.filter((todo) => todo.count > 0);
}

export function Heute() {
  const overview = useAsync(() => loadOverview(), []);
  const runs = useAsync(() => listOpenAuditRuns(), []);
  const hour = new Date().getHours();
  const greeting = hour < 11 ? "Guten Morgen" : hour < 18 ? "Guten Tag" : "Guten Abend";
  return (
    <div class="stack stack--loose">
      <PageHead kicker={date(today())} title={`${greeting}, Daniel`} />
      <ErrorNote message={overview.error} />
      {overview.data === undefined ? <Loading /> : <TodoList overview={overview.data} />}
      {overview.data !== undefined && <TodayAppointments overview={overview.data} />}
      <AuditRuns runs={runs} onChange={overview.reload} />
      <RecentCalls />
      {overview.data !== undefined && <Figures overview={overview.data} />}
      <Tasks onChange={overview.reload} />
    </div>
  );
}

function TodoList({ overview }: { overview: Overview }) {
  const list = todos(overview);
  return (
    <section class="stack" aria-labelledby="todo-head">
      <h2 id="todo-head">Jetzt zu tun</h2>
      {list.length === 0 ? <div class="panel panel--flat"><p>Alles erledigt. Nichts wartet auf dich.</p></div> : (
        <ul class="todo-list">
          {list.map((todo) => (
            <li key={todo.href + todo.text(todo.count)} class={todo.urgent === true ? "todo todo--urgent" : "todo"}>
              <span class="todo__count num">{todo.count}</span>
              <span class="todo__text">{todo.text(todo.count)}</span>
              <a class="button button--gold" href={todo.href}>{todo.button}</a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// Planned appointments of the Berlin day as the database lists them, untimed first; a video call shows its Jitsi link.
function TodayAppointments({ overview }: { overview: Overview }) {
  const entries = overview.appointments_today_items;
  return (
    <section class="panel stack" aria-labelledby="appointments-head">
      <div class="spread">
        <h2 id="appointments-head">{overview.appointments_today === 0 ? "Termine heute" : plural(overview.appointments_today, "Termin heute", "Termine heute")}</h2>
        <a class="button" href="/kalender">Zum Kalender</a>
      </div>
      {entries.length === 0 ? <Empty>Heute stehen keine Termine an.</Empty> : (
        <ul class="today-appointments">
          {entries.map((entry, index) => {
            const link = meetingLink(entry);
            return (
              <li key={`${String(index)}-${entry.title}`}>
                <a href="/kalender"><span class="num today-appointments__time">{entry.clock ?? "ohne Uhrzeit"}</span><span>{entry.title} · {APPOINTMENT_KIND[entry.kind]}</span></a>
                {link !== null && <a class="small" href={link} target="_blank" rel="noopener noreferrer">Videogespräch öffnen</a>}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function Figures({ overview }: { overview: Overview }) {
  return (
    <section class="kpis" aria-label="Zahlen">
      <Kpi label="Offene Rechnungen" value={euro(overview.receivables)} />
      <Kpi label="Eingegangen diesen Monat" value={euro(overview.paid_this_month)} />
      <Kpi label="Offene Angebote" value={euro(overview.open_quotes_value)} hint="netto" />
      <Kpi label="Verkaufschancen" value={euro(overview.pipeline_value)} hint="netto, noch offen" />
    </section>
  );
}

function AuditRuns({ runs, onChange }: { runs: AsyncState<AuditRun[]>; onChange: () => void }) {
  const action = useAction();
  const start = (id: string) => { void action.run(async () => { await startAuditRun(id); runs.reload(); onChange(); }); };
  if (runs.error === null && (runs.data === undefined || runs.data.length === 0)) return null;
  return (
    <section class="panel stack" id="monatspruefungen" aria-labelledby="runs-head">
      <h2 id="runs-head">Fällige Monatsprüfungen</h2>
      <ErrorNote message={runs.error ?? action.error} />
      <ul class="cards">
        {(runs.data ?? []).map((run) => (
          <li key={run.id} class="row">
            <span><a href={`/kunde/${run.customer_id}`}>{run.customer?.name ?? "Kunde"}</a> · {monthName(run.month)}</span>
            <span class="cluster">
              <Badge tone={run.status === "failed" ? "bad" : "gold"}>{AUDIT_RUN_STATUS[run.status]}</Badge>
              <button class="button button--gold" type="button" disabled={action.busy} onClick={() => { start(run.id); }}>Prüfung jetzt starten</button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

const DAY_MS = 86_400_000;

function RecentCalls() {
  const calls = useAsync(() => listCallsSince(new Date(Date.now() - DAY_MS).toISOString()), []);
  if (calls.error === null && (calls.data === undefined || calls.data.length === 0)) return null;
  const title = calls.data === undefined ? "Anrufe" : plural(calls.data.length, "Anruf", "Anrufe");
  return (
    <section class="panel stack" aria-labelledby="calls-head">
      <h2 id="calls-head">{title} in den letzten 24 Stunden</h2>
      <ErrorNote message={calls.error} />
      <CallList calls={calls.data ?? []} showCaller />
    </section>
  );
}

function Tasks({ onChange }: { onChange: () => void }) {
  const tasks = useAsync(() => listTasks(), []);
  const action = useAction();
  const toggle = (id: string, done: boolean) => { void action.run(async () => { await setTaskDone(id, done); tasks.reload(); onChange(); }); };
  return (
    <section class="panel stack" aria-labelledby="tasks-head">
      <div class="spread"><h2 id="tasks-head">Aufgaben</h2></div>
      <TaskForm onAdded={() => { tasks.reload(); onChange(); }} />
      <ErrorNote message={tasks.error ?? action.error} />
      {tasks.data === undefined ? <Loading /> : tasks.data.length === 0 ? <Empty>Keine offenen Aufgaben.</Empty> : (
        <ul class="tasks">{tasks.data.map((task) => <TaskRow key={task.id} task={task} onToggle={(done) => { toggle(task.id, done); }} />)}</ul>
      )}
    </section>
  );
}

function TaskRow({ task, onToggle }: { task: Task; onToggle: (done: boolean) => void }) {
  return (
    <li class={task.due_date < today() ? "task task--late" : "task"}>
      <input type="checkbox" checked={task.done} aria-label={`${task.title} erledigt`} onChange={(event) => { onToggle(event.currentTarget.checked); }} />
      <span class="task__title">
        {task.title}
        {task.customer !== null && task.customer !== undefined && <> · <a href={`/kunde/${task.customer.id}`}>{task.customer.name}</a></>}
      </span>
      <span class="small muted num">{task.due_date === today() ? "heute" : date(task.due_date)}</span>
      {task.origin !== "person" && <span class="badge">{task.origin === "agent" ? "Agent" : "Automatisch"}</span>}
    </li>
  );
}

function TaskForm({ onAdded }: { onAdded: () => void }) {
  const [title, setTitle] = useState("");
  const [customer, setCustomer] = useState("");
  const [choosing, setChoosing] = useState(false);
  const action = useAction();
  const submit = (event: Event) => {
    event.preventDefault();
    if (title.trim() === "") return;
    void action.run(async () => {
      await createTask(title, today(), customer === "" ? null : customer);
      setTitle(""); setCustomer(""); setChoosing(false);
      onAdded();
    });
  };
  return (
    <form class="stack stack--tight" onSubmit={submit}>
      <div class="cluster">
        <input class="grow" aria-label="Neue Aufgabe" placeholder="Neue Aufgabe für heute …" value={title} onInput={(event) => { setTitle(event.currentTarget.value); }} />
        <button class="button button--quiet" type="button" onClick={() => { setChoosing(!choosing); setCustomer(""); }}>{choosing ? "Ohne Kunde" : "Kunde zuordnen"}</button>
        <button class="button" type="submit" disabled={action.busy}>Hinzufügen</button>
      </div>
      {choosing && <CustomerPicker value={customer} onChange={setCustomer} label="Kunde (optional)" />}
      <ErrorNote message={action.error} />
    </form>
  );
}
