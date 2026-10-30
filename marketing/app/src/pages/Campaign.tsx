// One campaign: the decision to start, the board of posts, the research behind them, results and history.
import { useMemo, useState } from "preact/hooks";
import {
  getCampaign,
  listEvents,
  listFindings,
  listMetrics,
  listPosts,
  listReports,
  pauseCampaign,
  startCampaign,
} from "../api/queries";
import type { Campaign, CampaignEvent, Finding, Metric, Post, Report } from "../api/types";
import { ResultsChart } from "../components/ResultsChart";
import { CampaignBadge, Empty, ErrorNote, ExampleBadge, Kpi, Loading, VerdictBadge } from "../components/ui";
import { useIsAdmin } from "../hooks/role";
import { useAction, useAsync } from "../hooks/useAsync";
import { COLUMNS, groupPosts, plannedMoment, startCheck } from "../lib/board";
import { CHANNEL, EVENT, formatDay, formatMoment, formatNumber } from "../lib/format";
import { renderMarkdown } from "../lib/markdown";
import { byDay, byPost, isSimulated, sum } from "../lib/results";

type Tab = "board" | "research" | "results" | "reports" | "history";
const TABS: { key: Tab; label: string }[] = [
  { key: "board", label: "Beiträge" },
  { key: "research", label: "Recherche" },
  { key: "results", label: "Ergebnisse" },
  { key: "reports", label: "Berichte" },
  { key: "history", label: "Verlauf" },
];

interface Data {
  campaign: Campaign;
  posts: Post[];
  findings: Finding[];
  events: CampaignEvent[];
  metrics: Metric[];
  reports: Report[];
}

async function load(id: string): Promise<Data> {
  const [campaign, posts, findings, events, reports] = await Promise.all([
    getCampaign(id),
    listPosts(id),
    listFindings(id),
    listEvents(id),
    listReports(id),
  ]);
  const metrics = await listMetrics(posts.map((post) => post.id));
  return { campaign, posts, findings, events, metrics, reports };
}

function StartPanel({ data, onChange }: { data: Data; onChange: () => void }) {
  const { campaign, posts } = data;
  const action = useAction();
  const check = startCheck(campaign, posts);
  const [confirming, setConfirming] = useState(false);
  const start = () =>
    void action.run(async () => {
      await startCampaign(campaign);
      setConfirming(false);
      onChange();
    });
  const pause = () =>
    void action.run(async () => {
      await pauseCampaign(campaign);
      onChange();
    });

  if (campaign.status === "running") {
    return (
      <div class="panel stack stack--tight">
        <p class="note note--good">
          Läuft seit {campaign.started_at === null ? "-" : formatDay(campaign.started_at)}. Freigegebene Beiträge stehen zum Termin unter
          „Jetzt posten“.
        </p>
        <ErrorNote message={action.error} />
        <div>
          <button class="button button--danger" type="button" onClick={pause} disabled={action.busy}>
            Pausieren
          </button>
        </div>
      </div>
    );
  }
  if (campaign.status === "done") return <p class="note">Diese Kampagne ist abgeschlossen.</p>;

  const label = campaign.status === "paused" ? "Fortsetzen" : "Freigeben & starten";
  return (
    <div class="panel stack">
      <div class="spread">
        <div class="stack stack--tight">
          <h2>{campaign.status === "paused" ? "Pausiert" : "Bereit zum Start"}</h2>
          <p class="muted small">
            {check.approved} Beiträge freigegeben, {check.waiting} warten noch. Beim Start bekommt jeder freigegebene Beitrag seinen Termin: Starttag plus
            Versatz, jeweils {campaign.publish_time.slice(0, 5)} Uhr. Laufzeit {campaign.duration_days} Tage.
          </p>
        </div>
        {!confirming && (
          <button class="button button--gold button--big" type="button" disabled={!check.allowed || action.busy} onClick={() => { setConfirming(true); }}>
            {label}
          </button>
        )}
      </div>
      {check.reasons.map((reason) => (
        <p key={reason} class="note note--gold small">
          {reason}
        </p>
      ))}
      {confirming && (
        <div class="note note--gold stack stack--tight">
          <strong>Wirklich starten?</strong>
          <p class="small">
            Ab jetzt bekommen die freigegebenen Beiträge ihre Termine. Du kannst jederzeit pausieren.
            {check.waiting > 0 && ` ${String(check.waiting)} Beiträge ohne Freigabe bleiben zurück, bis du sie freigibst.`}
          </p>
          <div class="cluster">
            <button class="button button--gold" type="button" onClick={start} disabled={action.busy}>
              {action.busy ? "Starte …" : "Ja, starten"}
            </button>
            <button class="button" type="button" onClick={() => { setConfirming(false); }}>
              Abbrechen
            </button>
          </div>
        </div>
      )}
      <ErrorNote message={action.error} />
    </div>
  );
}

