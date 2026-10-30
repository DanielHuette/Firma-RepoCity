// The appointment page for customers in the look of the CRM sign-in: the lit scene, the RepoCity mark
// and one card. The form posts the field of its button, so the function books or asks only on a click,
// never when a mail program opens the link.
// Context: entry of termin/index.html, built by Vite as its own page without the CRM app and without
// its Supabase client. | Input: location.search and VITE_SUPABASE_URL. | Output: heading, text and,
// for a valid link, the button.
import { render } from "preact";
import { Mark, Wordmark } from "../components/Logo";
import { Szene } from "../components/Szene";
import { installPointerLight, useTilt } from "../hooks/motion";
import "../theme/app.css";
import { appointmentView } from "./view";

const view = appointmentView(window.location.search, `${import.meta.env.VITE_SUPABASE_URL ?? ""}/functions/v1/crm-termin`);

function AppointmentPage() {
  const lockup = useTilt<HTMLDivElement>(18, -8, 9);
  return (
    <>
      <Szene leise={false} />
      <main class="signin">
        <div class="lockup" ref={lockup} aria-label="RepoCity – AI for everyone" role="img">
          <Mark size={160} />
          <Wordmark />
        </div>
        <form class="signin__card panel stack" method="post" action={view.action ?? undefined}>
          <div>
            <p class="kicker">RepoCity</p>
            <h1>{view.heading}</h1>
          </div>
          <p class="muted">{view.text}</p>
          {view.field !== null && view.button !== null && (
            <>
              <input type="hidden" name={view.field} value="1" />
              <button class="button button--primary button--big" type="submit">{view.button}</button>
            </>
          )}
        </form>
      </main>
    </>
  );
}

const root = document.getElementById("app");
if (root !== null) {
  installPointerLight();
  render(<AppointmentPage />, root);
}
