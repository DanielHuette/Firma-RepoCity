import { describe, expect, it } from "vitest";
import { optOutView } from "./view";

const FUNCTION = "https://yizvntdwdajlgcbjcves.supabase.co/functions/v1/crm-abmelden";
const TOKEN = "3f8e2a10-6b7c-4d5e-8f90-a1b2c3d4e5f6";

describe("optOutView", () => {
  it("shows the button that posts the token to the function", () => {
    expect(optOutView(`?t=${TOKEN.toUpperCase()}`, FUNCTION)).toEqual({
      heading: "Keine Erinnerungen mehr",
      text: "Mit einem Klick auf den Knopf bekommen Sie von uns keine Erinnerungen und keine Bewertungsbitten mehr.",
      action: `${FUNCTION}?t=${TOKEN}`,
    });
  });

  it.each([
    ["?ergebnis=erledigt", "Keine Erinnerungen mehr", "Erledigt. Sie bekommen keine Erinnerungen und keine Bewertungsbitten mehr."],
    ["?ergebnis=fehler", "Nicht geklappt", "Das hat gerade nicht geklappt. Bitte versuchen Sie es später noch einmal."],
    ["?ergebnis=ungueltig", "Link nicht gültig", "Dieser Link ist nicht gültig. Bitte prüfen Sie, ob er vollständig aus der E-Mail übernommen wurde."],
    ["", "Link nicht gültig", "Dieser Link ist nicht gültig. Bitte prüfen Sie, ob er vollständig aus der E-Mail übernommen wurde."],
    [`?t=${TOKEN}0`, "Link nicht gültig", "Dieser Link ist nicht gültig. Bitte prüfen Sie, ob er vollständig aus der E-Mail übernommen wurde."],
    ["?ergebnis=irgendwas", "Link nicht gültig", "Dieser Link ist nicht gültig. Bitte prüfen Sie, ob er vollständig aus der E-Mail übernommen wurde."],
  ])("answers %s without a button", (search, heading, text) => {
    expect(optOutView(search, FUNCTION)).toEqual({ heading, text, action: null });
  });

  it("never puts anything but a checked token into the address it posts to", () => {
    expect(optOutView("?t=%22%3E%3Cscript%3E", FUNCTION).action).toBeNull();
  });
});
