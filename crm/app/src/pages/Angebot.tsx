// One quote: edit while it is a draft, send it as PDF by mail, and record the customer's decision.
import { useLocation } from "preact-iso";
import { useEffect, useState } from "preact/hooks";
import { loadCustomer, loadQuote, saveQuote } from "../api/crm";
import { acceptQuoteInCrm, declineQuoteInCrm, sendQuote } from "../api/flow";
import type { Customer, LineItem, Quote } from "../api/types";
import { ItemsEditor } from "../components/ItemsEditor";
import { QuoteBadge } from "../components/Status";
import { Versand, useMails } from "../components/Versand";
import { ErrorNote, Field, Loading, PageHead } from "../components/ui";
import { useSettings } from "../hooks/settings";
import { useAction, useAsync } from "../hooks/useAsync";
import { date, euro } from "../lib/format";

export function Angebot({ id }: { id: string }) {
  const loaded = useAsync(() => loadQuote(id), [id]);
  if (loaded.error !== null) return <ErrorNote message={loaded.error} />;
  if (loaded.data === undefined) return <Loading />;
  return <QuoteEditor quote={loaded.data.quote} initialItems={loaded.data.items} reload={loaded.reload} />;
}

type QuoteDraft = ReturnType<typeof useQuoteDraft>;

function useQuoteDraft(quote: Quote, initialItems: LineItem[]) {
  const [items, setItems] = useState(initialItems);
  const [intro, setIntro] = useState(quote.intro);
  const [outro, setOutro] = useState(quote.outro);
  const [validUntil, setValidUntil] = useState(quote.valid_until);
  const [dirty, setDirty] = useState(false);
  useEffect(() => { setItems(initialItems); setDirty(false); }, [initialItems]);
  const edited = <T,>(set: (value: T) => void) => (value: T) => { set(value); setDirty(true); };
  const persist = async () => { await saveQuote(quote.id, { intro, outro, valid_until: validUntil }, items); setDirty(false); };
  return {
    items, intro, outro, validUntil, dirty, persist,
    setItems: edited(setItems), setIntro: edited(setIntro), setOutro: edited(setOutro), setValidUntil: edited(setValidUntil),
  };
}

function QuoteEditor({ quote, initialItems, reload }: { quote: Quote; initialItems: LineItem[]; reload: () => void }) {
  const customer = useAsync(() => loadCustomer(quote.customer_id), [quote.customer_id]);
  const draft = useQuoteDraft(quote, initialItems);
  const mails = useMails("quote_id", quote.id);
  const action = useAction();
  const { route } = useLocation();
  const run = (task: () => Promise<void>) => { void action.run(task); };
  const handlers = {
    onSave: () => { run(async () => { await draft.persist(); reload(); }); },
    onSend: () => { run(async () => { if (draft.dirty) await draft.persist(); await sendQuote(quote.id); reload(); mails.reload(); }); },
    onAccept: () => { run(async () => { await acceptQuoteInCrm(quote.id); route("/verkauf?tab=auftraege"); }); },
    onDecline: () => { run(async () => { await declineQuoteInCrm(quote.id); reload(); }); },
  };
  return (
    <div class="stack stack--loose">
      <PageHead kicker={`Angebot · ${quote.customer?.name ?? ""}`} title={quote.number}>
        <QuoteBadge status={quote.status} />
        <a class="button" href={`/druck/angebot/${quote.id}`} target="_blank" rel="noopener">Als PDF / Drucken</a>
      </PageHead>
      <ErrorNote message={action.error} />
      <NextStep quote={quote} customer={customer.data} dirty={draft.dirty} busy={action.busy} {...handlers} />
      {quote.status !== "draft" && <Versand owner="quote_id" id={quote.id} mails={mails} />}
      <QuoteForm quote={quote} draft={draft} busy={action.busy} onSave={handlers.onSave} />
    </div>
  );
}

function QuoteForm({ quote, draft, busy, onSave }: { quote: Quote; draft: QuoteDraft; busy: boolean; onSave: () => void }) {
  const { settings } = useSettings();
  const editable = quote.status === "draft";
  return (
    <section class="panel stack">
      <div class="form-grid">
        <Field label="Kunde"><a href={`/kunde/${quote.customer_id}`}>{quote.customer?.name}</a></Field>
        <Field label="Gültig bis">
          {editable ? <input type="date" value={draft.validUntil} onInput={(event) => { draft.setValidUntil(event.currentTarget.value); }} /> : <span>{date(quote.valid_until)}</span>}
        </Field>
      </div>
      <Field label="Einleitung" wide>
        {editable ? <textarea class="textarea--short" value={draft.intro} onInput={(event) => { draft.setIntro(event.currentTarget.value); }} /> : <p>{quote.intro}</p>}
      </Field>
      <ItemsEditor items={draft.items} onChange={draft.setItems} smallBusiness={settings?.small_business ?? true} readOnly={!editable} />
      <Field label="Schlusstext" wide>
        {editable ? <textarea class="textarea--short" value={draft.outro} onInput={(event) => { draft.setOutro(event.currentTarget.value); }} /> : <p>{quote.outro}</p>}
      </Field>
      {editable && <div class="cluster"><button class="button" type="button" disabled={busy || !draft.dirty} onClick={onSave}>{draft.dirty ? "Änderungen speichern" : "Gespeichert"}</button></div>}
    </section>
  );
}

interface NextStepProps {
  quote: Quote;
  customer: Customer | undefined;
  dirty: boolean;
  busy: boolean;
  onSave: () => void;
  onSend: () => void;
  onAccept: () => void;
  onDecline: () => void;
}

function NextStep(props: NextStepProps) {
  const { quote } = props;
  if (quote.status === "draft") return <SendStep {...props} />;
  if (quote.status === "sent") {
    return (
      <div class="next-step">
        <p><strong>Nächster Schritt:</strong> Antwort des Kunden eintragen. Angebotssumme {euro(quote.gross)}, gültig bis {date(quote.valid_until)}.</p>
        <div class="cluster">
          <button class="button button--gold" type="button" disabled={props.busy} onClick={props.onAccept}>Kunde hat angenommen</button>
          <button class="button button--quiet" type="button" disabled={props.busy} onClick={props.onDecline}>Abgelehnt</button>
        </div>
      </div>
    );
  }
  if (quote.status === "accepted") return <p class="note note--good">Angenommen. Der Auftrag steht unter <a href="/verkauf?tab=auftraege">Verkauf → Aufträge</a>.</p>;
  return <p class="note">Dieses Angebot ist abgeschlossen.</p>;
}

function SendStep({ quote, customer, dirty, busy, onSave, onSend }: NextStepProps) {
  const email = customer?.email ?? "";
  const missing = customer !== undefined && email === "";
  return (
    <div class={missing ? "next-step next-step--warn" : "next-step"}>
      {missing ? (
        <p><strong>Beim Kunden fehlt die E-Mail-Adresse.</strong> Trag sie in den <a href={`/kunde/${quote.customer_id}`}>Stammdaten</a> ein, dann lässt sich das Angebot abschicken.</p>
      ) : (
        <p><strong>Nächster Schritt:</strong> Positionen prüfen, dann abschicken. Das Angebot geht als PDF per E-Mail an {email === "" ? "den Kunden" : email}.</p>
      )}
      <div class="cluster">
        {dirty && <button class="button" type="button" disabled={busy} onClick={onSave}>Speichern</button>}
        <button class="button button--gold" type="button" disabled={busy || missing || customer === undefined} onClick={onSend}>Angebot abschicken</button>
      </div>
    </div>
  );
}
