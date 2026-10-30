// One post: the text as readers will see it, the findings behind every number, and the decision.
import { useState } from "preact/hooks";
import {
  approvePost,
  editPost,
  getCampaign,
  getPost,
  markPosted,
  movePost,
  recordResult,
  rejectPost,
  reopenPost,
} from "../api/queries";
import type { Campaign, Finding, PostWithFindings } from "../api/types";
import { ErrorNote, ExampleBadge, Loading, PostBadge, VerdictBadge } from "../components/ui";
import { useIsAdmin } from "../hooks/role";
import { useAction, useAsync } from "../hooks/useAsync";
import { plannedMoment } from "../lib/board";
import { unbackedFigures } from "../lib/figures";
import { CHANNEL, formatDay, formatMoment } from "../lib/format";
import { renderMarkdown } from "../lib/markdown";
import { markLinks, markersFor } from "../lib/tracking";

interface Data {
  post: PostWithFindings;
  campaign: Campaign;
}

async function load(id: string): Promise<Data> {
  const post = await getPost(id);
  return { post, campaign: await getCampaign(post.campaign_id) };
}

function citedFindings(post: PostWithFindings): Finding[] {
  return post.post_findings.map((link) => link.findings);
}

function Preview({ post }: { post: PostWithFindings }) {
  if (post.channel !== "blog") {
    return <div class="linkedin-preview">{post.body_md}</div>;
  }
  return (
    <div class="stack">
      {post.summary !== "" && <p class="muted">{post.summary}</p>}
      <div class="prose" dangerouslySetInnerHTML={{ __html: renderMarkdown(post.body_md) }} />
    </div>
  );
}

function Editor({ post, onDone }: { post: PostWithFindings; onDone: () => void }) {
  const [title, setTitle] = useState(post.title);
  const [summary, setSummary] = useState(post.summary);
  const [body, setBody] = useState(post.body_md);
  const action = useAction();
  const figures = citedFindings(post).flatMap((finding) => finding.figures);
  const missing = unbackedFigures(`${title}\n${summary}\n${body}`, figures, post.free_figures);
  const save = (event: Event) => {
    event.preventDefault();
    void action.run(async () => {
      await editPost(post, { title, summary, body_md: body, unbacked_figures: missing });
      onDone();
    });
  };
  return (
    <form class="panel stack" onSubmit={save}>
      <h2>Bearbeiten</h2>
      <label>
        Titel
        <input value={title} required minLength={5} onInput={(event) => { setTitle(event.currentTarget.value); }} />
      </label>
      {post.channel === "blog" && (
        <label>
          Kurzfassung
          <input value={summary} onInput={(event) => { setSummary(event.currentTarget.value); }} />
        </label>
      )}
      <label>
        Text (Markdown)
        <textarea value={body} onInput={(event) => { setBody(event.currentTarget.value); }} />
      </label>
      {missing.length > 0 ? (
        <p class="note note--bad small">Zahlen ohne Quelle: {missing.join(", ")}. So lässt sich der Beitrag nicht freigeben.</p>
      ) : (
        <p class="note note--good small">Jede Zahl ist durch einen zitierten Befund gedeckt.</p>
      )}
      <ErrorNote message={action.error} />
      <div class="cluster">
        <button class="button button--primary" type="submit" disabled={action.busy}>
          Speichern, zurück in die Prüfung
        </button>
        <button class="button" type="button" onClick={onDone}>
          Abbrechen
        </button>
      </div>
    </form>
  );
}

function ResultForm({ post, onDone }: { post: PostWithFindings; onDone: () => void }) {
  const [day, setDay] = useState(new Date().toISOString().slice(0, 10));
  const [views, setViews] = useState(0);
  const [clicks, setClicks] = useState(0);
  const [leads, setLeads] = useState(0);
  const action = useAction();
  const save = (event: Event) => {
    event.preventDefault();
    void action.run(async () => {
      await recordResult(post, day, { views, clicks, leads });
      onDone();
    });
  };
  const number = (setter: (value: number) => void) => (event: Event) => {
    setter(Math.max(0, Math.round(Number((event.currentTarget as HTMLInputElement).value) || 0)));
  };
  return (
    <form class="panel stack stack--tight" onSubmit={save}>
      <h3>Ergebnis eintragen</h3>
      <p class="small muted">
        Impressionen und Klicks aus der Statistik von {CHANNEL[post.channel]}, dazu Anfragen, die der Beitrag gebracht hat.
      </p>
      <label>
        Tag
        <input type="date" value={day} required onInput={(event) => { setDay(event.currentTarget.value); }} />
      </label>
      <div class="kpis">
        <label>
          Impressionen
          <input type="number" min={0} value={views} onInput={number(setViews)} />
        </label>
        <label>
          Klicks
          <input type="number" min={0} value={clicks} onInput={number(setClicks)} />
        </label>
        <label>
          Anfragen
          <input type="number" min={0} value={leads} onInput={number(setLeads)} />
        </label>
      </div>
      <ErrorNote message={action.error} />
      <div>
        <button class="button" type="submit" disabled={action.busy}>
          Eintragen
        </button>
      </div>
    </form>
  );
}

