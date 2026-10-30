// Positions of a quote or an invoice draft: pick a product or type a free line, totals update live.
import { Fragment } from "preact";
import { listProducts } from "../api/crm";
import type { LineItem, Product, VatRate } from "../api/types";
import { useAsync } from "../hooks/useAsync";
import { euro } from "../lib/format";
import { documentTotals, lineNet, parseAmount } from "../lib/money";

const RATES: VatRate[] = [19, 7, 0];

export function emptyItem(position: number): LineItem {
  return { position, product_id: null, title: "", description: "", quantity: 1, unit: "Stück", unit_price_net: 0, vat_rate: 19 };
}

export function itemFromProduct(product: Product, position: number): LineItem {
  return {
    position, product_id: product.id, title: product.name, description: product.description, quantity: 1, unit: product.unit,
    unit_price_net: product.price_net, vat_rate: product.vat_rate,
  };
}

interface RowProps {
  item: LineItem;
  smallBusiness: boolean;
  readOnly: boolean;
  onUpdate: (changes: Partial<LineItem>) => void;
  onRemove: () => void;
}

function TitleCell({ item, readOnly, onUpdate }: Pick<RowProps, "item" | "readOnly" | "onUpdate">) {
  if (readOnly) return <td><strong>{item.title}</strong>{item.description !== "" && <div class="small muted">{item.description}</div>}</td>;
  return (
    <td>
      <div class="stack stack--tight">
        <input aria-label="Bezeichnung" placeholder="Bezeichnung" value={item.title} onInput={(event) => { onUpdate({ title: event.currentTarget.value }); }} />
        <input aria-label="Beschreibung" placeholder="Beschreibung (optional)" value={item.description} onInput={(event) => { onUpdate({ description: event.currentTarget.value }); }} />
      </div>
    </td>
  );
}

function NumberCells({ item, readOnly, onUpdate }: Pick<RowProps, "item" | "readOnly" | "onUpdate">) {
  if (readOnly) return <><td class="num">{item.quantity.toLocaleString("de-DE")}</td><td>{item.unit}</td><td class="num">{euro(item.unit_price_net)}</td></>;
  return (
    <>
      <td class="num">
        <input class="input--short num" aria-label="Menge" inputMode="decimal" value={String(item.quantity).replace(".", ",")}
          onChange={(event) => { const value = parseAmount(event.currentTarget.value); if (value !== null && value !== 0) onUpdate({ quantity: value }); }} />
      </td>
      <td><input class="input--short" aria-label="Einheit" value={item.unit} onInput={(event) => { onUpdate({ unit: event.currentTarget.value }); }} /></td>
      <td class="num">
        <input class="input--short num" aria-label="Einzelpreis netto" inputMode="decimal" value={item.unit_price_net.toFixed(2).replace(".", ",")}
          onChange={(event) => { const value = parseAmount(event.currentTarget.value); if (value !== null && value >= 0) onUpdate({ unit_price_net: value }); }} />
      </td>
    </>
  );
}

function ItemRow({ item, smallBusiness, readOnly, onUpdate, onRemove }: RowProps) {
  return (
    <tr>
      <TitleCell item={item} readOnly={readOnly} onUpdate={onUpdate} />
      <NumberCells item={item} readOnly={readOnly} onUpdate={onUpdate} />
      {!smallBusiness && (
        <td class="num">
          {readOnly ? `${String(item.vat_rate)} %` : (
            <select class="select" aria-label="Umsatzsteuer" value={String(item.vat_rate)} onChange={(event) => { onUpdate({ vat_rate: Number(event.currentTarget.value) as VatRate }); }}>
              {RATES.map((rate) => <option key={rate} value={String(rate)}>{rate} %</option>)}
            </select>
          )}
        </td>
      )}
      <td class="num">{euro(lineNet(item))}</td>
      {!readOnly && <td><button type="button" class="button button--quiet" aria-label="Position entfernen" onClick={onRemove}>×</button></td>}
    </tr>
  );
}

function AddItems({ items, onChange }: { items: LineItem[]; onChange: (next: LineItem[]) => void }) {
  const products = useAsync(() => listProducts(), []);
  const addProduct = (productId: string) => {
    const product = products.data?.find((candidate) => candidate.id === productId);
    if (product !== undefined) onChange([...items, itemFromProduct(product, items.length + 1)]);
  };
  return (
    <div class="cluster">
      <button type="button" class="button" onClick={() => { onChange([...items, emptyItem(items.length + 1)]); }}>+ Freie Position</button>
      {products.data !== undefined && products.data.length > 0 && (
        <select class="select" value="" onChange={(event) => { addProduct(event.currentTarget.value); event.currentTarget.value = ""; }} aria-label="Produkt hinzufügen">
          <option value="">+ Produkt oder Paket hinzufügen …</option>
          {products.data.map((product) => <option key={product.id} value={product.id}>{product.name} · {euro(product.price_net)}</option>)}
        </select>
      )}
    </div>
  );
}

function Totals({ items, smallBusiness }: { items: LineItem[]; smallBusiness: boolean }) {
  const totals = documentTotals(items, smallBusiness);
  return (
    <dl class="totals">
      <dt>Summe netto</dt><dd class="num">{euro(totals.net)}</dd>
      {smallBusiness ? (
        <><dt>Umsatzsteuer</dt><dd class="small muted">keine (Kleinunternehmer, § 19 UStG)</dd></>
      ) : totals.groups.map((group) => (
        <Fragment key={group.rate}><dt>Umsatzsteuer {group.rate} %</dt><dd class="num">{euro(group.vat)}</dd></Fragment>
      ))}
      <dt class="totals__gross">Gesamt</dt><dd class="num totals__gross">{euro(totals.gross)}</dd>
    </dl>
  );
}

export function ItemsEditor({ items, onChange, smallBusiness, readOnly = false }: {
  items: LineItem[]; onChange: (next: LineItem[]) => void; smallBusiness: boolean; readOnly?: boolean;
}) {
  const update = (index: number, changes: Partial<LineItem>) => { onChange(items.map((item, at) => (at === index ? { ...item, ...changes } : item))); };
  const remove = (index: number) => { onChange(items.filter((_, at) => at !== index)); };
  return (
    <div class="stack">
      <div class="table-wrap">
        <table class="table items">
          <thead>
            <tr>
              <th>Leistung</th><th class="num">Menge</th><th>Einheit</th><th class="num">Einzelpreis netto</th>
              {!smallBusiness && <th class="num">USt.</th>}
              <th class="num">Summe netto</th>
              {!readOnly && <th aria-label="Entfernen" />}
            </tr>
          </thead>
          <tbody>
            {items.map((item, index) => (
              <ItemRow key={index} item={item} smallBusiness={smallBusiness} readOnly={readOnly}
                onUpdate={(changes) => { update(index, changes); }} onRemove={() => { remove(index); }} />
            ))}
          </tbody>
        </table>
      </div>
      {!readOnly && <AddItems items={items} onChange={onChange} />}
      <Totals items={items} smallBusiness={smallBusiness} />
    </div>
  );
}
