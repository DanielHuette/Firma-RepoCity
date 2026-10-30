# Firmenseite RepoCity

[English version](README.md)

Die Seite für repocity.speedofthespirit.dev: in der Mitte das RepoCity-Zeichen, rundherum die
sieben Teile der Firma. Jeder Teil öffnet sich mit vier Reitern (Projekt, Ablauf, Skills,
Präsentation), und die Firma als Ganzes hat eine eigene Präsentation: der Weg eines Kunden vom
ersten Kontakt bis zur Monatsrechnung. Deutsch unter `/`, Englisch unter `/en/`, in beiden
dieselben Anker.

Stand: lokal gebaut, nicht veröffentlicht.

| Ordner | Inhalt |
|---|---|
| `site/` | die veröffentlichten Dateien: zwei HTML-Seiten, das Anfrageformular `anfrage/index.html` mit `anfrage.css`, `styles.css`, `js/` (ES-Module), Schriften, Symbol, Vorschaubild, `_headers`, `_routes.json`, `robots.txt`, `sitemap.xml` |
| `functions/api/` | Cloudflare Pages Functions `termine.js` und `anfrage.js`, dünne Hüllen um `server/anfrage.mjs` |
| `server/` | `anfrage.mjs`, die Verarbeitung der Anfragen ohne Cloudflare-Schnittstelle |
| `bau/` | `inhalt.py` enthält jeden Text in beiden Sprachen, `seite.py` setzt ihn um, `bauen.py` schreibt `site/index.html` und `site/en/index.html`; `vorschau.cjs` erzeugt `site/bilder/vorschau.png` |
| `tests/` | `test_bau.py` (Inhalt und Aufbau), `adresse.test.mjs` (Regeln der Adresse), `herkunft.test.mjs` (Herkunftsmerkmale), `anfrage-regeln.test.mjs`, `termine.test.mjs`, `anfrage-formular.test.mjs` und `anfrage-server.test.mjs` (Anfrageformular und Verarbeitung), `pruefen.cjs` (Prüfung im Browser, Bildschirmfotos in `tests/bilder/`) |

## Anker

| Adresse | Öffnet |
|---|---|
| `/` oder `/#uebersicht` | Übersicht: das Zeichen mit den Teilen rundherum |
| `/#praesentation` | Präsentation der ganzen Firma; an ihrem Ende öffnet sich die Übersicht |
| `/#crm`, `/#cockpit`, `/#radarauditor`, `/#marketing`, `/#telefon`, `/#mail`, `/#webseiten` | diesen Teil auf seiner Präsentation; an ihrem Ende öffnet sich der Reiter Projekt |
| `/#<teil>-projekt`, `/#<teil>-ablauf`, `/#<teil>-skills`, `/#<teil>-praesentation` | diesen Teil auf einem Reiter |

`/en/` nimmt dieselben Anker. Eine Präsentation wechselt nur, wenn sie ohne Unterbrechung oder
nach dem Fortsetzen bis zum Ende ihrer letzten Szene gelaufen ist; angehalten bleibt sie stehen.
Bei reduzierter Bewegung spielt nichts von selbst und nichts wechselt. Zurück führt wieder zur
Präsentation. Die Sprachwahl behält den Anker.

## Herkunftsmerkmale

`site/js/herkunft.js` liest `utm_source`, `utm_medium` und `utm_campaign` aus der Adresse, mit der
ein Besucher kommt, und ordnet sie genau wie das CRM einem Kanal zu (`crm.channel_from` und
`crm.source_channel_label` in `crm/supabase/migrations/011_herkunft.sql`). Ohne `utm_source`
ändert sich nichts. Mit:

- jeder `mailto:`-Link bekommt den Betreff `Anfrage – über <Kanal> (<Kampagne>)`, zum Beispiel
  `Anfrage – über LinkedIn (test)`; ein vorhandener Betreff bleibt vorne, verbunden mit ` – `; eine
  Kampagne, die nicht aus 1 bis 100 Zeichen `a-z`, `0-9` und `-` besteht, entfällt samt Klammern;
- jeder Link auf `https://speedofthespirit.dev` oder eine ihrer Subdomains ohne `utm_`-Parameter
  bekommt dieselben Merkmale, damit sie beim Wechsel auf die nächste Seite erhalten bleiben, auch
  beim Sprachwechsel.

Auf dem Gerät des Besuchers wird nichts gespeichert (kein Cookie, kein Browserspeicher), daher ist
nach § 25 des Telekommunikation-Digitale-Dienste-Datenschutz-Gesetzes (TDDDG) keine Einwilligung nötig. Die Seite hat heute keinen `mailto:`-Link; die Merkmale
reisen nur über ihre Links weiter. Dieselbe Datei liegt im Repository hauptseite
(`site/quellen/js/herkunft.js`); eine Änderung gehört in beide. Sie lädt vor `app.js`, das sich
die Sprachlinks beim Start merkt.

## Anfrageformular

`/anfrage/` ist ein eigenständiges Formular, von der Seite noch nicht verlinkt: Betrieb,
Ansprechpartner, E-Mail, Telefon, Gesprächsart (Vor Ort, Telefon, Video), Wunschtermin; bei Vor Ort
zusätzlich die Anschrift; Webseiten-Adresse und Nachricht freiwillig. `site/js/anfrage.js` bedient
jedes `form[data-anfrage]`, das Formular kann also später in die Hauptseite umziehen.