function dayText(offset: number): string {
  if (offset === 0) return "am Starttag";
  return offset === 1 ? "einen Tag nach dem Start" : `${String(offset)} Tage nach dem Start`;
}

function Decision({ data, onChange, onEdit, editing }: { data: Data; onChange: () => void; onEdit: () => void; editing: boolean }) {
  const { post, campaign } = data;
  const action = useAction();
  const [note, setNote] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [url, setUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const run = (task: () => Promise<unknown>) =>
    void action.run(async () => {
      await task();
      setRejecting(false);
      setNote("");
      onChange();
    });
  const blocked = post.unbacked_figures.length > 0;
  if (editing) {
    return (
      <div class="panel stack stack--tight">
        <h2>Entscheidung</h2>
        <p class="note small">Erst speichern. Entschieden wird über die gespeicherte Fassung.</p>
      </div>
    );
  }
  const moment = post.scheduled_for ?? post.planned_for;
  const due = post.status === "approved" && moment !== null && new Date(moment) <= new Date();

  return (
    <div class="panel stack">
      <div class="spread">
        <h2>Entscheidung</h2>
        <PostBadge status={post.status} />
      </div>
      {blocked && <p class="note note--bad small">Zahlen ohne geprüfte Quelle: {post.unbacked_figures.join(", ")}. Erst korrigieren, dann freigeben.</p>}
      {post.review_note !== null && post.status === "rejected" && <p class="note small">Abgelehnt: {post.review_note}</p>}

      {post.status === "review" && !rejecting && (
        <div class="cluster">
          <button class="button button--gold" type="button" disabled={blocked || action.busy} onClick={() => { run(() => approvePost(post)); }}>
            Freigeben
          </button>
          <button class="button" type="button" onClick={onEdit}>
            Bearbeiten
          </button>
          <button class="button button--danger" type="button" onClick={() => { setRejecting(true); }}>
            Ablehnen
          </button>
        </div>
      )}
      {rejecting && (
        <div class="stack stack--tight">
          <label>
            Begründung
            <input value={note} required onInput={(event) => { setNote(event.currentTarget.value); }} placeholder="Was soll anders werden?" />
          </label>
          <div class="cluster">
            <button class="button button--danger" type="button" disabled={note.trim() === "" || action.busy} onClick={() => { run(() => rejectPost(post, note.trim())); }}>
              Ablehnen
            </button>
            <button class="button" type="button" onClick={() => { setRejecting(false); }}>
              Abbrechen
            </button>
          </div>
        </div>
      )}
      {post.status === "rejected" && (
        <div class="cluster">
          <button class="button" type="button" onClick={onEdit}>
            Bearbeiten
          </button>
          <button class="button" type="button" onClick={() => { run(() => reopenPost(post)); }}>
            Zurück in die Prüfung
          </button>
        </div>
      )}
      {post.status === "approved" && (
        <div class="stack stack--tight">
          <p class="small">
            {campaign.status === "running" || post.planned_for !== null
              ? `Termin: ${formatMoment(plannedMoment(campaign, post, new Date()).toISOString())}`
              : `Geht ${dayText(post.day_offset)} der Kampagne raus, um ${campaign.publish_time.slice(0, 5)} Uhr.`}
          </p>
          {due && (
            <div class="note note--gold stack stack--tight">
              <strong>Jetzt auf {CHANNEL[post.channel]} posten</strong>
              <p class="small">Text kopieren, auf {CHANNEL[post.channel]} einfügen, posten. Dann die Adresse des Beitrags hier eintragen.</p>
              <div>
                <button
                  class="button"
                  type="button"
                  onClick={() => {
                    void navigator.clipboard.writeText(markLinks(post.body_md, markersFor(post.channel, campaign.slug, post.slug))).then(() => { setCopied(true); });
                  }}
                >
                  {copied ? "Kopiert" : "Text kopieren"}
                </button>
              </div>
              <label>
                Adresse des Beitrags
                <input type="url" value={url} placeholder="https://…" onInput={(event) => { setUrl(event.currentTarget.value); }} />
              </label>
              <div>
                <button class="button button--gold" type="button" disabled={!url.startsWith("https://") || action.busy} onClick={() => { run(() => markPosted(post, url)); }}>
                  Als gepostet markieren
                </button>
              </div>
            </div>
          )}
          <div>
            <button class="button" type="button" onClick={() => { run(() => reopenPost(post)); }}>
              Freigabe zurückziehen
            </button>
          </div>
        </div>
      )}
      {post.status === "published" && (
        <p class="small">
          Veröffentlicht am {post.published_at === null ? "-" : formatDay(post.published_at)}
          {post.url !== null && (
            <>
              {" · "}
              <a href={post.url} target="_blank" rel="noopener noreferrer">
                Ansehen
              </a>
            </>
          )}
        </p>
      )}
      <ErrorNote message={action.error} />
    </div>
  );
}

function localInput(day: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${String(day.getFullYear())}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}T${pad(day.getHours())}:${pad(day.getMinutes())}`;
}

/** Moves the post on the planner; for a running blog or LinkedIn post the database moves the publishing time along. */
function Termin({ data, onChange }: { data: Data; onChange: () => void }) {
  const { post, campaign } = data;
  const current = post.planned_for ?? post.scheduled_for ?? (campaign.status === "running" ? plannedMoment(campaign, post, new Date()).toISOString() : null);
  const [value, setValue] = useState(current === null ? "" : localInput(new Date(current)));
  const action = useAction();
  if (post.status === "published") return null;
  return (
    <form class="panel stack stack--tight" onSubmit={(event) => {
      event.preventDefault();
      if (value === "") return;
      void action.run(async () => { await movePost(post, new Date(value)); onChange(); });
    }}>
      <h2>Termin</h2>
      <label>
        Geplant für
        <input type="datetime-local" value={value} onInput={(event) => { setValue(event.currentTarget.value); }} />
      </label>
      <ErrorNote message={action.error} />
      <div><button class="button" type="submit" disabled={action.busy || value === ""}>Termin speichern</button></div>
    </form>
  );
}

export function PostPage({ id }: { id: string }) {
  const state = useAsync(() => load(id), [id]);
  const [editing, setEditing] = useState(false);
  const admin = useIsAdmin();
  if (state.loading && state.data === undefined) return <Loading />;
  if (state.data === undefined) return <ErrorNote message={state.error ?? "Nicht gefunden."} />;
  const data = state.data;
  const { post, campaign } = data;
  const findings = citedFindings(post);
  const done = () => {
    setEditing(false);
    state.reload();
  };
  return (
    <div class="stack stack--loose">
      <a class="small" href={`/kampagne/${campaign.id}`}>
        ← {campaign.title}
      </a>
      <div class="post-layout">
        <div class="stack">
          <div class="cluster">
            <span class="badge">{CHANNEL[post.channel]}</span>
            <span class="badge">Tag {post.day_offset + 1}</span>
            <span class="badge">Fassung {post.version}</span>
            {campaign.is_example && <ExampleBadge />}
          </div>
          <h1>{post.title}</h1>
          {admin && editing ? <Editor post={post} onDone={done} /> : <article class="panel"><Preview post={post} /></article>}
        </div>
        <aside class="stack sticky">
          {admin && <Decision data={data} editing={editing} onChange={state.reload} onEdit={() => { setEditing(true); }} />}
          {admin && <Termin data={data} onChange={state.reload} />}
          {admin && post.status === "published" && <ResultForm post={post} onDone={state.reload} />}
          <section class="panel">
            <h2>Belege</h2>
            <p class="small muted">Die Befunde, die dieser Beitrag zitiert. Nur diese Zahlen darf er zeigen.</p>
            {findings.map((finding) => (
              <div key={finding.id} class="finding">
                <div class="spread">
                  <span class="small muted">{finding.key}</span>
                  <VerdictBadge verdict={finding.verdict} />
                </div>
                <strong>{finding.statement}</strong>
                <div class="figures">
                  {finding.figures.map((figure) => (
                    <code key={figure}>{figure}</code>
                  ))}
                </div>
                <span class="small muted">
                  {finding.source_url === null ? `${finding.source_publisher}: ${finding.source_title}` : (
                    <a href={finding.source_url} target="_blank" rel="noopener noreferrer">
                      {finding.source_publisher}: {finding.source_title}
                    </a>
                  )}
                </span>
                {finding.evidence !== null && <span class="small">„{finding.evidence}“</span>}
              </div>
            ))}
          </section>
        </aside>
      </div>
    </div>
  );
}
