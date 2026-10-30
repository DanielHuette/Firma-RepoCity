// Everything that is set once: company data for documents, products and packages, subscriptions,
// contract templates, mail texts and the review link, business hours and the calendar link, the texts
// of the phone assistant, and how website, agents and other tools connect to the CRM.
import { useLocation } from "preact-iso";
import { useEffect, useState } from "preact/hooks";
import { saveSettings, signOut } from "../api/crm";
import type { Settings } from "../api/types";
import { ErrorNote, Field, Loading, PageHead, Tabs } from "../components/ui";
import { useSettings } from "../hooks/settings";
import { useAction } from "../hooks/useAsync";
import { datevNumberProblem, taxFreeAccountProblem } from "../lib/datev";
import { Abos } from "./einstellungen/Abos";
import { Anbindungen } from "./einstellungen/Anbindungen";
import { Kalender } from "./einstellungen/Kalender";
import { MailTexte } from "./einstellungen/MailTexte";
import { Produkte } from "./einstellungen/Produkte";
import { Telefonassistent } from "./einstellungen/Telefonassistent";
import { Vorlagen } from "./einstellungen/Vorlagen";

type Section = "firma" | "produkte" | "abos" | "vorlagen" | "mails" | "kalender" | "telefon" | "anbindungen" | "konto";

const SECTIONS: { id: Section; label: string }[] = [
  { id: "firma", label: "Firma" },
  { id: "produkte", label: "Produkte & Pakete" },
  { id: "abos", label: "Abos" },
  { id: "vorlagen", label: "Vertragsvorlagen" },
  { id: "mails", label: "E-Mails & Bewertungen" },
  { id: "kalender", label: "Kalender" },
  { id: "telefon", label: "Telefonassistent" },
  { id: "anbindungen", label: "Anbindungen" },
  { id: "konto", label: "Konto" },
];

export function Einstellungen({ email }: { email: string }) {
  const { query } = useLocation();
  const [section, setSection] = useState<Section>(SECTIONS.find((entry) => entry.id === query.bereich)?.id ?? "firma");
  return (
    <div class="stack stack--loose">
      <PageHead kicker="Einstellungen" title="Einmal einrichten" />
      <Tabs value={section} onChange={setSection} options={SECTIONS} />
      {section === "firma" && <Firma />}
      {section === "produkte" && <Produkte />}
      {section === "abos" && <Abos />}
      {section === "vorlagen" && <Vorlagen />}
      {section === "mails" && <MailTexte />}
      {section === "kalender" && <Kalender />}
      {section === "telefon" && <Telefonassistent />}
      {section === "anbindungen" && <Anbindungen />}
      {section === "konto" && <Konto email={email} />}
    </div>
  );
}

const COMPANY_FIELDS: { key: keyof Settings; label: string; wide?: boolean; type?: string }[] = [
  { key: "company_name", label: "Firmenname", wide: true },
  { key: "owner_name", label: "Inhaber" },
  { key: "email", label: "E-Mail", type: "email" },
  { key: "phone", label: "Telefon" },
  { key: "website", label: "Webseite" },
  { key: "street", label: "Straße und Hausnummer", wide: true },
  { key: "postal_code", label: "Postleitzahl" },
  { key: "city", label: "Ort" },
  { key: "tax_number", label: "Steuernummer" },
  { key: "vat_id", label: "Umsatzsteuer-Identifikationsnummer" },
  { key: "iban", label: "IBAN" },
  { key: "bic", label: "BIC" },
  { key: "bank_name", label: "Bank" },
];

function Firma() {
  const { settings, reload } = useSettings();
  const [form, setForm] = useState<Settings | undefined>(settings);
  const [saved, setSaved] = useState(false);
  const action = useAction();
  useEffect(() => { if (settings !== undefined && form === undefined) setForm(settings); }, [settings]);
  if (form === undefined) return <Loading />;
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => { setForm({ ...form, [key]: value }); setSaved(false); };
  const submit = (event: Event) => {
    event.preventDefault();
    void action.run(async () => { await saveSettings(companyPart(withDatevNumbers(form))); reload(); setSaved(true); });
  };
  return (
    <form class="panel stack" onSubmit={submit}>
      <p class="muted">Diese Angaben stehen auf jedem Angebot und jeder Rechnung. Ohne Firmenname, Anschrift und Steuernummer lässt sich keine Rechnung festschreiben.</p>
      <CompanyFields form={form} set={set} />
      <DatevFields form={form} set={set} />
      <ErrorNote message={action.error} />
      <div class="cluster">
        <button class="button button--gold" type="submit" disabled={action.busy}>{action.busy ? "Speichert …" : "Speichern"}</button>
        {saved && <span class="small muted">Gespeichert.</span>}
      </div>
    </form>
  );
}

