// Money of the company: the bank statement with every incoming payment and what became of it, the
// expenses with their account and receipts, the profit per month by payment date, and where the
// customers come from.
import { useLocation } from "preact-iso";
import { useState } from "preact/hooks";
import {
  addCashExpense, assignToInvoice, classifyIncoming, classifyOutgoing, importStatement, linkPayment, listAccounts, listExpenses, listImports,
  listOpenInvoices, listTransactions, listUnlinkedPayments, profitByMonth, receiptLink, releaseTransaction, setExpenseAccount, uploadReceipt,
  type CashExpense, type OpenInvoice,
} from "../api/finance";
import type { BankTransaction, Expense, ExpenseAccount, ImportResult, TransactionStatus, VatRate } from "../api/types";
import { Herkunft } from "../components/Herkunft";
import { ReversalPick } from "../components/Rueckbuchung";
import { SignedLink } from "../components/SignedLink";
import { Badge, Empty, ErrorNote, Field, Kpi, Loading, PageHead, Tabs, type Tone } from "../components/ui";
import { useSettings } from "../hooks/settings";
import { useAction, useAsync } from "../hooks/useAsync";
import { countedExpenses, monthRows, yearBefore, yearToDate, type MonthRow } from "../lib/finance";
import { date, euro, monthName, today, TRANSACTION_STATUS } from "../lib/format";
import { parseAmount } from "../lib/money";

type Tab = "konto" | "ausgaben" | "gewinn" | "herkunft";
const TABS: Tab[] = ["konto", "ausgaben", "gewinn", "herkunft"];

export function Finanzen() {
  const { query, route } = useLocation();
  const [tab, setTab] = useState<Tab>(TABS.includes(query.tab as Tab) ? (query.tab as Tab) : "konto");
  const change = (next: Tab) => { setTab(next); route(`/finanzen?tab=${next}`, true); };
  return (
    <div class="stack stack--loose">
      <PageHead kicker="Finanzen" title="Konto, Ausgaben und Gewinn" />
      <Tabs value={tab} onChange={change} options={[
        { id: "konto", label: "Kontoauszug" }, { id: "ausgaben", label: "Ausgaben" }, { id: "gewinn", label: "Gewinn" },
        { id: "herkunft", label: "Herkunft der Kunden" },
      ]} />
      {tab === "konto" && <Kontoauszug />}
      {tab === "ausgaben" && <Ausgaben />}
      {tab === "gewinn" && <Gewinn />}
      {tab === "herkunft" && <Herkunft />}
    </div>
  );
}

// Kontoauszug

function resultText(result: ImportResult): string {
  if (result.new === 0) return `Keine neuen Buchungen (${String(result.entries)} schon bekannt).`;
  const parts = [`${String(result.new)} neue Buchung(en)`];
  if (result.paid > 0) parts.push(`${String(result.paid)} Rechnung(en) als bezahlt verbucht`);
  if (result.suggested > 0) parts.push(`${String(result.suggested)} Vorschlag/Vorschläge zur Freigabe`);
  if (result.open > 0) parts.push(`${String(result.open)} Eingang/Eingänge ohne Rechnung`);
  if (result.expenses > 0) parts.push(`${String(result.expenses)} Ausgabe(n)`);
  if (result.reversals > 0) parts.push(`${String(result.reversals)} Rückbuchung(en) zum Prüfen`);
  if (result.skipped > 0) parts.push(`${String(result.skipped)} übersprungen (vorgemerkt oder nicht in Euro)`);
  return `${parts.join(", ")}.`;
}

