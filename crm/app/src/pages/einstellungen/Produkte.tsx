// Fixed services and packages that go into quotes and invoices.
import { useState } from "preact/hooks";
import { listProducts, saveProduct } from "../../api/crm";
import type { Billing, Product, VatRate } from "../../api/types";
import { Badge, Empty, ErrorNote, Field, Loading } from "../../components/ui";
import { useAction, useAsync } from "../../hooks/useAsync";
import { euro } from "../../lib/format";
import { parseAmount } from "../../lib/money";

type Editable = Omit<Product, "id"> & { id?: string };

const EMPTY_PRODUCT: Editable = { name: "", description: "", unit: "Stück", price_net: 0, vat_rate: 19, billing: "once", active: true };

export function Produkte() {
  const products = useAsync(() => listProducts(true), []);
  const [editing, setEditing] = useState<Editable | null>(null);
  const done = () => { setEditing(null); products.reload(); };
  return (
    <div class="stack">
      <p class="muted">Feste Leistungen und Pakete, die du in Angebote und Rechnungen übernimmst. Monatliche Leistungen lassen sich als Abo automatisch abrechnen.</p>
      {editing === null && <div><button class="button button--gold" type="button" onClick={() => { setEditing(EMPTY_PRODUCT); }}>+ Neues Produkt</button></div>}
      {editing !== null && <ProductForm key={editing.id ?? "neu"} initial={editing} onDone={done} onCancel={() => { setEditing(null); }} />}
      <ErrorNote message={products.error} />
      {products.data === undefined ? <Loading /> : products.data.length === 0 ? <Empty>Noch keine Produkte angelegt.</Empty> : <ProductTable products={products.data} onEdit={setEditing} />}
    </div>
  );
}

function ProductTable({ products, onEdit }: { products: Product[]; onEdit: (product: Product) => void }) {
  return (
    <table class="table table--rows">
      <thead><tr><th>Name</th><th>Abrechnung</th><th class="num">Netto</th><th>Status</th><th /></tr></thead>
      <tbody>
        {products.map((product) => (
          <tr key={product.id}>
            <td>{product.name}<div class="small muted">{product.description}</div></td>
            <td>{product.billing === "monthly" ? "Monatlich" : "Einmalig"}</td>
            <td class="num">{euro(product.price_net)} / {product.unit}</td>
            <td>{product.active ? <Badge tone="good">Aktiv</Badge> : <Badge>Inaktiv</Badge>}</td>
            <td><button class="button button--quiet" type="button" onClick={() => { onEdit(product); }}>Bearbeiten</button></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ProductForm({ initial, onDone, onCancel }: { initial: Editable; onDone: () => void; onCancel: () => void }) {
  const [editing, setEditing] = useState(initial);
  const [price, setPrice] = useState(initial.price_net.toFixed(2).replace(".", ","));
  const action = useAction();
  const submit = (event: Event) => {
    event.preventDefault();
    void action.run(async () => {
      const amount = parseAmount(price);
      if (editing.name.trim() === "") throw new Error("Der Name fehlt.");
      if (amount === null || amount < 0) throw new Error("Der Preis ist keine gültige Zahl.");
      await saveProduct({ ...editing, name: editing.name.trim(), price_net: amount });
      onDone();
    });
  };
  return (
    <form class="panel stack" onSubmit={submit}>
      <ProductFields editing={editing} price={price} onChange={setEditing} onPrice={setPrice} />
      <label class="check"><input type="checkbox" checked={editing.active} onChange={(event) => { setEditing({ ...editing, active: event.currentTarget.checked }); }} /><span>Aktiv (in Auswahllisten sichtbar)</span></label>
      <ErrorNote message={action.error} />
      <div class="cluster">
        <button class="button button--gold" type="submit" disabled={action.busy}>Speichern</button>
        <button class="button button--quiet" type="button" onClick={onCancel}>Abbrechen</button>
      </div>
    </form>
  );
}

function ProductFields({ editing, price, onChange, onPrice }: { editing: Editable; price: string; onChange: (next: Editable) => void; onPrice: (next: string) => void }) {
  return (
    <div class="form-grid">
      <Field label="Name" wide><input class="input" value={editing.name} onInput={(event) => { onChange({ ...editing, name: event.currentTarget.value }); }} /></Field>
      <Field label="Beschreibung" wide><textarea class="textarea textarea--short" value={editing.description} onInput={(event) => { onChange({ ...editing, description: event.currentTarget.value }); }} /></Field>
      <Field label="Preis netto in Euro"><input class="input num" inputMode="decimal" value={price} onInput={(event) => { onPrice(event.currentTarget.value); }} /></Field>
      <Field label="Einheit"><input class="input" value={editing.unit} onInput={(event) => { onChange({ ...editing, unit: event.currentTarget.value }); }} /></Field>
      <Field label="Umsatzsteuer">
        <select class="select" value={String(editing.vat_rate)} onChange={(event) => { onChange({ ...editing, vat_rate: Number(event.currentTarget.value) as VatRate }); }}>
          <option value="19">19 %</option><option value="7">7 %</option><option value="0">0 %</option>
        </select>
      </Field>
      <Field label="Abrechnung">
        <select class="select" value={editing.billing} onChange={(event) => { onChange({ ...editing, billing: event.currentTarget.value as Billing }); }}>
          <option value="once">Einmalig</option><option value="monthly">Monatlich</option>
        </select>
      </Field>
    </div>
  );
}
