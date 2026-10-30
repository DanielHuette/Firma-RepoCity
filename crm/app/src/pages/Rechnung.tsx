// One invoice. A draft is edited, then finalised and sent; after that it is fixed by law (GoBD) and
// only payments, reminders and a cancellation remain possible.
import { useLocation } from "preact-iso";
import { useEffect, useState } from "preact/hooks";
import { cancelInvoice, deleteInvoiceDraft, finalizeInvoice, loadCustomer, loadInvoice, recordPayment, saveInvoiceDraft } from "../api/crm";
import { sendInvoice } from "../api/flow";
import type { Customer, Invoice, LineItem, OutboxMail, Payment, PaymentMethod } from "../api/types";
import { ItemsEditor } from "../components/ItemsEditor";
import { InvoiceBadge } from "../components/Status";
import { Versand, useMails } from "../components/Versand";
import { ErrorNote, Field, Loading, PageHead } from "../components/ui";
import { useSettings } from "../hooks/settings";
import { useAction, useAsync, type Action } from "../hooks/useAsync";
import { downloadText } from "../lib/download";
import { DUNNING_LEVEL, PAYMENT_METHOD, date, euro, today } from "../lib/format";
import { parseAmount } from "../lib/money";
import { XRechnungError, buildXRechnung } from "../lib/xrechnung";

export function Rechnung({ id }: { id: string }) {
  const loaded = useAsync(() => loadInvoice(id), [id]);
  if (loaded.error !== null) return <ErrorNote message={loaded.error} />;
  if (loaded.data === undefined) return <Loading />;
  return <InvoiceView invoice={loaded.data.invoice} initialItems={loaded.data.items} payments={loaded.data.payments} reload={loaded.reload} />;
}

type InvoiceDraft = ReturnType<typeof useInvoiceDraft>;

function useInvoiceDraft(invoice: Invoice, initialItems: LineItem[]) {
  const [items, setItems] = useState(initialItems);
  const [intro, setIntro] = useState(invoice.intro);
  const [outro, setOutro] = useState(invoice.outro);
  const [serviceDate, setServiceDate] = useState(invoice.service_date ?? today());
  const [dirty, setDirty] = useState(false);
  useEffect(() => { setItems(initialItems); setDirty(false); }, [initialItems]);
  const edited = <T,>(set: (value: T) => void) => (value: T) => { set(value); setDirty(true); };
  const persist = async () => { await saveInvoiceDraft(invoice.id, { intro, outro, service_date: serviceDate }, items); setDirty(false); };
  return {
    items, intro, outro, serviceDate, dirty, persist,
    setItems: edited(setItems), setIntro: edited(setIntro), setOutro: edited(setOutro), setServiceDate: edited(setServiceDate),
  };
}

function InvoiceView({ invoice, initialItems, payments, reload }: { invoice: Invoice; initialItems: LineItem[]; payments: Payment[]; reload: () => void }) {
  const customer = useAsync(() => loadCustomer(invoice.customer_id), [invoice.customer_id]);
  const draft = useInvoiceDraft(invoice, initialItems);
  const mails = useMails("invoice_id", invoice.id);
  const action = useAction();
  const done = () => { reload(); mails.reload(); };
  const isCredit = invoice.cancels_invoice_id !== null;
  return (
    <div class="stack stack--loose">
      <InvoiceHead invoice={invoice} items={initialItems} action={action} />
      <ErrorNote message={action.error} />
      {invoice.status === "draft" && <DraftStep invoice={invoice} draft={draft} customer={customer.data} action={action} onDone={done} />}
      {invoice.status === "open" && !isCredit && <OpenStep invoice={invoice} customer={customer.data} mails={mails.data} action={action} onDone={done} />}
      {invoice.status === "paid" && !isCredit && <p class="note note--good">Vollständig bezahlt.</p>}
      {invoice.status === "cancelled" && <p class="note note--bad">Diese Rechnung wurde storniert.</p>}
      {invoice.status !== "draft" && <Versand owner="invoice_id" id={invoice.id} mails={mails} />}
      <InvoiceForm invoice={invoice} draft={draft} />
      <Payments payments={payments} />
    </div>
  );
}

