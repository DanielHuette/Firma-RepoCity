# CRM

[English version](README.md)

| Teil | Zweck |
|---|---|
| `app/` | Preact-App (Vite, installierbar): Heute, Kalender, Kunden mit vollständiger Kundenakte, Verkauf, Rechnungen, Finanzen, Service, Freigaben, Einstellungen |
| `supabase/migrations/` | Schema `crm`: Nummernkreise, Summen, Freigaben, Verträge aus Vorlagen, Prüfliste für unbekannte Absender, Postausgang, Bitten um Bewertung, Monatsprüfungen, Anrufe, Kontoauszüge, Ausgaben mit Belegen, Gewinn je Monat, Zeitpläne |
| `supabase/functions/crm-mail/` | Postfach-Dienst: Abruf per IMAP, Einordnung unbekannter Absender, Versand per SMTP mit Angebots-, Rechnungs- und Mahn-PDF |
| `supabase/functions/crm-calendar/` | Kalender-Abo fürs Handy: die Termine als iCalendar hinter dem geheimen Link |
| `supabase/functions/crm-abmelden/` | Abbestellen der Nachfass-Mails, zugleich Ziel des Ein-Klick-Abmeldens über den Kopf List-Unsubscribe |
| `supabase/functions/crm-termin/` | Die Terminlinks der Audit-Anfragen: vorgeschlagene Stunde buchen, anderen Termin wünschen |
| `supabase/functions/_shared/` | Gemeinsamer Code mehrerer Funktionen: iCalendar-Erzeugung, Termin als Kalendereintrag, Link-Schlüssel |
| `abmelden/index.html`, `src/abmelden/` | Die Abmeldeseite für Kunden, eine zweite Seite im Bau der App, ohne die App selbst |
| `termin/index.html`, `src/termin/` | Die Terminseite für Kunden, eine dritte Seite im Bau der App, ohne die App selbst |
| `../integration/` | Datenbanktests von CRM, Cockpit und RadarAuditor zusammen auf einem echten PostgreSQL |

Bauen: `cd app && npm ci && npm run check && npm test && npm run build` mit gesetztem `VITE_SUPABASE_URL` und `VITE_SUPABASE_ANON_KEY`.
Veröffentlichen: `npx wrangler@4 pages deploy dist --project-name repocity-crm --branch main`.

## Postfach-Dienst

**Context:** Edge Function `crm-mail`, alle fünf Minuten vom Zeitplan `crm-mail` und über „Postfach abrufen“ in den Einstellungen aufgerufen. | **Input:** Postfach-Zugang aus dem Supabase Vault, Schema `crm`, Prüfbericht-mit-Angebot-PDFs des RadarAuditors (`public.documents`, Speicher `documents`). | **Output:** Kundenakten, Einträge zur Einordnung, versendete Mails, PDFs im Speicher `crm-documents`.

