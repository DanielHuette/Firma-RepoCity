# RepoCity company page

[Deutsche Fassung](README.de.md)

The page for repocity.speedofthespirit.dev: the RepoCity mark in the centre, the seven parts of
the company around it. Each part opens with four tabs (Project, Flow, Skills, Presentation), and
the company as a whole has its own presentation: one customer's way from first contact to the
monthly invoice. German at `/`, English at `/en/`, same anchors in both.

Status: built locally, not published.

| Folder | Content |
|---|---|
| `site/` | the published files: two HTML pages, the request form `anfrage/index.html` with `anfrage.css`, `styles.css`, `js/` (ES modules), fonts, icon, preview image, `_headers`, `_routes.json`, `robots.txt`, `sitemap.xml` |
| `functions/api/` | Cloudflare Pages Functions `termine.js` and `anfrage.js`, thin wrappers around `server/anfrage.mjs` |
| `server/` | `anfrage.mjs`, the request handler without any Cloudflare API |
| `bau/` | `inhalt.py` holds every text in both languages, `seite.py` renders it, `bauen.py` writes `site/index.html` and `site/en/index.html`; `vorschau.cjs` renders `site/bilder/vorschau.png` |
| `tests/` | `test_bau.py` (content and structure), `adresse.test.mjs` (address rules), `herkunft.test.mjs` (channel markers), `anfrage-regeln.test.mjs`, `termine.test.mjs`, `anfrage-formular.test.mjs` and `anfrage-server.test.mjs` (request form and handler), `pruefen.cjs` (browser checks with screenshots in `tests/bilder/`) |

## Anchors

| Address | Opens |
|---|---|
| `/` or `/#uebersicht` | overview: the mark with the parts around it |
| `/#praesentation` | presentation of the whole company; at its end the overview opens |
| `/#crm`, `/#cockpit`, `/#radarauditor`, `/#marketing`, `/#telefon`, `/#mail`, `/#webseiten` | that part on its presentation; at its end the Project tab opens |
| `/#<part>-projekt`, `/#<part>-ablauf`, `/#<part>-skills`, `/#<part>-praesentation` | that part on one tab |

`/en/` takes the same anchors. A presentation only switches when it has played, or been resumed,
to the end of its last scene; a paused one stays. With reduced motion nothing plays by itself and
nothing switches. Back returns to the presentation. The language switch keeps the anchor.

## Channel markers

`site/js/herkunft.js` reads `utm_source`, `utm_medium` and `utm_campaign` from the address the
visitor arrived with and maps them to the channel exactly as the CRM does (`crm.channel_from` and
`crm.source_channel_label` in `crm/supabase/migrations/011_herkunft.sql`). Without `utm_source`
nothing changes. With it:

- every `mailto:` link gets the subject `Anfrage – über <label> (<campaign>)`, for example
  `Anfrage – über LinkedIn (test)`; an existing subject stays in front, joined by ` – `; a campaign
  that is not 1 to 100 characters of `a-z`, `0-9` and `-` is left out, and so are the brackets;
- every link to `https://speedofthespirit.dev` or one of its subdomains that carries no `utm_`
  parameter gets the same markers, so they survive the move to the next page, including the
  language switch.

Nothing is stored on the visitor's device (no cookie, no browser storage), so no consent is
needed under section 25 of the German Telecommunications Digital Services Data Protection Act (TDDDG). The page has no `mailto:` link today; the markers only travel on through
its links. The same file is kept in the hauptseite repository (`site/quellen/js/herkunft.js`);
a change belongs in both. It loads before `app.js`, which remembers the language links at start.

## Audit request form

`/anfrage/` is a self-contained form, not yet linked from the page: company, contact, e-mail,
phone, kind of meeting (Vor Ort, Telefon, Video), preferred slot; for Vor Ort the address too;
website and message optional. `site/js/anfrage.js` wires every `form[data-anfrage]`, so the form
can move into the main page later.

