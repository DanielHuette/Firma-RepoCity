// CSV as German spreadsheet programs and DATEV read it: semicolons, decimal comma, CRLF and a
// byte order mark so umlauts survive in Excel.
import { roundCents } from "./money";

export const BOM = "﻿";
export const SEPARATOR = ";";
export const LINE_END = "\r\n";

export function csvCell(value: string): string {
  return /[;"\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Amount with decimal comma and no thousands separator; empty for a missing value. */
export function csvAmount(value: number | null): string {
  if (value === null) return "";
  const rounded = roundCents(value);
  return (rounded === 0 ? 0 : rounded).toFixed(2).replace(".", ",");
}

/** A YYYY-MM-DD calendar day as DD.MM.YYYY; empty when there is none. */
export function germanDate(value: string | null): string {
  if (value === null || value === "") return "";
  const [year, month, day] = value.slice(0, 10).split("-");
  return `${day ?? ""}.${month ?? ""}.${year ?? ""}`;
}

export function csvLine(cells: string[]): string {
  return cells.map(csvCell).join(SEPARATOR);
}

export function csvDocument(header: string[], rows: string[][]): string {
  return BOM + [header, ...rows].map(csvLine).join(LINE_END) + LINE_END;
}
