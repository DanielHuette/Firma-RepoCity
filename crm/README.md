# CRM

[Deutsche Fassung](README.de.md)

| Part | Purpose |
|---|---|
| `app/` | Preact app (Vite, PWA): today view, calendar, customers with full customer file, sales, invoices, finances, service, approvals, settings |
| `supabase/migrations/` | Schema `crm`: numbering, totals, approvals, contracts from templates, mail review queue, outbox, review requests, monthly audit runs, phone calls, bank statements, expenses with receipts, profit per month, cron jobs |
| `supabase/functions/crm-mail/` | Mail worker: IMAP intake, triage of unknown senders, outbox over SMTP with quote, invoice and reminder PDFs |
| `supabase/functions/crm-calendar/` | Calendar feed for the phone: the appointments as iCalendar behind the secret link |
| `supabase/functions/crm-abmelden/` | Opt-out of the follow-up mails, also the one-click target of the List-Unsubscribe header |
| `supabase/functions/crm-termin/` | The appointment links of audit requests: book a proposed hour, ask for another time |
| `supabase/functions/_shared/` | Code several functions use: iCalendar builder, appointment as calendar event, link token |
| `abmelden/index.html`, `src/abmelden/` | The opt-out page customers see, a second page of the app build without the app itself |
| `termin/index.html`, `src/termin/` | The appointment page customers see, a third page of the app build without the app itself |
| `../integration/` | Database tests of CRM, Cockpit and RadarAuditor together on a real PostgreSQL |

Build: `cd app && npm ci && npm run check && npm test && npm run build` with `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` set.
Deploy: `npx wrangler@4 pages deploy dist --project-name repocity-crm --branch main`.

## Mail worker

**Context:** Edge Function `crm-mail`, called every five minutes by the cron job `crm-mail` and by "Postfach abrufen" in the settings. | **Input:** mailbox access from Supabase Vault, schema `crm`, audit-plus-quote PDFs of the RadarAuditor (`public.documents`, bucket `documents`). | **Output:** customer files, triage rows, sent mails, PDFs in bucket `crm-documents`.

| Step | What happens |
|---|---|
| Outbox | Sends every queued mail (`contract`, `quote`, `invoice`, `dunning`, `review_request`, `review_reminder`, `appointment`, `follow_up`, `assistant`, `audit_proposal`, `appointment_cancel`, `appointment_reminder`) with its attachment: contract; quote as the RadarAuditor's audit-plus-quote PDF, waiting up to 30 minutes while it is being made, otherwise its own quote PDF; invoice; reminder letter; an appointment confirmation carries the appointment as `Termin_<day>.ics` (iCalendar, `METHOD:PUBLISH`, organizer the mailbox address, not stored in `crm-documents`), a deleted or cancelled appointment makes that mail fail; a cancellation (`appointment_cancel`) carries the cancelled appointment as `Absage_<day>.ics` (`METHOD:CANCEL`, same UID, `STATUS:CANCELLED`, `SEQUENCE:1`, RFC 5546 sections 3.2.1 and 3.2.5), in a mail of its own so that each mail holds one calendar object. Review, follow-up, assistant, proposal and reminder mails go without attachment. A mail with `list_unsubscribe` gets `List-Unsubscribe: <address>` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click` (RFC 8058). A failed send is retried, after the third attempt the mail is marked failed. A mail the mail server accepted is marked sent and never sent again; a failed write after that only appears in the run report. |
| Classified senders | Unknown senders classified by the server worker: a customer is taken in and all stored mails are filed; any other verdict goes to the review list. The stored original mails are then deleted. |
| Mailbox | New mails of inbox and sent folder go to the customer file. An incoming mail of a customer with a sent quote is queued as `customer_mail` triage; `sender_verified` is set when Zoho's own Authentication-Results header shows dmarc=pass or a DKIM signature of the From domain. An unknown sender's original mail is stored at `triage/<id>.eml` with one `unknown_sender` triage row per address; further mails of that address before the classification are kept at `triage/<id>/<hash>.eml`. Automatic senders and the ignore list work as before. |
| Invoice PDFs | Every finalised invoice and cancellation invoice without PDF gets one, so the tax adviser package is complete. |

