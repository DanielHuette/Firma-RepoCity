// Planner: one week of posts on every channel, the posts still without a date, and a quick way
// to plan a new one. Opening a post leads to its page, where it is approved, edited or moved.
import { useMemo, useState } from "preact/hooks";
import { createPost, listPlan, listPlannableCampaigns } from "../api/queries";
import type { Channel, PlanRow } from "../api/types";
import { Empty, ErrorNote, Loading, PostBadge } from "../components/ui";
import { useIsAdmin } from "../hooks/role";
import { useAction, useAsync } from "../hooks/useAsync";
import { unbackedFigures } from "../lib/figures";
import { addDays, isoWeek, sameDay, weekStart } from "../lib/calendar";
import { CHANNEL } from "../lib/format";

const WEEKDAY = new Intl.DateTimeFormat("de-DE", { weekday: "short" });
const DAY = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit" });
const TIME = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" });
const CHANNELS = Object.keys(CHANNEL) as Channel[];

/** Value for a datetime-local field. */
function localInput(day: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${String(day.getFullYear())}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}T${pad(day.getHours())}:${pad(day.getMinutes())}`;
}

function due(row: PlanRow, now: Date): boolean {
  return row.status === "approved" && row.moment !== null && new Date(row.moment) <= now;
}

function PlanCard({ row, now }: { row: PlanRow; now: Date }) {
  return (
    <a class={`card plan-card${due(row, now) ? " plan-card--due" : ""}`} href={`/beitrag/${row.id}`}>
      <span class="cluster plan-card__meta">
        {row.moment !== null && <span class="num">{TIME.format(new Date(row.moment))}</span>}
        <span class="badge">{CHANNEL[row.channel]}</span>
      </span>
      <span class="card__title">{row.title}</span>
      <span class="cluster">
        {due(row, now) ? <span class="badge badge--gold">Jetzt posten</span> : <PostBadge status={row.status} />}
        {row.campaign_slug !== "laufend" && <span class="small muted">{row.campaign_title}</span>}
      </span>
    </a>
  );
}

function NewPost({ day, onDone, onCancel }: { day: Date; onDone: () => void; onCancel: () => void }) {
  const campaigns = useAsync(listPlannableCampaigns, []);
  const [campaignId, setCampaignId] = useState("");
  const [channel, setChannel] = useState<Channel>("linkedin");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [moment, setMoment] = useState(localInput(day));
  const action = useAction();
  const chosen = campaigns.data?.find((campaign) => campaign.id === campaignId) ?? campaigns.data?.[0];
  const missing = unbackedFigures(`${title}\n${body}`, []);
  const save = (toReview: boolean) => (event: Event) => {
    event.preventDefault();
    if (chosen === undefined) return;
    void action.run(async () => {
      await createPost({
        campaignId: chosen.id, channel, title, body,
        plannedFor: moment === "" ? null : new Date(moment), unbackedFigures: missing, toReview,
      });
      onDone();
    });
  };
  if (campaigns.data === undefined) return <div class="panel"><Loading /></div>;
  return (
    <form class="panel stack" onSubmit={save(true)}>
      <div class="spread">
        <h2>Neuer Beitrag</h2>
        <button class="button" type="button" onClick={onCancel}>Schließen</button>
      </div>
      <div class="form-row">
        <label>
          Kanal
          <select value={channel} onChange={(event) => { setChannel(event.currentTarget.value as Channel); }}>
            {CHANNELS.map((option) => <option key={option} value={option}>{CHANNEL[option]}</option>)}
          </select>
        </label>
        <label>
          Termin
          <input type="datetime-local" value={moment} onInput={(event) => { setMoment(event.currentTarget.value); }} />
        </label>
        <label>
          Kampagne
          <select value={chosen?.id ?? ""} onChange={(event) => { setCampaignId(event.currentTarget.value); }}>
            {campaigns.data.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.title}</option>)}
          </select>
        </label>
      </div>
      <label>
        Titel
        <input value={title} required minLength={5} onInput={(event) => { setTitle(event.currentTarget.value); }} placeholder="Worum geht es in einem Satz?" />
      </label>
      <label>
        Text
        <textarea value={body} required onInput={(event) => { setBody(event.currentTarget.value); }} placeholder="Der Text, so wie er gepostet wird." />
      </label>
      {missing.length > 0 && (
        <p class="note note--bad small">Zahlen ohne Quelle: {missing.join(", ")}. Speichern geht, freigeben erst, wenn jede Zahl belegt ist.</p>
      )}
      <ErrorNote message={action.error ?? campaigns.error} />
      <div class="cluster">
        <button class="button button--gold" type="submit" disabled={action.busy || title.trim().length < 5 || body.trim() === ""}>Zur Freigabe geben</button>
        <button class="button" type="button" disabled={action.busy || title.trim().length < 5 || body.trim() === ""} onClick={save(false)}>Als Entwurf speichern</button>
      </div>
    </form>
  );
}

export function Planer() {
  const admin = useIsAdmin();
  const [start, setStart] = useState(() => weekStart(new Date()));
  const [creating, setCreating] = useState<Date | null>(null);
  const end = useMemo(() => addDays(start, 7), [start]);
  const plan = useAsync(() => listPlan(start, end), [start.getTime()]);
  const now = new Date();
  const days = Array.from({ length: 7 }, (_, index) => addDays(start, index));
  const rows = plan.data?.dated ?? [];
  const waiting = rows.filter((row) => row.status === "review").length + (plan.data?.open.filter((row) => row.status === "review").length ?? 0);
  const toPost = rows.filter((row) => due(row, now)).length;
  const open = (day: Date) => {
    const at = new Date(day);
    at.setHours(sameDay(day, now) ? Math.min(now.getHours() + 1, 23) : 9, 0, 0, 0);
    setCreating(at);
  };

  return (
    <div class="stack stack--loose">
      <section class="hero">
        <p class="kicker">Planer</p>
        <div class="spread">
          <h1>KW {isoWeek(start)} · {DAY.format(start)} bis {DAY.format(addDays(start, 6))}</h1>
          <div class="cluster">
            <button class="button" type="button" onClick={() => { setStart(addDays(start, -7)); }} aria-label="Vorige Woche">←</button>
            <button class="button" type="button" onClick={() => { setStart(weekStart(new Date())); }}>Diese Woche</button>
            <button class="button" type="button" onClick={() => { setStart(addDays(start, 7)); }} aria-label="Nächste Woche">→</button>
            {admin && <button class="button button--gold" type="button" onClick={() => { open(sameDay(weekStart(now), start) ? now : start); }}>Neuer Beitrag</button>}
          </div>
        </div>
        <p class="muted">
          {rows.length} {rows.length === 1 ? "Beitrag" : "Beiträge"} in dieser Woche
          {waiting > 0 && ` · ${String(waiting)} warten auf Freigabe`}
          {toPost > 0 && ` · ${String(toPost)} jetzt von Hand posten`}
        </p>
      </section>

      {creating !== null && <NewPost day={creating} onCancel={() => { setCreating(null); }} onDone={() => { setCreating(null); plan.reload(); }} />}
      <ErrorNote message={plan.error} />
      {plan.data === undefined ? <Loading /> : (
        <div class="week">
          {days.map((day) => {
            const items = rows.filter((row) => row.moment !== null && sameDay(new Date(row.moment), day));
            return (
              <section key={day.getTime()} class={`column week__day${sameDay(day, now) ? " week__day--today" : ""}`} aria-label={`${WEEKDAY.format(day)} ${DAY.format(day)}`}>
                <div class="column__head">
                  <h3><span>{WEEKDAY.format(day)}</span><span class="num">{DAY.format(day)}</span></h3>
                </div>
                {items.map((row) => <PlanCard key={row.id} row={row} now={now} />)}
                {admin && <button class="plan-add" type="button" onClick={() => { open(day); }}>+ Beitrag</button>}
              </section>
            );
          })}
        </div>
      )}

      {plan.data !== undefined && (
        <section class="stack">
          <h2>Ohne Termin</h2>
          {plan.data.open.length === 0 ? <Empty>Jeder offene Beitrag hat einen Termin.</Empty> : (
            <div class="grid">{plan.data.open.map((row) => <PlanCard key={row.id} row={row} now={now} />)}</div>
          )}
        </section>
      )}
    </div>
  );
}