| Schritt | Mechanismus |
|---|---|
| Freie Termine | die Wahl der Gesprächsart ruft `GET /api/termine?art=visit\|call\|video`, das `crm.audit_slots(p_kind)` aufruft; `site/js/termine.js` zeigt die Startzeiten nach Tagen in deutscher Zeit (Europe/Berlin), je eine Stunde |
| Prüfung | `site/js/anfrage-regeln.js` enthält die Regeln für Formular und Server gemeinsam, mit den Längen und Mustern von `crm.request_audit` (`crm/supabase/migrations/013_audit_anfragen.sql`); Fehler stehen am Feld, der Fokus springt auf das erste |
| Absenden | `POST /api/anfrage` mit JSON (höchstens 32 Kibibyte, nur bekannte Felder) ruft `crm.request_audit`; einen deutschen Satz der Datenbank (SQLSTATE P0001) sieht der Besucher wörtlich, jeden anderen Fehler als festen Satz ohne Einzelheiten |
| Herkunftsmerkmale | `utm_source`, `utm_medium`, `utm_campaign` der Adresse gehen mit (`herkunft.js`) |
| Anfragekennung | jedes Absenden trägt eine zufällige `request_key` (UUID), weitergereicht als `p_request_key`; wer nach einem Fehler dieselben Eingaben erneut absendet, behält sie, die Datenbank speichert die Anfrage also nur einmal; nach jeder geänderten Eingabe gibt es eine neue; sie lebt nur in der geöffneten Seite |
| Danach | der Browser wechselt auf `https://radarauditor.speedofthespirit.dev/`, mit den Merkmalen |

Der Browser spricht nur mit der eigenen Seite; `server/anfrage.mjs` stellt
`handleRequest(request, env)` bereit und leitet an `{SUPABASE_URL}/rest/v1/rpc/<name>` weiter, mit
dem öffentlichen Schlüssel in `apikey` und `Authorization` und `Content-Profile: crm`. Die Datei
nutzt keine Cloudflare-Schnittstelle, ein eigener Server kann sie unverändert aufrufen. Bei
Cloudflare Pages liegen die Functions in `functions/` im Projektordner neben `site/`, nicht darin
(Cloudflare-Dokumentation, Pages Functions, Get started); `site/_routes.json` lässt sie nur für
`/api/*` laufen. `wrangler.toml` nennt `site/` als Ausgabeordner und setzt die beiden öffentlichen
Werte `SUPABASE_URL` und `SUPABASE_ANON_KEY`. Auf dem Gerät wird nichts gespeichert.

## Bauen und prüfen

```bash
python3 bau/bauen.py                 # beide Seiten aus bau/inhalt.py schreiben
uv run ruff check bau tests && uv run ruff format --check bau tests
uv run mypy
uv run pytest
node --test tests/*.test.mjs
node tests/pruefen.cjs               # braucht Playwright für Node (npm install), schreibt tests/bilder/
node tests/pruefen.cjs --nur-anfrage # nur das Anfrageformular
node bau/vorschau.cjs                # erzeugt das Vorschaubild neu
```

`pruefen.cjs` liefert `site/` mit seinen `_headers` aus, ein Verstoß gegen die Content Security
Policy erscheint also als Fehler in der Konsole. Geprüft werden 1440×900, 1280×720, 390×844 und
360×740 in beiden Sprachen: jeder Anker, die Reiterleisten, jede Präsentation im Zeitraffer über
das Chrome DevTools Protocol (die Dauern im Stylesheet bleiben, wie sie sind), Anhalten und
Fortsetzen, Zurück und Vor, Pfeiltasten, reduzierte Bewegung, Fehler in Konsole und Netz,
waagerechtes Scrollen und ob die Reiterleiste etwas verdeckt. Danach in allen vier Größen das
Anfrageformular mit der echten Verarbeitung hinter `/api/*` und einer nachgebildeten Datenbank im
selben Prozess: leeres Absenden, die Anschrift bei Vor Ort, die Terminliste, nur Tastatur (Tab,
Pfeiltasten, Leertaste, Eingabe), das Absenden mit Merkmalen und der Wechsel zu RadarAuditor,
eine Ablehnung durch die Datenbank und eine Beschriftung für jedes Feld.

## Veröffentlichen

Cloudflare Pages mit `site/` als Ausgabeordner, ohne Build-Befehl; `functions/` wird mit
veröffentlicht. `_headers` setzt eine strenge Content Security Policy (`script-src 'self'`, kein
eingebetteter Code) und die Cache-Regeln; `/anfrage/*` ersetzt die Regel durch eine ohne Cloudflare Web Analytics (`script-src 'self'; connect-src 'self'`). Für Antworten der Functions gilt `_headers` nicht, daher
setzt `server/anfrage.mjs` eigene Header.

## Quellen

Jede Aussage stammt aus den Dateien dieses Repositorys; `bau/inhalt.py` nennt sie je Teil unter
`quellen`, und der Reiter Projekt jedes Teils verlinkt sie auf GitHub. Verwendete Zahlen: 108
Prüfungen in 14 Bereichen (`radarauditor/config/pruefkatalog.yaml`), 13 Kanäle
(`marketing/supabase/migrations/005_planer.sql`), Postfach alle fünf Minuten
(`crm/README.de.md`), Knöpfe 14 Tage gültig (`Dokumentation/INTEGRATION.md`), Grafikkarte ab 12
Gigabyte Speicher (`telefon/README.de.md`), Nachfass-Mails nach 5 und 12 Tagen, ein Assistent mit
vier Aufgaben und die Erinnerung an eine Audit-Anfrage nach 24 Stunden
(`Dokumentation/INTEGRATION.de.md`), bis zu drei Knöpfe je Mitteilung und Aufnahmen von höchstens 60
Sekunden mit 16 Kilohertz (`cockpit/README.de.md`), vorgeschlagene Stunden 48 Stunden reserviert
und der Gewinn über zwölf Monate (`crm/README.de.md`), Rückrufe innerhalb von 60 Tagen
(`telefon/README.de.md`).