| Schritt | Was passiert |
|---|---|
| Postausgang | Verschickt jede wartende Mail (`contract`, `quote`, `invoice`, `dunning`, `review_request`, `review_reminder`, `appointment`, `follow_up`, `assistant`, `audit_proposal`, `appointment_cancel`, `appointment_reminder`) mit ihrem Anhang: Vertrag; Angebot als Prüfbericht-mit-Angebot-PDF des RadarAuditors, bis zu 30 Minuten wird darauf gewartet, solange es entsteht, sonst ein eigenes Angebots-PDF; Rechnung; Mahnschreiben; eine Terminbestätigung trägt den Termin als `Termin_<Tag>.ics` (iCalendar, `METHOD:PUBLISH`, Organisator ist die Postfachadresse, nicht in `crm-documents` abgelegt), ein gelöschter oder abgesagter Termin lässt diese Mail fehlschlagen; eine Absage (`appointment_cancel`) trägt den abgesagten Termin als `Absage_<Tag>.ics` (`METHOD:CANCEL`, dieselbe UID, `STATUS:CANCELLED`, `SEQUENCE:1`, RFC 5546 Abschnitte 3.2.1 und 3.2.5), in einer eigenen Mail, damit jede Mail ein Kalenderobjekt enthält. Bewertungs-, Nachfass-, Assistenten-, Vorschlags- und Erinnerungs-Mails gehen ohne Anhang. Eine Mail mit `list_unsubscribe` bekommt `List-Unsubscribe: <Adresse>` und `List-Unsubscribe-Post: List-Unsubscribe=One-Click` (RFC 8058). Ein fehlgeschlagener Versand wird wiederholt, nach dem dritten Versuch gilt die Mail als fehlgeschlagen. Eine vom Mailserver angenommene Mail gilt als versendet und geht nie ein zweites Mal raus; scheitert danach das Ablegen, steht das nur im Bericht des Laufs. |
| Eingeordnete Absender | Vom Server eingeordnete unbekannte Absender: Ein Kunde wird angelegt und alle gespeicherten Mails kommen in seine Akte; jedes andere Ergebnis landet in der Prüfliste. Danach werden die gespeicherten Originalmails gelöscht. |
| Postfach | Neue Mails aus Posteingang und Gesendet kommen in die Kundenakte. Eine eingehende Mail eines Kunden mit verschicktem Angebot wird als `customer_mail` zur Einordnung vorgemerkt; `sender_verified` wird gesetzt, wenn Zohos eigene Kopfzeile Authentication-Results dmarc=pass oder eine DKIM-Signatur der Absenderdomain zeigt. Von einem unbekannten Absender wird die Originalmail unter `triage/<id>.eml` gespeichert, mit einem `unknown_sender`-Eintrag je Adresse; weitere Mails dieser Adresse vor der Einordnung liegen unter `triage/<id>/<hash>.eml`. Automatische Absender und die Liste „kein Kunde“ wirken wie bisher. |
| Rechnungs-PDFs | Jede festgeschriebene Rechnung und Stornorechnung ohne PDF bekommt eins, damit das Paket für den Steuerberater vollständig ist. |

Jedes erzeugte PDF liegt unter `customers/<Kunden-ID>/` und als Eintrag in `crm.documents` mit der ID von Angebot, Rechnung oder Vertrag. Rechnungs-PDFs nutzen die Firmen- und Kundendaten, die beim Festschreiben der Rechnung gespeichert wurden.

Prüfen: `cd supabase/functions/crm-mail && deno check *.ts pdf/*.ts testing/*.ts && deno lint && deno test`, außerdem in `supabase/functions/crm-calendar`, `crm-abmelden`, `crm-termin` und `_shared` jeweils `deno check *.ts && deno lint && deno test --allow-env --allow-read`.

## Kalender-Abo
**Context:** Edge Function `crm-calendar`, ohne Prüfung eines Anmeldeschlüssels bereitgestellt; der geheime Link aus Einstellungen → Kalender ist der Zugang. | **Input:** `GET /functions/v1/crm-calendar?t=<crm.settings.calendar_token>`. | **Output:** `text/calendar; charset=utf-8` aus `crm.calendar_events`, `Cache-Control: private, no-store`.

| Fall | Antwort |
|---|---|
| Richtiger Schlüssel | Alle geplanten und erledigten Termine von 90 Tagen zurück bis ein Jahr voraus; ein Termin ohne Uhrzeit ist ein ganztägiger Eintrag; Beschreibung: Art, Kunde, Notiz |
| Fehlender, falsch geformter oder falscher Schlüssel | 404 „Nicht gefunden.“ ohne Einzelheiten |
| Datenbank nicht erreichbar | 503 |

Ein neuer `calendar_token` macht jeden alten Link unbrauchbar.

## Abbestellen
**Context:** Supabase zeigt eine Webseite, die eine Funktion auf einen Aufruf hin schickt, nur als reinen Text, solange das Projekt keine bezahlte eigene Adresse hat. Die Seite liegt deshalb auf der CRM-Seite (`/abmelden/`, im Aussehen der Anmeldung), und die Edge Function `crm-abmelden` antwortet nur mit Weiterleitungen oder reinem Text. | **Input:** `?t=<crm.customers.optout_token>`. | **Output:** `crm.opt_out` setzt `no_follow_ups` und `no_review_requests`.

