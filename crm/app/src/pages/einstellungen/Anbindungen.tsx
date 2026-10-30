// How the CRM connects: the mailbox and the mails it sends, the mails the server worker reads, the form
// for websites, agents and the database address.
import { Fragment } from "preact";
import { useState } from "preact/hooks";
import { supabaseConfig } from "../../api/config";
import { listFailedMails, listMailSync, retryMail, runMailbox, type MailRun } from "../../api/crm";
import { listMailTriage } from "../../api/flow";
import type { MailSync, MailTriage } from "../../api/types";
import { Badge, Empty, ErrorNote, Loading } from "../../components/ui";
import { useAction, useAsync } from "../../hooks/useAsync";
import { TRIAGE_STATUS, dateTime } from "../../lib/format";

function formSnippet(url: string, anonKey: string): string {
  return `<form id="anfrage">
  <input name="name" placeholder="Name" required>
  <input name="email" type="email" placeholder="E-Mail" required>
  <input name="phone" placeholder="Telefon">
  <input name="company" placeholder="Firma">
  <textarea name="message" placeholder="Ihre Nachricht" required></textarea>
  <button>Absenden</button>
  <p id="anfrage-status" role="status"></p>
</form>
<script>
document.getElementById("anfrage").addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.target));
  const link = new URLSearchParams(location.search);
  const response = await fetch("${url}/rest/v1/rpc/submit_inquiry", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Content-Profile": "crm", apikey: "${anonKey}" },
    body: JSON.stringify({ p_name: data.name, p_email: data.email, p_phone: data.phone, p_company: data.company, p_message: data.message, p_source: location.hostname,
      p_utm_source: link.get("utm_source") ?? "", p_utm_medium: link.get("utm_medium") ?? "", p_utm_campaign: link.get("utm_campaign") ?? "" })
  });
  document.getElementById("anfrage-status").textContent = response.ok
    ? "Danke, wir melden uns."
    : "Das hat nicht geklappt. Bitte schreiben Sie uns eine E-Mail.";
  if (response.ok) event.target.reset();
});
</script>`;
}

export function Anbindungen() {
  const config = supabaseConfig();
  if (config === null) return null;
  return (
    <div class="stack">
      <Postfach />
      <Triage />
      <WebForm snippet={formSnippet(config.url, config.anonKey)} />
      <section class="panel stack">
        <h2>Agenten und Automatisierung</h2>
        <p class="muted">Agenten (zum Beispiel Marketing, Telefon-KI oder Buchhaltung) arbeiten über den geheimen Dienstschlüssel aus der Datei <code>.env</code> direkt mit der Datenbank. Er kommt nie in eine Webseite.</p>
        <ul class="plain-list">
          <li><strong>Kontakt aufnehmen (legt Kunden automatisch an):</strong> <code>crm.intake_contact</code> mit Kanal <code>email</code>, <code>phone</code>, <code>website</code> oder <code>agent</code></li>
          <li><strong>Ticket anlegen:</strong> <code>crm.create_ticket</code></li>
          <li><strong>Freigabe anfordern:</strong> Zeile in <code>crm.approvals</code> mit Art, Titel und Text. Sie erscheint unter Freigaben.</li>
          <li><strong>Tagesüberblick lesen:</strong> <code>crm.today_overview</code></li>
          <li><strong>Notiz am Kunden:</strong> Zeile in <code>crm.activities</code> mit <code>actor</code> als Name des Agenten.</li>
        </ul>
      </section>
      <section class="panel stack">
        <h2>Datenbank</h2>
        <dl class="contact-line"><dt>Adresse</dt><dd><code>{config.url}</code></dd><dt>Bereich</dt><dd><code>crm</code></dd></dl>
      </section>
    </div>
  );
}

