// The texts of every mail the CRM sends by itself, and the Google review link with the reminder
// interval of the review request.
import { useEffect, useState } from "preact/hooks";
import { saveSettings } from "../../api/crm";
import { listMailTexts, saveMailText } from "../../api/flow";
import type { MailText, Settings } from "../../api/types";
import { ErrorNote, Field, Loading } from "../../components/ui";
import { useSettings } from "../../hooks/settings";
import { useAction, useAsync } from "../../hooks/useAsync";
import { MAIL_TEXT_KEY } from "../../lib/format";
import { mailTextProblem } from "../../lib/mailTexts";

const PLACEHOLDERS: [string, string][] = [
  ["{{anrede}}", "Begrüßung mit Ansprechpartner"], ["{{kunde}}", "Name des Kunden"], ["{{kunde_zeile}}", "Kunde mit Anschrift in einer Zeile"],
  ["{{kunde_anschrift}}", "Anschrift des Kunden"], ["{{firma}}", "dein Firmenname"], ["{{firma_zeile}}", "Firma mit Anschrift"],
  ["{{firma_anschrift}}", "deine Anschrift"], ["{{inhaber}}", "dein Name"], ["{{datum}}", "heutiges Datum"], ["{{zahlungsziel}}", "Zahlungsziel in Tagen"],
  ["{{kuendigungsfrist}}", "Kündigungsfrist"], ["{{nummer}}", "Angebots- oder Rechnungsnummer"], ["{{betrag}}", "Betrag"],
  ["{{faellig}}", "Fälligkeitstag, bei Nachfass-Mails das Ende der Angebotsfrist"], ["{{bewertungslink}}", "dein Google-Bewertungslink"],
  ["{{termin}}", "Tag und Uhrzeit des Termins (Terminbestätigungen und Erinnerung am Vortag)"],
  ["{{ort}}", "Ort des Termins, sonst „nach Absprache“; bei einem Videogespräch der Jitsi-Link (Terminbestätigungen und Erinnerung)"],
  ["{{titel}}", "Titel des Termins (Terminbestätigungen und Erinnerung)"],
  ["{{art}}", "Art des Gesprächs: Vor-Ort-Gespräch, Telefonat oder Videogespräch (Audit-Anfragen und Erinnerung)"],
  ["{{gespraech}}", "das Gespräch als „unser Telefonat“, „unser Videogespräch“, „unser Gespräch vor Ort“ oder „unseren Termin“ (Erinnerung)"],
  ["{{alter_termin}}", "Tag und Uhrzeit des bisherigen Termins (Bestätigung eines geänderten Termins)"],
  ["{{treffpunkt}}", "ganzer Satz, wo oder wie das Gespräch stattfindet: Anschrift, Telefonnummer oder Jitsi-Link (Bestätigung einer Audit-Anfrage und Erinnerung)"],
  ["{{umbuchungslink}}", "Link „Anderen Termin wünschen“ (Bestätigung einer Audit-Anfrage und eines geänderten Termins, muss dort im Text stehen)"],
  ["{{vorschlaege}}", "die drei Zeiten mit je einem Link zum Buchen (Terminvorschläge, muss dort im Text stehen)"],
  ["{{abmeldelink}}", "Link, mit dem der Kunde keine Erinnerungen mehr bekommt (nur Nachfass-Mails, muss dort im Text stehen)"],
];

const ORDER = Object.keys(MAIL_TEXT_KEY);

function inMailOrder(texts: MailText[]): MailText[] {
  return [...texts].sort((a, b) => ORDER.indexOf(a.key) - ORDER.indexOf(b.key));
}

export function MailTexte() {
  const texts = useAsync(() => listMailTexts(), []);
  return (
    <div class="stack">
      <ReviewSettings />
      <p class="muted">Diese Texte gehen automatisch hinaus: Angebote, Rechnungen, Mahnungen, die Bitte um eine Bewertung, Terminbestätigungen, Nachfass-Mails zu Angeboten, Terminvorschläge zu Audit-Anfragen, die Bestätigung eines geänderten Termins mit der Absage des bisherigen und die Erinnerung am Tag vor einem bestätigten Termin. Platzhalter in doppelten geschweiften Klammern werden beim Versand ersetzt.</p>
      <details class="more">
        <summary>Verfügbare Platzhalter</summary>
        <ul class="plain-list small">{PLACEHOLDERS.map(([name, meaning]) => <li key={name}><code>{name}</code> {meaning}</li>)}</ul>
      </details>
      <ErrorNote message={texts.error} />
      {texts.data === undefined ? <Loading /> : inMailOrder(texts.data).map((text) => <MailTextForm key={text.key} text={text} />)}
    </div>
  );
}

