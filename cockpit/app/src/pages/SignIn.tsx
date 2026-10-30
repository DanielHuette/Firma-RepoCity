// Sign-in of the one operator account; sign-ups are switched off in Supabase.
import { useState } from "preact/hooks";
import { requestPasswordReset, signIn } from "../api/cockpit";
import { Mark, Wordmark } from "../components/Logo";
import { ErrorNote } from "../components/ui";
import { useTilt } from "../hooks/motion";
import { useAction } from "../hooks/useAsync";

function useSignInForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [forgot, setForgot] = useState(false);
  const [sent, setSent] = useState(false);
  const action = useAction();
  const submit = (event: Event) => {
    event.preventDefault();
    if (!forgot) {
      void action.run(() => signIn(email.trim(), password));
      return;
    }
    void action.run(async () => {
      await requestPasswordReset(email.trim(), `${window.location.origin}/`);
      setSent(true);
    });
  };
  const switchMode = () => {
    setForgot(!forgot);
    setSent(false);
    action.clear();
  };
  return { email, setEmail, password, setPassword, forgot, sent, action, submit, switchMode };
}

function SignInFields({ form }: { form: ReturnType<typeof useSignInForm> }) {
  return (
    <>
      <label>
        E-Mail
        <input type="email" autocomplete="username" required value={form.email} onInput={(event) => { form.setEmail(event.currentTarget.value); }} />
      </label>
      {!form.forgot && (
        <label>
          Passwort
          <input type="password" autocomplete="current-password" required value={form.password} onInput={(event) => { form.setPassword(event.currentTarget.value); }} />
        </label>
      )}
      {form.sent && <p class="note note--good small">Wenn zu dieser Adresse ein Konto gehört, ist die E-Mail unterwegs. Schau auch im Spam-Ordner nach.</p>}
      <ErrorNote message={form.action.error} />
    </>
  );
}

function submitLabel(forgot: boolean, busy: boolean): string {
  if (forgot) return busy ? "Wird gesendet …" : "Link senden";
  return busy ? "Melde an …" : "Anmelden";
}

function SignInCard() {
  const form = useSignInForm();
  return (
    <form class="signin__card panel stack" onSubmit={form.submit}>
      <div>
        <p class="kicker">RepoCity</p>
        <h1>{form.forgot ? "Passwort vergessen" : "Cockpit"}</h1>
      </div>
      <p class="muted">
        {form.forgot
          ? "Du bekommst eine E-Mail mit einem Link, über den du ein neues Passwort festlegst."
          : "Alles, was in RepoCity passiert, an einem Ort."}
      </p>
      <SignInFields form={form} />
      <button class="button button--primary button--big" type="submit" disabled={form.action.busy || form.sent}>{submitLabel(form.forgot, form.action.busy)}</button>
      <button class="button" type="button" onClick={form.switchMode}>{form.forgot ? "Zurück zur Anmeldung" : "Passwort vergessen?"}</button>
    </form>
  );
}

export function SignIn() {
  const lockup = useTilt<HTMLDivElement>(18, -8, 9);
  return (
    <main class="signin">
      <div class="lockup" ref={lockup} aria-label="RepoCity – AI for everyone" role="img">
        <Mark size={160} />
        <Wordmark />
      </div>
      <SignInCard />
    </main>
  );
}
