# RepoCity Marketing

[English version](README.md)

Recherche, bei der jede Zahl gegen ihre Quelle geprüft ist; Kampagnen und Beiträge gehen zur
Freigabe in den Planer und werden von Hand über die Firmenkonten gepostet.

| Teil | Läuft wo | Zweck |
|---|---|---|
| `src/agentic_marketing/` | PC des Betreibers | `verify`, `review`, `apply`, `pack`, `stale`, `campaign` |
| `app/` | Cloudflare Pages, app.agenticmarketing.speedofthespirit.dev | Kampagnen, Planer, Freigabe |
| `supabase/migrations/` | Schema `marketing` in der gemeinsamen Datenbank | Beiträge, Plan, Meldungen ans Cockpit |
| `workspaces/radarauditor/` | PC des Betreibers | Recherche-Arbeitsbereich |

## Links tragen ihren Kanal

Der Befehl `campaign` hängt an jeden Link eines Beitrags auf eine eigene Seite (`https://speedofthespirit.dev`
und ihre Subdomains) die Merkmale, die das CRM liest (`crm.channel_from` in
`crm/supabase/migrations/011_herkunft.sql`), außer der Link trägt schon einen `utm_`-Parameter:

| Parameter | Wert |
|---|---|
| `utm_source` | der Kanal des Beitrags (`linkedin`, `x`, `newsletter`, ...) |
| `utm_medium` | `email` beim Newsletter, `social` bei jedem anderen Kanal |
| `utm_campaign` | das Kürzel der Kampagne (1 bis 100 Zeichen aus `a-z`, `0-9`, `-`) |
| `utm_content` | das Kürzel des Beitrags |

Andere Parameter und der Sprungpunkt nach `#` bleiben; Links auf fremde Seiten bleiben, wie sie
sind. Blogbeiträge sind Seiten einer eigenen Seite und bleiben ohne Merkmale, damit ein Besucher die
Merkmale behält, mit denen er gekommen ist. Beiträge des Kanals `presse` kommen im CRM als
„Sonstiges“ an, weil das CRM keinen eigenen Pressekanal hat. Der Code steht in
`src/agentic_marketing/tracking.py`. Der Knopf „Text kopieren“ in der Web-App versieht den kopierten Text nach denselben Regeln (`app/src/lib/tracking.ts`, dieselben Testfälle); dort fällt ein Kampagnenkürzel über 100 Zeichen weg, statt abgelehnt zu werden.

Prüfen: `uv run ruff check src tests`, `uv run mypy src`, `uv run pytest`, `cd app && npm run check && npx vitest run`.
