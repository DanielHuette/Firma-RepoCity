// Overview: a point of light travels along the orbit around the mark and makes each part glow
// as it passes. The orbit is an ellipse in percent of the stage (radius 38 on both axes, the
// same numbers as the SVG and the node positions in styles.css). It only runs while the overview
// is open, the window is visible, the screen is wide enough for the orbit and motion is wanted.

const RADIUS = 38;
const UMLAUF_MS = 16000;
const NAEHE = 0.09;

const reduziert = window.matchMedia("(prefers-reduced-motion: reduce)");
const breit = window.matchMedia("(min-width: 760px)");

export function umlauf(buehne) {
  const signal = buehne.querySelector(".umlauf__signal");
  const knoten = [...buehne.querySelectorAll(".knoten")];
  const winkel = knoten.map((_, i) => -Math.PI / 2 + (i * 2 * Math.PI) / knoten.length);
  let offen = false;
  let raf = 0;
  let start = 0;

  function markiere(phi) {
    knoten.forEach((k, i) => {
      let d = Math.abs(phi - winkel[i]) % (2 * Math.PI);
      if (d > Math.PI) d = 2 * Math.PI - d;
      k.classList.toggle("ist-dran", d < NAEHE * Math.PI);
    });
  }

  function takt(jetzt) {
    const phi = -Math.PI / 2 + (((jetzt - start) % UMLAUF_MS) / UMLAUF_MS) * 2 * Math.PI;
    signal.style.setProperty("--x", (50 + RADIUS * Math.cos(phi)).toFixed(3));
    signal.style.setProperty("--y", (50 + RADIUS * Math.sin(phi)).toFixed(3));
    markiere(phi);
    raf = requestAnimationFrame(takt);
  }

  function pruefen() {
    const soll = offen && !document.hidden && breit.matches && !reduziert.matches;
    if (soll && !raf) {
      start = performance.now();
      buehne.classList.add("laeuft");
      raf = requestAnimationFrame(takt);
    } else if (!soll && raf) {
      cancelAnimationFrame(raf);
      raf = 0;
      buehne.classList.remove("laeuft");
      knoten.forEach((k) => k.classList.remove("ist-dran"));
    }
  }

  document.addEventListener("visibilitychange", pruefen);
  breit.addEventListener("change", pruefen);
  reduziert.addEventListener("change", pruefen);

  return {
    setzeOffen(an) {
      offen = an;
      pruefen();
    },
  };
}
