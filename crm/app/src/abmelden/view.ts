// What the opt-out page shows for the address it was opened with.
// Context: static page /abmelden/ of the CRM site; the link in a follow-up mail leads here through
// the Edge Function crm-abmelden, whose button POST answers with a redirect back here. | Input: the
// query of the page address (?t=<token> or ?ergebnis=<outcome>) and the address of the function. |
// Output: heading, text and the form address, null when there is no button.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TITLE = "Keine Erinnerungen mehr";
const INVALID = {
  heading: "Link nicht gültig",
  text: "Dieser Link ist nicht gültig. Bitte prüfen Sie, ob er vollständig aus der E-Mail übernommen wurde.",
};
const OUTCOMES: Record<string, { heading: string; text: string }> = {
  erledigt: { heading: TITLE, text: "Erledigt. Sie bekommen keine Erinnerungen und keine Bewertungsbitten mehr." },
  fehler: { heading: "Nicht geklappt", text: "Das hat gerade nicht geklappt. Bitte versuchen Sie es später noch einmal." },
  ungueltig: INVALID,
};

export interface OptOutView {
  heading: string;
  text: string;
  action: string | null;
}

export function optOutView(search: string, functionUrl: string): OptOutView {
  const query = new URLSearchParams(search);
  const token = query.get("t") ?? "";
  if (UUID.test(token)) {
    return {
      heading: TITLE,
      text: "Mit einem Klick auf den Knopf bekommen Sie von uns keine Erinnerungen und keine Bewertungsbitten mehr.",
      action: `${functionUrl}?t=${token.toLowerCase()}`,
    };
  }
  return { ...(OUTCOMES[query.get("ergebnis") ?? ""] ?? INVALID), action: null };
}