function Board({ data }: { data: Data }) {
  const now = new Date();
  const groups = groupPosts(data.posts, now);
  return (
    <div class="board">
      {COLUMNS.map((column) => (
        <section key={column.key} class="column" aria-label={column.title}>
          <div class="column__head">
            <h3>
              {column.title} <span class="num">{groups[column.key].length}</span>
            </h3>
            <p class="small muted">{column.hint}</p>
          </div>
          {groups[column.key].map((post) => (
            <a key={post.id} class="card" href={`/beitrag/${post.id}`}>
              <div class="spread">
                <span class="badge">{CHANNEL[post.channel]}</span>
                <span class="small muted">Tag {post.day_offset + 1}</span>
              </div>
              <span class="card__title">{post.title}</span>
              {post.unbacked_figures.length > 0 && <span class="badge badge--bad">Zahl ohne Quelle: {post.unbacked_figures.join(", ")}</span>}
              {post.status === "approved" && data.campaign.status === "running" && (
                <span class="small muted">{formatMoment(plannedMoment(data.campaign, post, now).toISOString())}</span>
              )}
              {post.status === "published" && post.published_at !== null && <span class="small muted">{formatDay(post.published_at)}</span>}
            </a>
          ))}
        </section>
      ))}
    </div>
  );
}

function Research({ data }: { data: Data }) {
  if (data.findings.length === 0) return <Empty>Keine Befunde übernommen.</Empty>;
  return (
    <div class="stack">
      <p class="muted small">
        Jeder Befund wurde gegen seine Quelle geprüft und von einem Menschen behalten oder verworfen. Beiträge dürfen nur behaltene, belegte Befunde zitieren.
      </p>
      {data.findings.map((finding) => (
          <article key={finding.id} class="panel panel--flat stack stack--tight">
            <div class="spread">
              <span class="small muted">{finding.key}</span>
              <VerdictBadge verdict={finding.verdict} />
            </div>
            <h3>{finding.statement}</h3>
            <p class="small">{finding.detail}</p>
            <div class="figures">
              {finding.figures.map((figure) => (
                <code key={figure}>{figure}</code>
              ))}
            </div>
            <p class="small muted">
              Quelle: {finding.source_url === null ? `${finding.source_publisher}: ${finding.source_title}` : (
                <a href={finding.source_url} target="_blank" rel="noopener noreferrer">
                  {finding.source_publisher}: {finding.source_title}
                </a>
              )}
              {finding.source_published !== null && `, ${formatDay(finding.source_published)}`}
              {finding.checked_on !== null && ` · geprüft am ${formatDay(finding.checked_on)}`}
            </p>
            {finding.evidence !== null && <blockquote class="note small">„{finding.evidence}“</blockquote>}
          </article>
        ))}
    </div>
  );
}

