// The tax adviser package: choose month, quarter or year and download one zip with every invoice
// PDF, the lists as CSV, the DATEV posting batch, and the expenses with their batch and receipts.
import { useState } from "preact/hooks";
import { buildTaxPackage } from "../api/taxExport";
import { useSettings } from "../hooks/settings";
import { useAction } from "../hooks/useAsync";
import { datevSettingsFrom } from "../lib/datev";
import { downloadBlob } from "../lib/download";
import { MONTHS, today } from "../lib/format";
import { periodLabel, previousMonth, type PeriodKind, type TaxPeriod } from "../lib/taxPackage";
import { ErrorNote, Field } from "./ui";

const KINDS: { id: PeriodKind; label: string }[] = [{ id: "month", label: "Monat" }, { id: "quarter", label: "Quartal" }, { id: "year", label: "Jahr" }];

function PeriodPicker({ period, onChange }: { period: TaxPeriod; onChange: (next: TaxPeriod) => void }) {
  const thisYear = Number(today().slice(0, 4));
  const years = Array.from({ length: 6 }, (_, offset) => thisYear - offset);
  const indexes = period.kind === "month" ? MONTHS.map((name, index) => ({ value: index + 1, name })) : [1, 2, 3, 4].map((value) => ({ value, name: `${String(value)}. Quartal` }));
  return (
    <div class="cluster">
      <div class="segmented" role="radiogroup" aria-label="Zeitraum">
        {KINDS.map((kind) => (
          <button key={kind.id} type="button" role="radio" aria-checked={period.kind === kind.id} onClick={() => { onChange({ ...period, kind: kind.id, index: 1 }); }}>{kind.label}</button>
        ))}
      </div>
      {period.kind !== "year" && (
        <Field label={period.kind === "month" ? "Monat" : "Quartal"}>
          <select class="select" value={period.index} onChange={(event) => { onChange({ ...period, index: Number(event.currentTarget.value) }); }}>
            {indexes.map((option) => <option key={option.value} value={option.value}>{option.name}</option>)}
          </select>
        </Field>
      )}
      <Field label="Jahr">
        <select class="select" value={period.year} onChange={(event) => { onChange({ ...period, year: Number(event.currentTarget.value) }); }}>
          {years.map((year) => <option key={year} value={year}>{year}</option>)}
        </select>
      </Field>
    </div>
  );
}

interface Outcome {
  text: string;
  missing: string[];
  taxFree: string[];
  unassigned: string[];
}

function MissingNumbers() {
  const { settings } = useSettings();
  if (settings === undefined) return null;
  const datev = datevSettingsFrom(settings);
  if (datev.consultantNumber !== null && datev.clientNumber !== null) return null;
  return <p class="note note--gold">Für den DATEV-Buchungsstapel braucht dein Steuerberater seine Beraternummer und deine Mandantennummer; trag beide unter <a href="/einstellungen">Einstellungen → Firma</a> ein.</p>;
}

function usePackageBuild(period: TaxPeriod) {
  const { settings } = useSettings();
  const [progress, setProgress] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const action = useAction();
  const build = () => {
    setOutcome(null);
    void action.run(async () => {
      if (settings === undefined) throw new Error("Die Einstellungen sind noch nicht geladen. Bitte gleich noch einmal versuchen.");
      const result = await buildTaxPackage(period, settings, (done, total) => { setProgress(total === 0 ? null : `Lädt PDFs: ${String(done)} von ${String(total)}`); });
      downloadBlob(result.fileName, new Blob([new Uint8Array(result.zip)], { type: "application/zip" }));
      setOutcome({
        text: `${String(result.invoiceCount)} Rechnungen, ${String(result.paymentCount)} Zahlungen und ${String(result.expenseCount)} Ausgaben aus ${periodLabel(period)} im Paket.`,
        missing: result.missing, taxFree: result.missingTaxFreeAccount, unassigned: result.expensesWithoutAccount,
      });
    }).then(() => { setProgress(null); });
  };
  return { action, progress, outcome, build, reset: () => { setOutcome(null); } };
}

export function Steuerpaket({ onClose }: { onClose: () => void }) {
  const [period, setPeriod] = useState<TaxPeriod>(() => previousMonth(today()));
  const { action, progress, outcome, build, reset } = usePackageBuild(period);
  return (
    <section class="panel stack" aria-labelledby="paket-head">
      <h2 id="paket-head">Paket für den Steuerberater</h2>
      <p class="muted">Eine Zip-Datei mit allen Rechnungs-PDFs des Zeitraums, den Listen der Rechnungen, Zahlungen und offenen Posten als Tabelle, dem Buchungsstapel für DATEV sowie den Ausgaben mit eigenem Buchungsstapel (datev-ausgaben.csv) und allen Belegen.</p>
      <MissingNumbers />
      <PeriodPicker period={period} onChange={(next) => { setPeriod(next); reset(); }} />
      <ErrorNote message={action.error} />
      {outcome !== null && <PackageOutcome outcome={outcome} />}
      <div class="cluster">
        <button class="button button--gold" type="button" disabled={action.busy} onClick={build}>{action.busy ? "Erstellt …" : `Paket für ${periodLabel(period)} herunterladen`}</button>
        <button class="button button--quiet" type="button" onClick={onClose}>Schließen</button>
        {progress !== null && <span class="small muted" role="status">{progress}</span>}
      </div>
    </section>
  );
}

function PackageOutcome({ outcome }: { outcome: Outcome }) {
  return (
    <>
      {outcome.missing.length === 0 ? <p class="note note--good">{outcome.text}</p> : (
        <p class="note note--bad" role="alert">
          {outcome.text} Zu {outcome.missing.length === 1 ? "dieser Rechnung fehlt" : "diesen Rechnungen fehlt"} noch das PDF: <strong>{outcome.missing.join(", ")}</strong>.
          Der Mail-Dienst erzeugt fehlende PDFs bei seinem nächsten Durchlauf, spätestens nach fünf Minuten; danach das Paket noch einmal herunterladen. Die Liste liegt auch als fehlende-pdfs.txt im Paket.
        </p>
      )}
      {outcome.unassigned.length > 0 && (
        <p class="note note--gold">{outcome.unassigned.length === 1 ? "Eine Ausgabe hat" : `${String(outcome.unassigned.length)} Ausgaben haben`} noch kein Konto und {outcome.unassigned.length === 1 ? "fehlt" : "fehlen"} im Buchungsstapel der Ausgaben; unter <a href="/finanzen?tab=ausgaben">Finanzen → Ausgaben</a> ein Konto wählen und das Paket noch einmal herunterladen.</p>
      )}
      {outcome.taxFree.length > 0 && (
        <p class="note note--gold">Für Positionen ohne Umsatzsteuer in <strong>{outcome.taxFree.join(", ")}</strong> fehlt im Buchungsstapel das Erlöskonto; trag das Konto für steuerfreie Umsätze von deinem Steuerberater unter <a href="/einstellungen">Einstellungen → Firma</a> ein.</p>
      )}
    </>
  );
}