Every generated PDF is stored under `customers/<customer id>/` and as a `crm.documents` row with its quote, invoice or contract id. Invoice PDFs use the seller and customer data stored when the invoice was finalised.

Checks: `cd supabase/functions/crm-mail && deno check *.ts pdf/*.ts testing/*.ts && deno lint && deno test`, and in `supabase/functions/crm-calendar`, `crm-abmelden`, `crm-termin` and `_shared` each `deno check *.ts && deno lint && deno test --allow-env --allow-read`.

## Calendar feed
**Context:** Edge Function `crm-calendar`, deployed with JWT verification off; the secret link from Settings → Kalender is the access. | **Input:** `GET /functions/v1/crm-calendar?t=<crm.settings.calendar_token>`. | **Output:** `text/calendar; charset=utf-8` from `crm.calendar_events`, `Cache-Control: private, no-store`.

| Case | Answer |
|---|---|
| Right token | Every planned and done appointment from 90 days back to a year ahead; an appointment without time is an all-day event; description: kind, customer, note |
| Missing, malformed or wrong token | 404 "Nicht gefunden." without detail |
| Database not reachable | 503 |

A new `calendar_token` makes every old link useless.

## Opt-out
**Context:** Supabase shows HTML that a function sends for a GET as plain text unless the project has a paid custom domain, so the page lives on the CRM site (`/abmelden/`, in the look of the sign-in) and the Edge Function `crm-abmelden` (JWT verification off) answers only with redirects or plain text. | **Input:** `?t=<crm.customers.optout_token>`. | **Output:** `crm.opt_out` sets `no_follow_ups` and `no_review_requests`.

| Request | What happens |
|---|---|
| GET on the function (the link in the mail, or a link scanner) | 303 to `https://crm.speedofthespirit.dev/abmelden/?t=<token>`; changes nothing |
| The page | "Keine Erinnerungen mehr" with the button "Abbestellen"; without a valid token "Link nicht gültig" |
| POST of the button (field `abmelden`) | `crm.opt_out`, then 303 back to the page with `ergebnis=erledigt`, `ungueltig` or `fehler` |
| One-click POST of a mail program (`List-Unsubscribe=One-Click`, form or multipart) | `crm.opt_out`, plain text 200, 404 or 503, never a redirect (RFC 8058 section 3.1) |

The page sends no referrer, loads only its own files, may post only to the Supabase project (`_headers`) and installs no service worker.

## Audit requests
**Context:** migration `013_audit_anfragen.sql`; the form on the website (`repocity-seite`) calls `crm.audit_slots` and `crm.request_audit` with the anon key, Daniel decides with the buttons of the Cockpit notice. | **Input:** the request, Daniel's taps, the customer's clicks. | **Output:** customer, inquiry and `crm.audit_requests`; appointment, mails and Cockpit notices.

