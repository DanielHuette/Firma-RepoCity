// The operating instructions in short, where the operator needs them.
export function Guide() {
  return (
    <div class="stack stack--loose">
      <section class="hero">
        <p class="kicker">Anleitung</p>
        <h1>So arbeitest du mit dem Cockpit</h1>
        <p class="muted">Fünf Schritte von der Recherche bis zum Wochenbericht.</p>
      </section>
      <ol class="stack" style={{ paddingLeft: "1.2em" }}>
        <li class="panel stack stack--tight">
          <h2>Recherche prüfen</h2>
          <p>Unter „Recherche“ stehen die Befunde mit Quelle, geprüfter Textstelle und Urteil. Nur behaltene, belegte Befunde dürfen zitiert werden.</p>
        </li>
        <li class="panel stack stack--tight">
          <h2>Beiträge freigeben</h2>
          <p>
            Jeder Beitrag zeigt rechts seine Belege. Enthält er eine Zahl ohne Beleg, ist „Freigeben“ gesperrt, auch in der Datenbank. Bearbeiten schickt den Beitrag zurück
            in die Prüfung.
          </p>
        </li>
        <li class="panel stack stack--tight">
          <h2>Freigeben &amp; starten</h2>
          <p>
            Der Startknopf setzt den Plan: Jeder freigegebene Beitrag erscheint am Starttag plus seinem Versatz zur festgelegten Uhrzeit. Pausieren hält alles an, Fortsetzen
            plant neu.
          </p>
        </li>
        <li class="panel stack stack--tight">
          <h2>Veröffentlichen</h2>
          <p>
            Jeder freigegebene Beitrag erscheint zum Termin unter „Jetzt posten“ und als Nachricht im Cockpit: Text kopieren, im Firmenkonto des Kanals posten,
            Adresse eintragen, „Als gepostet markieren“.
          </p>
        </li>
        <li class="panel stack stack--tight">
          <h2>Messen und berichten</h2>
          <p>
            Impressionen, Klicks und Anfragen aus der Statistik des Kanals trägst du im Beitrag unter „Ergebnis eintragen“ ein. Die Kampagne zeigt sie zusammen.
          </p>
        </li>
      </ol>
    </div>
  );
}