function InvoiceHead({ invoice, items, action }: { invoice: Invoice; items: LineItem[]; action: Action }) {
  const draft = invoice.status === "draft";
  const isCredit = invoice.cancels_invoice_id !== null;
  const eInvoice = () => {
    void action.run(() => {
      try {
        downloadText(`${invoice.number ?? "rechnung"}.xml`, buildXRechnung(invoice, items), "application/xml");
      } catch (error) {
        if (error instanceof XRechnungError) throw new Error(error.message);
        throw error;
      }
      return Promise.resolve();
    });
  };
  return (
    <PageHead kicker={`${isCredit ? "Stornorechnung" : "Rechnung"} · ${invoice.customer?.name ?? ""}`} title={invoice.number ?? "Rechnungsentwurf"}>
      <InvoiceBadge status={invoice.status} dueDate={invoice.due_date} isCredit={isCredit} />
      <a class="button" href={`/druck/rechnung/${invoice.id}`} target="_blank" rel="noopener">{draft ? "Vorschau" : "Als PDF / Drucken"}</a>
      {!draft && <button class="button" type="button" onClick={eInvoice}>E-Rechnung (XRechnung)</button>}
    </PageHead>
  );
}

interface StepProps {
  invoice: Invoice;
  customer: Customer | undefined;
  action: Action;
  onDone: () => void;
}

function DraftStep({ invoice, draft, customer, action, onDone }: StepProps & { draft: InvoiceDraft }) {
  const [confirming, setConfirming] = useState(false);
  const { route } = useLocation();
  const finish = (send: boolean) => {
    void action.run(async () => {
      await draft.persist();
      if (send) await sendInvoice(invoice.id); else await finalizeInvoice(invoice.id, draft.serviceDate);
      setConfirming(false);
      onDone();
    });
  };
  const discard = () => { void action.run(async () => { await deleteInvoiceDraft(invoice.id); route("/rechnungen"); }); };
  if (confirming) return <ConfirmFinalize invoice={invoice} customer={customer} dirty={draft.dirty} busy={action.busy} onFinish={finish} onCancel={() => { setConfirming(false); }} />;
  return (
    <div class="next-step">
      <p><strong>Nächster Schritt:</strong> Positionen prüfen, dann festschreiben und senden. Erst dann bekommt die Rechnung ihre Nummer.</p>
      <div class="cluster">
        <button class="button button--gold" type="button" disabled={action.busy || draft.items.length === 0} onClick={() => { setConfirming(true); }}>Festschreiben und senden</button>
        {draft.dirty && <button class="button" type="button" disabled={action.busy} onClick={() => { void action.run(async () => { await draft.persist(); onDone(); }); }}>Speichern</button>}
        <button class="button button--quiet" type="button" disabled={action.busy} onClick={discard}>Entwurf verwerfen</button>
      </div>
    </div>
  );
}

function ConfirmFinalize({ invoice, customer, dirty, busy, onFinish, onCancel }: {
  invoice: Invoice; customer: Customer | undefined; dirty: boolean; busy: boolean; onFinish: (send: boolean) => void; onCancel: () => void;
}) {
  const email = customer?.email ?? "";
  return (
    <div class="next-step next-step--warn">
      <p>
        <strong>Wirklich festschreiben?</strong> Danach ist die Rechnung gesetzlich unveränderlich. Korrigieren geht dann nur noch über eine Stornorechnung.
        Gesamtbetrag: <strong>{euro(invoice.gross)}</strong>{dirty && " (ungespeicherte Änderungen werden mit übernommen)"}.
        {email === "" ? " Beim Kunden fehlt die E-Mail-Adresse, deshalb kann die Rechnung nur festgeschrieben werden." : ` Die Rechnung geht als PDF per E-Mail an ${email}.`}
      </p>
      <div class="cluster">
        {email !== "" && <button class="button button--gold" type="button" disabled={busy} onClick={() => { onFinish(true); }}>Ja, festschreiben und senden</button>}
        <button class={email === "" ? "button button--gold" : "button"} type="button" disabled={busy} onClick={() => { onFinish(false); }}>Nur festschreiben</button>
        <button class="button button--quiet" type="button" onClick={onCancel}>Abbrechen</button>
      </div>
    </div>
  );
}

