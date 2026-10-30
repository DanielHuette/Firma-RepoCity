// One customer: everything that belongs to them, and the next steps as buttons.
import type { ComponentChildren } from "preact";
import { useLocation } from "preact-iso";
import { useState } from "preact/hooks";
import {
  addActivity, createDeal, createInvoice, createQuote, createTicket, dismissCustomer, loadCustomer, loadCustomerFile, updateCustomer, type CustomerFile,
} from "../api/crm";
import type { ActivityKind, AuditRequest, Customer, Priority } from "../api/types";
import { CompleteOrder } from "../components/CompleteOrder";
import { CustomerForm } from "../components/CustomerForm";
import { Dokumente, Ueberblick, Verlauf } from "../components/Kundenakte";
import { Pruefungen } from "../components/Pruefungen";
import { DealBadge, InquiryBadge, InvoiceBadge, OrderBadge, QuoteBadge, TicketBadge } from "../components/Status";
import { Badge, Empty, ErrorNote, Field, Loading, PageHead, Tabs } from "../components/ui";
import { useAction, useAsync } from "../hooks/useAsync";
import { ACTIVITY_KIND, APPOINTMENT_KIND, AUDIT_REQUEST_STATUS, PRIORITY, channelLabel, date, dateTime, euro } from "../lib/format";
import { parseAmount } from "../lib/money";

type Tab = "ueberblick" | "verlauf" | "vorgaenge" | "pruefungen" | "dokumente" | "stammdaten";
type Panel = "none" | "deal" | "ticket";

const TABS: { id: Tab; label: string }[] = [
  { id: "ueberblick", label: "Überblick" },
  { id: "verlauf", label: "Verlauf" },
  { id: "vorgaenge", label: "Angebote & Rechnungen" },
  { id: "pruefungen", label: "Prüfungen" },
  { id: "dokumente", label: "Dokumente" },
  { id: "stammdaten", label: "Stammdaten" },
];

export function Kunde({ id }: { id: string }) {
  const customer = useAsync(() => loadCustomer(id), [id]);
  if (customer.error !== null) return <ErrorNote message={customer.error} />;
  if (customer.data === undefined) return <Loading />;
  return <CustomerView customer={customer.data} reload={customer.reload} />;
}

function CustomerView({ customer, reload }: { customer: Customer; reload: () => void }) {
  const file = useAsync(() => loadCustomerFile(customer.id), [customer.id]);
  const [tab, setTab] = useState<Tab>("ueberblick");
  const [panel, setPanel] = useState<Panel>("none");
  const refresh = () => { setPanel("none"); file.reload(); };
  const close = () => { setPanel("none"); };
  return (
    <div class="stack stack--loose">
      <CustomerHead customer={customer} onPanel={setPanel} />
      {panel === "deal" && <DealForm customerId={customer.id} onDone={refresh} onCancel={close} />}
      {panel === "ticket" && <TicketForm customerId={customer.id} onDone={refresh} onCancel={close} />}
      <Tabs value={tab} onChange={setTab} options={TABS} />
      {tab === "ueberblick" && <Ueberblick customerId={customer.id} />}
      {tab === "pruefungen" && <Pruefungen customerId={customer.id} />}
      {tab === "dokumente" && <Dokumente customerId={customer.id} />}
      {tab === "stammdaten" && <Stammdaten customer={customer} reload={reload} />}
      {(tab === "verlauf" || tab === "vorgaenge") && (file.error !== null ? <ErrorNote message={file.error} /> : file.data === undefined ? <Loading /> : tab === "verlauf" ? (
        <Verlauf customerId={customer.id} activities={file.data.activities}>
          <NoteForm customerId={customer.id} onDone={file.reload} />
        </Verlauf>
      ) : <Vorgaenge file={file.data} onChange={file.reload} />)}
    </div>
  );
}

function CustomerHead({ customer, onPanel }: { customer: Customer; onPanel: (panel: Panel) => void }) {
  const action = useAction();
  const { route } = useLocation();
  const newQuote = () => { void action.run(async () => { const quote = await createQuote(customer.id, null); route(`/angebot/${quote.id}`); }); };
  const newInvoice = () => { void action.run(async () => { const invoice = await createInvoice(customer.id); route(`/rechnung/${invoice.id}`); }); };
  return (
    <>
      <PageHead kicker={customer.kind === "company" ? "Firma" : "Privatperson"} title={customer.name}>
        <button class="button button--gold" type="button" onClick={newQuote} disabled={action.busy}>Angebot erstellen</button>
        <button class="button" type="button" onClick={() => { onPanel("deal"); }}>Verkaufschance</button>
        <button class="button" type="button" onClick={newInvoice} disabled={action.busy}>Rechnung</button>
        <button class="button" type="button" onClick={() => { onPanel("ticket"); }}>Service-Ticket</button>
      </PageHead>
      <ContactLine customer={customer} />
      <ErrorNote message={action.error} />
    </>
  );
}

