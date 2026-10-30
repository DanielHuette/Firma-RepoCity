// Shows one view of the page at a time and keeps it in the address. Links change the hash, the
// browser records each change, and back and forward replay it through "hashchange". A part
// opened by its plain anchor starts on its presentation; when a presentation has played to its
// end the address moves on (part: to its project tab, company: to the overview), so Back returns
// to the presentation.
import { lesen, schreiben, UEBERSICHT } from "./adresse.js";
import { Film } from "./film.js";
import { umlauf } from "./umlauf.js";

const html = document.documentElement;
const grundTitel = document.title;
const teilDock = document.querySelector('.dock[data-dock="teil"]');
const alleReiter = [...document.querySelectorAll('.dock [role="tab"]')];
const sprachLinks = [...document.querySelectorAll("a[data-sprache]")];
const sprachBasis = new Map(sprachLinks.map((a) => [a, a.getAttribute("href")]));

const filme = new Map();
for (const el of document.querySelectorAll("[data-film]")) {
  filme.set(el.dataset.film, new Film(el, () => { location.hash = el.dataset.ende; }));
}
const ueberblick = umlauf(document.querySelector(".sternbild"));

function titel(zustand) {
  if (zustand.ansicht === UEBERSICHT) {
    if (zustand.reiter === UEBERSICHT) return grundTitel;
    const film = document.querySelector("#tafel-firma-praesentation .film-titel");
    return `${film.textContent} – RepoCity`;
  }
  const name = document.querySelector(`#teil-${zustand.ansicht} .teil__name`);
  return `${name.textContent} – RepoCity`;
}

function anwenden(zustand) {
  html.dataset.ansicht = zustand.ansicht;
  html.dataset.reiter = zustand.reiter;

  if (zustand.ansicht !== UEBERSICHT) {
    for (const tab of teilDock.querySelectorAll('[role="tab"]')) {
      const hash = schreiben({ ansicht: zustand.ansicht, reiter: tab.dataset.reiter });
      tab.setAttribute("href", hash);
      tab.setAttribute("aria-controls", `tafel-${zustand.ansicht}-${tab.dataset.reiter}`);
    }
  }
  for (const tab of alleReiter) {
    const an = tab.dataset.reiter === zustand.reiter;
    tab.setAttribute("aria-selected", an ? "true" : "false");
    tab.tabIndex = an ? 0 : -1;
  }

  const filmId = zustand.ansicht === UEBERSICHT ? "firma" : zustand.ansicht;
  for (const [id, film] of filme) {
    if (zustand.reiter === "praesentation" && id === filmId) film.start();
    else film.stop();
  }
  ueberblick.setzeOffen(zustand.ansicht === UEBERSICHT && zustand.reiter === UEBERSICHT);

  for (const a of document.querySelectorAll(".weitere a[data-teil]")) {
    if (a.dataset.teil === zustand.ansicht) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  }

  const hash = lesen(location.hash) ? location.hash : "";
  for (const a of sprachLinks) a.setAttribute("href", sprachBasis.get(a) + hash);
  document.title = titel(zustand);
}

function tastatur(e) {
  const leiste = e.currentTarget.closest('[role="tablist"]');
  const reiter = [...leiste.querySelectorAll('[role="tab"]')];
  const i = reiter.indexOf(e.currentTarget);
  const ziel = {
    ArrowRight: reiter[(i + 1) % reiter.length],
    ArrowDown: reiter[(i + 1) % reiter.length],
    ArrowLeft: reiter[(i - 1 + reiter.length) % reiter.length],
    ArrowUp: reiter[(i - 1 + reiter.length) % reiter.length],
    Home: reiter[0],
    End: reiter[reiter.length - 1],
  }[e.key];
  if (!ziel) return;
  e.preventDefault();
  ziel.focus();
  ziel.click();
}

for (const tab of alleReiter) tab.addEventListener("keydown", tastatur);

window.addEventListener("hashchange", () => {
  const zustand = lesen(location.hash);
  if (!zustand) return;
  anwenden(zustand);
  window.scrollTo(0, 0);
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) return;
  for (const film of filme.values()) film.stop();
});

const erster = lesen(location.hash) || { ansicht: UEBERSICHT, reiter: UEBERSICHT };
// The entrance of the overview plays once, on the first view only.
if (erster.ansicht === UEBERSICHT && erster.reiter === UEBERSICHT) {
  html.classList.add("auftritt");
  setTimeout(() => html.classList.remove("auftritt"), 3200);
}
anwenden(erster);
html.classList.add("bereit");