| Anfrage | Was passiert |
|---|---|
| Aufruf der Funktion (der Link in der Mail oder ein Linkprüfer) | Weiterleitung auf `https://crm.speedofthespirit.dev/abmelden/?t=<Schlüssel>`; ändert nichts |
| Die Seite | „Keine Erinnerungen mehr“ mit dem Knopf „Abbestellen“; ohne gültigen Schlüssel „Link nicht gültig“ |
| Knopf (Feld `abmelden`) | `crm.opt_out`, danach zurück auf die Seite mit `ergebnis=erledigt`, `ungueltig` oder `fehler` |
| Ein-Klick-Befehl eines Mailprogramms (`List-Unsubscribe=One-Click`, als Formular oder multipart) | `crm.opt_out`, reiner Text mit 200, 404 oder 503, nie eine Weiterleitung (RFC 8058 Abschnitt 3.1) |

Die Seite gibt die Adresse nicht weiter, lädt nur eigene Dateien, darf nur an das Supabase-Projekt senden (`_headers`) und installiert keinen Hintergrunddienst.

## Audit anfragen
**Context:** Migration `013_audit_anfragen.sql`; das Formular auf der Webseite (`repocity-seite`) ruft `crm.audit_slots` und `crm.request_audit` mit dem öffentlichen Schlüssel auf, Daniel entscheidet mit den Knöpfen der Mitteilung im Cockpit. | **Input:** die Anfrage, Daniels Tippen, die Klicks des Kunden. | **Output:** Kunde, Anfrage und `crm.audit_requests`; Termin, Mails und Mitteilungen im Cockpit.

| Schritt | Was passiert |
|---|---|
| Freie Zeiten | `crm.audit_slots(Art)`: Stundenanfänge ab morgen 0 Uhr Berliner Zeit für 21 Tage an den Geschäftstagen und in den Geschäftszeiten, ohne Überschneidung mit einem nicht abgesagten Termin (ein Eintrag ohne Uhrzeit sperrt nichts) und ohne Stunden, die in den letzten 48 Stunden einem anderen Betrieb vorgeschlagen wurden; nur Zeiten |
| Anfrage | `crm.request_audit` prüft Felder und Stunde, nimmt den Kunden über `crm.submit_inquiry` auf (Kanal und Kampagne aus `utm_*`, ohne Mitteilung „Neuer Kunde“), speichert die Anfrage und meldet „Audit-Anfrage: …“ mit „Bestätigen“, „Anderen Termin vorschlagen“ und, mit Webseite, „Prüfen“; ein Tipp auf die Mitteilung öffnet die Nachrichtenzentrale des Cockpits; der Kunde bekommt noch nichts. Dieselbe `p_request_key` ein zweites Mal speichert nichts und antwortet wieder `{"ok": true}` |
| Bestätigen | die Wunschstunde als Termin (eine Stunde; Video bekommt `https://meet.jit.si/RepoCity-<32 zufällige Zeichen>` als Ort, Telefon die Rufnummer, Vor Ort die Anschrift), Bestätigung der Art `appointment` mit dem Text `audit_confirmation`, Kalenderdatei und dem Link „Anderen Termin wünschen“ |
| Anderen Termin vorschlagen | die nächsten drei freien Stunden außer der Wunschzeit als Entwurf und eine zweite Mitteilung mit „Senden“; „Senden“ stellt `audit_proposal` mit einem Link je Stunde in den Postausgang; ist eine Stunde inzwischen belegt, kommen stattdessen drei neue; die Stunden bleiben 48 Stunden für diesen Betrieb reserviert |
| Prüfen | `public.start_field_audit` für die Webseite, mit dem CRM-Kunden verknüpft |
| Umbuchen | wird nach „Anderen Termin wünschen“ neu gebucht, wird der alte Termin abgesagt; die Bestätigung nutzt den Text `audit_rebooking` (nennt den bisherigen Termin), `appointment_cancel` mit dem Text `audit_cancellation` trägt die Absage |
| Erinnerungen | stündlich `crm-audit-requests` (Minute 19): eine seit 24 Stunden offene Anfrage meldet sich einmal neu; täglich `crm-appointment-reminders` (07:47 UTC): `appointment_reminder` für jeden Termin morgen, dessen Bestätigung verschickt ist |

Die Links führen auf die Edge Function `crm-termin` (ohne Prüfung eines Anmeldeschlüssels), die nur mit Weiterleitungen auf die Seite `https://crm.speedofthespirit.dev/termin/` antwortet:

