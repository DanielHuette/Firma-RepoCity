// Sign-in of the one operator account; sign-ups are switched off in Supabase.
import { useState } from "preact/hooks";
import { requestPasswordReset, signIn } from "../api/queries";
import { ErrorNote } from "../components/ui";
import { useAction } from "../hooks/useAsync";

export function SignIn() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [forgot, setForgot] = useState(false);
  const [sent, setSent] = useState(false);
  const action = useAction();
  const submit = (event: Event) => {
    event.preventDefault();
    if (forgot) {
      void action.run(async () => {
        await requestPasswordReset(email.trim(), `${window.location.origin}/`);
        setSent(true);
      });
      return;
    }
    void action.run(() => signIn(email.trim(), password));
  };
  const switchMode = (next: boolean) => {
    setForgot(next);
    setSent(false);
    action.clear();
  };
  return (
    <main class="signin">
      <form class="signin__card panel stack" onSubmit={submit}>
        <div class="cluster">
          <img src="/favicon.svg" alt="" width={48} height={48} />
          <div>
            <p class="kicker">Agentic Marketing</p>
            <h1>{forgot ? "Passwort vergessen" : "Cockpit"}</h1>
          </div>
        </div>
        <p class="muted">
          {forgot
            ? "Du bekommst eine E-Mail mit einem Link, über den du ein neues Passwort festlegst."
            : "Recherche prüfen, Beiträge freigeben, Kampagnen starten und Ergebnisse sehen."}
        </p>
        <label>
          E-Mail
          <input type="email" autocomplete="username" required value={email} onInput={(event) => { setEmail(event.currentTarget.value); }} />
        </label>
        {!forgot && (
          <label>
            Passwort
            <input type="password" autocomplete="current-password" required value={password} onInput={(event) => { setPassword(event.currentTarget.value); }} />
          </label>
        )}
        {sent && <p class="note note--good small">Wenn zu dieser Adresse ein Konto gehört, ist die E-Mail unterwegs. Schau auch im Spam-Ordner nach.</p>}
        <ErrorNote message={action.error} />
        <button class="button button--primary button--big" type="submit" disabled={action.busy || sent}>
          {forgot ? (action.busy ? "Wird gesendet …" : "Link senden") : action.busy ? "Melde an …" : "Anmelden"}
        </button>
        <button class="button" type="button" onClick={() => { switchMode(!forgot); }}>
          {forgot ? "Zurück zur Anmeldung" : "Passwort vergessen?"}
        </button>
      </form>
    </main>
  );
}
