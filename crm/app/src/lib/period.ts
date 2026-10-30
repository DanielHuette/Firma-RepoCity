// Periods of the report "Herkunft der Kunden" and its totals.
import type { ChannelReportRow } from "../api/types";
import { addDays } from "./calendar";

export type Preset = "monat" | "jahr" | "zwoelf";

export interface Period {
  from: string;
  to: string;
}

function sameDayYearBefore(day: string): string {
  const year = Number(day.slice(0, 4)) - 1;
  const month = Number(day.slice(5, 7));
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const date = Math.min(Number(day.slice(8, 10)), lastDay);
  return `${String(year)}-${String(month).padStart(2, "0")}-${String(date).padStart(2, "0")}`;
}

/** This month, this year, or the twelve months up to the given day. */
export function presetPeriod(preset: Preset, today: string): Period {
  if (preset === "monat") return { from: `${today.slice(0, 7)}-01`, to: today };
  if (preset === "jahr") return { from: `${today.slice(0, 4)}-01-01`, to: today };
  return { from: addDays(sameDayYearBefore(today), 1), to: today };
}

export function periodProblem(period: Period): string | null {
  const day = /^\d{4}-\d{2}-\d{2}$/;
  if (!day.test(period.from) || !day.test(period.to)) return "Bitte Beginn und Ende des Zeitraums angeben.";
  if (period.from > period.to) return "Der Beginn muss vor dem Ende liegen.";
  return null;
}

export function reportTotals(rows: ChannelReportRow[]): Pick<ChannelReportRow, "inquiries" | "customers" | "revenue"> {
  const cents = rows.reduce((sum, row) => sum + Math.round(row.revenue * 100), 0);
  return {
    inquiries: rows.reduce((sum, row) => sum + row.inquiries, 0),
    customers: rows.reduce((sum, row) => sum + row.customers, 0),
    revenue: cents / 100,
  };
}