function ContactLine({ customer }: { customer: Customer }) {
  return (
    <div class="cluster contact-line">
      {customer.contact_person !== "" && <span>{customer.contact_person}</span>}
      {customer.email !== null && customer.email !== "" && <a href={`mailto:${customer.email}`}>{customer.email}</a>}
      {customer.phone !== "" && <a href={`tel:${customer.phone.replace(/\s/g, "")}`}>{customer.phone}</a>}
      {customer.city !== "" && <span class="muted">{[customer.street, `${customer.postal_code} ${customer.city}`.trim()].filter(Boolean).join(", ")}</span>}
      <span class="contact-line__wide cluster">
        <span class="muted">Kanal: {channelLabel(customer.channel)}{customer.campaign === "" ? "" : `, Kampagne ${customer.campaign}`}</span>
        {customer.no_follow_ups && <span class="badge badge--bad">Keine Erinnerungen</span>}
      </span>
    </div>
  );
}

function Stammdaten({ customer, reload }: { customer: Customer; reload: () => void }) {
  const action = useAction();
  return (
    <section class="panel stack">
      <CustomerForm initial={customer} submitLabel="Speichern" busy={action.busy} error={action.error}
        onSubmit={(draft) => { void action.run(async () => { await updateCustomer(customer.id, draft); reload(); }); }} />
      <Remove customerId={customer.id} />
    </section>
  );
}

function FileList<T>({ title, items, render }: { title: string; items: T[]; render: (item: T) => ComponentChildren }) {
  return (
    <section class="panel stack stack--tight">
      <h3>{title}</h3>
      {items.length === 0 ? <Empty>Keine.</Empty> : items.map(render)}
    </section>
  );
}

// Inquiries, and the requests from the form "Audit anfragen" on the website, decided in the Cockpit.
function Anfragen({ file }: { file: CustomerFile }) {
  return (
    <>
      <FileList title="Anfragen" items={file.inquiries} render={(inquiry) => (
        <div key={inquiry.id} class="row"><span>{inquiry.subject || "Anfrage"} · <span class="muted small">{date(inquiry.created_at)} · Kanal: {channelLabel(inquiry.source_channel)}</span></span><InquiryBadge status={inquiry.status} /></div>
      )} />
      {file.auditRequests.length > 0 && <AuditRequests requests={file.auditRequests} />}
    </>
  );
}

function AuditRequests({ requests }: { requests: AuditRequest[] }) {
  return (
    <FileList title="Audit-Anfragen" items={requests} render={(request) => (
      <div key={request.id} class="row">
        <span>{APPOINTMENT_KIND[request.kind]} · <span class="muted small">Wunsch {dateTime(request.wished_at)}{request.website !== "" && ` · ${request.website}`}{request.audit_id !== null && " · Prüfung gestartet"}</span></span>
        <Badge tone={request.status === "open" ? "gold" : ""}>{AUDIT_REQUEST_STATUS[request.status]}</Badge>
      </div>
    )} />
  );
}

function Vorgaenge({ file, onChange }: { file: CustomerFile; onChange: () => void }) {
  return (
    <div class="grid">
      <Anfragen file={file} />
      <FileList title="Verkaufschancen" items={file.deals} render={(deal) => (
        <div key={deal.id} class="row"><span>{deal.title} · <span class="num">{euro(deal.value_net)}</span></span><DealBadge stage={deal.stage} /></div>
      )} />
      <FileList title="Angebote" items={file.quotes} render={(quote) => (
        <a key={quote.id} class="row" href={`/angebot/${quote.id}`}><span>{quote.number} · <span class="num">{euro(quote.gross)}</span></span><QuoteBadge status={quote.status} /></a>
      )} />
      <FileList title="Aufträge" items={file.orders} render={(order) => (
        <div key={order.id} class="row">
          <a href="/verkauf?tab=auftraege">{order.number} · {order.title}</a>
          <span class="cluster"><OrderBadge status={order.status} /><CompleteOrder order={order} onDone={onChange} /></span>
        </div>
      )} />
      <FileList title="Rechnungen" items={file.invoices} render={(invoice) => (
        <a key={invoice.id} class="row" href={`/rechnung/${invoice.id}`}>
          <span>{invoice.number ?? "Entwurf"} · <span class="num">{euro(invoice.gross)}</span></span>
          <InvoiceBadge status={invoice.status} dueDate={invoice.due_date} isCredit={invoice.cancels_invoice_id !== null} />
        </a>
      )} />
      <FileList title="Service" items={file.tickets} render={(ticket) => (
        <a key={ticket.id} class="row" href="/service"><span>{ticket.number} · {ticket.subject}</span><TicketBadge status={ticket.status} /></a>
      )} />
    </div>
  );
}

