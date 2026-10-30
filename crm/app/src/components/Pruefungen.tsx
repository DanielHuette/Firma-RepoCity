// What the RadarAuditor did for one customer: its audits with reports, the monthly audit runs of the
// subscriptions, and whether the customer was asked for a Google review.
import { listAuditRuns, listCustomerAudits, listReviewRequests, markReviewDone, reportLink, startAuditRun } from "../api/flow";
import type { Audit, AuditRun, AuditRunStatus, AuditStatus, ReviewRequest, ReviewStatus } from "../api/types";
import { useAction, useAsync } from "../hooks/useAsync";
import { AUDIT_PURPOSE, AUDIT_RUN_STATUS, AUDIT_STATUS, REVIEW_STATUS, date, dateTime, monthName } from "../lib/format";
import { auditScore, canMarkReviewDone, canStartAuditRun } from "../lib/states";
import { SignedLink } from "./SignedLink";
import { Badge, Empty, ErrorNote, Loading, type Tone } from "./ui";

const RUN_TONE: Record<AuditRunStatus, Tone> = { due: "gold", started: "", reported: "good", failed: "bad" };
const REVIEW_TONE: Record<ReviewStatus, Tone> = { waiting_link: "gold", due: "", sent: "", reminded: "", done: "good", cancelled: "ink" };

function auditTone(status: AuditStatus): Tone {
  return status === "reported" ? "good" : status === "failed" ? "bad" : "";
}

export function Pruefungen({ customerId }: { customerId: string }) {
  return (
    <div class="stack stack--loose">
      <Monatspruefungen customerId={customerId} />
      <Audits customerId={customerId} />
      <Bewertungen customerId={customerId} />
    </div>
  );
}

function RunRow({ run, busy, onStart }: { run: AuditRun; busy: boolean; onStart: () => void }) {
  return (
    <li class="row">
      <span>{monthName(run.month)}<span class="small muted"> · Punkte {auditScore(run.score_before, run.score_after)}{run.finished_at !== null && ` · fertig ${dateTime(run.finished_at)}`}</span></span>
      <span class="cluster">
        <Badge tone={RUN_TONE[run.status]}>{AUDIT_RUN_STATUS[run.status]}</Badge>
        {canStartAuditRun(run.status) && <button class="button button--gold" type="button" disabled={busy} onClick={onStart}>Prüfung jetzt starten</button>}
      </span>
    </li>
  );
}

function Monatspruefungen({ customerId }: { customerId: string }) {
  const runs = useAsync(() => listAuditRuns(customerId), [customerId]);
  const action = useAction();
  const start = (id: string) => { void action.run(async () => { await startAuditRun(id); runs.reload(); }); };
  return (
    <section class="panel stack" aria-labelledby="runs-head">
      <h2 id="runs-head">Monatsprüfungen</h2>
      <p class="muted small">Jedes Abo mit Prüfung wird einmal im Monat fällig. Gestartet wird die Prüfung hier oder mit einem Tipp auf die Benachrichtigung.</p>
      <ErrorNote message={runs.error ?? action.error} />
      {runs.data === undefined ? <Loading /> : runs.data.length === 0 ? <Empty>Noch keine Monatsprüfung fällig gewesen.</Empty> : (
        <ul class="cards">{runs.data.map((run) => <RunRow key={run.id} run={run} busy={action.busy} onStart={() => { start(run.id); }} />)}</ul>
      )}
    </section>
  );
}

function AuditRow({ audit }: { audit: Audit }) {
  return (
    <tr>
      <td>{dateTime(audit.requested_at)}</td>
      <td>{AUDIT_PURPOSE[audit.purpose]}</td>
      <td><Badge tone={auditTone(audit.status)}>{AUDIT_STATUS[audit.status]}</Badge></td>
      <td class="num">{auditScore(null, audit.total_score)}</td>
      <td>{audit.report_path === null ? "–" : <SignedLink label="Bericht öffnen" sign={() => reportLink(audit.report_path ?? "")} />}</td>
    </tr>
  );
}

function Audits({ customerId }: { customerId: string }) {
  const audits = useAsync(() => listCustomerAudits(customerId), [customerId]);
  return (
    <section class="panel stack" aria-labelledby="audits-head">
      <h2 id="audits-head">Prüfungen im RadarAuditor</h2>
      <ErrorNote message={audits.error} />
      {audits.data === undefined ? <Loading /> : audits.data.length === 0 ? <Empty>Dieser Kunde wurde noch nicht geprüft.</Empty> : (
        <div class="table-wrap">
          <table class="table table--rows">
            <thead><tr><th>Angefordert</th><th>Art</th><th>Stand</th><th class="num">Punkte</th><th>Bericht</th></tr></thead>
            <tbody>{audits.data.map((audit) => <AuditRow key={audit.id} audit={audit} />)}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function reviewDetail(request: ReviewRequest): string {
  const parts = [`angelegt ${date(request.created_at)}`];
  if (request.sent_at !== null) parts.push(`verschickt ${date(request.sent_at)}`);
  if (request.reminded_at !== null) parts.push(`erinnert ${date(request.reminded_at)}`);
  else if (request.reminder_due !== null && request.status === "sent") parts.push(`Erinnerung am ${date(request.reminder_due)}`);
  return parts.join(" · ");
}

function Bewertungen({ customerId }: { customerId: string }) {
  const requests = useAsync(() => listReviewRequests(customerId), [customerId]);
  const action = useAction();
  const done = (id: string) => { void action.run(async () => { await markReviewDone(id); requests.reload(); }); };
  return (
    <section class="panel stack" aria-labelledby="reviews-head">
      <h2 id="reviews-head">Google-Bewertung</h2>
      <ErrorNote message={requests.error ?? action.error} />
      {requests.data === undefined ? <Loading /> : requests.data.length === 0 ? <Empty>Noch keine Bitte um Bewertung.</Empty> : (
        <ul class="cards">
          {requests.data.map((request) => (
            <li key={request.id} class="row">
              <span>{reviewDetail(request)}</span>
              <span class="cluster">
                <Badge tone={REVIEW_TONE[request.status]}>{REVIEW_STATUS[request.status]}</Badge>
                {canMarkReviewDone(request.status) && <button class="button" type="button" disabled={action.busy} onClick={() => { done(request.id); }}>Bewertung ist da</button>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
