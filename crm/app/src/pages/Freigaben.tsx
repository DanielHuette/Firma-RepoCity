// The approval centre: nothing that touches money, customers or the public goes out without Daniel's yes.
// Agents and the dunning check file requests here; deciding them is the only thing left to do.
import { useLocation } from "preact-iso";
import { useState } from "preact/hooks";
import { decideApproval, decideMailReview, listApprovals, listMailReview } from "../api/crm";
import type { Approval, MailReview } from "../api/types";
import { Empty, ErrorNote, Loading, PageHead, Tabs } from "../components/ui";
import { useAction, useAsync, type AsyncState } from "../hooks/useAsync";
import { APPROVAL_KIND, dateTime } from "../lib/format";

type View = "offen" | "absender" | "entschieden";

export function Freigaben({ onChange }: { onChange: () => void }) {
  const { query } = useLocation();
  const [view, setView] = useState<View>(query.ansicht === "absender" ? "absender" : "offen");
  const approvals = useAsync(() => listApprovals(view !== "entschieden"), [view]);
  const reviews = useAsync(() => listMailReview(), [view]);
  return (
    <div class="stack stack--loose">
      <PageHead kicker="Freigaben" title="Wartet auf dein Ja" />
      <p class="muted">Mahnungen, Veröffentlichungen deiner Agenten und alles, was Geld oder Kunden betrifft, landet hier. Erst nach deiner Freigabe geht es weiter.</p>
      <Tabs value={view} onChange={setView} options={[
        { id: "offen", label: "Offen", count: approvals.data?.filter((approval) => approval.status === "pending").length },
        { id: "absender", label: "Unbekannte Absender", count: reviews.data?.filter((review) => review.verdict !== "automated").length },
        { id: "entschieden", label: "Entschieden" },
      ]} />
      {view === "absender"
        ? <Absender reviews={reviews.data} error={reviews.error} onChange={() => { reviews.reload(); onChange(); }} />
        : <Approvals approvals={approvals} pendingView={view === "offen"} onChange={onChange} />}
    </div>
  );
}

function Approvals({ approvals, pendingView, onChange }: { approvals: AsyncState<Approval[]>; pendingView: boolean; onChange: () => void }) {
  const action = useAction();
  const decide = (approval: Approval, approve: boolean) => {
    void action.run(async () => { await decideApproval(approval.id, approve); approvals.reload(); onChange(); });
  };
  const visible = (approvals.data ?? []).filter((approval) => pendingView || approval.status !== "pending");
  if (approvals.error !== null) return <ErrorNote message={approvals.error} />;
  if (approvals.data === undefined) return <Loading />;
  if (visible.length === 0) return <Empty>{pendingView ? "Nichts wartet auf dich." : "Noch nichts entschieden."}</Empty>;
  return (
    <>
      <ErrorNote message={action.error} />
      <ul class="cards">
        {visible.map((approval) => <ApprovalCard key={approval.id} approval={approval} busy={action.busy} onDecide={(approve) => { decide(approval, approve); }} />)}
      </ul>
    </>
  );
}

function approveLabel(approval: Approval): string {
  if (approval.kind === "dunning") return "Mahnung senden";
  if (approval.kind === "contract") return "Freigeben und senden";
  if (approval.kind === "reversal") return "Verrechnen";
  if (approval.kind === "follow_up" || approval.kind === "assistant_mail") return "Senden";
  return "Freigeben";
}

function rejectLabel(approval: Approval): string {
  if (approval.kind === "dunning" || approval.kind === "follow_up" || approval.kind === "assistant_mail") return "Nicht senden";
  if (approval.kind === "reversal") return "Nicht verrechnen";
  return "Nein";
}

