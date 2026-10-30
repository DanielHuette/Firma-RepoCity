// Customer service tickets: open, waiting for the customer, solved.
import { useState } from "preact/hooks";
import { listTickets, setTicketStatus } from "../api/crm";
import type { Ticket, TicketStatus } from "../api/types";
import { CustomerPicker } from "../components/CustomerPicker";
import { TicketBadge } from "../components/Status";
import { Empty, ErrorNote, Loading, PageHead, Tabs } from "../components/ui";
import { useAction, useAsync } from "../hooks/useAsync";
import { PRIORITY, dateTime } from "../lib/format";
import { TicketForm } from "./Kunde";

type View = "offen" | "geloest";

export function Service() {
  const tickets = useAsync(() => listTickets(), []);
  const [view, setView] = useState<View>("offen");
  const [adding, setAdding] = useState(false);
  const visible = (tickets.data ?? []).filter((ticket) => (view === "offen" ? ticket.status !== "solved" : ticket.status === "solved"));
  return (
    <div class="stack stack--loose">
      <PageHead kicker="Service" title="Kundenanliegen">
        {!adding && <button class="button button--gold" type="button" onClick={() => { setAdding(true); }}>+ Neues Ticket</button>}
      </PageHead>
      {adding && <NewTicket onDone={() => { setAdding(false); tickets.reload(); }} onCancel={() => { setAdding(false); }} />}
      <Tabs value={view} onChange={setView} options={[
        { id: "offen", label: "Offen", count: (tickets.data ?? []).filter((ticket) => ticket.status !== "solved").length },
        { id: "geloest", label: "Gelöst" },
      ]} />
      <ErrorNote message={tickets.error} />
      {tickets.data === undefined ? <Loading /> : visible.length === 0 ? <Empty>{view === "offen" ? "Keine offenen Anliegen." : "Noch nichts gelöst."}</Empty> : (
        <ul class="cards">{visible.map((ticket) => <TicketCard key={ticket.id} ticket={ticket} onChange={tickets.reload} />)}</ul>
      )}
    </div>
  );
}

function NewTicket({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [customer, setCustomer] = useState("");
  return (
    <div class="stack">
      <div class="panel"><CustomerPicker value={customer} onChange={setCustomer} label="Zu welchem Kunden? (optional)" /></div>
      <TicketForm customerId={customer === "" ? null : customer} onDone={onDone} onCancel={onCancel} />
    </div>
  );
}

function TicketCard({ ticket, onChange }: { ticket: Ticket; onChange: () => void }) {
  const action = useAction();
  const set = (status: TicketStatus) => { void action.run(async () => { await setTicketStatus(ticket.id, status); onChange(); }); };
  return (
    <li class={ticket.priority === "high" && ticket.status !== "solved" ? "panel panel--flat stack stack--tight is-late" : "panel panel--flat stack stack--tight"}>
      <div class="spread">
        <span><strong>{ticket.number}</strong> · {ticket.subject}{ticket.customer !== null && ticket.customer !== undefined && <> · <a href={`/kunde/${ticket.customer.id}`}>{ticket.customer.name}</a></>}</span>
        <span class="cluster"><span class="badge">{PRIORITY[ticket.priority]}</span><TicketBadge status={ticket.status} /></span>
      </div>
      {ticket.body !== "" && <p class="message">{ticket.body}</p>}
      <div class="spread">
        <span class="small muted">{dateTime(ticket.created_at)}</span>
        {ticket.status !== "solved" && (
          <span class="cluster">
            {ticket.status === "open" && <button class="button" type="button" disabled={action.busy} onClick={() => { set("waiting"); }}>Wartet auf Kunde</button>}
            {ticket.status === "waiting" && <button class="button" type="button" disabled={action.busy} onClick={() => { set("open"); }}>Wieder offen</button>}
            <button class="button button--gold" type="button" disabled={action.busy} onClick={() => { set("solved"); }}>Gelöst</button>
          </span>
        )}
      </div>
      <ErrorNote message={action.error} />
    </li>
  );
}
