// Sign-in of the one operator account; sign-ups are switched off in Supabase.
import { useState } from "preact/hooks";
import { requestPasswordReset, signIn } from "../api/crm";
import { Mark, Wordmark } from "../components/Logo";
import { ErrorNote } from "../components/ui";
import { useTilt } from "../hooks/motion";
import { useAction } from "../hooks/useAsync";

export function SignIn() {
  const lockup = useTilt<HTMLDivElement>(18, -8, 9);
  return (
    <main class="signin">
      <div class="lockup" ref={lockup} aria-label="RepoCity – AI for everyone" role="img">
        <Mark size={160} />
        <Wordmark />
      </div>
      <SignInForm />
    </main>
  );
}

function SignInForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [forgot, setForgot] = useState(false);
  const [sent, setSent] = useState(false);
  const action = useAction();
  const submit = (event: Event) => {
    event.preventDefault();
    if (!forgot) { void action.run(() => signIn(email.trim(), password)); return; }
    void action.run(async () => { await requestPasswordReset(email.trim(), `${window.location.origin}/`); setSent(true); });
  };
  const switchMode = () => { setForgot(!forgot); setSent(false); action.clear(); };
  return (
    <form class="signin__card panel stack" onSubmit={submit}>
      <div>
        <p class="kicker">RepoCity</p>
        <h1>{forgot ? "Passwort vergessen" : "CRM"}</h1>
      </div>
      <p class="muted">{forgot ? "Du bekommst eine E-Mail mit einem Link, über den du ein neues Passwort festlegst." : "Kunden, Angebote, Rechnungen und Freigaben an einem Ort."}</p>
      <label>E-Mail<input type="email" autocomplete="username" required value={email} onInput={(event) => { setEmail(event.currentTarget.value); }} /></label>
      {!forgot && <label>Passwort<input type="password" autocomplete="current-password" required value={password} onInput={(event) => { setPassword(event.currentTarget.value); }} /></label>}
      {sent && <p class="note note--good small">Wenn zu dieser Adresse ein Konto gehört, ist die E-Mail unterwegs. Schau auch im Spam-Ordner nach.</p>}
      <ErrorNote message={action.error} />
      <button class="button button--primary button--big" type="submit" disabled={action.busy || sent}>
        {forgot ? (action.busy ? "Wird gesendet …" : "Link senden") : action.busy ? "Melde an …" : "Anmelden"}
      </button>
      <button class="button" type="button" onClick={switchMode}>{forgot ? "Zurück zur Anmeldung" : "Passwort vergessen?"}</button>
    </form>
  );
}