| Step | Mechanism |
|---|---|
| Free slots | choosing a kind calls `GET /api/termine?art=visit\|call\|video`, which calls `crm.audit_slots(p_kind)`; `site/js/termine.js` lists the start times by day in Europe/Berlin, one hour each |
| Checks | `site/js/anfrage-regeln.js` holds the rules for form and server alike, with the lengths and patterns of `crm.request_audit` (`crm/supabase/migrations/013_audit_anfragen.sql`); errors appear at the field, focus moves to the first one |
| Sending | `POST /api/anfrage` with JSON (at most 32 KiB, known fields only) calls `crm.request_audit`; a German sentence the database raises (SQLSTATE P0001) is shown as is, every other failure as a fixed sentence without details |
| Channel markers | `utm_source`, `utm_medium`, `utm_campaign` of the address are sent along (`herkunft.js`) |
| Request key | each sending carries a random `request_key` (UUID), passed on as `p_request_key`; sending the same input again after a failure keeps it, so the database stores the request once; a changed input gets a new one; it lives only in the open page |
| After sending | the browser moves to `https://radarauditor.speedofthespirit.dev/`, keeping the markers |

The browser only talks to its own site; `server/anfrage.mjs` exports `handleRequest(request, env)`
and forwards to `{SUPABASE_URL}/rest/v1/rpc/<name>` with the public key in `apikey` and
`Authorization` and `Content-Profile: crm`. It uses no Cloudflare API, so an own server can call it
unchanged. On Cloudflare Pages the Functions live in `functions/` at the project root, beside
`site/`, not inside it (Cloudflare documentation, Pages Functions, Get started); `site/_routes.json`
runs them for `/api/*` only. `wrangler.toml` names `site/` as output folder and sets the two public
values `SUPABASE_URL` and `SUPABASE_ANON_KEY`. Nothing is stored on the device.

## Build and check

```bash
python3 bau/bauen.py                 # write both pages from bau/inhalt.py
uv run ruff check bau tests && uv run ruff format --check bau tests
uv run mypy
uv run pytest
node --test tests/*.test.mjs
node tests/pruefen.cjs               # needs Playwright for Node (npm install), writes tests/bilder/
node tests/pruefen.cjs --nur-anfrage # the request form only
node bau/vorschau.cjs                # renders the preview image again
```

`pruefen.cjs` serves `site/` with its `_headers`, so a Content Security Policy violation shows up
as a console error. It checks 1440×900, 1280×720, 390×844 and 360×740 in both languages: every
anchor, the tab bars, every presentation sped up through the Chrome DevTools Protocol (durations
in the stylesheet stay as they are), pause and resume, back and forward, arrow keys, reduced
motion, console and network errors, horizontal scroll and whether the tab bar covers anything.
Then, in all four sizes, the request form with the real handler behind `/api/*` and a stand-in
database inside the process: empty send, the address for Vor Ort, the slot list, keyboard only
(Tab, arrow keys, space, Enter), the request sent with markers and the move to RadarAuditor, a
refusal by the database and labels for every field.

## Publishing

Cloudflare Pages with `site/` as the output folder; no build command; `functions/` is deployed
with it. `_headers` sets a strict Content Security Policy (`script-src 'self'`, no inline code)
and the cache rules; `/anfrage/*` replaces the policy with one without Cloudflare Web Analytics (`script-src 'self'; connect-src 'self'`). `_headers` does not reach responses of Functions, so `server/anfrage.mjs` sets its
own headers.

## Sources

Every statement comes from the files of this repository; `bau/inhalt.py` names them per part in
`quellen`, and the Project tab of each part links them on GitHub. Numbers in use: 108 checks in 14
areas (`radarauditor/config/pruefkatalog.yaml`), 13 channels
(`marketing/supabase/migrations/005_planer.sql`), mailbox every five minutes
(`crm/README.de.md`), buttons valid for 14 days (`Dokumentation/INTEGRATION.md`), graphics card
with at least 12 gigabytes of memory (`telefon/README.md`), follow-up mails after 5 and 12 days, an
assistant with four tasks and an audit request reminder after 24 hours
(`Dokumentation/INTEGRATION.md`), up to three buttons per notification and recordings of at most 60
seconds at 16 kilohertz (`cockpit/README.md`), proposed hours reserved for 48 hours and a profit
over twelve months (`crm/README.md`), callbacks within 60 days (`telefon/README.md`).
