// Sales in four steps: inquiries, deals, quotes, orders. Each row carries the button for its next step.
import { useLocation } from "preact-iso";
import { useState } from "preact/hooks";
import {
  DEAL_FLOW, createInquiry, createQuote, dealFromInquiry, invoiceFromOrder, listDeals, listInquiries, listOrders, listQuotes, setInquiryStatus,
  setOrderStatus, updateDeal,
} from "../api/crm";
import type { Deal, DealStage, Inquiry, Order, Quote } from "../api/types";
import { CompleteOrder } from "../components/CompleteOrder";
import { CustomerPicker } from "../components/CustomerPicker";
import { DealBadge, InquiryBadge, OrderBadge, QuoteBadge } from "../components/Status";
import { Empty, ErrorNote, Field, Loading, PageHead, Tabs } from "../components/ui";
import { useAction, useAsync } from "../hooks/useAsync";
import { DEAL_STAGE, channelLabel, date, daysUntil, euro, today } from "../lib/format";

type Tab = "anfragen" | "chancen" | "angebote" | "auftraege";
const TABS: Tab[] = ["anfragen", "chancen", "angebote", "auftraege"];

export function Verkauf() {
  const { query, route } = useLocation();
  const initial = TABS.includes(query.tab as Tab) ? (query.tab as Tab) : "anfragen";
  const [tab, setTab] = useState<Tab>(initial);
  const change = (next: Tab) => { setTab(next); route(`/verkauf?tab=${next}`, true); };
  return (
    <div class="stack stack--loose">
      <PageHead kicker="Verkauf" title="Von der Anfrage zum Auftrag" />
      <ol class="flow" aria-label="Ablauf">
        <li>Anfrage</li><li>Verkaufschance</li><li>Angebot</li><li>Auftrag</li><li>Rechnung</li>
      </ol>
      <Tabs value={tab} onChange={change} options={[
        { id: "anfragen", label: "Anfragen" },
        { id: "chancen", label: "Verkaufschancen" },
        { id: "angebote", label: "Angebote" },
        { id: "auftraege", label: "Aufträge" },
      ]} />
      {tab === "anfragen" && <Anfragen />}
      {tab === "chancen" && <Chancen />}
      {tab === "angebote" && <Angebote />}
      {tab === "auftraege" && <Auftraege />}
    </div>
  );
}

function Anfragen() {
  const inquiries = useAsync(() => listInquiries(), []);
  const [adding, setAdding] = useState(false);
  return (
    <section class="stack">
      <div class="spread">
        <p class="muted">Anfragen über das Kontaktformular landen hier von selbst. Telefonische trägst du selbst ein.</p>
        {!adding && <button class="button" type="button" onClick={() => { setAdding(true); }}>+ Anfrage erfassen</button>}
      </div>
      {adding && <InquiryForm onDone={() => { setAdding(false); inquiries.reload(); }} onCancel={() => { setAdding(false); }} />}
      <ErrorNote message={inquiries.error} />
      {inquiries.data === undefined ? <Loading /> : inquiries.data.length === 0 ? <Empty>Keine Anfragen.</Empty> : (
        <ul class="cards">{inquiries.data.map((inquiry) => <InquiryCard key={inquiry.id} inquiry={inquiry} onChange={inquiries.reload} />)}</ul>
      )}
    </section>
  );
}

function InquiryCard({ inquiry, onChange }: { inquiry: Inquiry; onChange: () => void }) {
  const action = useAction();
  const { route } = useLocation();
  const toDeal = () => { void action.run(async () => { await dealFromInquiry(inquiry.id); route("/verkauf?tab=chancen"); }); };
  const setStatus = (status: "done" | "rejected") => { void action.run(async () => { await setInquiryStatus(inquiry.id, status); onChange(); }); };
  return (
    <li class="panel panel--flat stack stack--tight">
      <div class="spread">
        <span><a href={`/kunde/${inquiry.customer_id}`}><strong>{inquiry.customer?.name}</strong></a> · <span class="small muted">{date(inquiry.created_at)} · {inquiry.subject} · Kanal: {channelLabel(inquiry.source_channel)}{inquiry.campaign === "" ? "" : ` (${inquiry.campaign})`}</span></span>
        <InquiryBadge status={inquiry.status} />
      </div>
      {inquiry.message !== "" && <p class="message">{inquiry.message}</p>}
      {inquiry.status === "new" && (
        <div class="cluster">
          <button class="button button--gold" type="button" disabled={action.busy} onClick={toDeal}>Verkaufschance daraus machen</button>
          <button class="button" type="button" disabled={action.busy} onClick={() => { setStatus("done"); }}>Erledigt</button>
          <button class="button button--quiet" type="button" disabled={action.busy} onClick={() => { setStatus("rejected"); }}>Ablehnen</button>
        </div>
      )}
      <ErrorNote message={action.error} />
    </li>
  );
}

function InquiryForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [customer, setCustomer] = useState("");
  const [channel, setChannel] = useState("phone");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const action = useAction();
  const submit = (event: Event) => {
    event.preventDefault();
    if (customer === "") return;
    void action.run(async () => { await createInquiry(customer, channel, subject, message); onDone(); });
  };
  return (
    <form class="panel stack" onSubmit={submit}>
      <h2>Anfrage erfassen</h2>
      <CustomerPicker value={customer} onChange={setCustomer} />
      <div class="form-grid">
        <Field label="Wie kam sie rein?">
          <select class="select" value={channel} onChange={(event) => { setChannel(event.currentTarget.value); }}>
            <option value="phone">Telefon</option><option value="email">E-Mail</option><option value="referral">Empfehlung</option><option value="other">Sonstiges</option>
          </select>
        </Field>
        <Field label="Betreff"><input value={subject} onInput={(event) => { setSubject(event.currentTarget.value); }} /></Field>
      </div>
      <Field label="Was möchte der Kunde?" wide><textarea class="textarea--short" value={message} onInput={(event) => { setMessage(event.currentTarget.value); }} /></Field>
      <ErrorNote message={action.error} />
      <div class="cluster"><button class="button button--gold" type="submit" disabled={action.busy || customer === ""}>Speichern</button><button class="button" type="button" onClick={onCancel}>Abbrechen</button></div>
    </form>
  );
}

const NEXT_STEP: Partial<Record<DealStage, string>> = {
  new: "Erstgespräch vereinbaren",
  meeting: "Angebot erstellen",
  quote: "Angebot nachfassen",
};

function Chancen() {
  const deals = useAsync(() => listDeals(), []);
  const [showClosed, setShowClosed] = useState(false);
  const visible = (deals.data ?? []).filter((deal) => showClosed || (deal.stage !== "won" && deal.stage !== "lost"));
  return (
    <section class="stack">
      <div class="spread">
        <p class="muted">Jede Verkaufschance hat genau einen nächsten Schritt. Oben steht, was zuerst fällig ist.</p>
        <label class="check"><input type="checkbox" checked={showClosed} onChange={(event) => { setShowClosed(event.currentTarget.checked); }} /><span>Abgeschlossene zeigen</span></label>
      </div>
      <ErrorNote message={deals.error} />
      {deals.data === undefined ? <Loading /> : visible.length === 0 ? <Empty>Keine offenen Verkaufschancen.</Empty> : (
        <ul class="cards">{visible.map((deal) => <DealCard key={deal.id} deal={deal} onChange={deals.reload} />)}</ul>
      )}
    </section>
  );
}

function useDealActions(deal: Deal, onChange: () => void) {
  const action = useAction();
  const { route } = useLocation();
  const next = DEAL_FLOW[DEAL_FLOW.indexOf(deal.stage) + 1];
  const advance = () => {
    if (next === undefined) return;
    void action.run(async () => { await updateDeal(deal.id, { stage: next, next_step: NEXT_STEP[next] ?? "", next_step_due: next === "won" ? null : today(3) }); onChange(); });
  };
  const lose = () => { void action.run(async () => { await updateDeal(deal.id, { stage: "lost", next_step: "", next_step_due: null }); onChange(); }); };
  const quote = () => { void action.run(async () => { const created = await createQuote(deal.customer_id, deal.id); route(`/angebot/${created.id}`); }); };
  return { action, next, advance, lose, quote };
}

function DealCard({ deal, onChange }: { deal: Deal; onChange: () => void }) {
  const { action, next, advance, lose, quote } = useDealActions(deal, onChange);
  const late = deal.next_step_due !== null && daysUntil(deal.next_step_due) < 0;
  return (
    <li class={late ? "panel panel--flat stack stack--tight is-late" : "panel panel--flat stack stack--tight"}>
      <div class="spread">
        <span><strong>{deal.title}</strong> · <a href={`/kunde/${deal.customer_id}`}>{deal.customer?.name}</a> · <span class="num">{euro(deal.value_net)}</span></span>
        <DealBadge stage={deal.stage} />
      </div>
      {deal.next_step !== "" && (
        <p class="small">Nächster Schritt: <strong>{deal.next_step}</strong>{deal.next_step_due !== null && <span class={late ? "late" : "muted"}> · bis {date(deal.next_step_due)}</span>}</p>
      )}
      {deal.stage !== "won" && deal.stage !== "lost" && (
        <div class="cluster">
          {(deal.stage === "meeting" || deal.stage === "new") && <button class="button button--gold" type="button" disabled={action.busy} onClick={quote}>Angebot erstellen</button>}
          {next !== undefined && <button class="button" type="button" disabled={action.busy} onClick={advance}>Weiter: {DEAL_STAGE[next]}</button>}
          <button class="button button--quiet" type="button" disabled={action.busy} onClick={lose}>Verloren</button>
        </div>
      )}
      <ErrorNote message={action.error} />
    </li>
  );
}

