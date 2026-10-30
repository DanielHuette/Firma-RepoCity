// The customer file: what was bought when, running services and contracts, calls of the phone
// assistant, the complete history (mails, notes, events) and every document that belongs to the customer.
import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import {
  cancelSubscription, deleteUpload, documentLink, listDocuments, listEmails, loadCustomerOverview, markContractSigned, uploadDocument,
} from "../api/crm";
import { listCustomerSubscriptions } from "../api/flow";
import type { Activity, CrmDocument, CustomerOverview, DocumentKind, Email } from "../api/types";
import { useAction, useAsync, type Action } from "../hooks/useAsync";
import { ACTIVITY_KIND, DOCUMENT_KIND, date, dateTime, euro, fileSize, quantity, today } from "../lib/format";
import { KundenAnrufe } from "./Anrufe";
import { SignedLink } from "./SignedLink";
import { ContractBadge } from "./Status";
import { MailList, useMails } from "./Versand";
import { Badge, Empty, ErrorNote, Field, Kpi, Loading } from "./ui";

function Section({ id, title, children }: { id: string; title: string; children: ComponentChildren }) {
  return (
    <section class="panel stack" aria-labelledby={id}>
      <h2 id={id}>{title}</h2>
      {children}
    </section>
  );
}

type FileSubscription = CustomerOverview["subscriptions"][number] & { next_audit_date: string | null };

async function loadFile(customerId: string): Promise<{ overview: CustomerOverview; subscriptions: FileSubscription[] }> {
  const [overview, rows] = await Promise.all([loadCustomerOverview(customerId), listCustomerSubscriptions(customerId)]);
  const auditDates = new Map(rows.map((row) => [row.id, row.next_audit_date]));
  return { overview, subscriptions: overview.subscriptions.map((sub) => ({ ...sub, next_audit_date: auditDates.get(sub.id) ?? null })) };
}

export function Ueberblick({ customerId }: { customerId: string }) {
  const file = useAsync(() => loadFile(customerId), [customerId]);
  const mails = useMails("customer_id", customerId);
  if (file.error !== null) return <ErrorNote message={file.error} />;
  if (file.data === undefined) return <Loading />;
  const { overview, subscriptions } = file.data;
  return (
    <div class="stack stack--loose">
      <section class="kpis" aria-label="Zahlen">
        <Kpi label="Kunde seit" value={date(overview.customer_since)} />
        <Kpi label="Umsatz netto" value={euro(overview.revenue_net)} />
        <Kpi label="Offen" value={euro(overview.open_amount)} />
        <Kpi label="Laufend pro Monat" value={euro(overview.monthly_net)} hint="netto, aus Abos" />
      </section>
      <Section id="abos-head" title="Laufende Leistungen"><Abos subscriptions={subscriptions} onChange={file.reload} /></Section>
      <Section id="vertraege-head" title="Verträge und Auftragsbestätigungen"><Vertraege contracts={overview.contracts} onChange={file.reload} /></Section>
      <Section id="anrufe-head" title="Anrufe beim Telefonassistenten"><KundenAnrufe customerId={customerId} /></Section>
      <Section id="mails-head" title="Ausgehende E-Mails"><MailList mails={mails} showKind empty="Noch keine E-Mail an diesen Kunden." /></Section>
      <Section id="kaeufe-head" title="Gekaufte Leistungen"><Kaeufe purchases={overview.purchases} /></Section>
    </div>
  );
}

function Abos({ subscriptions, onChange }: { subscriptions: FileSubscription[]; onChange: () => void }) {
  if (subscriptions.length === 0) return <Empty>Keine Abos oder Wartungsverträge.</Empty>;
  return (
    <div class="table-wrap">
      <table class="table table--rows">
        <thead><tr><th>Leistung</th><th>Seit</th><th class="num">Monatlich netto</th><th>Nächste Rechnung</th><th>Nächste Prüfung</th><th>Vertrag</th><th /></tr></thead>
        <tbody>{subscriptions.map((sub) => <AboRow key={sub.id} sub={sub} onChange={onChange} />)}</tbody>
      </table>
    </div>
  );
}

function Vertraege({ contracts, onChange }: { contracts: CustomerOverview["contracts"]; onChange: () => void }) {
  const action = useAction();
  const signed = (id: string) => { void action.run(async () => { await markContractSigned(id); onChange(); }); };
  if (contracts.length === 0) return <Empty>Noch keine.</Empty>;
  return (
    <>
    <ErrorNote message={action.error} />
    <ul class="cards">
      {contracts.map((contract) => (
        <li key={contract.id} class="row">
          <span>
            <a href={`/druck/vertrag/${contract.id}`} target="_blank" rel="noopener">{contract.title} {contract.number}</a>
            <span class="small muted"> · {date(contract.created_at)}{contract.signed_at !== null && ` · unterschrieben ${date(contract.signed_at)}`}{contract.end_date !== null && ` · endet ${date(contract.end_date)}`}</span>
          </span>
          <span class="cluster">
            <ContractBadge status={contract.status} />
            {(contract.status === "sent" || contract.status === "queued") && contract.title !== "Auftragsbestätigung" && (
              <button class="button button--quiet" type="button" disabled={action.busy} onClick={() => { signed(contract.id); }}>Unterschrieben</button>
            )}
          </span>
        </li>
      ))}
    </ul>
    </>
  );
}