function NoteForm({ customerId, onDone }: { customerId: string; onDone: () => void }) {
  const [kind, setKind] = useState<ActivityKind>("note");
  const [body, setBody] = useState("");
  const action = useAction();
  const submit = (event: Event) => {
    event.preventDefault();
    if (body.trim() === "") return;
    void action.run(async () => { await addActivity(customerId, kind, body); setBody(""); onDone(); });
  };
  return (
    <form class="stack stack--tight" onSubmit={submit}>
      <div class="segmented" role="radiogroup" aria-label="Art des Eintrags">
        {(["note", "call", "email", "meeting"] as ActivityKind[]).map((option) => (
          <button key={option} type="button" role="radio" aria-checked={kind === option} onClick={() => { setKind(option); }}>{ACTIVITY_KIND[option]}</button>
        ))}
      </div>
      <div class="cluster">
        <input class="grow" aria-label="Eintrag" placeholder="Was ist passiert? Zum Beispiel: Angerufen, Termin am Freitag vereinbart." value={body} onInput={(event) => { setBody(event.currentTarget.value); }} />
        <button class="button" type="submit" disabled={action.busy}>Eintragen</button>
      </div>
      <ErrorNote message={action.error} />
    </form>
  );
}

function DealForm({ customerId, onDone, onCancel }: { customerId: string; onDone: () => void; onCancel: () => void }) {
  const [title, setTitle] = useState("");
  const [value, setValue] = useState("");
  const action = useAction();
  const submit = (event: Event) => {
    event.preventDefault();
    void action.run(async () => { await createDeal(customerId, title, parseAmount(value) ?? 0); onDone(); });
  };
  return (
    <form class="panel stack" onSubmit={submit}>
      <h2>Neue Verkaufschance</h2>
      <div class="form-grid">
        <Field label="Worum geht es?"><input required placeholder="z. B. Neue Webseite" value={title} onInput={(event) => { setTitle(event.currentTarget.value); }} /></Field>
        <Field label="Geschätzter Wert netto (€)"><input inputMode="decimal" value={value} onInput={(event) => { setValue(event.currentTarget.value); }} /></Field>
      </div>
      <ErrorNote message={action.error} />
      <div class="cluster"><button class="button button--gold" type="submit" disabled={action.busy}>Anlegen</button><button class="button" type="button" onClick={onCancel}>Abbrechen</button></div>
    </form>
  );
}

export function TicketForm({ customerId, onDone, onCancel }: { customerId: string | null; onDone: () => void; onCancel: () => void }) {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [priority, setPriority] = useState<Priority>("normal");
  const action = useAction();
  const submit = (event: Event) => {
    event.preventDefault();
    void action.run(async () => { await createTicket(customerId, subject, body, priority); onDone(); });
  };
  return (
    <form class="panel stack" onSubmit={submit}>
      <h2>Neues Service-Ticket</h2>
      <div class="form-grid">
        <Field label="Betreff"><input required value={subject} onInput={(event) => { setSubject(event.currentTarget.value); }} /></Field>
        <Field label="Dringlichkeit">
          <select class="select" value={priority} onChange={(event) => { setPriority(event.currentTarget.value as Priority); }}>
            {(Object.keys(PRIORITY) as Priority[]).map((option) => <option key={option} value={option}>{PRIORITY[option]}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Beschreibung" wide><textarea class="textarea--short" value={body} onInput={(event) => { setBody(event.currentTarget.value); }} /></Field>
      <ErrorNote message={action.error} />
      <div class="cluster"><button class="button button--gold" type="submit" disabled={action.busy}>Ticket anlegen</button><button class="button" type="button" onClick={onCancel}>Abbrechen</button></div>
    </form>
  );
}

// For contacts that were filed by mistake; the database refuses once anything commercial exists.
function Remove({ customerId }: { customerId: string }) {
  const [asking, setAsking] = useState(false);
  const action = useAction();
  const { route } = useLocation();
  const remove = () => { void action.run(async () => { await dismissCustomer(customerId); route("/kunden"); }); };
  return (
    <div class="stack stack--tight">
      {!asking ? (
        <div><button class="button button--quiet" type="button" onClick={() => { setAsking(true); }}>Kein Kunde – wieder entfernen</button></div>
      ) : (
        <div class="next-step next-step--warn">
          <p>Kontakt mit Verlauf entfernen? Künftige Mails dieser Adresse werden nicht mehr übernommen.</p>
          <div class="cluster">
            <button class="button button--danger" type="button" disabled={action.busy} onClick={remove}>Ja, entfernen</button>
            <button class="button" type="button" onClick={() => { setAsking(false); }}>Abbrechen</button>
          </div>
        </div>
      )}
      <ErrorNote message={action.error} />
    </div>
  );
}