function ApprovalCard({ approval, busy, onDecide }: { approval: Approval; busy: boolean; onDecide: (approve: boolean) => void }) {
  const contractId = approval.kind === "contract" && typeof approval.payload.contract_id === "string" ? approval.payload.contract_id : null;
  return (
    <li class="panel stack stack--tight">
      <div class="spread">
        <span><span class="badge badge--gold">{APPROVAL_KIND[approval.kind]}</span> <strong>{approval.title}</strong></span>
        <span class="small muted">{approval.requested_by} · {dateTime(approval.created_at)}</span>
      </div>
      {approval.customer !== null && approval.customer !== undefined && <span>Kunde: <a href={`/kunde/${approval.customer.id}`}>{approval.customer.name}</a></span>}
      {approval.body !== "" && <p class="message">{approval.body}</p>}
      {approval.kind === "dunning" && approval.status === "pending" && <p class="small muted">Mit deinem Ja geht die Mahnung samt PDF sofort per E-Mail an den Kunden.</p>}
      {approval.kind === "assistant_mail" && typeof approval.payload.subject === "string" && <span>Betreff: <strong>{approval.payload.subject}</strong></span>}
      {approval.kind === "assistant_mail" && approval.status === "pending" && <p class="small muted">Claude Code hat diese Mail entworfen. Mit „Senden“ geht genau der Text oben an den Kunden; lies ihn vorher ganz.</p>}
      {approval.kind === "follow_up" && approval.status === "pending" && <p class="small muted">Mit „Senden“ geht die Nachfass-Mail sofort an den Kunden, mit einem Link zum Abbestellen. „Nicht senden“ lässt diese Erinnerung aus.</p>}
      {contractId !== null && <a class="button button--quiet" href={`/druck/vertrag/${contractId}`} target="_blank" rel="noopener">Vertrag ansehen</a>}
      {approval.status === "pending" ? (
        <div class="cluster">
          <button class="button button--gold" type="button" disabled={busy} onClick={() => { onDecide(true); }}>{approveLabel(approval)}</button>
          <button class="button" type="button" disabled={busy} onClick={() => { onDecide(false); }}>{rejectLabel(approval)}</button>
        </div>
      ) : <span class={approval.status === "approved" ? "badge badge--good" : "badge badge--bad"}>{approval.status === "approved" ? "Freigegeben" : "Abgelehnt"}</span>}
    </li>
  );
}

const VERDICT: Record<MailReview["verdict"], string> = {
  unsure: "KI ist unsicher", not_customer: "KI hält es für keinen Kunden", automated: "Automatische Mail",
};

function ReviewCard({ review, busy, onDecide }: { review: MailReview; busy: boolean; onDecide: (isCustomer: boolean) => void }) {
  return (
    <li class="panel panel--flat stack stack--tight">
      <div class="spread">
        <span><strong>{review.name === "" ? review.address : review.name}</strong>{review.name !== "" && <span class="small muted"> · {review.address}</span>}</span>
        <span class="small muted">{review.direction === "in" ? "hat dir geschrieben" : "du hast geschrieben"} · {dateTime(review.sent_at)}{review.mail_count > 1 && ` · ${String(review.mail_count)} Mails`}</span>
      </div>
      <span><span class="badge">{VERDICT[review.verdict]}</span> <span class="small muted">{review.reason}</span></span>
      {review.subject !== "" && <strong>{review.subject}</strong>}
      {review.snippet !== "" && <p class="message">{review.snippet}</p>}
      <div class="cluster">
        <button class="button button--gold" type="button" disabled={busy} onClick={() => { onDecide(true); }}>Als Kunde anlegen</button>
        <button class="button" type="button" disabled={busy} onClick={() => { onDecide(false); }}>Kein Kunde</button>
      </div>
    </li>
  );
}

// Unknown senders: the model only pre-sorts, Daniel decides. Automatic mails sit folded at the end.
function Absender({ reviews, error, onChange }: { reviews: MailReview[] | undefined; error: string | null; onChange: () => void }) {
  const action = useAction();
  if (error !== null) return <ErrorNote message={error} />;
  if (reviews === undefined) return <Loading />;
  const card = (review: MailReview) => (
    <ReviewCard key={review.id} review={review} busy={action.busy}
      onDecide={(isCustomer) => { void action.run(async () => { await decideMailReview(review.id, isCustomer); onChange(); }); }} />
  );
  const people = reviews.filter((review) => review.verdict !== "automated");
  const automated = reviews.filter((review) => review.verdict === "automated");
  return (
    <div class="stack">
      <p class="muted">Absender, die nicht eindeutig als Anfrage erkannt wurden. Nichts davon wird ohne deine Entscheidung verworfen.</p>
      <ErrorNote message={action.error} />
      {people.length === 0 ? <Empty>Keine offenen Absender.</Empty> : <ul class="cards">{people.map(card)}</ul>}
      {automated.length > 0 && (
        <details class="more">
          <summary>{automated.length} automatische Mails (Newsletter, Benachrichtigungen)</summary>
          <ul class="cards">{automated.map(card)}</ul>
        </details>
      )}
    </div>
  );
}