| Anfrage | Was passiert |
|---|---|
| GET `?buchen=<crm.audit_offers.token>` | `crm.audit_offer_view`, 303 auf die Seite mit `buchen`, `zeit`, `art`; bucht nichts |
| Knopf (Feld `buchen`) | `crm.book_audit_offer`: sofort gebucht und bestätigt, oder `ergebnis=belegt` (Daniel bekommt „Wunschzeit belegt: …“), `abgelaufen` (vor mehr als 48 Stunden verschickt oder vorbei: nichts gebucht, Daniel bekommt einmal „Vorschlag abgelaufen: …“), `ungueltig` (ersetzt, oder der damit gebuchte Termin wurde ersetzt) oder `fehler` |
| GET eines Vorschlags, der vor mehr als 48 Stunden verschickt wurde | 303 auf die Seite mit `abgelaufen`, `zeit`, `art`: die Reservierung ist vorbei, Knopf „Neue Vorschläge anfordern“ |
| GET `?anders=<crm.audit_requests.reschedule_token>` | `crm.audit_reschedule_view`, 303 auf die Seite mit dem bisherigen Termin |
| Knopf (Feld `anders`) | `crm.request_audit_reschedule`: Mitteilung „Anderer Termin gewünscht: …“ mit „Anderen Termin vorschlagen“; der alte Termin bleibt, bis ein neuer gebucht ist, dann wird er abgesagt; `ergebnis=gewuenscht` |

Für die Seite gelten dieselben Regeln wie für `/abmelden/` (`_headers`).

## Funktionen bereitstellen
Zuerst die Migrationen 009 und 010 (013 vor `crm-termin`), dann im Ordner `crm/`:
`npx supabase@2.121.0 functions deploy crm-mail --project-ref yizvntdwdajlgcbjcves --use-api`
`npx supabase@2.121.0 functions deploy crm-calendar --project-ref yizvntdwdajlgcbjcves --use-api --no-verify-jwt`
`npx supabase@2.121.0 functions deploy crm-abmelden --project-ref yizvntdwdajlgcbjcves --use-api --no-verify-jwt`
`npx supabase@2.121.0 functions deploy crm-termin --project-ref yizvntdwdajlgcbjcves --use-api --no-verify-jwt`
Gemeinsamer Code liegt in `supabase/functions/_shared/`; der Unterstrich verhindert, dass er als eigene Funktion bereitgestellt wird, und die Kommandozeile packt ihn in jede Funktion, die ihn einbindet.

## Telefon-Assistent

**Context:** Migration `005_calls.sql`; der Assistent auf dem RepoCity-Server ruft drei Funktionen mit dem Dienstschlüssel auf. | **Input:** die Rufnummer der Leitung, was der Anrufer gesagt hat. | **Output:** Kunden, Anfragen, Rückruf-Aufgaben, Entscheidungen zu Angeboten, Gesprächsprotokolle und Mitteilungen im Cockpit.

| Funktion | Was passiert |
|---|---|
| `crm.intake_call` | Findet den Kunden über die Rufnummer der Leitung, verglichen nach Ziffern (`+49`, `0049` und eine führende `0` sind dasselbe), dann über eine gültige genannte E-Mail-Adresse; sonst wird er mit Herkunft `phone` angelegt, auch ohne E-Mail-Adresse. Legt eine Anfrage mit Weg `phone` und die Aufgabe „Rückruf <Name>, <Nummer>“ an. |
| `crm.phone_quote_decision` | Nimmt an oder lehnt ab mit Weg `phone` nur, wenn die Rufnummer der Leitung die Telefonnummer des Kunden zum Angebot ist, das Angebot verschickt und bei einer Annahme noch gültig ist. Sonst eine Mitteilung im Cockpit, bei einer möglichen Annahme mit „Annahme bestätigen“. Gibt den Satz zurück, den die Assistentin vorliest; jeder nicht entschiedene Fall bekommt denselben. |
| `crm.record_call` | Speichert das Gespräch mit Mitschrift und Zusammenfassung in `crm.calls`, verknüpft den Kunden und meldet es im Cockpit („Anruf von …“). Kommt dasselbe Gespräch zweimal an, wird es einmal gespeichert. |

