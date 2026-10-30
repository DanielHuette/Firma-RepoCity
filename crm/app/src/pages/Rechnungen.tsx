// All invoices with filters, a new invoice for any customer, the dunning check and the package for
// the tax adviser.
import { useLocation } from "preact-iso";
import { useState } from "preact/hooks";
import { createInvoice, listInvoices, runDunning } from "../api/crm";
import type { Invoice } from "../api/types";
import { CustomerPicker } from "../components/CustomerPicker";
import { InvoiceBadge } from "../components/Status";
import { Steuerpaket } from "../components/Steuerpaket";
import { Empty, ErrorNote, Loading, PageHead, Tabs } from "../components/ui";
import { useAction, useAsync } from "../hooks/useAsync";
import { DUNNING_LEVEL, date, euro, today } from "../lib/format";

type Filter = "alle" | "entwurf" | "offen" | "ueberfaellig" | "bezahlt" | "storniert";
type Panel = "none" | "neu" | "paket";
const FILTERS: Filter[] = ["alle", "entwurf", "offen", "ueberfaellig", "bezahlt", "storniert"];

function matches(invoice: Invoice, filter: Filter): boolean {
  const overdue = invoice.status === "open" && invoice.due_date !== null && invoice.due_date < today();
  switch (filter) {
    case "alle": return true;
    case "entwurf": return invoice.status === "draft";
    case "offen": return invoice.status === "open";
    case "ueberfaellig": return overdue;
    case "bezahlt": return invoice.status === "paid";
    case "storniert": return invoice.status === "cancelled" || invoice.cancels_invoice_id !== null;
  }
}

export function Rechnungen() {
  const { query, route } = useLocation();
  const [filter, setFilter] = useState<Filter>(FILTERS.includes(query.filter as Filter) ? (query.filter as Filter) : "alle");
  const [panel, setPanel] = useState<Panel>("none");
  const invoices = useAsync(() => listInvoices(), []);
  const all = invoices.data ?? [];
  const count = (which: Filter) => all.filter((invoice) => matches(invoice, which)).length;
  const change = (next: Filter) => { setFilter(next); route(`/rechnungen?filter=${next}`, true); };
  return (
    <div class="stack stack--loose">
      <PageHead kicker="Rechnungen" title="Rechnungen und Zahlungen">
        <button class="button" type="button" onClick={() => { setPanel("paket"); }}>Paket für den Steuerberater</button>
        <button class="button button--gold" type="button" onClick={() => { setPanel("neu"); }}>+ Neue Rechnung</button>
      </PageHead>
      <Dunning />
      {panel === "neu" && <NewInvoice onCancel={() => { setPanel("none"); }} />}
      {panel === "paket" && <Steuerpaket onClose={() => { setPanel("none"); }} />}
      <ErrorNote message={invoices.error} />
      <Tabs value={filter} onChange={change} options={[
        { id: "alle", label: "Alle" }, { id: "entwurf", label: "Entwürfe", count: count("entwurf") }, { id: "offen", label: "Offen", count: count("offen") },
        { id: "ueberfaellig", label: "Überfällig", count: count("ueberfaellig") }, { id: "bezahlt", label: "Bezahlt" }, { id: "storniert", label: "Storniert" },
      ]} />
      {invoices.data === undefined ? <Loading /> : <InvoiceTable invoices={all.filter((invoice) => matches(invoice, filter))} />}
    </div>
  );
}

function Dunning() {
  const [result, setResult] = useState<number | null>(null);
  const action = useAction();
  const check = () => { void action.run(async () => { setResult(await runDunning()); }); };
  return (
    <div class="cluster">
      <button class="button button--quiet" type="button" disabled={action.busy} onClick={check}>Überfällige jetzt prüfen</button>
      {result !== null && <span class="small muted">{result === 0 ? "Keine neue Mahnung nötig." : `${String(result)} Mahnung(en) liegen jetzt unter Freigaben.`} {result > 0 && <a href="/freigaben">Zu den Freigaben</a>}</span>}
      <ErrorNote message={action.error} />
    </div>
  );
}

function NewInvoice({ onCancel }: { onCancel: () => void }) {
  const [customer, setCustomer] = useState("");
  const action = useAction();
  const { route } = useLocation();
  const create = () => { void action.run(async () => { const invoice = await createInvoice(customer); route(`/rechnung/${invoice.id}`); }); };
  return (
    <div class="panel stack">
      <CustomerPicker value={customer} onChange={setCustomer} label="Für welchen Kunden?" />
      <ErrorNote message={action.error} />
      <div class="cluster">
        <button class="button button--gold" type="button" disabled={customer === "" || action.busy} onClick={create}>Rechnungsentwurf anlegen</button>
        <button class="button" type="button" onClick={onCancel}>Abbrechen</button>
      </div>
    </div>
  );
}

function InvoiceTable({ invoices }: { invoices: Invoice[] }) {
  const { route } = useLocation();
  if (invoices.length === 0) return <Empty>Keine Rechnungen in dieser Ansicht.</Empty>;
  return (
    <div class="table-wrap panel panel--flat">
      <table class="table table--rows">
        <thead><tr><th>Nummer</th><th>Kunde</th><th>Datum</th><th>Fällig</th><th class="num">Betrag</th><th class="num">Offen</th><th>Status</th></tr></thead>
        <tbody>
          {invoices.map((invoice) => (
            <tr key={invoice.id} onClick={() => { route(`/rechnung/${invoice.id}`); }}>
              <td data-label="Nummer"><a href={`/rechnung/${invoice.id}`}>{invoice.number ?? "Entwurf"}</a></td>
              <td data-label="Kunde">{invoice.customer?.name}</td>
              <td data-label="Datum">{date(invoice.issue_date)}</td>
              <td data-label="Fällig">{date(invoice.due_date)}{invoice.dunning_level > 0 && <div class="small late">{DUNNING_LEVEL[invoice.dunning_level]}</div>}</td>
              <td data-label="Betrag" class="num">{euro(invoice.gross)}</td>
              <td data-label="Offen" class="num">{invoice.status === "open" ? euro(invoice.gross - invoice.paid_amount) : "–"}</td>
              <td data-label="Status"><InvoiceBadge status={invoice.status} dueDate={invoice.due_date} isCredit={invoice.cancels_invoice_id !== null} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