function ImportPanel({ onImported }: { onImported: () => void }) {
  const { settings } = useSettings();
  const imports = useAsync(() => listImports(), []);
  const [result, setResult] = useState<string | null>(null);
  const action = useAction();
  const upload = (files: FileList | null) => {
    const file = files?.[0];
    if (file === undefined) return;
    void action.run(async () => { setResult(resultText(await importStatement(file))); imports.reload(); onImported(); });
  };
  const last = imports.data?.[0];
  return (
    <section class="panel stack">
      <h2>Kontoauszug einlesen</h2>
      <p class="small muted">Im Online-Banking den Kontoauszug als CAMT.053 (XML-Datei) herunterladen und hier auswählen. Dieselbe Datei zweimal einzulesen schadet nicht.</p>
      {settings?.iban.trim() === "" && (
        <p class="note">Erst die IBAN des Geschäftskontos unter <a href="/einstellungen">Einstellungen → Firma</a> eintragen; nur Auszüge dieses Kontos werden angenommen.</p>
      )}
      <Field label="Datei">
        <input type="file" accept=".xml,application/xml,text/xml" disabled={action.busy} onChange={(event) => { upload(event.currentTarget.files); event.currentTarget.value = ""; }} />
      </Field>
      {action.busy && <p class="small muted" role="status">Liest ein …</p>}
      {result !== null && <p class="note note--good" role="status">{result}</p>}
      <ErrorNote message={action.error} />
      {last !== undefined && <p class="small muted">Zuletzt eingelesen: {last.file_name || "Kontoauszug"} am {date(last.imported_at)}, Buchungen bis {date(last.statement_to)}.</p>}
    </section>
  );
}

function Kontoauszug() {
  const from = today(-90);
  const transactions = useAsync(() => listTransactions(from), [from]);
  const [filter, setFilter] = useState<"unklar" | "alle">("unklar");
  const all = transactions.data ?? [];
  const unclear = all.filter(isUnclear);
  return (
    <div class="stack">
      <ImportPanel onImported={transactions.reload} />
      <Tabs value={filter} onChange={setFilter} options={[{ id: "unklar", label: "Unklar", count: unclear.length }, { id: "alle", label: "Alle der letzten 90 Tage" }]} />
      <ErrorNote message={transactions.error} />
      {transactions.data === undefined ? <Loading /> : <TransactionTable transactions={filter === "unklar" ? unclear : all} onChange={transactions.reload} />}
    </div>
  );
}

function isUnclear(tx: BankTransaction): boolean {
  return tx.status === "open" || tx.status === "suggested";
}

const TONE: Record<TransactionStatus, Tone> = { paid: "good", suggested: "gold", open: "bad", other_income: "", private: "ink", expense: "", reversed: "ink" };

