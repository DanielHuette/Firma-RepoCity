// A presentation that plays by itself like a short film. Timing lives in the stylesheet: the
// active chapter's bar fills over --szene-dauer and its animationend moves the film on, so
// pausing freezes every animation inside the film. Only a run that plays, or is resumed, to the
// end of the last scene calls onEnde; a paused film never reaches it. With reduced motion
// nothing plays by itself and the chapter buttons still change the scene.

const reduziert = window.matchMedia("(prefers-reduced-motion: reduce)");

export class Film {
  constructor(wurzel, onEnde) {
    this.wurzel = wurzel;
    this.onEnde = onEnde;
    this.szenen = [...wurzel.querySelectorAll(".szene")];
    this.kapitel = [...wurzel.querySelectorAll("[data-kapitel]")];
    this.knopf = wurzel.querySelector(".film__knopf");
    this.knopfText = this.knopf.querySelector(".film__knopf-text");
    this.texte = { abspielen: this.knopf.dataset.abspielen, anhalten: this.knopf.dataset.anhalten };
    this.aktuell = 0;
    this.spielt = false;

    this.kapitel.forEach((k, i) => {
      k.addEventListener("click", () => {
        this.zeige(i);
        this.setzeSpielt(true);
      });
      k.querySelector(".kapitel__balken").addEventListener("animationend", () => this.weiter(i));
    });
    this.knopf.addEventListener("click", () => this.setzeSpielt(!this.spielt));
    wurzel.classList.add("ist-bereit");
    this.zeige(0);
    this.setzeSpielt(false);
  }

  weiter(index) {
    if (!this.spielt || index !== this.aktuell) return;
    if (this.aktuell === this.szenen.length - 1) {
      this.setzeSpielt(false);
      this.onEnde();
      return;
    }
    this.zeige(this.aktuell + 1);
  }

  zeige(index) {
    this.aktuell = Math.max(0, Math.min(index, this.szenen.length - 1));
    this.szenen.forEach((s, i) => {
      const an = i === this.aktuell;
      s.classList.remove("ist-aktiv");
      s.hidden = !an;
    });
    this.kapitel.forEach((k, i) => {
      k.classList.remove("ist-aktiv");
      k.classList.toggle("ist-gesehen", i < this.aktuell);
      if (i === this.aktuell) k.setAttribute("aria-current", "step");
      else k.removeAttribute("aria-current");
    });
    // Re-adding the class after a reflow restarts the scene's animations from the beginning.
    void this.wurzel.offsetWidth;
    this.szenen[this.aktuell].classList.add("ist-aktiv");
    this.kapitel[this.aktuell].classList.add("ist-aktiv");
  }

  setzeSpielt(an) {
    this.spielt = an && !reduziert.matches;
    this.wurzel.classList.toggle("ist-pausiert", !this.spielt);
    this.knopf.setAttribute("aria-pressed", this.spielt ? "true" : "false");
    this.knopfText.textContent = this.spielt ? this.texte.anhalten : this.texte.abspielen;
  }

  /** Starts from the first scene; called when the film's tab opens. */
  start() {
    this.zeige(0);
    this.setzeSpielt(true);
  }

  stop() {
    this.setzeSpielt(false);
  }
}
