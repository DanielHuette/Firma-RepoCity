// Master data of a customer; used for new customers and for editing.
import { useState } from "preact/hooks";
import type { Channel, CustomerDraft, CustomerKind, CustomerSource } from "../api/types";
import { CHANNEL, SOURCE } from "../lib/format";
import { ErrorNote, Field } from "./ui";

export const EMPTY_CUSTOMER: CustomerDraft = {
  kind: "company", name: "", contact_person: "", email: "", phone: "", street: "", postal_code: "", city: "", country_code: "DE",
  vat_id: "", buyer_reference: "", source: "manual", marketing_consent: false, no_review_requests: false,
  no_follow_ups: false, channel: null, campaign: "", notes: "",
};

type Setter = <K extends keyof CustomerDraft>(key: K, value: CustomerDraft[K]) => void;

function KindSwitch({ draft, set }: { draft: CustomerDraft; set: Setter }) {
  return (
    <div class="segmented" role="radiogroup" aria-label="Art">
      {(["company", "person"] as CustomerKind[]).map((kind) => (
        <button key={kind} type="button" role="radio" aria-checked={draft.kind === kind} onClick={() => { set("kind", kind); }}>
          {kind === "company" ? "Firma" : "Privatperson"}
        </button>
      ))}
    </div>
  );
}

function ContactFields({ draft, set }: { draft: CustomerDraft; set: Setter }) {
  return (
    <div class="form-grid">
      <Field label={draft.kind === "company" ? "Firmenname" : "Name"}><input required value={draft.name} onInput={(event) => { set("name", event.currentTarget.value); }} /></Field>
      {draft.kind === "company" && <Field label="Ansprechpartner"><input value={draft.contact_person} onInput={(event) => { set("contact_person", event.currentTarget.value); }} /></Field>}
      <Field label="E-Mail"><input type="email" value={draft.email ?? ""} onInput={(event) => { set("email", event.currentTarget.value); }} /></Field>
      <Field label="Telefon"><input type="tel" value={draft.phone} onInput={(event) => { set("phone", event.currentTarget.value); }} /></Field>
      <Field label="Straße und Hausnummer"><input value={draft.street} onInput={(event) => { set("street", event.currentTarget.value); }} /></Field>
      <Field label="Postleitzahl"><input value={draft.postal_code} inputMode="numeric" onInput={(event) => { set("postal_code", event.currentTarget.value); }} /></Field>
      <Field label="Ort"><input value={draft.city} onInput={(event) => { set("city", event.currentTarget.value); }} /></Field>
      <Field label="Woher kommt der Kontakt?">
        <select class="select" value={draft.source} onChange={(event) => { set("source", event.currentTarget.value as CustomerSource); }}>
          {(Object.keys(SOURCE) as CustomerSource[]).map((source) => <option key={source} value={source}>{SOURCE[source]}</option>)}
        </select>
      </Field>
      <ChannelFields draft={draft} set={set} />
    </div>
  );
}

// The empty option stands for null: the database keeps a missing channel as unknown.
function ChannelFields({ draft, set }: { draft: CustomerDraft; set: Setter }) {
  return (
    <>
      <Field label="Kanal">
        <select class="select" value={draft.channel ?? ""} onChange={(event) => { set("channel", event.currentTarget.value === "" ? null : event.currentTarget.value as Channel); }}>
          <option value="">Unbekannt</option>
          {(Object.keys(CHANNEL) as Channel[]).map((channel) => <option key={channel} value={channel}>{CHANNEL[channel]}</option>)}
        </select>
      </Field>
      <Field label="Kampagne">
        <input value={draft.campaign} maxLength={100} onInput={(event) => { set("campaign", event.currentTarget.value); }} />
      </Field>
    </>
  );
}

function InvoiceFields({ draft, set }: { draft: CustomerDraft; set: Setter }) {
  return (
    <details class="more">
      <summary>Weitere Angaben für Rechnungen</summary>
      <div class="form-grid">
        <Field label="Umsatzsteuer-Identifikationsnummer des Kunden"><input value={draft.vat_id} onInput={(event) => { set("vat_id", event.currentTarget.value); }} /></Field>
        <Field label="Leitweg-ID (nur bei Behörden)"><input value={draft.buyer_reference} onInput={(event) => { set("buyer_reference", event.currentTarget.value); }} /></Field>
        <Field label="Land (zweistelliger Code)"><input value={draft.country_code} maxLength={2} onInput={(event) => { set("country_code", event.currentTarget.value.toUpperCase()); }} /></Field>
      </div>
    </details>
  );
}

function Consents({ draft, set }: { draft: CustomerDraft; set: Setter }) {
  return (
    <>
      <label class="check">
        <input type="checkbox" checked={draft.marketing_consent} onChange={(event) => { set("marketing_consent", event.currentTarget.checked); }} />
        <span>Einwilligung für Werbung per E-Mail liegt vor</span>
      </label>
      <label class="check">
        <input type="checkbox" checked={draft.no_review_requests} onChange={(event) => { set("no_review_requests", event.currentTarget.checked); }} />
        <span>Keine Bewertungsanfragen</span>
      </label>
      <label class="check">
        <input type="checkbox" checked={draft.no_follow_ups} onChange={(event) => { set("no_follow_ups", event.currentTarget.checked); }} />
        <span>Keine Erinnerungen</span>
      </label>
    </>
  );
}

export function CustomerForm({ initial, submitLabel, busy, error, onSubmit, onCancel }: {
  initial: CustomerDraft; submitLabel: string; busy: boolean; error: string | null; onSubmit: (draft: CustomerDraft) => void; onCancel?: () => void;
}) {
  const [draft, setDraft] = useState<CustomerDraft>(initial);
  const set: Setter = (key, value) => { setDraft({ ...draft, [key]: value }); };
  const submit = (event: Event) => { event.preventDefault(); onSubmit(draft); };
  return (
    <form class="stack" onSubmit={submit}>
      <KindSwitch draft={draft} set={set} />
      <ContactFields draft={draft} set={set} />
      <InvoiceFields draft={draft} set={set} />
      <Field label="Notizen" wide><textarea class="textarea--short" value={draft.notes} onInput={(event) => { set("notes", event.currentTarget.value); }} /></Field>
      <Consents draft={draft} set={set} />
      <ErrorNote message={error} />
      <div class="cluster">
        <button class="button button--gold" type="submit" disabled={busy}>{busy ? "Speichert …" : submitLabel}</button>
        {onCancel !== undefined && <button class="button" type="button" onClick={onCancel}>Abbrechen</button>}
      </div>
    </form>
  );
}
