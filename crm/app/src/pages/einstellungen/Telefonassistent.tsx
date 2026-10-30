// What the phone assistant says when it answers the business number and what it may tell callers
// about the business.
import { useEffect, useState } from "preact/hooks";
import { saveSettings } from "../../api/crm";
import type { Settings } from "../../api/types";
import { ErrorNote, Field, Loading } from "../../components/ui";
import { useSettings } from "../../hooks/settings";
import { useAction } from "../../hooks/useAsync";
import { greetingProblem } from "../../lib/calls";

type AssistantTexts = Pick<Settings, "assistant_greeting" | "assistant_facts">;

function useAssistantForm(settings: Settings | undefined) {
  const [form, setForm] = useState<AssistantTexts | undefined>(undefined);
  useEffect(() => {
    if (settings !== undefined) setForm({ assistant_greeting: settings.assistant_greeting, assistant_facts: settings.assistant_facts });
  }, [settings]);
  return { form, setForm };
}

export function Telefonassistent() {
  const { settings, reload } = useSettings();
  const { form, setForm } = useAssistantForm(settings);
  const [saved, setSaved] = useState(false);
  const action = useAction();
  if (form === undefined) return <Loading />;
  const set = (key: keyof AssistantTexts, value: string) => { setForm({ ...form, [key]: value }); setSaved(false); };
  const submit = (event: Event) => {
    event.preventDefault();
    void action.run(async () => {
      const problem = greetingProblem(form.assistant_greeting);
      if (problem !== null) throw new Error(problem);
      await saveSettings({ assistant_greeting: form.assistant_greeting.trim(), assistant_facts: form.assistant_facts.trim() });
      reload();
      setSaved(true);
    });
  };
  return (
    <form class="panel stack" onSubmit={submit}>
      <p class="muted">Der Telefonassistent nimmt Anrufe auf der Geschäftsnummer an, beantwortet Fragen, nimmt Anfragen und Rückrufwünsche auf und trägt jedes Gespräch hier im CRM ein.</p>
      <AssistantFields form={form} set={set} />
      <ErrorNote message={action.error} />
      <div class="cluster">
        <button class="button button--gold" type="submit" disabled={action.busy}>{action.busy ? "Speichert …" : "Speichern"}</button>
        {saved && <span class="small muted">Gespeichert.</span>}
      </div>
    </form>
  );
}

function AssistantFields({ form, set }: { form: AssistantTexts; set: (key: keyof AssistantTexts, value: string) => void }) {
  return (
    <>
      <div class="stack stack--tight">
        <Field label="Begrüßung" wide>
          <textarea class="textarea--short" value={form.assistant_greeting} onInput={(event) => { set("assistant_greeting", event.currentTarget.value); }} />
        </Field>
        <p class="small muted">Mit diesem Text meldet sich der Assistent am Telefon. Er muss sagen, dass hier eine künstliche Intelligenz spricht und das Gespräch zur Bearbeitung aufgeschrieben wird.</p>
      </div>
      <div class="stack stack--tight">
        <Field label="Was der Assistent über die Firma sagen darf" wide>
          <textarea class="textarea--long" value={form.assistant_facts} onInput={(event) => { set("assistant_facts", event.currentTarget.value); }} />
        </Field>
        <p class="small muted">Zum Beispiel Leistungen, Erreichbarkeit und wie es nach einer Anfrage weitergeht. Produkte und Preise nimmt er aus deinen Produkten. Was hier nicht steht, sagt und verspricht er nicht.</p>
      </div>
    </>
  );
}
