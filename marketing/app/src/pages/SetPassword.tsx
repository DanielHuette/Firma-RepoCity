// Shown after a password reset link: the person sets a new password before anything else.
import { useState } from "preact/hooks";
import { supabase } from "../api/supabase";
import { ErrorNote } from "../components/ui";
import { useAction } from "../hooks/useAsync";
import { QueryError } from "../lib/errors";

const MIN_LENGTH = 10;

export function SetPassword({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const action = useAction();
  const submit = (event: Event) => {
    event.preventDefault();
    if (password.length < MIN_LENGTH) {
      setProblem(`Das Passwort braucht mindestens ${String(MIN_LENGTH)} Zeichen.`);
      return;
    }
    if (password !== repeat) {
      setProblem("Die beiden Eingaben stimmen nicht überein.");
      return;
    }
    setProblem(null);
    void action.run(async () => {
      const { error } = await supabase.auth.updateUser({ password });
      if (error !== null) throw new QueryError("Passwort speichern", error.message, error.code ?? null);
      onDone();
    });
  };
  return (
    <main class="signin">
      <form class="signin__card panel stack" onSubmit={submit}>
        <p class="kicker">Agentic Marketing</p>
        <h1>Neues Passwort</h1>
        <p class="muted">Es gilt für das Cockpit und für RadarAuditor.</p>
        <label>
          Neues Passwort
          <input type="password" autocomplete="new-password" required value={password} onInput={(event) => { setPassword(event.currentTarget.value); }} />
        </label>
        <label>
          Passwort wiederholen
          <input type="password" autocomplete="new-password" required value={repeat} onInput={(event) => { setRepeat(event.currentTarget.value); }} />
        </label>
        <ErrorNote message={problem ?? action.error} />
        <button class="button button--primary button--big" type="submit" disabled={action.busy}>
          {action.busy ? "Wird gespeichert …" : "Passwort speichern"}
        </button>
      </form>
    </main>
  );
}
