// Message centre: everything the RepoCity apps report, newest first, plus the figures of each app
// at a glance. Tapping a message marks it read and opens the place where it can be dealt with;
// its buttons carry out the same one-tap actions as the notification on the lock screen.
import { useEffect, useState } from "preact/hooks";
import { useFeedContext } from "../App";
import { loadCrmOverview, markRead, runAction } from "../api/cockpit";
import type { AppName, CrmOverview, Message } from "../api/types";
import { Empty, ErrorNote, Kpi, Loading, PageHead, Tabs } from "../components/ui";
import { useAction, useAsync } from "../hooks/useAsync";
import { actedSummary, openActions, type ActionOutcome } from "../lib/actions";
import { dayLabel, euro, time } from "../lib/format";
import { kindLabel } from "../lib/kinds";
import { enablePush, pushState, type PushState } from "../lib/push";

const APP_LABEL: Record<AppName, string> = { crm: "CRM", marketing: "Marketing", trading: "Trading", system: "Cockpit" };
const PRIORITY_LABEL = { info: "", wichtig: "Wichtig", dringend: "Dringend" } as const;

type View = "ungelesen" | "alle";
type AppFilter = AppName | "alle";

function groupByDay(messages: Message[]): { day: string; items: Message[] }[] {
  const groups: { day: string; items: Message[] }[] = [];
  for (const message of messages) {
    const day = dayLabel(message.created_at);
    const last = groups.at(-1);
    if (last?.day === day) last.items.push(message);
    else groups.push({ day, items: [message] });
  }
  return groups;
}

function CrmCard({ overview }: { overview: CrmOverview }) {
  const waiting = overview.pending_approvals + overview.unknown_senders;
  const trouble = overview.mailbox_stale || overview.failed_mails > 0;
  return (
    <section class="panel stack app-card" aria-labelledby="crm-head">
      <div class="spread">
        <h2 id="crm-head">CRM</h2>
        <a class="button button--gold" href="https://crm.speedofthespirit.dev/" target="_blank" rel="noopener">Öffnen</a>
      </div>
      <div class="kpis">
        <Kpi label="Wartet auf dich" value={String(waiting)} hint={`${String(overview.pending_approvals)} Freigaben · ${String(overview.unknown_senders)} Absender`} />
        <Kpi label="Offene Forderungen" value={euro(overview.receivables)} hint={overview.overdue_invoices > 0 ? `${String(overview.overdue_invoices)} überfällig` : "nichts überfällig"} />
        <Kpi label="Eingang im Monat" value={euro(overview.paid_this_month)} />
        <Kpi label="In Aussicht" value={euro(overview.pipeline_value)} hint={overview.new_inquiries > 0 ? `${String(overview.new_inquiries)} neue Anfragen` : undefined} />
      </div>
      <p class={trouble ? "note note--bad small" : "small muted"}>
        {overview.mailbox_stale ? "Das Postfach wird gerade nicht abgerufen." : overview.failed_mails > 0
          ? `${String(overview.failed_mails)} ${overview.failed_mails === 1 ? "E-Mail wurde" : "E-Mails wurden"} nicht verschickt.`
          : "Postfach und Versand laufen."}
      </p>
    </section>
  );
}

function PushOffer() {
  const [state, setState] = useState<PushState | undefined>(undefined);
  const action = useAction();
  useEffect(() => {
    pushState().then(setState, () => { setState("unsupported"); });
  }, []);
  if (state === undefined || state === "on" || state === "unsupported") return null;
  return (
    <div class="todo todo--urgent">
      <span class="todo__count" aria-hidden="true">!</span>
      <span class="todo__text">
        {state === "blocked"
          ? "Mitteilungen sind für das Cockpit in diesem Browser gesperrt. Erlaube sie in den Website-Einstellungen, dann kommen die Nachrichten auf den Sperrbildschirm."
          : "Auf diesem Gerät kommen noch keine Nachrichten auf den Sperrbildschirm."}
        <ErrorNote message={action.error} />
      </span>
      {state === "off" && (
        <button class="button button--gold" type="button" disabled={action.busy} onClick={() => {
          void action.run(async () => { setState(await enablePush()); });
        }}>{action.busy ? "Wird eingerichtet …" : "Einschalten"}</button>
      )}
    </div>
  );
}

function ActionButtons({ message, onDone }: { message: Message; onDone: (message: Message) => void }) {
  const action = useAction();
  const [outcome, setOutcome] = useState<ActionOutcome | null>(null);
  const buttons = openActions(message);
  // Once the list shows the action as done, its own line replaces a successful outcome.
  const showOutcome = outcome !== null && (!outcome.ok || message.acted_at === null);
  const run = (key: string) => {
    void action.run(async () => {
      setOutcome(await runAction(message, key));
      onDone(message);
    });
  };
  return (
    <>
      {buttons.length > 0 && (
        <div class="cluster">
          {buttons.map((button, index) => (
            <button key={button.action} class={index === 0 ? "button button--gold" : "button"} type="button" disabled={action.busy} onClick={() => { run(button.action); }}>
              {button.title}
            </button>
          ))}
        </div>
      )}
      {showOutcome && <p class={outcome.ok ? "note note--good small" : "note note--bad small"} role="status">{outcome.text}</p>}
      <ErrorNote message={action.error} />
    </>
  );
}