function OpenStep({ invoice, customer, mails, action, onDone }: StepProps & { mails: OutboxMail[] | undefined }) {
  const { route } = useLocation();
  const open = invoice.gross - invoice.paid_amount;
  const unsent = mails !== undefined && !mails.some((mail) => mail.kind === "invoice");
  const canSend = unsent && (customer?.email ?? "") !== "";
  const send = () => { void action.run(async () => { await sendInvoice(invoice.id); onDone(); }); };
  const cancel = () => { void action.run(async () => { const credit = await cancelInvoice(invoice.id); route(`/rechnung/${credit.id}`); }); };
  return (
    <div class="next-step">
      <p><strong>Offen: {euro(open)}</strong> · fällig am {date(invoice.due_date)}{invoice.dunning_level > 0 && <> · <span class="late">{DUNNING_LEVEL[invoice.dunning_level]} versendet</span></>}</p>
      {canSend && <div class="cluster"><button class="button" type="button" disabled={action.busy} onClick={send}>Rechnung per E-Mail senden</button></div>}
      <PaymentForm invoiceId={invoice.id} open={open} onDone={onDone} />
      {invoice.paid_amount === 0 && <button class="button button--quiet" type="button" disabled={action.busy} onClick={cancel}>Rechnung stornieren</button>}
    </div>
  );
}

function InvoiceForm({ invoice, draft }: { invoice: Invoice; draft: InvoiceDraft }) {
  const { settings } = useSettings();
  const editable = invoice.status === "draft";
  return (
    <section class="panel stack">
      <div class="form-grid">
        <Field label="Kunde"><a href={`/kunde/${invoice.customer_id}`}>{invoice.customer?.name}</a></Field>
        <Field label="Leistungsdatum">
          {editable ? <input type="date" value={draft.serviceDate} onInput={(event) => { draft.setServiceDate(event.currentTarget.value); }} /> : <span>{date(invoice.service_date)}</span>}
        </Field>
        {!editable && <Field label="Rechnungsdatum"><span>{date(invoice.issue_date)}</span></Field>}
      </div>
      <Field label="Einleitung" wide>
        {editable ? <textarea class="textarea--short" value={draft.intro} onInput={(event) => { draft.setIntro(event.currentTarget.value); }} /> : <p>{invoice.intro}</p>}
      </Field>
      <ItemsEditor items={draft.items} onChange={draft.setItems} smallBusiness={invoice.seller_snapshot?.small_business ?? settings?.small_business ?? true} readOnly={!editable} />
      <Field label="Schlusstext" wide>
        {editable ? <textarea class="textarea--short" value={draft.outro} onInput={(event) => { draft.setOutro(event.currentTarget.value); }} /> : <p>{invoice.outro}</p>}
      </Field>
    </section>
  );
}

function Payments({ payments }: { payments: Payment[] }) {
  if (payments.length === 0) return null;
  return (
    <section class="panel stack stack--tight">
      <h2>Zahlungen</h2>
      {payments.map((payment) => (
        <div key={payment.id} class="row"><span>{date(payment.paid_on)} · {PAYMENT_METHOD[payment.method]}{payment.reference !== "" && ` · ${payment.reference}`}</span><span class="num">{euro(payment.amount)}</span></div>
      ))}
    </section>
  );
}

function PaymentForm({ invoiceId, open, onDone }: { invoiceId: string; open: number; onDone: () => void }) {
  const [amount, setAmount] = useState(open.toFixed(2).replace(".", ","));
  const [paidOn, setPaidOn] = useState(today());
  const [method, setMethod] = useState<PaymentMethod>("transfer");
  const [reference, setReference] = useState("");
  const action = useAction();
  const submit = (event: Event) => {
    event.preventDefault();
    void action.run(async () => {
      const value = parseAmount(amount);
      if (value === null || value <= 0) throw new Error("Bitte einen Betrag größer als 0 eingeben.");
      await recordPayment(invoiceId, value, paidOn, method, reference);
      onDone();
    });
  };
  return (
    <form class="payment" onSubmit={submit}>
      <Field label="Betrag (€)"><input inputMode="decimal" value={amount} onInput={(event) => { setAmount(event.currentTarget.value); }} /></Field>
      <Field label="Eingegangen am"><input type="date" value={paidOn} onInput={(event) => { setPaidOn(event.currentTarget.value); }} /></Field>
      <Field label="Art">
        <select class="select" value={method} onChange={(event) => { setMethod(event.currentTarget.value as PaymentMethod); }}>
          {(Object.keys(PAYMENT_METHOD) as PaymentMethod[]).map((option) => <option key={option} value={option}>{PAYMENT_METHOD[option]}</option>)}
        </select>
      </Field>
      <Field label="Verwendungszweck (optional)"><input value={reference} onInput={(event) => { setReference(event.currentTarget.value); }} /></Field>
      <button class="button button--gold" type="submit" disabled={action.busy}>Zahlung erfassen</button>
      <ErrorNote message={action.error} />
    </form>
  );
}