function TransactionTable({ transactions, onChange }: { transactions: BankTransaction[]; onChange: () => void }) {
  const invoices = useAsync(() => listOpenInvoices(), [transactions.length]);
  if (transactions.length === 0) return <Empty>Keine Buchungen in dieser Ansicht.</Empty>;
  return (
    <div class="table-wrap panel panel--flat">
      <table class="table table--rows">
        <thead><tr><th>Datum</th><th>Von / an</th><th>Verwendungszweck</th><th class="num">Betrag</th><th>Stand</th></tr></thead>
        <tbody>
          {transactions.map((tx) => {
            const label = TRANSACTION_STATUS[tx.status];
            const tone = TONE[tx.status];
            return (
              <tr key={tx.id}>
                <td data-label="Datum">{date(tx.booking_date)}</td>
                <td data-label="Von / an">{tx.counterparty || "–"}</td>
                <td data-label="Verwendungszweck" class="small">{tx.purpose || "–"}</td>
                <td data-label="Betrag" class={tx.direction === "in" ? "num" : "num late"}>{tx.direction === "in" ? euro(tx.amount) : euro(-tx.amount)}</td>
                <td data-label="Stand">
                  <Badge tone={tone}>{label}</Badge>{tx.reversal && <> <Badge tone="bad">Rückbuchung</Badge></>}
                  {tx.invoice?.number !== undefined && tx.invoice.number !== null && <div class="small"><a href={`/rechnung/${tx.invoice.id}`}>{tx.invoice.number}</a></div>}
                  <Decide tx={tx} invoices={invoices.data ?? []} onDone={onChange} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Decide({ tx, invoices, onDone }: { tx: BankTransaction; invoices: OpenInvoice[]; onDone: () => void }) {
  const action = useAction();
  const run = (task: () => Promise<void>) => { void action.run(async () => { await task(); onDone(); }); };
  let body = null;
  if (tx.status === "paid") body = <Release onRelease={() => { run(() => releaseTransaction(tx.id)); }} busy={action.busy} />;
  else if (isUnclear(tx) && tx.direction === "out") {
    body = (
      <>
        {tx.reversal && <ReversalPick reversal={tx} busy={action.busy} run={run} />}
        <div class="cluster">
          <button class="button" type="button" disabled={action.busy} onClick={() => { run(() => classifyOutgoing(tx.id, "expense")); }}>Als Ausgabe führen</button>
          <button class="button button--quiet" type="button" disabled={action.busy} onClick={() => { run(() => classifyOutgoing(tx.id, "private")); }}>Privat</button>
        </div>
      </>
    );
  } else if (isUnclear(tx)) {
    body = (
      <>
        {tx.reversal ? <ReversalPick reversal={tx} busy={action.busy} run={run} /> : <AssignIncoming tx={tx} invoices={invoices} busy={action.busy} run={run} />}
        <div class="cluster">
          <button class="button button--quiet" type="button" disabled={action.busy} onClick={() => { run(() => classifyIncoming(tx.id, "other_income")); }}>Sonstige Einnahme</button>
          <button class="button button--quiet" type="button" disabled={action.busy} onClick={() => { run(() => classifyIncoming(tx.id, "private")); }}>Privat eingezahlt</button>
        </div>
      </>
    );
  }
  if (body === null) return null;
  return <div class="stack stack--tight decide">{body}<ErrorNote message={action.error} /></div>;
}

function Release({ onRelease, busy }: { onRelease: () => void; busy: boolean }) {
  const [asking, setAsking] = useState(false);
  if (!asking) return <button class="link-button small" type="button" onClick={() => { setAsking(true); }}>Zuordnung zurücknehmen</button>;
  return (
    <div class="cluster">
      <span class="small">Zahlung von der Rechnung nehmen?</span>
      <button class="button" type="button" disabled={busy} onClick={onRelease}>Ja, zurücknehmen</button>
      <button class="button button--quiet" type="button" onClick={() => { setAsking(false); }}>Nein</button>
    </div>
  );
}

interface AssignProps {
  tx: BankTransaction;
  invoices: OpenInvoice[];
  busy: boolean;
  run: (task: () => Promise<void>) => void;
}

function AssignIncoming({ tx, invoices, busy, run }: AssignProps) {
  const [invoice, setInvoice] = useState(tx.invoice_id ?? "");
  const [payment, setPayment] = useState("");
  const known = useAsync(() => listUnlinkedPayments(tx.amount), [tx.amount]);
  return (
    <>
      <div class="cluster">
        <select class="select" aria-label="Offene Rechnung" value={invoice} onChange={(event) => { setInvoice(event.currentTarget.value); }}>
          <option value="">Rechnung wählen …</option>
          {invoices.map((open) => <option key={open.id} value={open.id}>{open.number} · {open.customer?.name} · offen {euro(open.gross - open.paid_amount)}</option>)}
        </select>
        <button class="button button--gold" type="button" disabled={invoice === "" || busy} onClick={() => { run(() => assignToInvoice(tx.id, invoice)); }}>Zuordnen</button>
      </div>
      {(known.data ?? []).length > 0 && (
        <div class="cluster">
          <select class="select" aria-label="Schon erfasste Zahlung" value={payment} onChange={(event) => { setPayment(event.currentTarget.value); }}>
            <option value="">Schon erfasste Zahlung …</option>
            {(known.data ?? []).map((row) => <option key={row.id} value={row.id}>{row.invoice_number} · {row.customer_name} · {date(row.paid_on)}</option>)}
          </select>
          <button class="button" type="button" disabled={payment === "" || busy} onClick={() => { run(() => linkPayment(tx.id, payment)); }}>Verknüpfen</button>
        </div>
      )}
    </>
  );
}

// Ausgaben

function monthRange(month: string): { from: string; to: string } {
  const [year, index] = month.split("-").map(Number);
  const last = new Date(Date.UTC(year ?? 2026, index ?? 1, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}

function Ausgaben() {
  const { settings } = useSettings();
  const [month, setMonth] = useState(today().slice(0, 7));
  const [onlyOpen, setOnlyOpen] = useState(false);
  const range = monthRange(month);
  const expenses = useAsync(() => listExpenses(range.from, range.to), [range.from, range.to]);
  const accounts = useAsync(() => listAccounts(), []);
  const smallBusiness = settings?.small_business !== false;
  const all = expenses.data ?? [];
  const counted = countedExpenses(all);
  const shown = onlyOpen ? counted.filter((expense) => expense.account === null) : all;
  return (
    <div class="stack">
      <ExpenseHead month={month} onMonth={setMonth} onlyOpen={onlyOpen} onOnlyOpen={setOnlyOpen} accounts={accounts.data} smallBusiness={smallBusiness} onAdded={expenses.reload} />
      <p class="small muted">
        {monthName(range.from)}: {String(counted.length)} Ausgabe(n), zusammen {euro(counted.reduce((sum, expense) => sum + expense.amount, 0))};
        {" "}{String(counted.filter((expense) => expense.account === null).length)} noch ohne Konto.
      </p>
      <ErrorNote message={expenses.error ?? accounts.error} />
      {expenses.data === undefined || accounts.data === undefined ? <Loading /> : shown.length === 0 ? <Empty>Keine Ausgaben in dieser Ansicht.</Empty> : (
        <div class="table-wrap panel panel--flat">
          <table class="table table--rows">
            <thead><tr><th>Datum</th><th>Empfänger</th><th class="num">Betrag</th><th>Konto</th>{!smallBusiness && <th>USt laut Beleg</th>}<th>Beleg</th></tr></thead>
            <tbody>{shown.map((expense) => <ExpenseRow key={expense.id} expense={expense} accounts={accounts.data ?? []} smallBusiness={smallBusiness} onChange={expenses.reload} />)}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

interface ExpenseHeadProps {
  month: string;
  onMonth: (next: string) => void;
  onlyOpen: boolean;
  onOnlyOpen: (next: boolean) => void;
  accounts: ExpenseAccount[] | undefined;
  smallBusiness: boolean;
  onAdded: () => void;
}

function ExpenseHead({ month, onMonth, onlyOpen, onOnlyOpen, accounts, smallBusiness, onAdded }: ExpenseHeadProps) {
  const [adding, setAdding] = useState(false);
  return (
    <>
      <div class="spread">
        <div class="cluster">
          <Field label="Monat"><input type="month" value={month} onInput={(event) => { if (event.currentTarget.value !== "") onMonth(event.currentTarget.value); }} /></Field>
          <label class="check"><input type="checkbox" checked={onlyOpen} onChange={(event) => { onOnlyOpen(event.currentTarget.checked); }} /> Nur ohne Konto</label>
        </div>
        <button class="button button--gold" type="button" onClick={() => { setAdding(true); }}>+ Barausgabe</button>
      </div>
      {adding && accounts !== undefined && (
        <CashExpenseForm accounts={accounts} smallBusiness={smallBusiness} onDone={() => { setAdding(false); onAdded(); }} onCancel={() => { setAdding(false); }} />
      )}
    </>
  );
}

const RATES: VatRate[] = [19, 7, 0];

/** Only business expenses carry input VAT; private withdrawals and tax payments never do. */
function takesVat(accounts: ExpenseAccount[], account: string | null): boolean {
  return accounts.find((candidate) => candidate.number === account)?.kind === "expense";
}

function AccountSelect({ accounts, value, onChange, disabled }: { accounts: ExpenseAccount[]; value: string; onChange: (next: string) => void; disabled?: boolean }) {
  return (
    <select class="select" aria-label="Konto" value={value} disabled={disabled} onChange={(event) => { onChange(event.currentTarget.value); }}>
      <option value="">Konto wählen …</option>
      {accounts.map((account) => <option key={account.number} value={account.number}>{account.number} {account.name}</option>)}
    </select>
  );
}

function ExpenseRow({ expense, accounts, smallBusiness, onChange }: { expense: Expense; accounts: ExpenseAccount[]; smallBusiness: boolean; onChange: () => void }) {
  const action = useAction();
  const save = (account: string, rate: VatRate) => {
    if (account === "") return;
    void action.run(async () => { await setExpenseAccount(expense.id, account, rate); onChange(); });
  };
  return (
    <tr>
      <td data-label="Datum">{date(expense.spent_on)}{expense.method === "cash" && <div class="small muted">bar</div>}</td>
      <td data-label="Empfänger">{expense.counterparty || "–"}<div class="small muted">{expense.purpose}</div></td>
      <td data-label="Betrag" class="num">{euro(expense.amount)}{expense.reversed_by !== null && <div><Badge tone="ink">zurückgebucht</Badge></div>}</td>
      <td data-label="Konto">
        <AccountSelect accounts={accounts} value={expense.account ?? ""} disabled={action.busy} onChange={(next) => { save(next, expense.vat_rate); }} />
        <ErrorNote message={action.error} />
      </td>
      {!smallBusiness && (
        <td data-label="USt laut Beleg">
          <RateSelect value={expense.vat_rate} disabled={action.busy || !takesVat(accounts, expense.account)} onChange={(rate) => { save(expense.account ?? "", rate); }} />
        </td>
      )}
      <td data-label="Beleg"><Receipts expense={expense} onChange={onChange} /></td>
    </tr>
  );
}

function RateSelect({ value, disabled = false, onChange }: { value: VatRate; disabled?: boolean; onChange: (next: VatRate) => void }) {
  return (
    <select class="select" aria-label="Umsatzsteuer laut Beleg" value={String(value)} disabled={disabled} onChange={(event) => { onChange(Number(event.currentTarget.value) as VatRate); }}>
      {RATES.map((rate) => <option key={rate} value={String(rate)}>{rate} %</option>)}
    </select>
  );
}

function Receipts({ expense, onChange }: { expense: Expense; onChange: () => void }) {
  const action = useAction();
  const receipts = expense.receipts ?? [];
  const upload = (files: FileList | null) => {
    const file = files?.[0];
    if (file === undefined) return;
    void action.run(async () => { await uploadReceipt(expense.id, file); onChange(); });
  };
  return (
    <div class="stack stack--tight">
      {receipts.map((receipt) => <SignedLink key={receipt.id} label={receipt.file_name} sign={() => receiptLink(receipt.path)} />)}
      <label class="link-button">
        {receipts.length === 0 ? "Beleg anhängen" : "Weiteren Beleg anhängen"}
        <input class="visually-hidden" type="file" accept="application/pdf,image/jpeg,image/png,image/heic,image/webp" disabled={action.busy}
          onChange={(event) => { upload(event.currentTarget.files); event.currentTarget.value = ""; }} />
      </label>
      {action.busy && <span class="small muted" role="status">Lädt hoch …</span>}
      <ErrorNote message={action.error} />
    </div>
  );
}

function useCashDraft(smallBusiness: boolean) {
  const [spentOn, setSpentOn] = useState(today());
  const [amount, setAmount] = useState("");
  const [counterparty, setCounterparty] = useState("");
  const [purpose, setPurpose] = useState("");
  const [account, setAccount] = useState("");
  const [rate, setRate] = useState<VatRate>(smallBusiness ? 0 : 19);
  const toExpense = (): CashExpense => {
    const value = parseAmount(amount);
    if (value === null || value <= 0) throw new Error("Bitte einen Betrag größer als 0 eingeben.");
    if (counterparty.trim() === "") throw new Error("Bitte angeben, wo bezahlt wurde.");
    return { spentOn, amount: value, counterparty, purpose, account, vatRate: smallBusiness ? 0 : rate };
  };
  return { spentOn, setSpentOn, amount, setAmount, counterparty, setCounterparty, purpose, setPurpose, account, setAccount, rate, setRate, toExpense };
}

function CashExpenseForm({ accounts, smallBusiness, onDone, onCancel }: { accounts: ExpenseAccount[]; smallBusiness: boolean; onDone: () => void; onCancel: () => void }) {
  const draft = useCashDraft(smallBusiness);
  const action = useAction();
  const submit = (event: Event) => {
    event.preventDefault();
    void action.run(async () => { await addCashExpense(draft.toExpense()); onDone(); });
  };
  return (
    <form class="panel stack" onSubmit={submit}>
      <h2>Barausgabe</h2>
      <div class="form-grid">
        <Field label="Datum"><input type="date" max={today()} value={draft.spentOn} onInput={(event) => { draft.setSpentOn(event.currentTarget.value); }} /></Field>
        <Field label="Betrag (€)"><input inputMode="decimal" value={draft.amount} onInput={(event) => { draft.setAmount(event.currentTarget.value); }} /></Field>
        <Field label="Wo bezahlt"><input value={draft.counterparty} onInput={(event) => { draft.setCounterparty(event.currentTarget.value); }} /></Field>
        <Field label="Wofür"><input value={draft.purpose} onInput={(event) => { draft.setPurpose(event.currentTarget.value); }} /></Field>
        <Field label="Konto"><AccountSelect accounts={accounts} value={draft.account} onChange={draft.setAccount} /></Field>
        {!smallBusiness && <Field label="USt laut Beleg"><RateSelect value={draft.rate} onChange={draft.setRate} /></Field>}
      </div>
      <p class="small muted">Den Beleg danach in der Liste anhängen.</p>
      <ErrorNote message={action.error} />
      <div class="cluster">
        <button class="button button--gold" type="submit" disabled={action.busy}>Speichern</button>
        <button class="button" type="button" onClick={onCancel}>Abbrechen</button>
      </div>
    </form>
  );
}

// Gewinn

function signed(value: number): string {
  return value > 0 ? `+${euro(value)}` : euro(value);
}

function Gewinn() {
  const to = today();
  const from = yearBefore(to);
  const months = useAsync(() => profitByMonth(from, to), [from, to]);
  if (months.error !== null) return <ErrorNote message={months.error} />;
  if (months.data === undefined) return <Loading />;
  const rows = monthRows(months.data);
  const current = rows.at(-1);
  const year = yearToDate(months.data);
  return (
    <div class="stack">
      <p class="small muted">Gerechnet nach Zahlungsdatum: Einnahmen sind eingegangene Zahlungen und sonstige Einnahmen, Ausgaben alles, was das Konto verlassen hat, außer privaten Entnahmen. Ausgaben ohne Konto zählen schon mit.</p>
      <section class="kpis" aria-label="Gewinn">
        {current !== undefined && <Kpi label={`Gewinn ${monthName(current.month)}`} value={euro(current.profit)} hint={current.change === null ? undefined : `${signed(current.change)} zum Vormonat`} />}
        {year !== null && <Kpi label={`Gewinn ${String(year.year)} bis heute`} value={euro(year.profit)} hint={`Einnahmen ${euro(year.income)}, Ausgaben ${euro(year.expenses)}`} />}
      </section>
      <MonthTable rows={rows} />
    </div>
  );
}

function MonthTable({ rows }: { rows: MonthRow[] }) {
  return (
    <div class="table-wrap panel panel--flat">
      <table class="table table--rows">
        <thead><tr><th>Monat</th><th class="num">Einnahmen</th><th class="num">Ausgaben</th><th class="num">davon ohne Konto</th><th class="num">Gewinn</th><th class="num">zum Vormonat</th></tr></thead>
        <tbody>
          {[...rows].reverse().map((row) => (
            <tr key={row.month}>
              <td data-label="Monat">{monthName(row.month)}</td>
              <td data-label="Einnahmen" class="num">{euro(row.income)}</td>
              <td data-label="Ausgaben" class="num">{euro(row.expenses)}</td>
              <td data-label="davon ohne Konto" class="num">{row.unassigned === 0 ? "–" : <a href="/finanzen?tab=ausgaben">{euro(row.unassigned)}</a>}</td>
              <td data-label="Gewinn" class={row.profit < 0 ? "num late" : "num"}>{euro(row.profit)}</td>
              <td data-label="zum Vormonat" class="num">{row.change === null ? "–" : signed(row.change)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
