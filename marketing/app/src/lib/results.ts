// Sums of reads, clicks and leads per day and per post, for the results tab.
import type { Metric } from "../api/types";

export interface Totals {
  views: number;
  clicks: number;
  leads: number;
}

export function emptyTotals(): Totals {
  return { views: 0, clicks: 0, leads: 0 };
}

export function sum(metrics: readonly Metric[]): Totals {
  const total = emptyTotals();
  for (const row of metrics) {
    total.views += row.views;
    total.clicks += row.clicks;
    total.leads += row.leads;
  }
  return total;
}

export function byPost(metrics: readonly Metric[]): Map<string, Totals> {
  const grouped = new Map<string, Metric[]>();
  for (const row of metrics) grouped.set(row.post_id, [...(grouped.get(row.post_id) ?? []), row]);
  return new Map([...grouped].map(([id, rows]) => [id, sum(rows)]));
}

export interface DayRow extends Totals {
  day: string;
}

/** One row per calendar day from the first to the last measured day, gaps filled with zero. */
export function byDay(metrics: readonly Metric[]): DayRow[] {
  if (metrics.length === 0) return [];
  const days = [...new Set(metrics.map((row) => row.day))].sort();
  const first = new Date(`${days[0] ?? ""}T00:00:00Z`);
  const last = new Date(`${days.at(-1) ?? ""}T00:00:00Z`);
  const rows: DayRow[] = [];
  for (let cursor = first; cursor <= last; cursor = new Date(cursor.getTime() + 86_400_000)) {
    const day = cursor.toISOString().slice(0, 10);
    rows.push({ day, ...sum(metrics.filter((row) => row.day === day)) });
  }
  return rows;
}

export function isSimulated(metrics: readonly Metric[]): boolean {
  return metrics.some((row) => row.source === "simulated");
}