| Step | What happens |
|---|---|
| Free hours | `crm.audit_slots(kind)`: hour starts from tomorrow 0:00 Berlin time for 21 days inside `business_days` and `business_hours_start`/`_end`, no overlap with an appointment that is not cancelled (an entry without time blocks nothing) and none proposed to another business within the last 48 hours; times only |
| Request | `crm.request_audit` checks the fields and the hour, takes the customer in through `crm.submit_inquiry` (channel and campaign from `utm_*`, no notice „Neuer Kunde“), stores the request and sends the notice „Audit-Anfrage: …“ with „Bestätigen“, „Anderen Termin vorschlagen“ and, with a website, „Prüfen“; a tap on the notice opens the Cockpit's message centre; the customer gets nothing yet. The same `p_request_key` a second time stores nothing and answers `{"ok": true}` again |
| Bestätigen | the wished hour as appointment (one hour; `video` gets `https://meet.jit.si/RepoCity-<32 random hex characters>` as place, `call` the phone number, `visit` the address), confirmation kind `appointment` with mail text `audit_confirmation`, calendar file and the link „Anderen Termin wünschen“ |
| Anderen Termin vorschlagen | the next three free hours except the wished one as drafts and a second notice with „Senden“; „Senden“ queues `audit_proposal` with one link per hour; an hour taken meanwhile brings three new ones instead; the hours stay reserved for this business for 48 hours |
| Prüfen | `public.start_field_audit` for the website, linked to the CRM customer |
| Rebooking | when a new hour is booked after „Anderen Termin wünschen“, the old appointment is cancelled; the confirmation uses mail text `audit_rebooking` (names the old appointment), and `appointment_cancel` with text `audit_cancellation` carries the cancellation |
| Reminders | hourly `crm-audit-requests` (minute 19): a request open for 24 hours is pushed once more; daily `crm-appointment-reminders` (07:47 UTC): `appointment_reminder` for every appointment tomorrow whose confirmation was sent |

The links lead to the Edge Function `crm-termin` (JWT verification off), which answers only with redirects to the page `https://crm.speedofthespirit.dev/termin/`:

| Request | What happens |
|---|---|
| GET `?buchen=<crm.audit_offers.token>` | `crm.audit_offer_view`, 303 to the page with `buchen`, `zeit`, `art`; books nothing |
| POST of the button (field `buchen`) | `crm.book_audit_offer`: booked at once and confirmed, or `ergebnis=belegt` (Daniel gets the notice „Wunschzeit belegt: …“), `abgelaufen` (sent more than 48 hours ago or past: nothing booked, Daniel gets „Vorschlag abgelaufen: …“ once), `ungueltig` (replaced, or an appointment booked with it was replaced) or `fehler` |
| GET of a proposal sent more than 48 hours ago | 303 to the page with `abgelaufen`, `zeit`, `art`: the reservation ran out, button „Neue Vorschläge anfordern“ |
| GET `?anders=<crm.audit_requests.reschedule_token>` | `crm.audit_reschedule_view`, 303 to the page with the current appointment |
| POST of the button (field `anders`) | `crm.request_audit_reschedule`: notice „Anderer Termin gewünscht: …“ with „Anderen Termin vorschlagen“; the old appointment stays until a new one is booked, then it is cancelled; `ergebnis=gewuenscht` |

The page has the same rules as `/abmelden/` (`_headers`).

## Deploying the functions
Migrations 009 and 010 first (013 before `crm-termin`), then from `crm/`:
`npx supabase@2.121.0 functions deploy crm-mail --project-ref yizvntdwdajlgcbjcves --use-api`
`npx supabase@2.121.0 functions deploy crm-calendar --project-ref yizvntdwdajlgcbjcves --use-api --no-verify-jwt`
`npx supabase@2.121.0 functions deploy crm-abmelden --project-ref yizvntdwdajlgcbjcves --use-api --no-verify-jwt`
`npx supabase@2.121.0 functions deploy crm-termin --project-ref yizvntdwdajlgcbjcves --use-api --no-verify-jwt`
Shared code lies in `supabase/functions/_shared/`; the leading underscore keeps it from being deployed as a function, and the CLI bundles it into every function that imports it.

## Phone assistant

**Context:** migration `005_calls.sql`; the agent on the RepoCity server calls three functions with the service key. | **Input:** the number of the line, what the caller said. | **Output:** customers, inquiries, callback tasks, quote decisions, call records and Cockpit notices.