Die Begrüßung (`crm.settings.assistant_greeting`) sagt dem Anrufer, dass eine künstliche Intelligenz spricht und das Gespräch mitgeschrieben wird, wie es Artikel 50 der Verordnung (EU) 2024/1689 verlangt; sie lässt sich umformulieren, aber nicht leeren. `assistant_facts` ist, was die Assistentin über den Betrieb sagen darf.

## Was die App kann

| Seite | Funktion |
|---|---|
| Heute | Was ansteht: Freigaben, fällige Monatsprüfungen mit „Prüfung jetzt starten“, nicht versendete E-Mails, Mails, die der Server noch nicht gelesen hat, überfällige Rechnungen, die Anrufe beim Telefonassistenten der letzten 24 Stunden (auch von Anrufern, die das CRM noch nicht kennt), die geplanten Termine des Tages (`appointments_today_items` aus `crm.today_overview`, die ohne Uhrzeit zuerst, mit Art und bei einem Videogespräch dem Jitsi-Link) mit „Zum Kalender“, Aufgaben (auf Wunsch mit Kunde). Mahnungen, Abo-Abrechnung, fällige Prüfungen und Bitten um Bewertung laufen in der Tagesroutine der Datenbank (`crm.daily_routine`), nicht beim Öffnen der Seite. |
| Kalender | `/kalender`: eine Woche von Montag bis Sonntag in Berliner Zeit, auch auf einem Gerät mit anderer Zeitzone, mit „Vorige Woche“, „Heute“ und „Nächste Woche“; ein Termin ohne Uhrzeit steht als „ohne Uhrzeit“ zuerst an seinem Tag; darunter die nächsten 30 geplanten Termine mit „Ändern“, „Erledigt“ und „Absagen“ (`crm.set_appointment_status`). Ein Videogespräch zeigt „Videogespräch öffnen“ mit seinem Jitsi-Link. Das Formular nimmt Art (Vor-Ort-Gespräch, Rückruf, Telefonat, Videogespräch, Termin), Titel (leer: Art und Kunde), Tag, eine Uhrzeit nach Wahl mit Dauer (5 bis 720 Minuten), Kunde, Ort und Notiz und ruft `crm.create_appointment` oder `crm.update_appointment` auf; die Uhrzeit geht mit dem Berliner Zeitversatz dieses Tages an die Datenbank, auch über die Zeitumstellung hinweg. „Bestätigung mit Kalenderdatei an den Kunden schicken“ lässt sich nur mit einem Kunden mit E-Mail-Adresse und mit Uhrzeit ankreuzen; bei einem neuen Termin ist das `p_confirm`, bei einem geänderten `crm.confirm_appointment` nach dem Speichern. Ablehnungen der Datenbank erscheinen in ihrem Wortlaut. |
| Kundenakte | Überblick mit laufenden Abos (Preis laut Angebot, nächste Rechnung, nächste Monatsprüfung), Verträgen, den Anrufen beim Telefonassistenten (Ergebnis, Datum, Dauer, Zusammenfassung, auf Wunsch das Gespräch Zeile für Zeile), jeder ausgehenden E-Mail mit ihrem Stand und den Käufen; Verlauf; Angebote und Rechnungen; Reiter „Prüfungen“ mit den Prüfungen aus dem RadarAuditor samt Bericht, den Monatsprüfungen und der Bitte um eine Google-Bewertung; Dokumente; Stammdaten mit „Keine Bewertungsanfragen“, „Keine Erinnerungen“ (`no_follow_ups`), Kanal (die Bezeichnungen aus `crm.source_channel_label`, leer ist „Unbekannt“) und Kampagne. Der Kopf zeigt Kanal und Kampagne und, wenn gesetzt, „Keine Erinnerungen“; Anfragen zeigen ihren Kanal; Audit-Anfragen stehen darunter mit Art, Wunschtermin und Stand (wartet auf dich, Vorschläge verschickt, Termin gebucht). Offene Aufträge haben „Auftrag abschließen“ (`crm.complete_order`). |
| Angebot | „Angebot abschicken“ ruft `crm.send_quote` auf, der Postfach-Dienst verschickt das PDF. Die Seite zeigt den Stand der E-Mail (wartet, verschickt, fehlgeschlagen mit Grund) und das erzeugte PDF. |
| Rechnung | „Festschreiben und senden“ schreibt den Entwurf fest und stellt die E-Mail in den Postausgang (`crm.send_invoice`); „Nur festschreiben“, wenn beim Kunden keine Adresse steht. Stand der E-Mail, erzeugtes PDF, Zahlungen, Storno, XRechnung. |
| Rechnungen | Filter, neue Rechnung und das Paket für den Steuerberater: eine Zip-Datei je Monat, Quartal oder Jahr mit allen Rechnungs-PDFs, `rechnungen.csv`, `zahlungen.csv`, `offene-posten.csv` und `datev-buchungsstapel.csv`, dazu `ausgaben.csv`, `datev-ausgaben.csv` und jeder Beleg unter `Belege/`, sowie `rueckbuchungen.csv`, wenn im Zeitraum Rückbuchungen verrechnet wurden (welche frühere Einnahme oder Ausgabe nicht mehr zählt); zurückgebuchte Ausgaben fehlen. Fehlende PDFs nennt die App mit Nummer, zusätzlich stehen sie in `fehlende-pdfs.txt`; Ausgaben ohne Konto in `ausgaben-ohne-konto.txt`. |
| Finanzen | Reiter Kontoauszug, Ausgaben, Gewinn und Herkunft der Kunden, beschrieben im Abschnitt „Finanzen“. |
| Verkauf | Annehmen oder Ablehnen im CRM hält den Weg `crm` fest (`crm.accept_quote_via`, `crm.decline_quote_via`). „Auftrag abschließen“ schreibt die Rechnung über die einmaligen Positionen fest, verschickt sie und bittet um eine Bewertung. Jede Anfrage zeigt ihren Kanal und ihre Kampagne. |
| Freigaben | Wer eine Mahnung freigibt, verschickt sie damit („Mahnung senden“). Wer einen Zahlungsvorschlag freigibt, bucht die Zahlung zur Rechnung. Eine Nachfass-Mail (`follow_up`, „Nachfass-Mail“) und eine vom Assistenten entworfene Mail (`assistant_mail`, „Mail vom Assistenten“) werden mit „Senden“ oder „Nicht senden“ entschieden. |
| Einstellungen | Firmendaten, Produkte, Abos, Vertragsvorlagen, E-Mail-Texte mit ihren Platzhaltern (auch die Terminbestätigung mit `{{termin}}`, `{{ort}}` und `{{titel}}` und beide Nachfass-Mails, die sich ohne `{{abmeldelink}}` nicht speichern lassen), Reiter Kalender mit Geschäftszeiten, Geschäftstagen und den Minuten bis zur Erinnerung (`business_hours_start`, `business_hours_end`, `business_days`, `reminder_minutes`, geprüft wie in der Datenbank) und dem „Kalender-Link“ `<Supabase-Adresse>/functions/v1/crm-calendar?t=<calendar_token>` mit „Link kopieren“, Google-Bewertungslink und Tage bis zur Erinnerung, Begrüßung und Angaben zur Firma für den Telefonassistenten (`crm.settings.assistant_greeting`, `assistant_facts`; eine Begrüßung, die nicht sagt, dass eine künstliche Intelligenz spricht, lässt sich nicht speichern), Stand von Postfach und Server, DATEV-Nummern und Konto für steuerfreie Umsätze. |

