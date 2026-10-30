// Report "Herkunft der Kunden": per channel the inquiries and new customers of a period and the
// payments received in it, as crm.channel_report counts them.
import { useState } from "preact/hooks";
import { channelReport } from "../api/crm";
import type { ChannelReportRow } from "../api/types";
import { useAsync } from "../hooks/useAsync";
import { berlinDay } from "../lib/calendar";
import { date, euro } from "../lib/format";
import { periodProblem, presetPeriod, reportTotals, type Period, type Preset } from "../lib/period";
import { Empty, ErrorNote, Field, Loading } from "./ui";

const PRESETS: { id: Preset; label: string }[] = [
  { id: "monat", label: "Dieser Monat" }, { id: "jahr", label: "Dieses Jahr" }, { id: "zwoelf", label: "Letzte 12 Monate" },
];

function load(period: Period): Promise<ChannelReportRow[]> {
  const problem = periodProblem(period);
  return problem === null ? channelReport(period.from, period.to) : Promise.reject(new Error(problem));
}

export function Herkunft() {
  const today = berlinDay(new Date());
  const [period, setPeriod] = useState<Period>(() => presetPeriod("jahr", today));
  const report = useAsync(() => load(period), [period.from, period.to]);
  return (
    <div class="stack">
      <p class="small muted">Anfragen und neue Kunden zählen nach dem Tag, an dem sie hereinkamen; Zahlungseingänge nach dem Zahlungstag, beim Kanal des zahlenden Kunden. Ein Kunde behält den Kanal seines ersten Kontakts.</p>
      <PeriodPicker period={period} today={today} onChange={setPeriod} />
      {report.error !== null ? <ErrorNote message={report.error} /> : report.data === undefined ? <Loading /> : <ReportTable rows={report.data} period={period} />}
    </div>
  );
}

function PeriodPicker({ period, today, onChange }: { period: Period; today: string; onChange: (next: Period) => void }) {
  const active = PRESETS.find((preset) => {
    const range = presetPeriod(preset.id, today);
    return range.from === period.from && range.to === period.to;
  })?.id;
  return (
    <div class="spread period">
      <div class="segmented" role="radiogroup" aria-label="Zeitraum">
        {PRESETS.map((preset) => (
          <button key={preset.id} type="button" role="radio" aria-checked={active === preset.id} onClick={() => { onChange(presetPeriod(preset.id, today)); }}>{preset.label}</button>
        ))}
      </div>
      <div class="cluster period__days">
        <Field label="Von"><input type="date" value={period.from} onInput={(event) => { onChange({ ...period, from: event.currentTarget.value }); }} /></Field>
        <Field label="Bis"><input type="date" value={period.to} onInput={(event) => { onChange({ ...period, to: event.currentTarget.value }); }} /></Field>
      </div>
    </div>
  );
}

function ReportTable({ rows, period }: { rows: ChannelReportRow[]; period: Period }) {
  if (rows.length === 0) return <Empty>Zwischen {date(period.from)} und {date(period.to)} gab es weder Anfragen noch neue Kunden noch Zahlungseingänge.</Empty>;
  const totals = reportTotals(rows);
  return (
    <div class="table-wrap panel panel--flat">
      <table class="table table--rows table--labelled">
        <thead><tr><th>Kanal</th><th class="num">Anfragen</th><th class="num">Neue Kunden</th><th class="num">Zahlungseingänge</th></tr></thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.channel}>
              <td data-label="Kanal">{row.label}</td>
              <td data-label="Anfragen" class="num">{row.inquiries}</td>
              <td data-label="Neue Kunden" class="num">{row.customers}</td>
              <td data-label="Zahlungseingänge" class="num">{euro(row.revenue)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr class="table__total">
            <td data-label="Kanal">Zusammen</td>
            <td data-label="Anfragen" class="num">{totals.inquiries}</td>
            <td data-label="Neue Kunden" class="num">{totals.customers}</td>
            <td data-label="Zahlungseingänge" class="num">{euro(totals.revenue)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
