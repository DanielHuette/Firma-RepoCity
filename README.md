# Firma RepoCity

The software RepoCity runs on: message centre, CRM, marketing, the RadarAuditor product and the phone assistant, one app per folder.

Project page: [speedofthespirit.dev/de/](https://speedofthespirit.dev/de/)

Status: test stage without customer operation.

[Deutsche Fassung](README.de.md)

Private backup of the software RepoCity runs on. Each folder is one app with its own build,
database migrations and tests; they share one Supabase project and nothing else.

| Folder | App | Address |
|---|---|---|
| `cockpit/` | Message centre above all apps, lock-screen push | cockpit.speedofthespirit.dev |
| `crm/` | Customers, offers, orders, invoices, contracts, mailbox | crm.speedofthespirit.dev |
| `marketing/` | Source-checked research, campaigns, planner for every channel | app.agenticmarketing.speedofthespirit.dev |
| `radarauditor/` | Visibility audit of a local business website (product) | app.radarauditor.speedofthespirit.dev |
| `telefon/` | Phone assistant on the business number: self-hosted speech and language models, writes to the CRM | RepoCity server (no web address) |

`integration/` tests the shared database of RadarAuditor, CRM and Cockpit on a real PostgreSQL,
with every migration applied in the order the live project got them.

Secrets are never part of this repository; every app reads them from its build environment or
from the Supabase vault.