function WebForm({ snippet }: { snippet: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => { void navigator.clipboard.writeText(snippet).then(() => { setCopied(true); }); };
  return (
    <section class="panel stack">
      <h2>Webseiten-Formular</h2>
      <p class="muted">Diesen Baustein in jede Webseite einfügen. Jede Anfrage landet als Kunde und neue Anfrage hier im CRM, mit Aufgabe für den nächsten Tag. Pro Absender sind fünf Anfragen am Tag möglich, das bremst Spam.</p>
      <pre class="code">{snippet}</pre>
      <div class="cluster"><button class="button" type="button" onClick={copy}>{copied ? "Kopiert" : "Code kopieren"}</button></div>
    </section>
  );
}

function runSummary(run: MailRun): string {
  return `${String(run.imported)} E-Mails übernommen, ${String(run.created)} neue Kunden, ${String(run.parked)} unbekannte Absender, ${String(run.sent)} versendet.`;
}

function Postfach() {
  const sync = useAsync(() => listMailSync(), []);
  const action = useAction();
  const [result, setResult] = useState<string | null>(null);
  const [round, setRound] = useState(0);
  const fetchNow = () => {
    setResult(null);
    void action.run(async () => {
      const run = await runMailbox();
      sync.reload();
      setRound(round + 1);
      if (run.errors.length > 0) throw new Error(run.errors[0]);
      setResult(runSummary(run));
    });
  };
  return (
    <section class="panel stack">
      <h2>Postfach</h2>
      <p class="muted">E-Mails von und an Kunden landen alle paar Minuten automatisch in der Kundenakte, Anhänge unter Dokumente. Neue Anfragen werden als Kunde angelegt, unklare Absender warten unter Freigaben. Angebote, Rechnungen und Mahnungen gehen von hier aus als E-Mail mit PDF hinaus.</p>
      <div class="cluster">
        <button class="button" type="button" disabled={action.busy} onClick={fetchNow}>{action.busy ? "Ruft ab …" : "Jetzt abrufen"}</button>
        {result !== null && <span class="small muted">{result}</span>}
      </div>
      <ErrorNote message={sync.error ?? action.error} />
      {sync.data !== undefined && <SyncState folders={sync.data} />}
      <FailedMails key={round} />
    </section>
  );
}

function SyncState({ folders }: { folders: MailSync[] }) {
  if (folders.length === 0) return <p class="small muted">Noch nicht verbunden.</p>;
  return (
    <dl class="contact-line">
      {folders.map((folder) => (
        <Fragment key={folder.folder}>
          <dt>{folder.folder}</dt>
          <dd>{folder.last_error !== "" ? <span class="late">{folder.last_error}</span> : folder.synced_at === null ? "–" : `zuletzt ${dateTime(folder.synced_at)}`}</dd>
        </Fragment>
      ))}
    </dl>
  );
}

function FailedMails() {
  const failed = useAsync(() => listFailedMails(), []);
  const action = useAction();
  const retry = (id: string) => { void action.run(async () => { await retryMail(id); failed.reload(); }); };
  if (failed.data === undefined || failed.data.length === 0) return <ErrorNote message={failed.error} />;
  return (
    <div class="stack stack--tight">
      <h3>Nicht versendet</h3>
      <ErrorNote message={action.error} />
      {failed.data.map((mail) => (
        <div key={mail.id} class="row">
          <span>{mail.subject} · an {mail.to_address}<span class="small late"> · {mail.error}</span></span>
          <button class="button" type="button" disabled={action.busy} onClick={() => { retry(mail.id); }}>Erneut senden</button>
        </div>
      ))}
    </div>
  );
}

function TriageRow({ row }: { row: MailTriage }) {
  return (
    <li class="row">
      <span>
        {row.subject === "" ? "(ohne Betreff)" : row.subject} · {row.name === "" ? row.address : `${row.name} <${row.address}>`}
        <span class="small muted"> · {dateTime(row.created_at)}{row.attempts > 0 && ` · ${String(row.attempts)}. Versuch`}</span>
        {row.status === "failed" && row.error !== null && row.error !== "" && <span class="small late"> · {row.error}</span>}
      </span>
      <Badge tone={row.status === "failed" ? "bad" : "gold"}>{TRIAGE_STATUS[row.status]}</Badge>
    </li>
  );
}

// Incoming mails wait here until the server worker has read them with Claude Code; nothing to do while it runs.
function Triage() {
  const triage = useAsync(() => listMailTriage(), []);
  return (
    <section class="panel stack" aria-labelledby="triage-head">
      <h2 id="triage-head">Mails, die der Server noch liest</h2>
      <p class="muted">Der Server liest Antworten von Kunden und Mails unbekannter Absender und ordnet sie ein. Liegen hier Mails länger als eine Stunde, läuft der Server vermutlich nicht.</p>
      <ErrorNote message={triage.error} />
      {triage.data === undefined ? <Loading /> : triage.data.length === 0 ? <Empty>Nichts wartet. Alles ist gelesen.</Empty> : (
        <ul class="cards">{triage.data.map((row) => <TriageRow key={row.id} row={row} />)}</ul>
      )}
    </section>
  );
}
