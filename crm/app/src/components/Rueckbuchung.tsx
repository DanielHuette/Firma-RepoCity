// A reversal the CRM could not tie to one booking by itself: Daniel picks the booking it takes back
// and confirms, and both stop counting (a paid invoice is open again), as after "Verrechnen" in the
// Cockpit. Netting cannot be undone, so the choice names status, invoice and the best fit.
import { useState } from "preact/hooks";
import { listReversalCandidates, netReversal } from "../api/finance";
import type { BankTransaction } from "../api/types";
import { useAsync } from "../hooks/useAsync";
import { date, euro, TRANSACTION_STATUS } from "../lib/format";
import { ErrorNote, Loading } from "./ui";

interface Props {
  reversal: BankTransaction;
  busy: boolean;
  run: (task: () => Promise<void>) => void;
}

function fits(reversal: BankTransaction, candidate: BankTransaction): boolean {
  return (reversal.end_to_end_id !== "" && candidate.end_to_end_id === reversal.end_to_end_id)
    || (reversal.counterparty_iban !== "" && candidate.counterparty_iban === reversal.counterparty_iban);
}

function label(reversal: BankTransaction, tx: BankTransaction): string {
  const invoice = tx.invoice?.number === undefined || tx.invoice.number === null ? "" : ` · ${tx.invoice.number}`;
  const best = fits(reversal, tx) ? " · passt am besten" : "";
  return `${date(tx.booking_date)} · ${tx.counterparty || "Unbekannt"} · ${TRANSACTION_STATUS[tx.status]}${invoice} · ${tx.purpose.slice(0, 50)}${best}`;
}

export function ReversalPick({ reversal, busy, run }: Props) {
  const candidates = useAsync(() => listReversalCandidates(reversal.id), [reversal.id]);
  const [original, setOriginal] = useState("");
  const [asking, setAsking] = useState(false);
  if (candidates.error !== null) return <ErrorNote message={candidates.error} />;
  if (candidates.data === undefined) return <Loading label="Sucht passende Buchungen …" />;
  if (candidates.data.length === 0) {
    return <p class="small muted">Keine Buchung über {euro(reversal.amount)} in den 180 Tagen davor; bitte unten einordnen.</p>;
  }
  const options = candidates.data;
  return (
    <div class="stack stack--tight">
      <select class="select" aria-label="Ursprüngliche Buchung" value={original} onChange={(event) => { setOriginal(event.currentTarget.value); setAsking(false); }}>
        <option value="">Ursprüngliche Buchung wählen …</option>
        {options.map((tx) => <option key={tx.id} value={tx.id}>{label(reversal, tx)}</option>)}
      </select>
      {asking ? (
        <div class="cluster">
          <span class="small">Beide Buchungen zählen danach nicht mehr, eine bezahlte Rechnung ist wieder offen. Das lässt sich nicht zurücknehmen.</span>
          <button class="button button--gold" type="button" disabled={busy} onClick={() => { run(() => netReversal(reversal.id, original)); }}>Ja, verrechnen</button>
          <button class="button button--quiet" type="button" onClick={() => { setAsking(false); }}>Nein</button>
        </div>
      ) : (
        <button class="button button--gold" type="button" disabled={original === "" || busy} onClick={() => { setAsking(true); }}>Verrechnen</button>
      )}
    </div>
  );
}
