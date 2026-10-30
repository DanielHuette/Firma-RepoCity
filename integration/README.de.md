# Integrationstests

[English version](README.md)

RadarAuditor, CRM und Cockpit teilen sich ein Supabase-Projekt und rufen gegenseitig ihre
Funktionen und Auslöser auf. Diese Tests bauen die Datenbank auf einem Wegwerf-PostgreSQL nach und
prüfen daran den ganzen Ablauf aus `Dokumentation/INTEGRATION.de.md`: Angebot, Annahme, Auswertung
der Kundenmails, abgeschlossener Auftrag, Monatsrechnung, Monatsprüfung über den Knopf auf dem
Sperrbildschirm, Bitte um eine Bewertung, Mahnwesen, Telefon-Assistent, Kontoauszüge und Rückbuchungen, Kalender, Nachfassen, Herkunft der Kunden, Assistent und Audit-Anfragen von der Webseite.

## Szenarien
**Context:** jeder Weg, den ein Kunde und Daniel gehen können, von Anfang bis Ende, über die Aufrufe, die jeder Teil macht (`tests/actors.py`). | **Input:** das aufgebaute Projekt. | **Output:** ein Test je Zeile, benannt nach der Nummer.

| Nr. | Weg | Ergebnis | Testdatei |
|---|---|---|---|
| L1 | Anfrage über das Kontaktformular, danach die Prüfung vor Ort | derselbe CRM-Kunde, Adresse bleibt, Angebot geht ohne erneute Eingabe raus | `tests/test_scenario_leads.py` |
| L2 | Unbekannter Absender, der Server sagt Kunde, der Mail-Abruf nimmt ihn auf, danach die Prüfung vor Ort | ein Kunde, Anfrage per E-Mail, Angebot verschickt | `tests/test_scenario_leads.py` |
| L3 | Anfrage am Telefon von unbekannter Nummer, Adresse im RadarAuditor ergänzt | ein Kunde mit Nummer und Adresse | `tests/test_scenario_leads.py` |
| L4 | Dieselbe Adresse zweimal übers Formular (Groß/klein egal), per Mail und am Telefon | ein Kunde, jede Anfrage bei ihm | `tests/test_scenario_leads.py` |
| L5 | Dieselbe Nummer anders geschrieben | ein Kunde, eine Rückruf-Aufgabe je Anruf | `tests/test_scenario_leads.py` |
| L6 | Der Server scheitert dreimal an einer Mail | erneut, erneut, aufgegeben; Mitteilung; Daniels Prüfliste | `tests/test_scenario_leads.py` |
| Q1 | Angebot aus dem RadarAuditor, in der App angenommen | Auftrag, Abo zum Angebotspreis, beide Verträge ohne Freigabe verschickt, ein „Neuer Auftrag“ | `tests/test_scenario_acceptance.py` |
| Q2 | Angebot per bestätigter Mail angenommen | Weg E-Mail, derselbe Auftrag | `tests/test_scenario_acceptance.py` |
| Q3 | Unbestätigte Mail, Daniel tippt zweimal „Annahme bestätigen“ | ein Auftrag (Weg CRM), zweiter Tipp „Das wurde bereits erledigt.“ | `tests/test_scenario_acceptance.py` |
| Q4 | Am Telefon von der Nummer des Kunden angenommen, Gespräch gespeichert | Weg Telefon, Gespräch zugeordnet und gemeldet | `tests/test_scenario_acceptance.py` |
| Q5 | Am Telefon von fremder Nummer angenommen | nichts entschieden bis zu Daniels Tipp | `tests/test_scenario_acceptance.py` |
| Q6 | Angebot abgelaufen, dann per Mail und Telefon angenommen | nie automatisch, zwei Mitteilungen mit Ablaufdatum, Daniels Tipp nimmt an, der andere wird abgelehnt | `tests/test_scenario_acceptance.py` |
| Q7 | Per bestätigter Mail abgelehnt, später eine Annahme-Mail | bleibt abgelehnt, kein Auftrag, Mitteilung ohne Knopf | `tests/test_scenario_acceptance.py` |
| Q8 | Am Telefon von der richtigen Nummer abgelehnt | abgelehnt, kein Auftrag | `tests/test_scenario_acceptance.py` |
| Q9 | Im CRM abgelehnt | abgelehnt, kein Abo | `tests/test_scenario_acceptance.py` |
| Q10 | Telefon und Mail nehmen dasselbe Angebot an | ein Auftrag | `tests/test_scenario_acceptance.py` |
| Q11 | Der Server wertet dieselbe Mail noch einmal aus | abgewiesen, ein Auftrag | `tests/test_scenario_acceptance.py` |
| Q12 | Angebotsmail scheitert dreimal, Daniel stellt sie neu ein, sie scheitert wieder, dann geht sie raus | zwei Fehlermeldungen, ein „Mail verschickt“, eine abgelegte Mail | `tests/test_scenario_acceptance.py` |
| O1 | Entwürfe freigegeben und eingespielt | Ereignis einmal, Rechnung der Einmal-Posten mit PDF verschickt, Bitte um Bewertung | `tests/test_scenario_order.py` |
| O2 | Optimierung findet nichts zu ändern | Auftrag abgeschlossen | `tests/test_scenario_order.py` |
| O3 | Eine Änderung scheitert, Daniel schließt den Auftrag von Hand ab, später ein neuer Lauf | eine Rechnung, keine Fehlermeldung | `tests/test_scenario_order.py` |
| O4 | Eine Änderung ist von Hand zu machen und wird abgehakt | Auftrag abgeschlossen | `tests/test_scenario_order.py` |
| O5 | Jeder Entwurf abgelehnt | Auftrag abgeschlossen | `tests/test_scenario_order.py` |
| O6 | Firmendaten fehlen beim Abschluss | Entwurf, Aufgabe, Mitteilung; nach dem Eintragen verschickt | `tests/test_scenario_order.py` |
| O7 | Einspiel-Auftrag wiederholt | ein Ereignis, eine Rechnung | `tests/test_scenario_order.py` |
| O8 | Nach dem Ereignis zweimal von Hand abgeschlossen | nichts doppelt | `tests/test_scenario_order.py` |
| O9 | Auftrag nur aus Monatsposten | erledigt, keine Rechnung, Bitte um Bewertung | `tests/test_scenario_order.py` |
| M1 | Zahlung in voller Höhe | bezahlt, keine Erinnerung, Mitteilung zur Zahlung | `tests/test_scenario_money.py` |
| M2 | Überfällig, Tagesablauf zweimal, „Senden“ zweimal getippt | eine Freigabe, eine Erinnerung mit PDF | `tests/test_scenario_money.py` |
| M3 | „Nicht senden“ | keine Mail, nach sieben Tagen neue Frage | `tests/test_scenario_money.py` |
| M4 | Nach der Mitteilung bezahlt, dann „Senden“ | abgewiesen, keine Mail | `tests/test_scenario_money.py` |
| M5 | Teilzahlung, Mahnungen | Restbetrag genannt, Stufen 1–3, danach nichts | `tests/test_scenario_money.py` |
| M6 | Monatsrechnung, Tagesablauf zweimal | eine Rechnung, eine Mail; im nächsten Monat die nächste | `tests/test_scenario_money.py` |
| M7 | Monatsrechnung ohne Firmendaten | Entwurf und Mitteilung, aus dem CRM verschickt | `tests/test_scenario_money.py` |
| M8 | Abo gekündigt | abgerechnet bis zum Ende, dann inaktiv, Vertrag beendet, keine Prüfung | `tests/test_scenario_money.py` |
| M9 | Steuerberater-Paket des Monats mit einer Stornierung | Rechnungen, Stornorechnung, Zahlungen und jedes Rechnungs-PDF | `tests/test_scenario_money.py` |
| M10 | Rechnungsmail ohne Kundenadresse | Entwurf und Aufgabe, Bitte um Bewertung trotzdem angelegt | `tests/test_scenario_money.py` |
| S1 | Monatsprüfung fällig, auf dem Sperrbildschirm ausgelöst, zweimal gemeldet | Lauf mit beiden Punktzahlen, eine Mitteilung, Kundenakte | `tests/test_scenario_service.py` |
| S2 | Im CRM gestartet, alter Knopf auf dem Sperrbildschirm getippt | mit Grund abgewiesen, eine Prüfung | `tests/test_scenario_service.py` |
| S3 | Monatsprüfung fehlgeschlagen, „Erneut auslösen“ | zweite Prüfung gemeldet | `tests/test_scenario_service.py` |
| S4 | Tagesablauf zweimal am selben Tag | keine zweite Rechnung, Mail, Freigabe, Prüfung oder Mitteilung | `tests/test_scenario_service.py` |
| S5 | Bewertungslink fehlt, wird eingetragen, Erinnerung | wartet mit einer Mitteilung, Bitte, eine Erinnerung, dann nichts | `tests/test_scenario_service.py` |
| S6 | Kunde hat vorher widersprochen | keine Mail, Anfrage storniert | `tests/test_scenario_service.py` |
| S7 | Kunde widerspricht nach der Bitte | keine Erinnerung | `tests/test_scenario_service.py` |
| S8 | Von Daniel abgehakt | keine Erinnerung | `tests/test_scenario_service.py` |
| S9 | Ein Schritt des Tagesablaufs scheitert | die anderen laufen, eine Mitteilung pro Tag | `tests/test_scenario_service.py` |
| S10 | Link eingetragen, Kunde ohne Adresse | keine Meldung „Link fehlt“ mehr, Bitte geht raus, sobald die Adresse da ist | `tests/test_scenario_service.py` |
| F1 | Auszug mit Rechnungsnummer und genau offenem Betrag | Rechnung zum Buchungstag bezahlt, keine Freigabe | `tests/test_scenario_finance.py` |
| F2 | Dieselbe Datei zweimal | nichts dazu, eine Zahlung, eine Ausgabe | `tests/test_scenario_finance.py` |
| F3 | Nummer mit anderem Betrag, „Zuordnen“ getippt | Teilzahlung gebucht, Link zu Finanzen | `tests/test_scenario_finance.py` |
| F4 | Betrag ohne Nummer, „Nicht zuordnen“ | Buchung unklar, Rechnung offen | `tests/test_scenario_finance.py` |
| F5 | Unbekannte Zahlung als sonstige Einnahme | Mitteilung „Zahlungseingang ohne Rechnung“, zählt als Einnahme | `tests/test_scenario_finance.py` |
| F6 | Konto einmal für einen Empfänger gewählt | nächste Ausgabe des Empfängers bekommt es selbst | `tests/test_scenario_finance.py` |
| F7 | Private Entnahme | nicht im Gewinn | `tests/test_scenario_finance.py` |
| F8 | Keine IBAN in den Einstellungen, Auszug eines anderen Kontos | abgelehnt, nichts gespeichert | `tests/test_scenario_finance.py` |
| F9 | Version 08, Buchung mit mehreren Posten, gleiche Zwillinge | jeder einmal, zweites Einlesen fügt nichts hinzu | `tests/test_scenario_finance.py` |
| F10 | Vorgemerkte Buchung, Buchung in Dollar | übersprungen | `tests/test_scenario_finance.py` |
| F11 | Datei mit DOCTYPE, kein CAMT, kaputtes XML | abgelehnt | `tests/test_scenario_finance.py` |
| F12 | Überfällig bei aktuellem Kontoauszug | Mahnung ohne Freigabe verschickt | `tests/test_scenario_finance.py` |
| F13 | Alter Kontoauszug oder unklare Zahlung | Freigabe wie bisher | `tests/test_scenario_finance.py` |
| F14 | Überfällig, Kunde ohne Adresse | Freigabe statt Fehler | `tests/test_scenario_finance.py` |
| F15 | Barausgabe mit Beleg | Beleg nicht löschbar, Betrag fest, Konto änderbar | `tests/test_scenario_finance.py` |
| F16 | Gewinn zweier Monate | gleich der Rechnung von Hand | `tests/test_scenario_finance.py` |
| F17 | Angemeldeter Leser | kann keinen Auszug einlesen und keine Buchungen lesen | `tests/test_scenario_finance.py` |
| F18 | Platzhalter NONREF bei mehreren Buchungen | jede gespeichert, Zahlung gebucht | `tests/test_scenario_finance.py` |
| F19 | Zahlung von Hand, danach der Auszug | verknüpft, einmal gezählt | `tests/test_scenario_finance.py` |
| F20 | Vorschlag, dann Zahlung von Hand | Buchung wieder unklar, einzuordnen | `tests/test_scenario_finance.py` |
| F21 | Version 08 mit Beträgen direkt am Posten | Buchung aufgeteilt | `tests/test_scenario_finance.py` |
| F22 | Rückbuchung | Mitteilung, keine Ausgabe bis Daniel entscheidet | `tests/test_scenario_finance.py` |
| F23 | Buchung ohne Status | übersprungen | `tests/test_scenario_finance.py` |
| F24 | Gleiche Buchung mit anderen Leerzeichen | einmal gespeichert | `tests/test_scenario_finance.py` |
| F25 | Zuordnung zurückgenommen | Zahlung entfernt, Rechnung offen | `tests/test_scenario_finance.py` |
| F26 | Auszüge reichen noch nicht über die Fälligkeit | Freigabe | `tests/test_scenario_finance.py` |
| F27 | Unklare Zahlung, Tagesablauf zweimal | eine Freigabe, eine Mitteilung | `tests/test_scenario_finance.py` |
| F28 | Steuer- und Privatkonto, Zahlungsdienst | keine Vorsteuer, nichts gelernt | `tests/test_scenario_finance.py` |
| F29 | Konto und Satz geändert | Änderung festgehalten, nicht löschbar | `tests/test_scenario_finance.py` |
| F30 | Kundenzahlung zurückgebucht | Freigabe im Cockpit, Rechnung offen, keine Einnahme | `tests/test_scenario_reversal.py` |
| F31 | Danach neue Zahlung | Rechnung wieder bezahlt | `tests/test_scenario_reversal.py` |
| F32 | Eigene Überweisung zurück (RRTN, RtrInf) | Ausgabe zählt nicht mehr | `tests/test_scenario_reversal.py` |
| F33 | „Nicht verrechnen“ | beide Buchungen wie vorher | `tests/test_scenario_reversal.py` |
| F34 | Keine eindeutige Buchung | Mitteilung, Daniel wählt auf der Seite | `tests/test_scenario_reversal.py` |
| F35 | Falscher Betrag, falsche Buchung, doppelt, Leser | abgelehnt | `tests/test_scenario_reversal.py` |
| F36 | Vorschlag zurückgebucht | keine Freigabe bleibt offen | `tests/test_scenario_reversal.py` |
| F37 | Gleicher Beleg zweimal gespeichert | ein Beleg | `tests/test_scenario_reversal.py` |
| F38 | Datei ohne Eintrag | stündlich nachgetragen | `tests/test_scenario_reversal.py` |
| F39 | Datei lässt sich nicht nachtragen | je eine Mitteilung | `tests/test_scenario_reversal.py` |
| F40 | Stündlicher Ablauf | Minute 41 eingeplant | `tests/test_scenario_reversal.py` |
| F41 | Buchung nennt nur dieses Konto | kein Gegenüber | `tests/test_scenario_reversal.py` |
| F42 | Rückbuchung auf der Seite eingeordnet | Freigabe erledigt | `tests/test_scenario_reversal.py` |
| F43 | Zahlung von Hand, während die Rückbuchung wartet | Freigabe bleibt | `tests/test_scenario_reversal.py` |
| F44 | Verknüpfte Zahlung von Hand | entfernt, in der Kundenakte vermerkt | `tests/test_scenario_reversal.py` |
| F45 | Offene Rückbuchung | Mahnungen laufen weiter | `tests/test_scenario_reversal.py` |
| F46 | Doppelt oder für normale Buchung angefragt | ändert nichts | `tests/test_scenario_reversal.py` |
| F47 | Rückgabecodes deutscher Banken (GVC) und international | als Rückbuchung erkannt | `tests/test_scenario_reversal.py` |
| K1 | Termin mit Uhrzeit | mit seinem Berliner Tag gespeichert, ein Eintrag in der Kundenakte | `tests/test_scenario_calendar.py` |
| K2 | Termin ohne Titel | Art und Kundenname benennen ihn | `tests/test_scenario_calendar.py` |
| K3 | Unbekannte Art, kein Tag, falsche Dauer, unbekannter Kunde, Leser | abgelehnt, auf Deutsch begründet | `tests/test_scenario_calendar.py` |
| K4 | Erinnerung vor Beginn, Lauf zweimal | eine Mitteilung „Termin um …“ | `tests/test_scenario_calendar.py` |
| K5 | Abgesagter Termin | keine Erinnerung | `tests/test_scenario_calendar.py` |
| K6 | Häkchen für Bestätigung gesetzt oder nicht, ohne Kunde oder Uhrzeit | Mail mit Termin nur mit Häkchen, ohne Kunde oder Uhrzeit abgelehnt | `tests/test_scenario_calendar.py` |
| K7 | Kalender-Link mit richtigem und falschem Schlüssel, angemeldeter Nutzer | Termine nur zum richtigen Schlüssel, für Angemeldete gesperrt | `tests/test_scenario_calendar.py` |
| K8 | Anrufer möchte Rückruf in den Geschäftszeiten | Rückruf zu der Zeit, Mitteilung „Rückruf gewünscht“ | `tests/test_scenario_calendar.py` |
| K9 | Wunsch am Samstag, abends, in der Vergangenheit, 90 Tage voraus | Rückruf heute ohne Uhrzeit, die Notiz sagt, warum | `tests/test_scenario_calendar.py` |
| K10 | Tagesüberblick | beginnt mit den Terminen von heute | `tests/test_scenario_calendar.py` |
| K11 | Kunde verworfen | seine Termine gelöscht | `tests/test_scenario_calendar.py` |
| K12 | Rückruf im Anruf eingetragen, in beliebiger Reihenfolge | ein Termin, keine zweite Aufgabe | `tests/test_scenario_calendar.py` |
| N1 | Angebot vor fünf Tagen verschickt, keine Antwort | Freigabe „Nachfass-Mail … senden?“, „Senden“ legt die Mail mit Abmeldelink und Kopfzeile an | `tests/test_scenario_follow_up.py` |
| N2 | Zwölf Tage | zweite Erinnerung, einmal | `tests/test_scenario_follow_up.py` |
| N3 | „Nicht senden“ | diese Erinnerung entfällt endgültig | `tests/test_scenario_follow_up.py` |
| N4 | Kunde hat seit dem Angebot geschrieben, angerufen oder angefragt | keine Erinnerung | `tests/test_scenario_follow_up.py` |
| N5 | Kunde hat abbestellt | keine Erinnerungen, keine Bewertungsanfragen | `tests/test_scenario_follow_up.py` |
| N6 | Angebot entschieden, während eine Erinnerung wartet | wartende Erinnerung entfällt | `tests/test_scenario_follow_up.py` |
| N7 | Angebot über sein Datum | auf abgelaufen gesetzt, keine Erinnerung | `tests/test_scenario_follow_up.py` |
| N8 | Täglicher Lauf | setzt ab und fasst nach | `tests/test_scenario_follow_up.py` |
| N9 | Abbestellen aus dem Netz oder als angemeldeter Nutzer | abgelehnt | `tests/test_scenario_follow_up.py` |
| N10 | Kunde antwortet, während eine Erinnerung wartet | Frage fällt weg, „Senden“ verschickt nichts | `tests/test_scenario_follow_up.py` |
| N11 | Erste Erinnerung spät | die zweite frühestens eine Woche danach | `tests/test_scenario_follow_up.py` |
| N12 | Abbestellen, während Mails warten | Erinnerungs- und Bewertungsmails gelöscht, andere bleiben | `tests/test_scenario_follow_up.py` |
| H1 | Link-Marker | der richtige Kanal, ohne Marker keiner | `tests/test_scenario_channel.py` |
| H2 | Formular mit Markern | Kanal und Kampagne an Kunde und Anfrage | `tests/test_scenario_channel.py` |
| H3 | Zweite Anfrage aus anderem Kanal | Kunde behält den ersten, Anfrage ihren eigenen | `tests/test_scenario_channel.py` |
| H4 | Kontaktmail mit „Anfrage – über …“ | Kanal und Kampagne aus dem Betreff | `tests/test_scenario_channel.py` |
| H5 | Antwort des Anrufers am Telefon | Kanal am Kunden | `tests/test_scenario_channel.py` |
| H6 | Unbekannter Kanal | abgelehnt | `tests/test_scenario_channel.py` |
| H7 | Bericht eines Monats | Anfragen, neue Kunden und Zahlungseingänge je Kanal | `tests/test_scenario_channel.py` |
| H8 | Bezeichnungen | einfaches Deutsch, „Unbekannt“ ohne Kanal | `tests/test_scenario_channel.py` |
| H9 | Gewöhnlicher Betreff mit „über“, eine Antwort | kein Kanal; „AW: Anfrage – über …“ wird gelesen | `tests/test_scenario_channel.py` |
| A1 | Getippte Anfrage | wartet, wird einmal übernommen | `tests/test_scenario_assistant.py` |
| A2 | Gesprochene Anfrage | Mitschrift gespeichert | `tests/test_scenario_assistant.py` |
| A3 | Kontakt anlegen | angelegt, zurückgelesen, Mitteilung „Assistent: erledigt“ | `tests/test_scenario_assistant.py` |
| A4 | Adresse schon bekannt | nichts angelegt, Mitteilung „nicht erledigt“ | `tests/test_scenario_assistant.py` |
| A5 | Termin für genannten Kunden | Termin mit Herkunft Assistent, zurückgelesen | `tests/test_scenario_assistant.py` |
| A6 | Zwei Kunden passen zum Namen | beide genannt, nichts eingetragen | `tests/test_scenario_assistant.py` |
| A7 | Mail entwerfen | Freigabe, Mail erst nach „Senden“ | `tests/test_scenario_assistant.py` |
| A8 | Umsatz eines Monats | Einnahmen, Ausgaben und Gewinn aus den Büchern | `tests/test_scenario_assistant.py` |
| A9 | Unbekannte Aufgabe, Rückfrage, falscher Zeitraum | klar gesagt, nichts getan | `tests/test_scenario_assistant.py` |
| A10 | Leser fragt, Administrator übernimmt, Server scheitert | abgelehnt, abgelehnt, mit Meldung gescheitert | `tests/test_scenario_assistant.py` |
| A11 | Aufnahme hochgeladen, Anfrage nie gespeichert | nach zehn Minuten zum Löschen genannt | `tests/test_scenario_assistant.py` |
| A12 | Server bringt eine Anfrage dreimal nicht zu Ende | nicht erledigt mit deutschem Satz | `tests/test_scenario_assistant.py` |
| A13 | Lange entworfene Mail | ganzer Text in der Freigabe, keine Knöpfe auf dem Sperrbildschirm | `tests/test_scenario_assistant.py` |
| A14 | Anfragen älter als 30 Tage | täglich gelöscht | `tests/test_scenario_assistant.py` |
| T1 | Formular lädt freie Zeiten | nur ab morgen, alle 21 Tage, Geschäftszeiten, volle Stunden, belegte fehlen, abgesagte nicht, nur Zeiten | `tests/test_scenario_audit_request.py` |
| T2 | Anfrage über das Formular mit Link-Markern | Kunde mit Kanal und Kampagne, Anfrage, keine Mail, keine Aufgabe, nur „Audit-Anfrage“ mit drei Knöpfen (kein „Neuer Kunde“), Ziel die Nachrichtenzentrale | `tests/test_scenario_audit_request.py` |
| T3 | Pflichtfeld fehlt oder zu kurz, E-Mail, Telefon, Anschrift bei Vor Ort, Webseite, Längen, Zeit nicht frei | abgelehnt mit deutschem Satz (P0001), nichts gespeichert | `tests/test_scenario_audit_request.py` |
| T4 | Ohne Webseite, bekannte E-Mail-Adresse | kein „Prüfen“, derselbe Kunde, sein Kanal bleibt | `tests/test_scenario_audit_request.py` |
| T5 | „Bestätigen“ bei Video | Termin zur Wunschzeit mit eigenem Jitsi-Link in Mail, Ort und Kalender-Abo, Link „Anderen Termin wünschen“ | `tests/test_scenario_audit_request.py` |
| T6 | „Bestätigen“ bei Telefon und Vor Ort, Zeit inzwischen belegt | Rufnummer bzw. Anschrift in der Mail; belegt: abgelehnt, keine Mail | `tests/test_scenario_audit_request.py` |
| T7 | „Anderen Termin vorschlagen“, dann „Senden“ | drei freie Zeiten ohne die Wunschzeit, Mail mit drei Links erst nach „Senden“ | `tests/test_scenario_audit_request.py` |
| T8 | Kunde klickt einen Vorschlag | sofort gebucht und bestätigt, zweiter Klick ändert nichts, andere Links ungültig, Mitteilung an Daniel | `tests/test_scenario_audit_request.py` |
| T9 | Vorgeschlagene Zeit inzwischen belegt | klare Meldung, Mitteilung wie bei neuer Anfrage, andere Links gelten weiter | `tests/test_scenario_audit_request.py` |
| T10 | „Prüfen“ | RadarAuditor-Prüfung der Webseite mit dem CRM-Kunden verknüpft, übrige Knöpfe neu gemeldet, kein zweites Mal | `tests/test_scenario_audit_request.py` |
| T11 | Tag vor einem bestätigten Termin | eine Erinnerung mit Uhrzeit und Rufnummer, Anschrift oder Link; ohne verschickte Bestätigung keine | `tests/test_scenario_audit_request.py` |
| T12 | „Anderen Termin wünschen“, neu gebucht | alter Termin bleibt bis zur neuen Buchung, dann abgesagt; Bestätigung nennt den bisherigen Termin, eigene Mail mit Absage als Kalenderdatei; alter Buchungslink ungültig; nach dem Termin ungültig | `tests/test_scenario_audit_request.py` |
| T13 | 24 Stunden ohne Entscheidung | genau eine Erinnerung mit denselben Knöpfen | `tests/test_scenario_audit_request.py` |
| T14 | Liste der Anfragen | nur nicht gebuchte und noch nicht geprüfte, offene zuerst, neueste oben, nur für den Administrator | `tests/test_scenario_audit_request.py` |
| T15 | „Senden“, eine Zeit inzwischen belegt | neue Vorschläge statt Mail | `tests/test_scenario_audit_request.py` |
| T16 | Zeitpläne | stündlich und täglich, nie zur vollen oder halben Stunde | `tests/test_scenario_audit_request.py` |
| T17 | Vorschlagslink nach 48 Stunden, unbekannter Link, angemeldeter Nutzer | bucht nichts, klare Meldung, Daniel einmal gefragt wie bei neuer Anfrage; Funktionen nur für den Dienstschlüssel | `tests/test_scenario_audit_request.py` |
| T18 | Vorgeschlagene Zeiten | 48 Stunden nur für diesen Betrieb: nicht im Formular, nicht in fremden Vorschlägen, nicht bestätigbar für andere | `tests/test_scenario_audit_request.py` |
| T19 | Dieselbe Anfrage zweimal gesendet (gleiche Kennung) | eine Anfrage, eine Mitteilung, beide Male „ok“ | `tests/test_scenario_audit_request.py` |
| T20 | Ganze Kette zweimal, 009 allein, Cockpit 002 allein erneut ausgeführt | Audit-Ablauf läuft weiter wie vorher | `tests/test_scenario_audit_request.py` |