## Paket für den Steuerberater

Der DATEV-Buchungsstapel ist aus dem geprüften Steuer-Export des RadarAuditors übernommen (`exports/tax.py` und `tests/test_tax_export.py`): Format EXTF 700, Kategorie 21, Kontenrahmen SKR03. Jede Rechnung wird je Steuersatz gebucht: der Bruttobetrag des Satzes im Soll des Debitorenkontos 1400 gegen das Erlöskonto 8400 (19 % Umsatzsteuer) oder 8300 (7 % Umsatzsteuer); als Kleinunternehmer nach § 19 Umsatzsteuergesetz geht alles auf 8195; eine Position mit 0 % Umsatzsteuer bei Regelbesteuerung auf das Konto für steuerfreie Umsätze aus den Einstellungen (fehlt es, nennt die App die betroffenen Rechnungen); ein Storno bucht im Haben. Offene Beträge berücksichtigen die Zahlungen und Stornos des gewählten Zeitraums. Berater-, Mandantennummer und das Konto für steuerfreie Umsätze stehen unter Einstellungen → Firma; fehlt eine, entsteht das Paket trotzdem und die App weist darauf hin.

## Finanzen

**Context:** Migration `007_finanzen.sql`, mit Daniel am 29.10.2026 festgelegt. | **Input:** der Kontoauszug des Geschäftskontos als CAMT.053 (ISO 20022, Version 02 der deutschen Banken oder später), Daniels Entscheidungen. | **Output:** Buchungen, Zahlungen zu Rechnungen, Ausgaben mit Konto nach SKR03 und Belegen, der Gewinn je Monat.

