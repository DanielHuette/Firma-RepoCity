# Firma RepoCity

Die Software, auf der RepoCity läuft: Nachrichtenzentrale, CRM, Marketing, das Produkt RadarAuditor und der Telefonassistent, je Ordner eine App.

Projektseite: [speedofthespirit.dev/de/](https://speedofthespirit.dev/de/)

Stand: Teststand ohne Kundenbetrieb.

[English version](README.md)

Private Sicherung der Software, auf der RepoCity läuft. Jeder Ordner ist eine App mit eigenem
Build, eigenen Datenbank-Migrationen und eigenen Tests; gemeinsam ist nur das Supabase-Projekt.

| Ordner | App | Adresse |
|---|---|---|
| `cockpit/` | Nachrichtenzentrale über allen Apps, Mitteilungen auf dem Sperrbildschirm | cockpit.speedofthespirit.dev |
| `crm/` | Kunden, Angebote, Aufträge, Rechnungen, Verträge, Postfach | crm.speedofthespirit.dev |
| `marketing/` | Recherche mit geprüften Quellen, Kampagnen, Planer für alle Kanäle | app.agenticmarketing.speedofthespirit.dev |
| `radarauditor/` | Sichtbarkeitsprüfung der Webseite örtlicher Betriebe (Produkt) | app.radarauditor.speedofthespirit.dev |
| `telefon/` | Telefonassistentin auf der Geschäftsnummer: Spracherkennung, Stimme und Sprachmodell auf dem eigenen Server, schreibt ins CRM | RepoCity-Server (keine Webadresse) |

`integration/` prüft die gemeinsame Datenbank von RadarAuditor, CRM und Cockpit auf einem echten
PostgreSQL, mit allen Migrationen in der Reihenfolge, in der das Live-Projekt sie bekommen hat.

Zugangsdaten gehören nie in dieses Repository; jede App liest sie aus der Build-Umgebung oder
aus dem Supabase-Tresor.
