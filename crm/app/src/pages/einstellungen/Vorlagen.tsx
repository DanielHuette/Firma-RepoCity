// Contract templates and the notice period of maintenance contracts.
import { useEffect, useState } from "preact/hooks";
import { listTemplates, saveSettings, saveTemplate } from "../../api/crm";
import type { ContractTemplate } from "../../api/types";
import { ErrorNote, Field, Loading } from "../../components/ui";
import { useSettings } from "../../hooks/settings";
import { useAction, useAsync } from "../../hooks/useAsync";

const PLACEHOLDERS = "{{kunde}}, {{kunde_zeile}}, {{kunde_anschrift}}, {{anrede}}, {{firma}}, {{firma_zeile}}, {{inhaber}}, {{vertragsnummer}}, {{datum}}, {{titel}}, {{leistung}}, {{beschreibung}}, {{beginn}}, {{preis}}, {{steuerhinweis}}, {{zahlungsziel}}, {{kuendigungsfrist}}, {{angebot}}, {{positionen}}, {{summe}}, {{termin}}";

export function Vorlagen() {
  const templates = useAsync(() => listTemplates(), []);
  return (
    <div class="stack">
      <p class="muted">Aus diesen Vorlagen entstehen die Verträge automatisch: der Wartungsvertrag bei jedem neuen Abo, die Auftragsbestätigung bei jedem angenommenen Angebot. Bereits erstellte Verträge ändern sich nicht mehr.</p>
      <NoticePeriod />
      <ErrorNote message={templates.error} />
      {templates.data === undefined ? <Loading /> : templates.data.map((template) => <Vorlage key={template.key} template={template} onSaved={templates.reload} />)}
      <details class="more"><summary>Verfügbare Platzhalter</summary><p class="small">{PLACEHOLDERS}</p></details>
    </div>
  );
}

function NoticePeriod() {
  const { settings, reload } = useSettings();
  const [notice, setNotice] = useState("");
  const action = useAction();
  useEffect(() => { if (settings !== undefined) setNotice(String(settings.notice_months)); }, [settings]);
  const save = () => {
    void action.run(async () => {
      const months = Number(notice);
      if (!Number.isInteger(months) || months < 0 || months > 24) throw new Error("Die Kündigungsfrist muss zwischen 0 und 24 Monaten liegen.");
      await saveSettings({ notice_months: months });
      reload();
    });
  };
  return (
    <section class="panel cluster">
      <Field label="Kündigungsfrist für Wartungsverträge (Monate)">
        <input class="input--short num" type="number" min={0} max={24} value={notice} onInput={(event) => { setNotice(event.currentTarget.value); }} />
      </Field>
      <button class="button" type="button" disabled={action.busy || settings === undefined} onClick={save}>Speichern</button>
      <ErrorNote message={action.error} />
    </section>
  );
}

function Vorlage({ template, onSaved }: { template: ContractTemplate; onSaved: () => void }) {
  const [draft, setDraft] = useState(template);
  const [saved, setSaved] = useState(false);
  const action = useAction();
  const edit = (changes: Partial<ContractTemplate>) => { setDraft({ ...draft, ...changes }); setSaved(false); };
  const submit = (event: Event) => {
    event.preventDefault();
    void action.run(async () => { await saveTemplate(draft); setSaved(true); onSaved(); });
  };
  return (
    <form class="panel stack" onSubmit={submit}>
      <h2>{template.key === "maintenance" ? "Wartungsvertrag (bei neuem Abo)" : "Auftragsbestätigung (bei angenommenem Angebot)"}</h2>
      <Field label="Titel" wide><input value={draft.title} onInput={(event) => { edit({ title: event.currentTarget.value }); }} /></Field>
      <Field label="Vertragstext" wide><textarea class="textarea--long" value={draft.body} onInput={(event) => { edit({ body: event.currentTarget.value }); }} /></Field>
      <Field label="Begleittext der E-Mail" wide><textarea class="textarea--short" value={draft.mail_text} onInput={(event) => { edit({ mail_text: event.currentTarget.value }); }} /></Field>
      <ErrorNote message={action.error} />
      <div class="cluster">
        <button class="button button--gold" type="submit" disabled={action.busy}>Vorlage speichern</button>
        {saved && <span class="small muted">Gespeichert.</span>}
      </div>
    </form>
  );
}
