// Document totals, computed the same way as crm.document_totals in the database: VAT is rounded
// per rate, and a small business under § 19 UStG charges none.
import type { LineItem, VatRate } from "../api/types";

export interface VatGroup {
  rate: VatRate;
  net: number;
  vat: number;
}

export interface Totals {
  net: number;
  vat: number;
  gross: number;
  groups: VatGroup[];
}

/** Rounds half away from zero, as PostgreSQL's round() and the PDF code of the mail worker do. */
export function roundCents(value: number): number {
  const rounded = Math.round((Math.abs(value) + Number.EPSILON) * 100) / 100;
  return value < 0 && rounded !== 0 ? -rounded : rounded;
}

export function lineNet(item: Pick<LineItem, "quantity" | "unit_price_net">): number {
  return roundCents(item.quantity * item.unit_price_net);
}

export function documentTotals(items: Pick<LineItem, "quantity" | "unit_price_net" | "vat_rate">[], smallBusiness: boolean): Totals {
  const byRate = new Map<VatRate, number>();
  for (const item of items) byRate.set(item.vat_rate, roundCents((byRate.get(item.vat_rate) ?? 0) + lineNet(item)));
  const groups = [...byRate.entries()]
    .sort(([a], [b]) => b - a)
    .map(([rate, net]) => ({ rate, net, vat: smallBusiness ? 0 : roundCents((net * rate) / 100) }));
  const net = roundCents(groups.reduce((sum, group) => sum + group.net, 0));
  const vat = roundCents(groups.reduce((sum, group) => sum + group.vat, 0));
  return { net, vat, gross: roundCents(net + vat), groups };
}

/** Parses German or plain number input ("1.234,50", "1234.5"); returns null when it is not a number. */
export function parseAmount(input: string): number | null {
  const text = input.trim().replace(/\s|€/g, "");
  if (text === "") return null;
  const normalised = text.includes(",") ? text.replace(/\./g, "").replace(",", ".") : text;
  const value = Number(normalised);
  return Number.isFinite(value) ? value : null;
}
