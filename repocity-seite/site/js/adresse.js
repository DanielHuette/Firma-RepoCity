// The address is the state of the page: which view is open and which tab. Every anchor is
// lower case and the same in both languages:
//   (none), #uebersicht          overview with the parts around the mark
//   #praesentation               presentation of the whole company
//   #<part>                      that part, on its presentation
//   #<part>-<tab>                that part on one tab (projekt, ablauf, skills, praesentation)

export const TEILE = ["crm", "cockpit", "radarauditor", "marketing", "telefon", "mail", "webseiten"];
export const REITER = ["projekt", "ablauf", "skills", "praesentation"];
export const UEBERSICHT = "uebersicht";

/** Reads a hash; returns null when it names no view, so in-page anchors keep the view. */
export function lesen(hash) {
  let name = "";
  try {
    name = decodeURIComponent(String(hash || "").replace(/^#/, "")).trim().toLowerCase();
  } catch {
    return null;
  }
  if (name === "" || name === UEBERSICHT) return { ansicht: UEBERSICHT, reiter: UEBERSICHT };
  if (name === "praesentation") return { ansicht: UEBERSICHT, reiter: "praesentation" };
  if (TEILE.includes(name)) return { ansicht: name, reiter: "praesentation" };
  const trenner = name.lastIndexOf("-");
  if (trenner > 0) {
    const teil = name.slice(0, trenner);
    const reiter = name.slice(trenner + 1);
    if (TEILE.includes(teil) && REITER.includes(reiter)) return { ansicht: teil, reiter };
  }
  return null;
}

/** Writes the hash for a state; a part's tab always carries the tab name. */
export function schreiben(zustand) {
  if (zustand.ansicht === UEBERSICHT) return zustand.reiter === "praesentation" ? "#praesentation" : "#uebersicht";
  return `#${zustand.ansicht}-${zustand.reiter}`;
}
