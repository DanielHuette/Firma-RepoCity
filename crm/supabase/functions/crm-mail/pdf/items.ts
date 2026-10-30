// Item table and totals shared by quote and invoice: amounts per line, the net amount split by
// value added tax rate, and the small business note required by § 34a UStDV.
import type { Block, Column, TotalRow } from "./model.ts";
import { cents, euro, lineCents, quantityDe, vatCents } from "./text.ts";

export const SMALL_BUSINESS_NOTE = "Für diese Leistung gilt die Steuerbefreiung für Kleinunternehmer nach § 19 Abs. 1 UStG; Umsatzsteuer wird nicht berechnet.";

export interface Item {
  position: number;
  title: string;
  description: string;
  quantity: number;
  unit: string;
  unit_price_net: number;
  vat_rate: number;
}

export interface Totals { net: number; vat: number; gross: number }

function toNumber(value: unknown): number {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : 0;
}

/** Items as the database returns them, sorted by position. */
export function toItems(rows: unknown): Item[] {
  const list = Array.isArray(rows) ? rows as Record<string, unknown>[] : [];
  return list.map((row) => ({
    position: toNumber(row.position), title: String(row.title ?? ""), description: String(row.description ?? ""),
    quantity: toNumber(row.quantity), unit: String(row.unit ?? ""), unit_price_net: toNumber(row.unit_price_net), vat_rate: toNumber(row.vat_rate),
  })).sort((a, b) => a.position - b.position);
}

export function rateLabel(rate: number): string {
  return `${String(Number(rate.toFixed(2))).replace(".", ",")} %`;
}

function columns(withRate: boolean): Column[] {
  return [
    { title: "Pos.", width: 0.07 }, { title: "Leistung", width: withRate ? 0.37 : 0.45 }, { title: "Menge", width: 0.16 },
    ...(withRate ? [{ title: "USt.", width: 0.08, align: "right" as const }] : []),
    { title: "Einzelpreis", width: 0.16, align: "right" }, { title: "Betrag", width: 0.16, align: "right" },
  ];
}

export function itemTable(items: Item[], withRate: boolean): Block {
  const rows = items.map((item, index) => [
    String(index + 1), item.description === "" ? item.title : `${item.title}\n${item.description}`, `${quantityDe(item.quantity)} ${item.unit}`.trim(),
    ...(withRate ? [rateLabel(item.vat_rate)] : []), euro(cents(item.unit_price_net)), euro(lineCents(item.quantity, item.unit_price_net)),
  ]);
  return { kind: "table", columns: columns(withRate), rows };
}

/** Net amount per rate in cents, rates ascending; the rounding matches crm.document_totals. */
export function netByRate(items: Item[]): [number, number][] {
  const sums = new Map<number, number>();
  for (const item of items) sums.set(item.vat_rate, (sums.get(item.vat_rate) ?? 0) + lineCents(item.quantity, item.unit_price_net));
  return [...sums.entries()].sort(([a], [b]) => a - b);
}

export function totalRows(items: Item[], totals: Totals, smallBusiness: boolean): TotalRow[] {
  const gross: TotalRow = { label: "Gesamtbetrag", value: euro(cents(totals.gross)), strong: true };
  if (smallBusiness) return [gross];
  const taxes = netByRate(items).map(([rate, net]) => ({ label: `Umsatzsteuer ${rateLabel(rate)} auf ${euro(net)}`, value: euro(vatCents(net, rate)) }));
  return [{ label: "Summe netto", value: euro(cents(totals.net)) }, ...taxes, gross];
}
