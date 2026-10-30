// Customer list with search and the form for a new customer.
import { useLocation } from "preact-iso";
import { useState } from "preact/hooks";
import { createCustomer, listCustomers } from "../api/crm";
import type { Customer } from "../api/types";
import { CustomerForm, EMPTY_CUSTOMER } from "../components/CustomerForm";
import { Empty, ErrorNote, Loading, PageHead } from "../components/ui";
import { useAction, useAsync } from "../hooks/useAsync";
import { SOURCE } from "../lib/format";

export function Kunden() {
  const [term, setTerm] = useState("");
  const [adding, setAdding] = useState(false);
  const customers = useAsync(() => listCustomers(term), [term]);
  const action = useAction();
  const { route } = useLocation();
  return (
    <div class="stack stack--loose">
      <PageHead kicker="Kunden" title="Alle Kunden">
        {!adding && <button class="button button--gold" type="button" onClick={() => { setAdding(true); }}>+ Neuer Kunde</button>}
      </PageHead>
      {adding && (
        <section class="panel stack">
          <h2>Neuer Kunde</h2>
          <CustomerForm initial={EMPTY_CUSTOMER} submitLabel="Kunde anlegen" busy={action.busy} error={action.error}
            onCancel={() => { setAdding(false); }}
            onSubmit={(draft) => { void action.run(async () => { const created = await createCustomer(draft); route(`/kunde/${created.id}`); }); }} />
        </section>
      )}
      <input type="search" aria-label="Kunden suchen" placeholder="Suchen nach Name, E-Mail, Ansprechpartner oder Ort …" value={term}
        onInput={(event) => { setTerm(event.currentTarget.value); }} />
      <ErrorNote message={customers.error} />
      {customers.data === undefined ? <Loading /> : customers.data.length === 0 ? <Empty>{term === "" ? "Noch keine Kunden." : "Keine Treffer."}</Empty> : <CustomerTable customers={customers.data} />}
    </div>
  );
}

function CustomerTable({ customers }: { customers: Customer[] }) {
  const { route } = useLocation();
  return (
    <div class="table-wrap panel panel--flat">
      <table class="table table--rows">
        <thead><tr><th>Name</th><th>Ansprechpartner</th><th>E-Mail</th><th>Telefon</th><th>Ort</th><th>Herkunft</th></tr></thead>
        <tbody>
          {customers.map((customer) => (
            <tr key={customer.id} onClick={() => { route(`/kunde/${customer.id}`); }}>
              <td data-label="Name"><a href={`/kunde/${customer.id}`}><strong>{customer.name}</strong></a></td>
              <td data-label="Ansprechpartner">{customer.contact_person}</td>
              <td data-label="E-Mail">{customer.email}</td>
              <td data-label="Telefon">{customer.phone}</td>
              <td data-label="Ort">{customer.city}</td>
              <td data-label="Herkunft"><span class="badge">{SOURCE[customer.source]}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