| Function | What happens |
|---|---|
| `crm.intake_call` | Finds the customer by the number of the line, compared by digits (`+49`, `0049` and a leading `0` are the same), then by a valid spoken e-mail address; otherwise creates one with source `phone`, also without e-mail address. Files an inquiry with channel `phone` and the task "Rückruf <name>, <number>". |
| `crm.phone_quote_decision` | Accepts or declines with channel `phone` only when the number of the line is the phone of the quote's customer, the quote is sent and, for an acceptance, still valid. Otherwise a Cockpit notice, for a possible acceptance with "Annahme bestätigen". Returns the sentence the assistant reads out; every case not decided gets the same one. |
| `crm.record_call` | Stores the call with transcript and summary in `crm.calls`, links the customer and announces it in the Cockpit ("Anruf von …"). The same call sent twice is stored once. |

The greeting (`crm.settings.assistant_greeting`) tells the caller that an AI answers and that the call is written down, as Art. 50 of Regulation (EU) 2024/1689 requires; it can be reworded but not emptied. `assistant_facts` is what the assistant may say about the business.

## What the app does

| Page | Function |
|---|---|
| Today | What needs attention: approvals, due monthly audits with "Prüfung jetzt starten", mails that failed to go out, incoming mails the server worker has not read yet, overdue invoices, the calls of the phone assistant in the last 24 hours (also from callers the CRM does not know yet), the planned appointments of the day (`appointments_today_items` of `crm.today_overview`, those without a time first, with kind and, for a video call, the Jitsi link) with "Zum Kalender", tasks (optionally linked to a customer). Dunning, subscription billing, due audits and review requests run in the database routine `crm.daily_routine`, not on page load. |
| Calendar | `/kalender`: one week from Monday to Sunday in Berlin time, also on a device set to another time zone, with "Vorige Woche", "Heute" and "Nächste Woche"; an appointment without a time stands as "ohne Uhrzeit" first on its day; below, the next 30 planned appointments with "Ändern", "Erledigt" and "Absagen" (`crm.set_appointment_status`). A video call shows „Videogespräch öffnen“ with its Jitsi link. The form takes the kind (Vor-Ort-Gespräch, Rückruf, Telefonat, Videogespräch, Termin), title (empty: kind and customer), day, an optional time with duration (5 to 720 minutes), customer, place and note and calls `crm.create_appointment` or `crm.update_appointment`; the time goes to the database with the Berlin offset of that day, also across the change of summer time. "Bestätigung mit Kalenderdatei an den Kunden schicken" can only be ticked with a customer who has an e-mail address and with a time; on a new appointment it is `p_confirm`, on a changed one `crm.confirm_appointment` after saving. Refusals of the database are shown in its words. |
| Customer file | Overview with running subscriptions (quoted price, next invoice, next monthly audit), contracts, calls of the phone assistant (outcome, date, duration, summary, the conversation line by line on demand), every outgoing mail with its state, purchases; history; quotes and invoices; tab "Prüfungen" with the RadarAuditor audits and their reports, the monthly audit runs and the Google review request; documents; master data with "Keine Bewertungsanfragen", "Keine Erinnerungen" (`no_follow_ups`), channel (the labels of `crm.source_channel_label`, empty is "Unbekannt") and campaign. The head shows the channel and campaign and, when set, "Keine Erinnerungen"; inquiries show their channel; audit requests follow with kind, wished hour and state (waiting for Daniel, proposals sent, appointment booked). Open orders get "Auftrag abschließen" (`crm.complete_order`). |
| Quote | "Angebot abschicken" calls `crm.send_quote`; the mail worker sends the PDF. The page shows the mail state (waiting, sent, failed with the error) and the generated PDF. |
| Invoice | "Festschreiben und senden" finalises the draft and queues the mail (`crm.send_invoice`); "Nur festschreiben" when the customer has no address. Mail state, generated PDF, payments, cancellation, XRechnung. |
| Invoices | Filters, new invoice, and the tax adviser package: one zip per month, quarter or year with every invoice PDF, `rechnungen.csv`, `zahlungen.csv`, `offene-posten.csv` and `datev-buchungsstapel.csv`, plus `ausgaben.csv`, `datev-ausgaben.csv` and every receipt under `Belege/`, and `rueckbuchungen.csv` when reversals were netted in the period (which earlier income or expense no longer counts); expenses taken back by a reversal are left out. Missing PDFs are named in the app and in `fehlende-pdfs.txt`; expenses without an account in `ausgaben-ohne-konto.txt`. |
| Finances | Tabs Kontoauszug, Ausgaben, Gewinn and Herkunft der Kunden, described in the section "Finances". |
| Sales | Accepting or declining a quote in the CRM records the channel `crm` (`crm.accept_quote_via`, `crm.decline_quote_via`). "Auftrag abschließen" finalises and sends the invoice of the one-off items and asks for a review. Every inquiry shows its channel and campaign. |
| Approvals | Approving a dunning approval sends the reminder ("Mahnung senden"). Approving a payment suggestion books the payment to the invoice. A follow-up mail (`follow_up`, "Nachfass-Mail") and a mail drafted by the assistant (`assistant_mail`, "Mail vom Assistenten") are decided with "Senden" or "Nicht senden". |
| Settings | Company data, products, subscriptions, contract templates, mail texts with their placeholders (also the appointment confirmation with `{{termin}}`, `{{ort}}` and `{{titel}}` and both follow-up mails, which cannot be saved without `{{abmeldelink}}`), tab Kalender with business hours, business days and the reminder minutes (`business_hours_start`, `business_hours_end`, `business_days`, `reminder_minutes`, checked as the database checks them) and the "Kalender-Link" `<Supabase URL>/functions/v1/crm-calendar?t=<calendar_token>` with "Link kopieren", Google review link and reminder days, greeting and business facts of the phone assistant (`crm.settings.assistant_greeting`, `assistant_facts`; a greeting that does not say an artificial intelligence is speaking is refused), mailbox and server state, DATEV numbers and the account for tax-free revenue. |