function CompanyFields({ form, set }: { form: Settings; set: <K extends keyof Settings>(key: K, value: Settings[K]) => void }) {
  return (
    <>
      <div class="form-grid">
        {COMPANY_FIELDS.map((field) => (
          <Field key={field.key} label={field.label} wide={field.wide === true}>
            <input class="input" type={field.type ?? "text"} value={String(form[field.key])} onInput={(event) => { set(field.key, event.currentTarget.value as never); }} />
          </Field>
        ))}
        <Field label="Zahlungsziel in Tagen">
          <input class="input input--short num" type="number" min={0} max={90} value={form.payment_days} onInput={(event) => { set("payment_days", Number(event.currentTarget.value)); }} />
        </Field>
        <Field label="Angebote gültig in Tagen">
          <input class="input input--short num" type="number" min={1} max={180} value={form.quote_valid_days} onInput={(event) => { set("quote_valid_days", Number(event.currentTarget.value)); }} />
        </Field>
      </div>
      <label class="check">
        <input type="checkbox" checked={form.small_business} onChange={(event) => { set("small_business", event.currentTarget.checked); }} />
        <span>Kleinunternehmer nach § 19 Umsatzsteuergesetz (keine Umsatzsteuer auf Rechnungen)</span>
      </label>
    </>
  );
}

// Only the fields of this tab: the other tabs save their own, and a stale copy of theirs must not
// overwrite what they saved meanwhile.
function companyPart(form: Settings): Partial<Settings> {
  const keys: (keyof Settings)[] = [...COMPANY_FIELDS.map((field) => field.key), "payment_days", "quote_valid_days", "small_business",
    "datev_consultant_number", "datev_client_number", "datev_tax_free_account"];
  return Object.fromEntries(keys.map((key) => [key, form[key]]));
}

function withDatevNumbers(form: Settings): Settings {
  const consultant = form.datev_consultant_number.trim();
  const client = form.datev_client_number.trim();
  const taxFree = form.datev_tax_free_account.trim();
  const problem = datevNumberProblem(consultant, 7) ?? datevNumberProblem(client, 5);
  if (problem !== null) throw new Error(`Beraternummer und Mandantennummer: ${problem}`);
  const accountProblem = taxFreeAccountProblem(taxFree);
  if (accountProblem !== null) throw new Error(accountProblem);
  return { ...form, datev_consultant_number: consultant, datev_client_number: client, datev_tax_free_account: taxFree };
}

function DatevFields({ form, set }: { form: Settings; set: <K extends keyof Settings>(key: K, value: Settings[K]) => void }) {
  return (
    <section class="stack stack--tight" aria-labelledby="datev-head">
      <h3 id="datev-head">DATEV</h3>
      <p class="small muted">Alle drei Angaben nennt dir dein Steuerberater. Sie gehen in den Buchungsstapel im Paket für den Steuerberater; das Konto für steuerfreie Umsätze braucht es nur für Positionen mit 0 % Umsatzsteuer.</p>
      <div class="form-grid">
        <Field label="Beraternummer (bis 7 Ziffern)">
          <input class="input num" inputMode="numeric" maxLength={7} value={form.datev_consultant_number} onInput={(event) => { set("datev_consultant_number", event.currentTarget.value); }} />
        </Field>
        <Field label="Mandantennummer (bis 5 Ziffern)">
          <input class="input num" inputMode="numeric" maxLength={5} value={form.datev_client_number} onInput={(event) => { set("datev_client_number", event.currentTarget.value); }} />
        </Field>
        <Field label="Konto für steuerfreie Umsätze (4 Ziffern)">
          <input class="input num" inputMode="numeric" maxLength={4} value={form.datev_tax_free_account} onInput={(event) => { set("datev_tax_free_account", event.currentTarget.value); }} />
        </Field>
      </div>
    </section>
  );
}

function Konto({ email }: { email: string }) {
  const action = useAction();
  return (
    <div class="panel stack">
      <p>Angemeldet als <strong>{email}</strong></p>
      <ErrorNote message={action.error} />
      <div><button class="button" type="button" disabled={action.busy} onClick={() => { void action.run(signOut); }}>Abmelden</button></div>
    </div>
  );
}
