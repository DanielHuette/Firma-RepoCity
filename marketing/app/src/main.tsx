// Entry point: checks the build configuration, catches the install prompt and mounts the app.
import { render } from "preact";
import { supabaseConfig } from "./api/config";
import { captureInstallPrompt } from "./hooks/install";
import "./theme/app.css";

const root = document.getElementById("app");
if (root === null) throw new Error("Element #app is missing in index.html");

captureInstallPrompt();

function ConfigMissing() {
  return (
    <main class="signin">
      <div class="signin__card panel stack">
        <h1>Cockpit nicht eingerichtet</h1>
        <p class="muted">
          Beim Bauen fehlten VITE_SUPABASE_URL und VITE_SUPABASE_ANON_KEY. Trag beide in Cloudflare Pages unter Einstellungen, Umgebungsvariablen ein und baue neu.
        </p>
      </div>
    </main>
  );
}

// The Supabase client throws on import without configuration, so the app loads only once it is known to work.
if (supabaseConfig() === null) {
  render(<ConfigMissing />, root);
} else {
  void import("./App").then(({ App }) => {
    render(<App />, root);
  });
}