Die gezielten Tests der einzelnen Schritte bleiben in den übrigen Testdateien.

## Abgleich der Aufrufe
**Context:** `tests/test_callers.py` liest jeden Datenbankaufruf im Quelltext der Apps von CRM, Cockpit und RadarAuditor, des Service-Workers im Cockpit, der Edge Functions `crm-mail`, `crm-calendar`, `crm-abmelden`, `crm-termin` und `cockpit-push` und der Datenzugriffe des RadarAuditors. | **Input:** der Quelltext und der Katalog des aufgebauten Projekts. | **Output:** ein scheiternder Test mit Datei, Zeile und Abweichung: fehlende Funktion, fehlendes Argument, fehlende Tabelle, Spalte, Verknüpfung oder Konfliktschlüssel, oder ein Recht oder eine Zeilenregel, die der Rolle des Aufrufers fehlt.

## Ausführen

```bash
cd integration
uv sync
uv run pytest
```

PostgreSQL ab Version 14 muss installiert sein; gesucht wird in `REPOCITY_PG_BIN`, dann im `PATH`,
dann unter `/usr/lib/postgresql/<Version>/bin`. PostgreSQL läuft nicht als Administrator (root),
deshalb die Tests als normaler Benutzer starten. Das Supabase-Projekt wird nicht berührt.

## Reihenfolge der Migrationen

Das Live-Projekt hat seine Migrationen in dieser Reihenfolge bekommen, und
`src/repocity_integration/project.py` spielt sie genauso ein:

1. RadarAuditor 001–005
2. CRM 001–003
3. Cockpit 001
4. RadarAuditor 006–012
5. RadarAuditor 013 und 014, CRM 004, Cockpit 002
6. CRM 005
7. RadarAuditor 015, Cockpit 003, CRM 006
8. CRM 007, Cockpit 004, CRM 008, Cockpit 005
9. CRM 009, CRM 010, Cockpit 006, CRM 011, CRM 012
10. CRM 013, Cockpit 007

Erneut einspielen geht nur als ganze Kette ab RadarAuditor 013 in dieser Reihenfolge (die Liste `RERUNNABLE` in `tests/test_project.py`): eine ältere Migration allein setzt ältere Fassungen von Funktionen und Rechten zurück, die die späteren ersetzen.

`sql/supabase_stub.sql` ersetzt, was Supabase vor jeder Migration mitbringt: Rollen, `auth`,
`storage`, den Tresor (Vault), `pg_net` (jeder Aufruf landet in `net.calls`), `pg_cron` und die
Veröffentlichung für Live-Aktualisierungen.