function Results({ data }: { data: Data }) {
  const total = sum(data.metrics);
  const rows = useMemo(() => byDay(data.metrics), [data.metrics]);
  const perPost = byPost(data.metrics);
  const kpi = data.campaign.kpi;
  const live = data.posts.filter((post) => post.status === "published");
  return (
    <div class="stack">
      {isSimulated(data.metrics) && <p class="note note--gold">Beispielkampagne: Diese Ergebnisse sind simuliert, nicht gemessen.</p>}
      <div class="kpis">
        <Kpi label="Aufrufe" value={formatNumber(total.views)} goal={kpi.views === undefined ? undefined : { done: total.views, target: kpi.views }} />
        <Kpi label="Klicks" value={formatNumber(total.clicks)} goal={kpi.clicks === undefined ? undefined : { done: total.clicks, target: kpi.clicks }} />
        <Kpi label="Anfragen" value={formatNumber(total.leads)} goal={kpi.leads === undefined ? undefined : { done: total.leads, target: kpi.leads }} />
      </div>
      {rows.length > 0 ? (
        <div class="panel">
          <ResultsChart rows={rows} />
        </div>
      ) : (
        <Empty>Noch keine Ergebnisse. Sie erscheinen, sobald Beiträge live sind und der tägliche Lauf gezählt hat.</Empty>
      )}
      {live.length > 0 && (
        <div class="panel table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th>Beitrag</th>
                <th>Kanal</th>
                <th class="num">Aufrufe</th>
                <th class="num">Klicks</th>
                <th class="num">Anfragen</th>
              </tr>
            </thead>
            <tbody>
              {live.map((post) => {
                const result = perPost.get(post.id);
                return (
                  <tr key={post.id}>
                    <td>
                      <a href={`/beitrag/${post.id}`}>{post.title}</a>
                    </td>
                    <td>{CHANNEL[post.channel]}</td>
                    <td class="num">{formatNumber(result?.views ?? 0)}</td>
                    <td class="num">{formatNumber(result?.clicks ?? 0)}</td>
                    <td class="num">{formatNumber(result?.leads ?? 0)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p class="small muted">
        Impressionen, Klicks und Anfragen trägst du im Beitrag unter „Ergebnis eintragen“ ein.
      </p>
    </div>
  );
}

function Reports({ data }: { data: Data }) {
  if (data.reports.length === 0) return <Empty>Der erste Wochenbericht entsteht montags nach dem Start.</Empty>;
  return (
    <div class="stack">
      {data.reports.map((report) => (
        <article key={report.id} class="panel prose" dangerouslySetInnerHTML={{ __html: renderMarkdown(report.body_md) }} />
      ))}
    </div>
  );
}

function History({ data }: { data: Data }) {
  if (data.events.length === 0) return <Empty>Noch nichts passiert.</Empty>;
  const titles = new Map(data.posts.map((post) => [post.id, post.title]));
  return (
    <ul class="timeline panel">
      {data.events.map((event) => (
        <li key={event.id}>
          <span class="small muted num">{formatMoment(event.created_at)}</span>
          <span>
            <strong>{EVENT[event.kind] ?? event.kind}</strong>
            {event.post_id !== null && ` · ${titles.get(event.post_id) ?? ""}`}
            {event.note !== null && <span class="small muted"> · {event.note}</span>}
            <span class="small muted"> · {event.actor}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

export function CampaignPage({ id }: { id: string }) {
  const state = useAsync(() => load(id), [id]);
  const [tab, setTab] = useState<Tab>("board");
  const admin = useIsAdmin();
  if (state.loading && state.data === undefined) return <Loading />;
  if (state.data === undefined) return <ErrorNote message={state.error ?? "Nicht gefunden."} />;
  const data = state.data;
  const { campaign } = data;
  return (
    <div class="stack stack--loose">
      <a class="small" href="/">
        ← Alle Kampagnen
      </a>
      <section class={`hero ${campaign.is_example ? "example-flag" : ""}`}>
        <div class="cluster">
          <CampaignBadge status={campaign.status} />
          {campaign.is_example && <ExampleBadge />}
          <span class="badge">{campaign.product}</span>
        </div>
        <h1>{campaign.title}</h1>
        <p>
          <strong>Ziel:</strong> {campaign.goal}
        </p>
        <p class="muted">
          <strong>Zielgruppe:</strong> {campaign.audience}
        </p>
      </section>
      {admin && <StartPanel data={data} onChange={state.reload} />}
      <div class="tabs" role="tablist">
        {TABS.map((item) => (
          <button key={item.key} type="button" role="tab" aria-selected={tab === item.key} onClick={() => { setTab(item.key); }}>
            {item.label}
            {item.key === "board" && ` (${String(data.posts.length)})`}
            {item.key === "research" && ` (${String(data.findings.length)})`}
          </button>
        ))}
      </div>
      {tab === "board" && <Board data={data} />}
      {tab === "research" && <Research data={data} />}
      {tab === "results" && <Results data={data} />}
      {tab === "reports" && <Reports data={data} />}
      {tab === "history" && <History data={data} />}
    </div>
  );
}