function validReviewInput(link: string, days: number): void {
  if (link !== "" && !/^https:\/\/\S+$/.test(link)) throw new Error("Der Bewertungslink muss mit https:// beginnen.");
  if (!Number.isInteger(days) || days < 1 || days > 60) throw new Error("Die Erinnerung muss zwischen 1 und 60 Tagen liegen.");
}

function useReviewForm(settings: Settings | undefined) {
  const [link, setLink] = useState("");
  const [days, setDays] = useState("7");
  useEffect(() => {
    if (settings === undefined) return;
    setLink(settings.google_review_url);
    setDays(String(settings.review_reminder_days));
  }, [settings]);
  return { link, setLink, days, setDays };
}

function ReviewSettings() {
  const { settings, reload } = useSettings();
  const { link, setLink, days, setDays } = useReviewForm(settings);
  const [saved, setSaved] = useState(false);
  const action = useAction();
  const save = () => {
    void action.run(async () => {
      validReviewInput(link.trim(), Number(days));
      await saveSettings({ google_review_url: link.trim(), review_reminder_days: Number(days) });
      reload();
      setSaved(true);
    });
  };
  return (
    <section class="panel stack">
      <h2>Google-Bewertungen</h2>
      <p class="muted">Den Link zum Bewerten gibt es im Google-Unternehmensprofil, sobald die Firma gegründet und das Profil eingerichtet ist. Bis dahin warten die Bitten um Bewertung und gehen erst hinaus, wenn der Link hier steht.</p>
      <ReviewFields link={link} days={days} onLink={(value) => { setLink(value); setSaved(false); }} onDays={(value) => { setDays(value); setSaved(false); }} />
      <ErrorNote message={action.error} />
      <div class="cluster">
        <button class="button button--gold" type="button" disabled={action.busy || settings === undefined} onClick={save}>Speichern</button>
        {saved && <span class="small muted">Gespeichert.</span>}
      </div>
    </section>
  );
}

function ReviewFields({ link, days, onLink, onDays }: { link: string; days: string; onLink: (value: string) => void; onDays: (value: string) => void }) {
  return (
    <div class="form-grid">
      <Field label="Link zum Bewerten" wide><input type="url" placeholder="https://g.page/r/…/review" value={link} onInput={(event) => { onLink(event.currentTarget.value); }} /></Field>
      <Field label="Erinnerung nach Tagen"><input class="input--short num" type="number" min={1} max={60} value={days} onInput={(event) => { onDays(event.currentTarget.value); }} /></Field>
    </div>
  );
}

function MailTextForm({ text }: { text: MailText }) {
  const [subject, setSubject] = useState(text.subject);
  const [body, setBody] = useState(text.body);
  const [saved, setSaved] = useState(false);
  const action = useAction();
  const submit = (event: Event) => {
    event.preventDefault();
    void action.run(async () => {
      const problem = mailTextProblem(text.key, subject, body);
      if (problem !== null) throw new Error(problem);
      await saveMailText(text.key, subject, body);
      setSaved(true);
    });
  };
  return (
    <form class="panel stack" onSubmit={submit}>
      <h2>{MAIL_TEXT_KEY[text.key]}</h2>
      <Field label="Betreff" wide><input value={subject} onInput={(event) => { setSubject(event.currentTarget.value); setSaved(false); }} /></Field>
      <Field label="Text" wide><textarea class="textarea--long" value={body} onInput={(event) => { setBody(event.currentTarget.value); setSaved(false); }} /></Field>
      <ErrorNote message={action.error} />
      <div class="cluster">
        <button class="button button--gold" type="submit" disabled={action.busy}>Text speichern</button>
        {saved && <span class="small muted">Gespeichert.</span>}
      </div>
    </form>
  );
}