| Reiter | Was passiert |
|---|---|
| Kontoauszug | Die Datei geht an `crm.import_bank_statement`. Angenommen wird nur der Auszug des Kontos, dessen IBAN unter Einstellungen → Firma steht; eine Datei mit `DOCTYPE` oder `ENTITY` wird abgelehnt. Die Datei darf höchstens 1 MB groß sein (etwa 2.000 Buchungen brauchen 4,4 Sekunden; eine Anfrage darf 8 Sekunden dauern). Jede gebuchte Buchung in Euro wird einmal gespeichert; der Schlüssel ist ein Prüfwert über alles, was die Bank meldet, mit Zähler für gleiche Buchungen einer Datei, weil die Referenz der Bank allein nicht eindeutig ist (Platzhalter wie `NONREF`). Dieselbe Datei zweimal einzulesen fügt nichts hinzu. Eine Rückbuchung (`RvslInd`; ein internationaler Rückgabecode `RRTN`, `RPCR`, `UPDD`, `RCDD`, `PRDD`, `UPCT`, `UPCQ`, `XRTN` oder `PSTE`; ein deutscher Geschäftsvorfallcode für Rückgabe oder Storno wie 109, 159, 160, 181 oder 899, nach den Listen von HypoVereinsbank und Postbank; oder Rückgabeangaben `RtrInf`) wird nie von selbst zugeordnet oder zur Ausgabe (Änderung `008_rueckbuchung_belege.sql`). Trägt genau eine frühere Buchung in Gegenrichtung mit gleichem Betrag dieselbe Ende-zu-Ende-Referenz, oder sonst genau eine mit derselben Kontonummer des Gegenübers innerhalb von 90 Tagen, fragt das Cockpit „Rückbuchung … verrechnen?“ mit „Verrechnen“ und „Nicht verrechnen“. Sonst kommt die Mitteilung „Rückbuchung ohne passende Buchung“, und auf der Seite wählt Daniel die Buchung aus den möglichen (gleicher Betrag, Gegenrichtung, 180 Tage). Verrechnet wird wie bei Lexware Office (beide auf „Durchlaufende Posten“): Beide Buchungen sind „Verrechnet“ und zählen weder als Einnahme noch als Ausgabe; eine daraus gebuchte oder mit ihr verknüpfte Zahlung wird entfernt (die Kundenakte vermerkt sie) und ihre Rechnung ist wieder offen; eine Ausgabe daraus bleibt mit ihren Belegen stehen und ist „zurückgebucht“; danach kommt die Mitteilung „Rückbuchung verrechnet“. Ohne Verrechnen führt Daniel sie wie bisher als Ausgabe oder privat. Steht eine von Hand erfasste Zahlung mit gleicher Rechnungsnummer und gleichem Betrag schon im CRM, wird die Buchung mit ihr verknüpft statt doppelt gebucht; auf der Seite geht das auch von Hand („Schon erfasste Zahlung“). Ein Eingang mit der Nummer genau einer offenen Rechnung im Verwendungszweck (Trennzeichen beliebig) und genau ihrem offenen Betrag wird als Zahlung gebucht. Mit Nummer und anderem Betrag, oder ohne Nummer bei genau einer offenen Rechnung über diesen Betrag, entsteht eine Freigabe „Zahlung … zu Rechnung …?“ mit „Zuordnen“ und „Nicht zuordnen“ im Cockpit. Alles andere ist „Unklar“ mit der Mitteilung „Zahlungseingang ohne Rechnung“; auf der Seite lässt es sich einer Rechnung zuordnen, als sonstige Einnahme oder als private Einzahlung einordnen. Eine Zuordnung lässt sich zurücknehmen; eine Zahlung, die das Einlesen angelegt hat, wird dabei entfernt und die Rechnung ist wieder offen. Wird ein Vorschlag irgendwo abgelehnt (auch durch eine Zahlung von Hand oder ein Storno), ist die Buchung wieder „Unklar“. Unklare Buchungen zeigt die Seite unabhängig von ihrem Alter. Jede Abbuchung wird eine Ausgabe. |
| Ausgaben | Je Monat, mit Filter „Nur ohne Konto“. Das Konto kommt aus einer festen Liste nach SKR03 (`crm.expense_accounts`, Bezeichnungen laut DATEV und Ecovis, Stand 2023). Das zuletzt gewählte Konto eines Empfängers gilt für seine nächsten Ausgaben und füllt alle seine Ausgaben ohne Konto; bei Zahlungsdiensten wie PayPal, Amazon, Klarna oder Stripe wird nichts gelernt, weil dort viele verschiedene Käufe zusammenlaufen. Jede Änderung von Konto oder Steuersatz steht unveränderbar in `crm.expense_changes`. Privatentnahmen und Umsatzsteuer-Vorauszahlungen haben nie Vorsteuer. Bei Regelbesteuerung lässt sich der Steuersatz des Belegs wählen. Barausgaben werden von Hand angelegt. Belege (PDF, JPEG, PNG, HEIC, WebP, bis 15 MB) liegen im Speicher `crm-receipts` unter `belege/<Ausgabe>/`; ein Beleg lässt sich weder ersetzen noch löschen (Aufbewahrung zehn Jahre, § 147 Abs. 3 Abgabenordnung), und Betrag, Datum und Empfänger einer gebuchten oder belegten Ausgabe bleiben, wie sie sind. |
| Belege | Hochladen und Eintragen werden je dreimal versucht; dieselbe Datei erneut zu speichern ergibt einen Beleg. Der stündliche Ablauf `crm-receipts` (`crm.check_receipts`, Minute 41) trägt jede Datei im Belegspeicher, die älter als zehn Minuten ist und keinen Eintrag hat, bei ihrer Ausgabe nach; was sich nicht nachtragen lässt (Ausgabe fehlt, anderer Dateityp, leer oder über 15 MB), meldet er einmal mit der Mitteilung „Beleg nicht gespeichert“. |
| Herkunft der Kunden | `crm.channel_report(from, to)` (Änderung `011_herkunft.sql`) als Tabelle Kanal, Anfragen, Neue Kunden, Zahlungseingänge mit Summe, für „Dieser Monat“, „Dieses Jahr“, „Letzte 12 Monate“ oder zwei gewählte Tage. |
| Gewinn | `crm.profit_by_month` über die letzten zwölf Monate nach Zahlungsdatum: Einnahmen sind Zahlungen zu Rechnungen und sonstige Einnahmen, Ausgaben alles außer privaten Entnahmen (Konto 1800) und verrechneten Rückbuchungen, Ausgaben ohne Konto zählen schon mit. Dazu der Vergleich zum Vormonat und das laufende Jahr. |

Eine Mahnung geht ohne Freigabe raus, wenn die Kontoauszüge mindestens bis gestern reichen, kein Zahlungseingang auf eine Entscheidung wartet und die Rechnung mindestens zwei Tage vor dem letzten Auszugstag fällig war, damit eine Überweisung am Fälligkeitstag schon drinsteht. Sonst, und wenn die Mail nicht in den Postausgang kann, bleibt es bei der Freigabe; der Grund steht dann in der Freigabe und in der Kundenakte. Warten Mahnungen wegen unklarer Eingänge, meldet das Cockpit das einmal am Tag. Zahlungen, die nicht über das Konto laufen (bar, PayPal), müssen von Hand erfasst sein, bevor gemahnt wird. Im DATEV-Buchungsstapel der Ausgaben steht jede Ausgabe mit Konto im Soll gegen 1200 Bank oder 1000 Kasse, bei Regelbesteuerung mit Steuerschlüssel 9 (19 % Vorsteuer) oder 8 (7 %); er ist eine eigene Datei, damit der Steuerberater nicht Kontoauszug und Ausgaben doppelt bucht.