function Kaeufe({ purchases }: { purchases: CustomerOverview["purchases"] }) {
  if (purchases.length === 0) return <Empty>Noch nichts abgerechnet.</Empty>;
  return (
    <div class="table-wrap">
      <table class="table table--rows">
        <thead><tr><th>Datum</th><th>Leistung</th><th class="num">Menge</th><th class="num">Netto</th><th>Rechnung</th></tr></thead>
        <tbody>
          {purchases.map((purchase, index) => (
            <tr key={`${purchase.invoice_id}-${String(index)}`} class={purchase.cancelled ? "muted" : ""}>
              <td>{date(purchase.date)}</td>
              <td>{purchase.title}{purchase.cancelled && <span class="small"> (storniert)</span>}</td>
              <td class="num">{quantity(purchase.quantity)} {purchase.unit}</td>
              <td class="num">{euro(purchase.net)}</td>
              <td><a href={`/rechnung/${purchase.invoice_id}`}>{purchase.invoice_number}</a></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AboRow({ sub, onChange }: { sub: FileSubscription; onChange: () => void }) {
  return (
    <tr class={sub.active ? "" : "muted"}>
      <td>{sub.product}{sub.quantity !== 1 && <span class="small muted"> · {quantity(sub.quantity)} {sub.unit}</span>}</td>
      <td>{date(sub.start_date)}</td>
      <td class="num">{euro(sub.monthly_net)}</td>
      <td>{sub.end_date !== null ? `endet ${date(sub.end_date)}` : sub.active ? date(sub.next_invoice_date) : "pausiert"}</td>
      <td>{sub.active && sub.next_audit_date !== null ? date(sub.next_audit_date) : "–"}</td>
      <td>{sub.contract_id !== null && sub.contract_status !== null
        ? <a href={`/druck/vertrag/${sub.contract_id}`} target="_blank" rel="noopener"><ContractBadge status={sub.contract_status} /></a> : "–"}</td>
      <td><CancelSubscription sub={sub} onChange={onChange} /></td>
    </tr>
  );
}

function CancelSubscription({ sub, onChange }: { sub: FileSubscription; onChange: () => void }) {
  const [cancelling, setCancelling] = useState(false);
  const [end, setEnd] = useState(today(30));
  const action = useAction();
  const cancel = () => { void action.run(async () => { await cancelSubscription(sub.id, end); setCancelling(false); onChange(); }); };
  if (sub.end_date !== null) return null;
  return (
    <>
      {!cancelling && <button class="button button--quiet" type="button" onClick={() => { setCancelling(true); }}>Kündigen</button>}
      {cancelling && (
        <span class="cluster">
          <input class="input--short" type="date" aria-label="Kündigen zum" value={end} onInput={(event) => { setEnd(event.currentTarget.value); }} />
          <button class="button" type="button" disabled={action.busy} onClick={cancel}>Kündigen zum Datum</button>
          <button class="button button--quiet" type="button" onClick={() => { setCancelling(false); }}>Abbrechen</button>
        </span>
      )}
      <ErrorNote message={action.error} />
    </>
  );
}

type Entry =
  | { kind: "activity"; at: string; activity: Activity }
  | { kind: "email"; at: string; email: Email }
  | { kind: "document"; at: string; document: CrmDocument };

function entryKey(entry: Entry): string {
  if (entry.kind === "activity") return `activity-${entry.activity.id}`;
  return entry.kind === "email" ? `email-${entry.email.id}` : `document-${entry.document.id}`;
}

function timeline(activities: Activity[], emails: Email[], documents: CrmDocument[]): Entry[] {
  return [
    ...activities.map((activity): Entry => ({ kind: "activity", at: activity.happened_at, activity })),
    ...emails.map((email): Entry => ({ kind: "email", at: email.sent_at, email })),
    ...documents.filter((doc) => doc.source !== "email").map((document): Entry => ({ kind: "document", at: document.created_at, document })),
  ].sort((a, b) => b.at.localeCompare(a.at));
}

export function Verlauf({ customerId, activities, children }: { customerId: string; activities: Activity[]; children: ComponentChildren }) {
  const extra = useAsync(async () => {
    const [emails, documents] = await Promise.all([listEmails(customerId), listDocuments(customerId)]);
    return { emails, documents };
  }, [customerId, activities]);
  const entries = timeline(activities, extra.data?.emails ?? [], extra.data?.documents ?? []);
  return (
    <section class="panel stack">
      {children}
      <ErrorNote message={extra.error} />
      {extra.data === undefined ? <Loading /> : entries.length === 0 ? <Empty>Noch keine Einträge.</Empty> : (
        <ol class="timeline">
          {entries.map((entry) => (
            <li key={entryKey(entry)}>
              <span class="small muted num">{dateTime(entry.at)}</span>
              {entry.kind === "activity" && <span><Badge>{ACTIVITY_KIND[entry.activity.kind]}</Badge> {entry.activity.body}</span>}
              {entry.kind === "email" && <MailEntry email={entry.email} />}
              {entry.kind === "document" && <span><Badge tone="ink">Dokument</Badge> <DocumentLink document={entry.document} /></span>}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function MailEntry({ email }: { email: Email }) {
  return (
    <details class="more mail">
      <summary>
        <Badge tone={email.direction === "in" ? "gold" : ""}>{email.direction === "in" ? "E-Mail erhalten" : "E-Mail gesendet"}</Badge>{" "}
        {email.subject === "" ? "(ohne Betreff)" : email.subject}{email.has_attachments && <span class="small muted"> · mit Anhang</span>}
      </summary>
      <p class="small muted">
        {email.direction === "in" ? `Von ${email.from_name === "" ? email.from_address : `${email.from_name} <${email.from_address}>`}` : `An ${email.to_addresses.join(", ")}`}
      </p>
      <pre class="mail-preview">{email.body_text === "" ? "(kein Text)" : email.body_text}</pre>
    </details>
  );
}

function DocumentLink({ document }: { document: CrmDocument }) {
  if (document.source === "generated" && document.contract_id !== null) {
    return <a href={`/druck/vertrag/${document.contract_id}`} target="_blank" rel="noopener">{document.title}</a>;
  }
  return <SignedLink label={document.title} sign={() => documentLink(document.file_path)} />;
}

const UPLOAD_KINDS: DocumentKind[] = ["signed_contract", "contract", "quote", "invoice", "other"];

function useUpload(customerId: string, kind: DocumentKind, onDone: () => void): { action: Action; busyName: string | null; upload: (files: FileList | null) => void } {
  const [busyName, setBusyName] = useState<string | null>(null);
  const action = useAction();
  const upload = (files: FileList | null) => {
    if (files === null || files.length === 0) return;
    const list = Array.from(files);
    void action.run(async () => {
      for (const file of list) {
        setBusyName(file.name);
        await uploadDocument(customerId, file, kind);
      }
      onDone();
    }).then(() => { setBusyName(null); });
  };
  return { action, busyName, upload };
}

export function Dokumente({ customerId }: { customerId: string }) {
  const documents = useAsync(() => listDocuments(customerId), [customerId]);
  const [kind, setKind] = useState<DocumentKind>("signed_contract");
  const { action, busyName, upload } = useUpload(customerId, kind, documents.reload);
  return (
    <div class="stack">
      <section class="panel stack">
        <div class="form-grid">
          <Field label="Art">
            <select class="select" value={kind} onChange={(event) => { setKind(event.currentTarget.value as DocumentKind); }}>
              {UPLOAD_KINDS.map((option) => <option key={option} value={option}>{DOCUMENT_KIND[option]}</option>)}
            </select>
          </Field>
          <Field label="Dateien (bis 25 MB je Datei)">
            <input type="file" multiple disabled={action.busy} onChange={(event) => { upload(event.currentTarget.files); event.currentTarget.value = ""; }} />
          </Field>
        </div>
        {busyName !== null && <p class="small muted">Lädt hoch: {busyName} …</p>}
        <ErrorNote message={action.error} />
      </section>
      <ErrorNote message={documents.error} />
      {documents.data === undefined ? <Loading /> : documents.data.length === 0 ? <Empty>Noch keine Dokumente.</Empty> : <DocumentTable documents={documents.data} onChange={documents.reload} />}
    </div>
  );
}

function DocumentTable({ documents, onChange }: { documents: CrmDocument[]; onChange: () => void }) {
  const action = useAction();
  const remove = (document: CrmDocument) => { void action.run(async () => { await deleteUpload(document); onChange(); }); };
  return (
    <div class="table-wrap">
      <ErrorNote message={action.error} />
      <table class="table table--rows">
        <thead><tr><th>Dokument</th><th>Art</th><th>Herkunft</th><th class="num">Größe</th><th>Datum</th><th /></tr></thead>
        <tbody>
          {documents.map((document) => (
            <tr key={document.id}>
              <td><DocumentLink document={document} /></td>
              <td>{DOCUMENT_KIND[document.kind]}</td>
              <td>{document.source === "upload" ? "Hochgeladen" : document.source === "email" ? "Aus E-Mail" : "Erstellt"}</td>
              <td class="num">{document.size_bytes > 0 ? fileSize(document.size_bytes) : "–"}</td>
              <td>{date(document.created_at)}</td>
              <td>{document.source === "upload" && <button class="button button--quiet" type="button" disabled={action.busy} onClick={() => { remove(document); }}>Entfernen</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
