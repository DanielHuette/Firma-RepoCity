// Installing the app, the version, and signing out.
import { signOut } from "../api/queries";
import { isStandalone, useInstallPrompt } from "../hooks/install";

export function Settings({ email }: { email: string }) {
  const { available, install } = useInstallPrompt();
  return (
    <div class="stack stack--loose">
      <section class="hero">
        <p class="kicker">Einstellungen</p>
        <h1>App und Konto</h1>
      </section>
      <section class="panel stack stack--tight">
        <h2>App installieren</h2>
        {isStandalone() ? (
          <p class="note note--good">Das Cockpit läuft als installierte App.</p>
        ) : available ? (
          <div>
            <button class="button button--primary" type="button" onClick={() => void install()}>
              Auf diesem Gerät installieren
            </button>
          </div>
        ) : (
          <p class="small muted">
            Im Browsermenü „App installieren“ oder „Zum Startbildschirm hinzufügen“ wählen. Auf dem iPhone: Teilen, dann „Zum Home-Bildschirm“.
          </p>
        )}
      </section>
      <section class="panel stack stack--tight">
        <h2>Konto</h2>
        <p class="small">Angemeldet als {email}</p>
        <div>
          <button class="button" type="button" onClick={() => void signOut()}>
            Abmelden
          </button>
        </div>
        <p class="small muted">Version {__APP_VERSION__}</p>
      </section>
    </div>
  );
}
