// Monthly subscriptions: each one is billed automatically and, when its product includes audits,
// gets a monthly audit.
import { useState } from "preact/hooks";
import { createSubscription, listProducts, listSubscriptions, setSubscriptionActive } from "../../api/crm";
import type { Subscription } from "../../api/types";
import { CustomerPicker } from "../../components/CustomerPicker";
import { Empty, ErrorNote, Field, Loading } from "../../components/ui";
import { useAction, useAsync } from "../../hooks/useAsync";
import { date, euro, quantity as formatQuantity, today } from "../../lib/format";
import { parseAmount } from "../../lib/money";

export function Abos() {
  const subscriptions = useAsync(() => listSubscriptions(), []);
  const [adding, setAdding] = useState(false);
  return (
    <div class="stack">
      <p class="muted">Zu jedem neuen Abo geht der Wartungsvertrag automatisch per E-Mail an den Kunden; fehlt die E-Mail-Adresse, wartet er unter Freigaben. Am Fälligkeitstag wird die Rechnung erstellt, festgeschrieben und verschickt.</p>
      {!adding && <div><button class="button button--gold" type="button" onClick={() => { setAdding(true); }}>+ Neues Abo</button></div>}
      {adding && <NewSubscription onDone={() => { setAdding(false); subscriptions.reload(); }} onCancel={() => { setAdding(false); }} />}
      <ErrorNote message={subscriptions.error} />
      {subscriptions.data === undefined ? <Loading /> : subscriptions.data.length === 0 ? <Empty>Noch keine Abos.</Empty> : <SubscriptionTable subscriptions={subscriptions.data} onChange={subscriptions.reload} />}
    </div>
  );
}

function SubscriptionTable({ subscriptions, onChange }: { subscriptions: Subscription[]; onChange: () => void }) {
  const action = useAction();
  const toggle = (id: string, active: boolean) => { void action.run(async () => { await setSubscriptionActive(id, active); onChange(); }); };
  return (
    <div class="table-wrap">
      <ErrorNote message={action.error} />
      <table class="table table--rows">
        <thead><tr><th>Kunde</th><th>Produkt</th><th class="num">Menge</th><th class="num">Preis netto</th><th>Nächste Rechnung</th><th>Nächste Prüfung</th><th /></tr></thead>
        <tbody>
          {subscriptions.map((subscription) => (
            <tr key={subscription.id} class={subscription.active ? "" : "muted"}>
              <td><a href={`/kunde/${subscription.customer_id}`}>{subscription.customer?.name ?? "–"}</a></td>
              <td>{subscription.product?.name ?? "–"}</td>
              <td class="num">{formatQuantity(subscription.quantity)}</td>
              <td class="num">{euro(subscription.unit_price_net ?? subscription.product?.price_net ?? 0)}{subscription.unit_price_net !== null && <div class="small muted">laut Angebot</div>}</td>
              <td>{subscription.active ? date(subscription.next_invoice_date) : "Pausiert"}</td>
              <td>{subscription.active ? date(subscription.next_audit_date) : "–"}</td>
              <td>
                <button class="button button--quiet" type="button" disabled={action.busy} onClick={() => { toggle(subscription.id, !subscription.active); }}>
                  {subscription.active ? "Pausieren" : "Fortsetzen"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function validQuantity(customer: string, product: string, amount: string): number {
  const value = parseAmount(amount);
  if (customer === "" || product === "") throw new Error("Bitte Kunde und Produkt wählen.");
  if (value === null || value <= 0) throw new Error("Die Menge ist keine gültige Zahl.");
  return value;
}

function NewSubscription({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [customer, setCustomer] = useState("");
  const [product, setProduct] = useState("");
  const [amount, setAmount] = useState("1");
  const [start, setStart] = useState(today());
  const action = useAction();
  const submit = (event: Event) => {
    event.preventDefault();
    void action.run(async () => { await createSubscription(customer, product, validQuantity(customer, product, amount), start); onDone(); });
  };
  return (
    <form class="panel stack" onSubmit={submit}>
      <CustomerPicker value={customer} onChange={setCustomer} />
      <div class="form-grid">
        <ProductChoice value={product} onChange={setProduct} />
        <Field label="Menge"><input class="input input--short num" inputMode="decimal" value={amount} onInput={(event) => { setAmount(event.currentTarget.value); }} /></Field>
        <Field label="Erste Rechnung am"><input class="input" type="date" value={start} onInput={(event) => { setStart(event.currentTarget.value); }} /></Field>
      </div>
      <ErrorNote message={action.error} />
      <div class="cluster">
        <button class="button button--gold" type="submit" disabled={action.busy}>Anlegen</button>
        <button class="button button--quiet" type="button" onClick={onCancel}>Abbrechen</button>
      </div>
    </form>
  );
}

function ProductChoice({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const products = useAsync(async () => (await listProducts()).filter((product) => product.billing === "monthly"), []);
  return (
    <Field label="Monatliches Produkt">
      <select class="select" value={value} onChange={(event) => { onChange(event.currentTarget.value); }}>
        <option value="">Bitte wählen</option>
        {(products.data ?? []).map((item) => <option key={item.id} value={item.id}>{item.name} ({euro(item.price_net)})</option>)}
      </select>
      {products.data?.length === 0 && <span class="small muted">Lege zuerst unter „Produkte & Pakete“ ein monatliches Produkt an.</span>}
      <ErrorNote message={products.error} />
    </Field>
  );
}