function MessageActions({ message, onDone }: { message: Message; onDone: (message: Message) => void }) {
  const summary = actedSummary(message);
  if (summary === null && message.actions.length === 0) return null;
  return (
    <div class="note-item__actions">
      {summary !== null && (
        <p class="small">
          <span class="badge badge--good">Erledigt</span> {summary.label}{summary.result === "" ? "" : ` · ${summary.result}`}
        </p>
      )}
      <ActionButtons message={message} onDone={onDone} />
    </div>
  );
}

function MessageContent({ message }: { message: Message }) {
  const kind = kindLabel(message.kind);
  return (
    <>
      <span class="note-item__meta">
        <span class="note-item__app">{APP_LABEL[message.app]}</span>
        {kind !== "" && <span>{kind}</span>}
        {message.priority !== "info" && <span class={`badge ${message.priority === "dringend" ? "badge--bad" : "badge--gold"}`}>{PRIORITY_LABEL[message.priority]}</span>}
        <span class="num">{time(message.created_at)}</span>
      </span>
      <span class="note-item__title">{message.title}</span>
      {message.body !== "" && <span class="note-item__body">{message.body}</span>}
    </>
  );
}

function MessageItem({ message, onOpen }: { message: Message; onOpen: (message: Message) => void }) {
  const external = message.link.startsWith("http");
  const classes = ["note-item", message.read_at === null ? "note-item--unread" : "", `note-item--${message.priority}`].filter(Boolean).join(" ");
  const open = () => { onOpen(message); };
  return (
    <li>
      {message.link === "" || message.link === "/" ? (
        <button class={classes} type="button" onClick={open}><MessageContent message={message} /></button>
      ) : (
        <a class={classes} href={message.link} target={external ? "_blank" : undefined} rel={external ? "noopener" : undefined} onClick={open}>
          <MessageContent message={message} />
        </a>
      )}
      <MessageActions message={message} onDone={onOpen} />
    </li>
  );
}

function greeting(hour: number): string {
  return hour < 11 ? "Guten Morgen" : hour < 18 ? "Guten Tag" : "Guten Abend";
}

function FeedList({ messages, view, onOpen }: { messages: Message[] | undefined; view: View; onOpen: (message: Message) => void }) {
  if (messages === undefined) return <Loading />;
  if (messages.length === 0) {
    return <div class="panel panel--flat"><Empty>{view === "ungelesen" ? "Nichts Neues. Alles gelesen." : "Noch keine Nachrichten."}</Empty></div>;
  }
  return (
    <>
      {groupByDay(messages).map((group) => (
        <div class="stack stack--tight" key={group.day}>
          <h3 class="feed-day">{group.day}</h3>
          <ul class="feed">
            {group.items.map((message) => <MessageItem key={message.id} message={message} onOpen={onOpen} />)}
          </ul>
        </div>
      ))}
    </>
  );
}

function useFeedFilter(all: Message[]) {
  const [view, setView] = useState<View>("ungelesen");
  const [app, setApp] = useState<AppFilter>("alle");
  const unread = all.filter((message) => message.read_at === null);
  const shown = (view === "ungelesen" ? unread : all).filter((message) => app === "alle" || message.app === app);
  return { view, setView, app, setApp, unread, shown, apps: [...new Set(all.map((message) => message.app))] };
}

function Feed() {
  const feed = useFeedContext();
  const filter = useFeedFilter(feed.messages ?? []);
  const action = useAction();
  const open = (message: Message) => {
    if (message.read_at !== null) { feed.reload(); return; }
    void action.run(async () => { await markRead([message.id]); feed.reload(); });
  };
  const readAll = () => {
    void action.run(async () => { await markRead(filter.shown.filter((message) => message.read_at === null).map((message) => message.id)); feed.reload(); });
  };
  return (
    <section class="stack" aria-labelledby="feed-head">
      <div class="spread">
        <h2 id="feed-head">Nachrichten</h2>
        {filter.shown.some((message) => message.read_at === null) && (
          <button class="button button--quiet" type="button" disabled={action.busy} onClick={readAll}>Alle als gelesen markieren</button>
        )}
      </div>
      <FeedTabs filter={filter} />
      <ErrorNote message={feed.error ?? action.error} />
      <FeedList messages={feed.messages === undefined ? undefined : filter.shown} view={filter.view} onOpen={open} />
    </section>
  );
}

function FeedTabs({ filter }: { filter: ReturnType<typeof useFeedFilter> }) {
  return (
    <div class="cluster">
      <Tabs value={filter.view} onChange={filter.setView} options={[{ id: "ungelesen", label: "Ungelesen", count: filter.unread.length }, { id: "alle", label: "Alle" }]} />
      {filter.apps.length > 1 && (
        <Tabs value={filter.app} onChange={filter.setApp} options={[{ id: "alle" as const, label: "Alle Apps" }, ...filter.apps.map((id) => ({ id, label: APP_LABEL[id] }))]} />
      )}
    </div>
  );
}

export function Zentrale() {
  const feed = useFeedContext();
  const crm = useAsync(() => loadCrmOverview(), [feed.messages?.length]);
  return (
    <div class="stack stack--loose">
      <PageHead kicker="Cockpit" title={`${greeting(new Date().getHours())}, Daniel`} />
      <PushOffer />
      <ErrorNote message={crm.error} />
      {crm.data !== undefined && <CrmCard overview={crm.data} />}
      <Feed />
    </div>
  );
}