function Angebote() {
  const quotes = useAsync(() => listQuotes(), []);
  const [adding, setAdding] = useState(false);
  return (
    <section class="stack">
      <div class="spread">
        <p class="muted">Ein angenommenes Angebot wird mit einem Klick zum Auftrag.</p>
        {!adding && <button class="button" type="button" onClick={() => { setAdding(true); }}>+ Neues Angebot</button>}
      </div>
      {adding && <NewQuote onCancel={() => { setAdding(false); }} />}
      <ErrorNote message={quotes.error} />
      {quotes.data === undefined ? <Loading /> : quotes.data.length === 0 ? <Empty>Noch keine Angebote.</Empty> : <QuoteTable quotes={quotes.data} />}
    </section>
  );
}

function NewQuote({ onCancel }: { onCancel: () => void }) {
  const [customer, setCustomer] = useState("");
  const action = useAction();
  const { route } = useLocation();
  const create = () => { void action.run(async () => { const quote = await createQuote(customer, null); route(`/angebot/${quote.id}`); }); };
  return (
    <div class="panel stack">
      <CustomerPicker value={customer} onChange={setCustomer} label="Für welchen Kunden?" />
      <ErrorNote message={action.error} />
      <div class="cluster"><button class="button button--gold" type="button" disabled={customer === "" || action.busy} onClick={create}>Angebot anlegen</button><button class="button" type="button" onClick={onCancel}>Abbrechen</button></div>
    </div>
  );
}

function QuoteTable({ quotes }: { quotes: Quote[] }) {
  const { route } = useLocation();
  return (
    <div class="table-wrap panel panel--flat">
      <table class="table table--rows">
        <thead><tr><th>Nummer</th><th>Kunde</th><th>Datum</th><th>Gültig bis</th><th class="num">Betrag</th><th>Status</th></tr></thead>
        <tbody>
          {quotes.map((quote) => (
            <tr key={quote.id} onClick={() => { route(`/angebot/${quote.id}`); }}>
              <td data-label="Nummer"><a href={`/angebot/${quote.id}`}>{quote.number}</a></td>
              <td data-label="Kunde">{quote.customer?.name}</td>
              <td data-label="Datum">{date(quote.issue_date)}</td>
              <td data-label="Gültig bis" class={quote.status === "sent" && daysUntil(quote.valid_until) <= 7 ? "late" : ""}>{date(quote.valid_until)}</td>
              <td data-label="Betrag" class="num">{euro(quote.gross)}</td>
              <td data-label="Status"><QuoteBadge status={quote.status} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Auftraege() {
  const orders = useAsync(() => listOrders(), []);
  const [note, setNote] = useState<string | null>(null);
  return (
    <section class="stack">
      <p class="muted">„Auftrag abschließen“ schreibt die Rechnung über die einmaligen Positionen fest, schickt sie an den Kunden und bittet ihn um eine Bewertung. Monatliche Positionen laufen als Abo.</p>
      {note !== null && <p class="note note--gold">{note}</p>}
      <ErrorNote message={orders.error} />
      {orders.data === undefined ? <Loading /> : orders.data.length === 0 ? <Empty>Noch keine Aufträge.</Empty> : (
        <ul class="cards">{orders.data.map((order) => <OrderCard key={order.id} order={order} onNote={setNote} onChange={orders.reload} />)}</ul>
      )}
    </section>
  );
}

function OrderCard({ order, onNote, onChange }: { order: Order; onNote: (note: string) => void; onChange: () => void }) {
  const action = useAction();
  const { route } = useLocation();
  const start = () => { void action.run(async () => { await setOrderStatus(order.id, "in_progress"); onChange(); }); };
  const invoice = () => {
    void action.run(async () => {
      const created = await invoiceFromOrder(order.id);
      if (created !== null) { route(`/rechnung/${created.id}`); return; }
      onNote("Hier gibt es nichts einmalig abzurechnen. Die monatlichen Leistungen rechnet das Abo jeden Monat selbst ab.");
      onChange();
    });
  };
  return (
    <li class="panel panel--flat spread">
      <span><strong>{order.number}</strong> · {order.title} · <a href={`/kunde/${order.customer_id}`}>{order.customer?.name}</a>{order.due_date !== null && <span class="small muted"> · bis {date(order.due_date)}</span>}</span>
      <span class="cluster">
        <OrderBadge status={order.status} />
        {order.status === "open" && <button class="button" type="button" disabled={action.busy} onClick={start}>Beginnen</button>}
        <CompleteOrder order={order} onDone={onChange} />
        {order.status === "done" && <button class="button" type="button" disabled={action.busy} onClick={invoice}>Rechnung schreiben</button>}
      </span>
      <ErrorNote message={action.error} />
    </li>
  );
}