## Tax adviser package

The DATEV posting batch is ported from the tested RadarAuditor tax export (`exports/tax.py` and `tests/test_tax_export.py`): format EXTF 700, category 21, chart of accounts SKR03. Each invoice is booked per VAT rate: the gross amount of the rate on debit of debtor account 1400 against revenue account 8400 (19 % VAT) or 8300 (7 % VAT); a small business under § 19 UStG books everything on 8195; a 0 % line under normal taxation goes to the tax-free account from the settings (while it is missing, the app names the affected invoices); a cancellation books on credit. Open amounts count the payments received within the period and the cancellations of the period. Consultant number, client number and the tax-free account come from Settings → Firma; while one is missing the package still builds and the app says so.

## Finances

**Context:** migration `007_finanzen.sql`, decided with Daniel on 29.10.2026. | **Input:** the statement of the business account as CAMT.053 (ISO 20022, version 02 of the German banks or later), Daniel's choices. | **Output:** transactions, payments to invoices, expenses with an SKR03 account and receipts, the profit per month.

| Tab | What happens |
|---|---|
| Kontoauszug | The file goes to `crm.import_bank_statement`. Only the statement of the account whose IBAN is under Settings → Company is accepted; a file with `DOCTYPE` or `ENTITY` is refused. The file may be at most 1 MB (about 2,000 bookings take 4.4 s; a request may take 8 s). Every booked transaction in euro is stored once, keyed by a hash of everything the bank reports with a counter for identical transactions of one file, because the bank's reference alone is not unique (placeholders such as `NONREF`). Loading the same file twice adds nothing. A reversal (`RvslInd`; an ISO return code `RRTN`, `RPCR`, `UPDD`, `RCDD`, `PRDD`, `UPCT`, `UPCQ`, `XRTN` or `PSTE`; a German business transaction code for a return or Storno such as 109, 159, 160, 181 or 899, from the lists of HypoVereinsbank and Postbank; or return details `RtrInf`) is never assigned or turned into an expense by itself (migration `008_rueckbuchung_belege.sql`). When exactly one earlier booking in the other direction with the same amount carries its end-to-end reference, or else exactly one with the same account of the other side within 90 days, the Cockpit asks "Rückbuchung … verrechnen?" with "Verrechnen" and "Nicht verrechnen". Otherwise the notice "Rückbuchung ohne passende Buchung" comes, and on the page Daniel picks the booking from the candidates (same amount, other direction, 180 days). Netting books it as Lexware Office does (both on "Durchlaufende Posten"): both bookings are "Verrechnet" and count neither as income nor as expense, a payment booked from the original or linked to it is removed (the customer file keeps what it was) and its invoice is open again, an expense from it stays with its receipts marked "zurückgebucht"; a notice "Rückbuchung verrechnet" follows. Without netting Daniel files it as an expense or private as before. When a payment entered by hand with the same invoice number and amount is already in the CRM, the transaction is linked to it instead of booked twice; the page offers that by hand too ("Schon erfasste Zahlung"). An incoming payment naming exactly one open invoice in its reference (any separators) with exactly its open amount is booked as a payment. With the number and another amount, or without a number when exactly one open invoice has that amount, an approval "Zahlung … zu Rechnung …?" with "Zuordnen" and "Nicht zuordnen" appears in the Cockpit. Anything else is "Unklar" with the notice "Zahlungseingang ohne Rechnung"; on the page it can be assigned to an invoice or marked as other income or a private deposit. An assignment can be taken back; a payment the import created is then removed and the invoice is open again. When a suggestion is rejected anywhere (also by a payment by hand or a cancellation), the transaction is "Unklar" again. The page shows unclear transactions whatever their age. Every debit becomes an expense. |
| Ausgaben | Per month, with the filter "Nur ohne Konto". The account comes from a fixed SKR03 list (`crm.expense_accounts`, names as in DATEV and Ecovis, as of 2023). The account last chosen for a payee is used for its next expenses and fills all its expenses without an account; for payment services such as PayPal, Amazon, Klarna or Stripe nothing is learnt, because many different purchases run through them. Every change of account or VAT rate is kept unchangeably in `crm.expense_changes`. Private withdrawals and VAT prepayments never carry input VAT. Under normal taxation the VAT rate of the receipt can be chosen. Cash expenses are entered by hand. Receipts (PDF, JPEG, PNG, HEIC, WebP, up to 15 MB) live in the bucket `crm-receipts` under `belege/<expense>/`; a receipt can be neither replaced nor removed (kept ten years, § 147(3) AO), and amount, date and payee of a booked or documented expense stay as they are. |
| Belege | Upload and entry each get three tries; saving the same file again keeps one receipt. The hourly job `crm-receipts` (`crm.check_receipts`, minute 41) adds every file of the receipts store older than ten minutes that has no entry to its expense; one that cannot be added (no such expense, another file type, empty or over 15 MB) is reported once with the notice "Beleg nicht gespeichert". |
| Herkunft der Kunden | `crm.channel_report(from, to)` (migration `011_herkunft.sql`) as a table Kanal, Anfragen, Neue Kunden, Zahlungseingänge with a total, for "Dieser Monat", "Dieses Jahr", "Letzte 12 Monate" or two chosen days. |
| Gewinn | `crm.profit_by_month` over the last twelve months by payment date: income is payments to invoices and other income, expenses everything but private withdrawals (account 1800) and netted reversals; expenses without an account already count. Plus the change against the month before and the current year. |

A reminder goes out without approval when the statements reach at least yesterday, no incoming payment waits for a decision and the invoice was due at least two days before the last statement day, so a transfer on the due date is in it. Otherwise, and when the mail cannot be queued, the approval stays; the reason is then in the approval and in the customer file. When reminders wait because of unclear payments, the Cockpit says so once a day. Payments that do not go through the account (cash, PayPal) must be entered by hand before a reminder is due. The DATEV booking batch of the expenses books every expense with an account in debit against 1200 Bank or 1000 Kasse, under normal taxation with tax key 9 (19 % input VAT) or 8 (7 %); it is a file of its own, so the tax adviser does not book statement and expenses twice.
