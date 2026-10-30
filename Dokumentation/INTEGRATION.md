# How RadarAuditor, CRM and Cockpit work together

[Deutsche Fassung](INTEGRATION.de.md)

## Division of work
**Context:** decided by Daniel on 24 October 2026. | **Input:** the three apps in this repository. | **Output:** which part owns which step.

| Part | Owns | Does not own |
|---|---|---|
| RadarAuditor (`radarauditor/`) | audits, evaluation, quote creation in the field, optimisation of the website and Google profile, audit reports | customer status, invoices, payments, tax export, monthly run, mail sending |
| CRM (`crm/`) | customers, quotes, acceptance from app, mail and phone, orders, subscriptions, invoices with one number range, payments, dunning, contracts, all outgoing mail, review requests, tax adviser package, monthly audit due dates | collecting or scoring audits |
| Cockpit (`cockpit/`) | notifications on the lock screen for every event below, one-tap actions | business logic |
| Server worker (RadarAuditor container on the RepoCity server) | audit jobs, and reading incoming mail with Claude Code on the Claude subscription | anything paid per call: the Anthropic API is not used anywhere |

## Flow
**Context:** one business from first audit to monthly service. | **Input:** a website address. | **Output:** the chain of events and who triggers each.

| Step | Trigger | What happens | Cockpit notification |
|---|---|---|---|
| 1 Audit and quote | Daniel in the RadarAuditor app | audit, evaluation, `crm.create_quote` with items | none |
| 2 Send quote | "Angebot abschicken" in RadarAuditor or CRM | `crm.send_quote` marks the quote sent and queues an outbox mail; the mail worker attaches the audit-plus-quote PDF of the RadarAuditor when one exists, otherwise its own quote PDF, and sends over the Zoho mailbox | "Mail erstellt", then "Mail verschickt" (same notification tag, the second replaces the first) |
| 3 Acceptance | "Angenommen" in the RadarAuditor app (`crm.accept_quote`), a customer mail recognised by Claude Code (`crm.classify_mail_triage`), later the phone assistant (`crm.accept_quote_via(..., 'phone', ...)`) | order; one subscription per monthly quote item, with the quoted price; order confirmation and maintenance contract are queued and sent without approval | "Neuer Auftrag" |
| 4 Optimisation | Daniel starts it in the RadarAuditor app | optimisation jobs and changes; when nothing is left open the RadarAuditor writes the event `optimization.finished` | none |
| 5 Order complete | event `optimization.finished` | `crm.complete_order`: order done, invoice of the one-off items finalised and sent, review request created | "Mail erstellt/verschickt" for the invoice |
| 6 Review request | daily routine | sent once the Google review link is set in the CRM settings; one reminder after `review_reminder_days`, then nothing more; sent to every customer, no filtering by satisfaction | "Mail erstellt/verschickt"; while the link is missing one notice per day |
| 7 Monthly invoice | daily routine | `crm.bill_subscriptions` creates, finalises and sends the invoice of every due subscription | "Mail erstellt/verschickt" |
| 8 Monthly audit | daily routine `crm.flag_due_audits` | a row in `crm.audit_runs` with status `due` | "Monatsprüfung fällig" with the button "Prüfung auslösen" |
| 9 Start monthly audit | one tap on the notification, also on the lock screen | `cockpit.run_action` calls `crm.start_audit_run`, which calls `public.queue_monthly_audit`; the RadarAuditor audits again with purpose `monthly` and writes the before-after report | "Prüfung gestartet" |
| 10 Monthly audit done | audit status `reported` or `failed` | `crm.audit_runs` updated, activity in the customer file | "Monatsprüfung fertig" or "Monatsprüfung fehlgeschlagen" |
| 11 Dunning | daily routine | when the statements reach yesterday, no incoming payment waits for a decision and the invoice was due at least two days before the last statement day, the reminder with PDF goes out at once. Otherwise, and when the customer has no e-mail address, an approval as before; one tap "Senden" sends it | "Mail erstellt/verschickt" or "Freigabe nötig" with the buttons "Senden" and "Nicht senden" |
| 11a Bank statement | Daniel loads a CAMT.053 file in the CRM under Finanzen | every transaction once; when invoice number and open amount fit, the invoice is paid; otherwise a suggestion or "Unklar"; every debit becomes an expense with the account Daniel last gave that payee | "Freigabe nötig: Zahlung … zu Rechnung …?" with "Zuordnen" and "Nicht zuordnen", or "Zahlungseingang ohne Rechnung" |
| 11b Reversal | the statement carries a reversal or return | after "Verrechnen" both bookings count neither as income nor as expense; a paid invoice is open again | "Freigabe nötig: Rückbuchung … verrechnen?" with "Verrechnen" and "Nicht verrechnen", or "Rückbuchung ohne passende Buchung"; afterwards "Rückbuchung verrechnet" |
| 11c Receipt | a receipt file is stored but its entry failed three times | the hourly check adds it to its expense | "Beleg nicht gespeichert" when it cannot |
| 12 Tax adviser | Daniel in the CRM, invoices page | zip with every invoice PDF of the period, invoices, payments and open items as CSV, and the DATEV booking batch; also the expenses as a list, as their own booking batch and every receipt | none |
| 13 Appointment | Daniel on the CRM page "Kalender", the assistant, or a caller who wants a callback | appointment with day, time (a callback may have none), duration, kind, customer, place and note; with the box ticked the customer gets a confirmation mail with the appointment as calendar file; the phone calendar subscribes to a secret read-only link | "Termin um HH:MM: …" before the start (setting `reminder_minutes`, 60 by default); the 6:00 morning brief starts with "N Termin(e) heute"; "Rückruf gewünscht: …" for a call |
| 14 Follow-up | daily routine | a sent quote without answer gets a question after 5 and after 12 days, the second at least a week after the first; a mail, call or inquiry of the customer withdraws a waiting question; none when the customer has written, called or asked since the quote was sent, when it ran out (the routine sets it to expired) or when the customer opted out with the link in the mail; opting out also stops review requests and deletes such mails still waiting to be sent | "Freigabe nötig: Nachfass-Mail zu Angebot … senden?" with "Senden" and "Nicht senden" |
| 15 Assistant | Daniel types or speaks in the Cockpit | the server worker turns speech into text on the server and deletes the recording, Claude Code reads the request as one of four tasks (create contact, book appointment, draft mail, revenue), the database carries it out and reads back what it stored; a drafted mail waits for "Senden" on the CRM page Freigaben, where its whole text stands | "Assistent: erledigt" or "Assistent: nicht erledigt" with the read-back text; for a mail "Freigabe nötig" without buttons, linking to that page |
| 16 Channel | a link of the marketing app, the Google profile, a contact mail, the web form, the phone assistant | the first channel and campaign stay on the customer, every inquiry keeps its own; the CRM counts inquiries, new customers and revenue per channel | none |
| 17 Audit request | a business fills in „Audit anfragen“ on the website with a free hour of Daniel's calendar | customer and inquiry with channel and campaign, nothing to the customer; „Bestätigen“ books and confirms with calendar file, place (address, phone number or Jitsi link) and the link „Anderen Termin wünschen“; „Anderen Termin vorschlagen“ and „Senden“ mail three free hours, a click books at once; „Prüfen“ starts the RadarAuditor audit; a reminder mail the day before | „Audit-Anfrage: …“ with „Bestätigen“, „Anderen Termin vorschlagen“, „Prüfen“; „Vorschlag für …“ with „Senden“; „Termin gebucht: …“; „Wunschzeit belegt: …“; „Anderer Termin gewünscht: …“; once after 24 hours „Seit einem Tag offen: …“ |

## Database interface
**Context:** names every part codes against. | **Input:** migrations `radarauditor/supabase/migrations/013_crm_handover.sql` (additions), `014_remove_billing.sql` (removals), `crm/supabase/migrations/004_flow.sql`, `cockpit/supabase/migrations/002_actions.sql`; fixes from the scenario walk in RadarAuditor `015_link_crm_leads.sql`, CRM `006_scenario_fixes.sql` and Cockpit `003_scenario_fixes.sql`. | **Output:** tables, columns and functions below. Everything not listed keeps its current shape.

### Schema public (RadarAuditor)

| Object | Shape |
|---|---|
| `public.audits.purpose` | `text not null default 'sales'`, check in (`sales`, `monthly`); the report step writes the before-after report only for `monthly` audits that have a previous reported audit |
| `public.queue_monthly_audit(p_crm_customer uuid) returns uuid` | finds the oldest `public.customers` row with that `crm_customer_id`; new audit with purpose `monthly`, the `disabled_checks` of the customer's latest audit, kind `with_access` when `customer_access.google_business_profile_granted`, else `remote`; queues the first job exactly like `queue_field_audit`; raises `P0002` with a German message when no audited customer exists |
| event `optimization.finished` | row in `public.events` with payload `{"order_id": "<uuid>"}`, written once per order by a trigger on `public.optimization_changes` and `public.jobs` when the order has at least one change or an `optimize` job `done` that found nothing to change, no change in `draft`, `approved`, `manual` or `failed`, and no `optimize` or `apply` job `queued` or `running` |
| `crm.customers.source` value `radarauditor` | customers created by the RadarAuditor carry this source |
| `public.link_crm_customer(p_customer_id uuid) returns uuid` | links the audited customer to the one CRM customer of the same name and city; failing that, to the one CRM customer of the same name without a city (a lead from the web form, a mail or a call), which gets the city; otherwise creates one with source `radarauditor` |
| removed in 014 | tables `payments`, `invoice_counters`; functions `next_invoice_number`, `forbid_invoice_update` and its trigger; column `customers.stage` and type `customer_stage`; job kind `monthly`; document kinds `invoice` and `credit_note`; column `documents.cancels_document_id`; settings keys `monthly_last_run` and `tax_export_request`. 014 stops with a German message while invoices or credit notes are still stored; `public.claim_jobs` becomes callable by `service_role` only |

### Schema crm

| Object | Shape |
|---|---|
| `crm.settings` | new `google_review_url text not null default ''`, `review_reminder_days int not null default 7` (1–60), `datev_consultant_number` (1–7 digits, empty allowed) and `datev_client_number` (1–5 digits, empty allowed) for the EXTF header of the DATEV batch, `datev_tax_free_account` (4 digits, empty allowed) for 0 % lines under normal taxation |
| `crm.quotes` | new `accepted_via text` check in (`app`, `email`, `phone`, `crm`), `decision_note text not null default ''` |
| `crm.subscriptions` | new `quote_id uuid` → `crm.quotes`, `unit_price_net numeric(12,2)` (null means product price), `next_audit_date date` (a before-insert trigger sets start date plus one month when it is null and the product has `radar_areas`, also for subscriptions entered in the CRM) |
| `crm.documents` | new `quote_id uuid`, `invoice_id uuid`; generated quote and invoice PDFs carry these ids |
| `crm.outbox` | new `kind text not null default 'contract'` check in (`contract`, `quote`, `invoice`, `dunning`, `review_request`, `review_reminder`), `quote_id`, `invoice_id`, `review_request_id`, `dunning_level int`, `attachment_path text`; subject and body are final when the row is queued |
| `crm.mail_texts` | `key text primary key` check in (`quote`, `invoice`, `dunning_1`, `dunning_2`, `dunning_3`, `review_request`, `review_reminder`), `subject text`, `body text`, `updated_at`; placeholders as in `crm.base_values` plus `{{nummer}}`, `{{betrag}}`, `{{faellig}}`, `{{bewertungslink}}` |
| `crm.review_requests` | `id`, `customer_id`, `order_id unique`, `status` in (`waiting_link`, `due`, `sent`, `reminded`, `done`, `cancelled`), `sent_at`, `reminder_due date`, `reminded_at`, `created_at` |
| `crm.audit_runs` | `id`, `subscription_id`, `customer_id`, `month date` (first of month), unique (`subscription_id`, `month`), `status` in (`due`, `started`, `reported`, `failed`), `audit_id uuid`, `score_before numeric`, `score_after numeric`, `created_at`, `started_at`, `finished_at` |
| `crm.mail_triage` | `id`, `kind` in (`unknown_sender`, `customer_mail`), `status` in (`queued`, `claimed`, `classified`, `applied`, `failed`), `direction`, `address`, `name`, `subject`, `body_text` (at most 8000 characters), `folder`, `raw_path` (storage path of the original mail, unknown senders only), `email_id` → `crm.emails`, `customer_id`, `result jsonb`, `attempts int`, `claimed_until`, `error`, `created_at`, `classified_at`, `applied_at`, `sender_verified boolean not null default false` (set by the mail worker: DMARC pass, or DKIM pass for the From domain) |
| `crm.accept_quote_via(p_quote uuid, p_channel text, p_note text default '') returns crm.orders` | acceptance from any channel; creates order, subscriptions for monthly items, sets `accepted_via` |
| `crm.accept_quote(p_quote uuid)` | unchanged signature, channel `app` |
| `crm.decline_quote_via(p_quote uuid, p_channel text, p_note text default '') returns crm.quotes` | decline from any channel; `crm.decline_quote` uses channel `app` |
| `crm.send_quote(p_quote uuid) returns crm.outbox` | draft becomes sent and the mail is queued; raises when the customer has no e-mail address |
| `crm.send_invoice(p_invoice uuid) returns crm.outbox` | finalises a draft, then queues the mail |
| `crm.invoice_from_order(p_order uuid)` | copies only items whose product is not `monthly`; returns null when nothing is left to invoice |
| `crm.complete_order(p_order uuid) returns void` | order done, invoice from order finalised and sent, review request created; a failure to finalise (for example missing company data) leaves the draft, a task and a Cockpit notice instead of raising; also Daniel's manual "Auftrag abschließen" (`crm.require_writer`); a second call does nothing, an order already done or invoiced another way is refused |
| `crm.bill_subscriptions() returns int` | as before, then finalises and sends every new invoice; the price is `unit_price_net` or the product price |
| `crm.flag_due_audits() returns int` | one `audit_runs` row per active subscription with `next_audit_date <= current_date`, moves `next_audit_date` on by one month, Cockpit notice with action `start_audit` |
| `crm.start_audit_run(p_run uuid) returns crm.audit_runs` | status `due` or `failed` to `started`, `audit_id` from `public.queue_monthly_audit` |
| `crm.run_review_requests() returns int` | sends due requests and reminders; without a review link sets `waiting_link`; customers with `crm.customers.no_review_requests` (they objected) get none, their requests become `cancelled`; both texts tell the customer they can object at any time |
| `crm.mark_review_done(p_request uuid) returns crm.review_requests` | Daniel ticks it off; no reminder follows |
| `crm.claim_mail_triage(p_limit int, p_seconds int) returns setof crm.mail_triage` | service role only; claims `queued` rows and rows whose claim expired, `for update skip locked`, raises `attempts` |
| `crm.classify_mail_triage(p_id uuid, p_result jsonb) returns crm.mail_triage` | service role only; validates the result; a `customer_mail` is applied at once (status `applied`), an `unknown_sender` waits as `classified` for the mail worker, which still holds the original mail |
| `crm.fail_mail_triage(p_id uuid, p_error text) returns crm.mail_triage` | back to `queued` below three attempts, else `failed` with a Cockpit notice |
| `crm.today_overview() returns jsonb` | as before, plus `due_audits` (count of `audit_runs` with status `due`), `mail_triage_waiting` (count of `mail_triage` with status `queued` or `claimed`) and `mail_triage_failed` (count with status `failed`) |
| `crm.daily_routine() returns void` | the one function the cron job `crm-daily` calls: dunning, subscription billing, due audits, review requests |
| triggers | on `public.audits` status `reported` or `failed`: update the matching `audit_runs` row and log an activity for every audit of a linked customer; on `public.events` insert of `optimization.finished`: `crm.complete_order` |
| removed | vault secret `crm_anthropic_key`, its name in `crm.set_secret` and `crm.mail_config` |

Calendar, follow-ups, channel and assistant (`crm/supabase/migrations/009_kalender.sql` to `012_assistent.sql`):

| Object | Shape |
|---|---|
| `crm.settings` | new `business_hours_start` / `business_hours_end time` (08:00 / 18:00, start before end), `business_days smallint[]` (ISO weekdays, default Monday to Friday), `reminder_minutes int` (5–1440, default 60), `calendar_token uuid` (secret of the calendar feed) |
| `crm.appointments` | `id`, `kind` in (`visit` "Vor-Ort-Gespräch", `callback` "Rückruf", `call` "Telefonat", `other` "Termin"), `title`, `starts_on date` (the Berlin date of `starts_at`, or the day of an appointment without time), `starts_at`, `ends_at`, `customer_id`, `location`, `note`, `origin` in (`person`, `phone`, `assistant`), `status` in (`planned`, `done`, `cancelled`), `reminded_at`, `created_at`, `updated_at` |
| `crm.create_appointment(p_kind, p_title, p_starts_at, p_duration, p_customer, p_location, p_note, p_confirm default false, p_starts_on default null)`, `crm.update_appointment(p_appointment, …, p_starts_on default null)`, `crm.set_appointment_status(p_appointment, p_status)` | the calendar page; `p_confirm` queues outbox kind `appointment` with `appointment_id`, refused without customer or without time; moving an appointment makes its reminder due again |
| `crm.remind_appointments() returns int` | service role only, cron `crm-appointments` every five minutes; one Cockpit notice kind `termin` per planned appointment within `reminder_minutes` |
| `crm.calendar_events(p_token uuid)` | service role only; planned and done appointments from 90 days back to a year ahead when the token matches, otherwise nothing |
| `crm.callback_from_call(p_caller_number, p_name, p_reason, p_wished_at timestamptz) returns uuid` | service role only; a callback at the wished time when it lies ahead, within 60 days and inside the business hours; otherwise today without time, with the reason the wish did not fit in the note; Cockpit notice "Rückruf gewünscht: …" |
| `crm.today_overview()` | plus `appointments_today` and `appointments_today_list` |
| `crm.customers` | new `no_follow_ups boolean`, `optout_token uuid` (unique), `channel` (see below, null = unknown), `campaign text` (at most 100 characters) |
| `crm.quotes.follow_up_level` | 0–2, the last follow-up sent or declined |
| `crm.outbox` | new kinds `appointment`, `follow_up`, `assistant`; `appointment_id`; `list_unsubscribe text` (opt-out address for the `List-Unsubscribe` header) |
| `crm.mail_texts` | new keys `appointment` (`{{termin}}`, `{{ort}}`), `follow_up_1`, `follow_up_2` (`{{abmeldelink}}`) |
| `crm.approvals.kind` | new `follow_up` (payload `{"quote_id", "level"}`; "Nicht senden" counts the level as done) and `assistant_mail` |
| `crm.expire_quotes()`, `crm.run_follow_ups()` | service role only, both in `crm.daily_routine` |
| `crm.opt_out(p_token uuid) returns boolean` | service role only; sets `no_follow_ups` and `no_review_requests`, drops waiting follow-up questions |
| `crm.inquiries` | new `source_channel`, `campaign` |
| channel values | `google_search`, `google_maps`, `linkedin`, `instagram`, `facebook`, `xing`, `youtube`, `tiktok`, `x`, `threads`, `reddit`, `forum`, `newsletter`, `referral`, `other`; German labels from `crm.source_channel_label` |
| `crm.channel_from(p_source text, p_medium text) returns text` | the channel of a link's `utm_source` and `utm_medium` |
| `crm.submit_inquiry(…, p_utm_source, p_utm_medium, p_utm_campaign)` | the web form hands the link markers on |
| `crm.intake_contact` | reads a subject "Anfrage – über <label> (<campaign>)"; the last such part counts, any other subject names no channel |
| `crm.intake_call(…, p_channel text default '')` | the caller's answer to "Wie sind Sie auf uns aufmerksam geworden?" |
| `crm.channel_report(p_from date, p_to date)` | `channel`, `label`, `inquiries`, `customers` (new in the period), `revenue` (payments received in the period, counted by the paying customer's channel; a netted reversal removes its payment) |
| `crm.assistant_requests` | `id`, `text`, `audio_path` (`anfragen/<uuid>.wav` in the private bucket `crm-assistant`, at most 4 MB), `status` in (`queued`, `claimed`, `done`, `failed`), `attempts`, `claimed_at`, `intent jsonb`, `result_text`, `created_at`, `finished_at`; the administrator reads and inserts `queued` rows |
| `crm.ask_assistant(p_text, p_audio_path)` | administrator; text or a recording |
| `crm.claim_assistant_request()`, `crm.save_assistant_transcript`, `crm.apply_assistant_intent(p_request, p_intent jsonb) returns jsonb`, `crm.fail_assistant_request(p_request, p_error)` | service role only; a claim is taken again after ten minutes, at most three times; `apply_assistant_intent` returns `{"ok", "text"}` and sends the Cockpit notice kind `assistent`; a request claimed three times without result ends as not done |
| `crm.prune_assistant_requests() returns int` | service role only, cron `crm-assistant-prune` daily at 03:23; deletes requests older than 30 days |
| `crm.orphan_recordings() returns table (path text)` | service role only; recordings in `crm-assistant/anfragen/` older than ten minutes that no request names; the idle worker removes them through the Storage interface |

Audit requests (`crm/supabase/migrations/013_audit_anfragen.sql`, `cockpit/supabase/migrations/007_audit_anfragen.sql`):

| Object | Shape |
|---|---|
| `crm.audit_slots(p_kind text) returns table (starts_at timestamptz)` | `anon`; `p_kind` in (`visit`, `call`, `video`); hour starts from tomorrow 0:00 Berlin time for 21 days inside the business days and hours, no overlap with an appointment that is not cancelled, none drafted or sent as proposal to a business within the last 48 hours, sorted, at most 504 (21 days of 24 hours) |
| `crm.request_audit(p_company, p_contact, p_email, p_phone, p_website, p_address, p_kind, p_starts_at, p_message, p_utm_source, p_utm_medium, p_utm_campaign, p_request_key uuid default null) returns jsonb` | `anon`; `{"ok": true}`, or `P0001` with a German sentence for the customer; limits: business and contact 2–200 characters, e-mail at most 200, phone at most 40 characters of `+` (first), digits, space, `()/.-` with 6–20 digits, address at least 5 for on site and at most 300, website at most 300 with a dot in the host, message at most 5000, each `utm_*` at most 100; the hour must be one of `crm.audit_slots`; customer and inquiry through `crm.submit_inquiry` (subject „Audit anfragen“, which also limits an address to 5 requests a day); a known `p_request_key` stores nothing and answers `{"ok": true}` |
| `crm.open_audit_requests()` | administrator; `id, customer_id, company, contact, website, kind, wished_at, status, created_at` of requests neither booked nor checked (`audit_id` empty), open ones first, newest on top |
| `crm.audit_requests` | the request; `status` in (`open` waits for Daniel, `proposed` times mailed, `booked`), `appointment_id`, `reschedule_token`, `audit_id` → `public.audits`, `asked_at`, `owner_reminded_at`; administrator reads |
| `crm.audit_offers` | the proposed hours: `batch`, `starts_at`, `token`, `status` in (`draft`, `sent`, `booked`, `taken`, `expired`, `void`), `sent_at`, `appointment_id`; a draft or sent hour is reserved for its business for 48 hours |
| `crm.appointments` | kind `video` („Videogespräch“), `customer_reminded_at` |
| `crm.outbox`, `crm.mail_texts` | kinds `audit_proposal`, `appointment_cancel` (calendar file `METHOD:CANCEL`), `appointment_reminder`; texts `audit_confirmation` (`{{art}}`, `{{treffpunkt}}`, `{{umbuchungslink}}`), `audit_rebooking` (plus `{{alter_termin}}`), `audit_cancellation`, `audit_proposal` (`{{vorschlaege}}`), `appointment_reminder` (`{{gespraech}}`) |
| Cockpit actions | `audit_confirm` (`crm.confirm_audit_request`), `audit_propose` (`crm.propose_audit_times`), `audit_send` (`crm.send_audit_proposal`, payload `batch`), `audit_check` (`crm.check_audit_website`, `public.start_field_audit`); payload `{"request_id", "batch"}`; at most three buttons per message |
| `crm.audit_offer_view`, `crm.book_audit_offer`, `crm.audit_reschedule_view`, `crm.request_audit_reschedule` (each `p_token uuid`) | service role only, the Edge Function `crm-termin`; a proposal books while sent within 48 hours and ahead, after that it is `expired` (nothing booked, Daniel asked once); `booked` only while the request still holds the appointment it became; the other-time link works while the booked appointment lies ahead |
| `crm.remind_audit_requests()`, `crm.send_appointment_reminders()` | service role only; cron `crm-audit-requests` hourly at minute 19, `crm-appointment-reminders` daily at 07:47 UTC |
| `crm.today_overview()` | plus `appointments_today_items` (`clock`, `title`, `kind`, `location`) |

Intents the server worker hands to `crm.apply_assistant_intent` (the database checks each one again):

```json
{"action": "create_contact", "name": "Erika Korn", "company": "Bäckerei Korn", "email": "erika@korn.de", "phone": "0251 123", "note": ""}
{"action": "create_appointment", "customer": "Bäckerei Korn", "kind": "visit", "title": "", "starts_at": "2026-11-02T10:00:00+01:00", "duration_minutes": 45, "location": "Laden", "note": ""}
{"action": "draft_mail", "customer": "Bäckerei Korn", "subject": "Termin am Montag", "body": "…"}
{"action": "revenue", "from": "2026-10-01", "to": "2026-10-31"}
{"action": "unclear", "question": "Welcher Kunde?"}
```

Results Claude Code writes for `crm.classify_mail_triage`:

```json
{"verdict": "customer", "name": "Erika Muster", "company": "Muster GmbH", "reason": "asks for a quote"}
{"intent": "accept", "quote_number": "AN-2026-0004", "confidence": "high", "summary": "accepts the quote of 24 October"}
```

`verdict` is one of `customer`, `unsure`, `not_customer`, `automated`. `intent` is one of `accept`, `decline`, `other`; `confidence` is `high` or `low`; `quote_number` may be null. Lengths: `name` and `company` at most 200 characters, `reason` and `summary` at most 500, `quote_number` at most 40; no other keys. A `high` acceptance from a verified sender (`sender_verified`) whose quote is found among the customer's sent quotes (by number, or the only one) and is still valid (`valid_until` today or later) is accepted with channel `email`; a `high` decline from a verified sender with a found quote is declined and announced (kind `kundenmail`, "Absage per E-Mail: <customer> – <quote number>"); anything else becomes a Cockpit notice, for a possible acceptance (kind `annahme`) with the action `accept_quote`, naming an expired quote or an unverified sender.

### Schema cockpit

| Object | Shape |
|---|---|
| `cockpit.messages` | new `actions jsonb not null default '[]'` (at most two `{"action": "...", "title": "..."}`, three since Cockpit 007), `action_payload jsonb not null default '{}'`, `action_token uuid not null default gen_random_uuid()`, `acted_at timestamptz`, `acted_action text`, `action_result text not null default ''`, `tag text` |
| `cockpit.notify_action(p_app, p_kind, p_title, p_body, p_link, p_priority, p_dedupe, p_actions jsonb, p_payload jsonb, p_tag text) returns uuid` | like `cockpit.notify`, with actions and tag |
| `cockpit.run_action(p_message uuid, p_token uuid, p_action text) returns jsonb` | open to `anon` and `authenticated`; the unguessable token proves the caller got the push; checks the action is offered, not yet taken and the message is at most 14 days old; runs `start_audit` (`crm.start_audit_run`), `approve` / `reject` (`crm.decide_approval`), `accept_quote` (`crm.accept_quote_via(..., 'crm', 'im Cockpit bestätigt')`); returns `{"ok": true|false, "text": "<German sentence>"}` |
| triggers | outbox insert ("Mail erstellt: …") and change to `sent` ("Mail verschickt: …") with tag `mail-<outbox id>`; order insert ("Neuer Auftrag: …", `wichtig`); `audit_runs` status changes; failed `mail_triage`; `review_requests` waiting for the link (one per day) |
| health | mail triage rows `queued` for more than an hour: one notice per day "Mails werden nicht gelesen – läuft der Server?" |

### Push payload (Edge Function `cockpit-push`)
`{"id", "app", "kind", "priority", "title", "body", "link", "tag", "token", "actions": [{"action", "title"}]}`; `tag` falls back to `id`.

### Mail worker (Edge Function `crm-mail`)
Reads the mailbox every five minutes, files mails of known customers, queues `customer_mail` triage for incoming mails of customers with a sent quote, queues `unknown_sender` triage with the original mail in `crm-documents/triage/<id>.eml`, files classified unknown senders (customer: intake and filing; otherwise `crm.mail_review`), renders quote, invoice and dunning PDFs with `pdf-lib`, stores them as `crm.documents` and sends the outbox. It renders the PDF of every finalised invoice that has none yet, so the tax adviser package is complete.

### Server worker (RadarAuditor)
On every idle poll: `crm.claim_mail_triage`, one headless Claude Code call per mail without any tool, answer validated against the shapes above, then `crm.classify_mail_triage` or `crm.fail_mail_triage`. The mail text is untrusted input and is fenced in the prompt as data.

Assistant requests the same way: `crm.claim_assistant_request`; a recording is fetched from `crm-assistant`, sent to the speech service of the phone stack (faster-whisper on the server) and deleted; then one Claude Code call without tools turns the text into one of the intents above, which is validated and handed to `crm.apply_assistant_intent`, or `crm.fail_assistant_request` with a German sentence.

### Calendar feed and opt-out page (Edge Functions `crm-calendar`, `crm-abmelden`)
`crm-calendar?t=<calendar_token>` answers the appointments as iCalendar for the phone's calendar subscription, read only. `crm-abmelden?t=<optout_token>` leads a GET to the page `https://crm.speedofthespirit.dev/abmelden/` with one button (Supabase shows HTML from a function's GET only as plain text without a paid custom domain); only the button's POST opts out, and leads back to that page with the result, as does the one-click POST of a mail program (RFC 8058), which gets plain text and no redirect. Both run without a signed-in user; the token is the only key. `crm-termin?buchen=<token>` and `crm-termin?anders=<token>` lead a GET to `https://crm.speedofthespirit.dev/termin/` with the hour to show (`abgelaufen=` after the 48 hours of reservation); only the POST of the button there books the proposed hour, asks for new proposals or asks for another time, and leads back with `ergebnis=gebucht`, `belegt`, `abgelaufen`, `gewuenscht`, `ungueltig` or `fehler`.

## Phone assistant
**Context:** decided by Daniel on 25 October 2026: everything runs on the RepoCity server from the start, no interim cloud or PC service; LiveKit carries the calls; a free female German voice until his own voice is cloned. | **Input:** a call on the business number (SIP trunk; the number is entered when the company exists). | **Output:** a call record, an inquiry or a decision in the CRM, and a Cockpit notice.

| Part | Runs on the server as | Free licence |
|---|---|---|
| LiveKit server and LiveKit SIP | containers `livekit`, `livekit-sip`, `redis` (runs Valkey) | Apache 2.0 (LiveKit), BSD 3-Clause (Valkey) |
| Agent (`telefon/`) | Python service with LiveKit Agents | own code; LiveKit Agents Apache 2.0 |
| Speech to text | faster-whisper behind a local HTTP service | MIT |
| Language model | Ollama with a Qwen 3 model | MIT (Ollama), Apache 2.0 (Qwen 3) |
| Voice | Piper with the female German voice `de_DE-ramona-low` (M-AILABS data, commercial use allowed) | GPL 3.0 (piper-tts 1.8, runs as its own service, nothing is distributed), voice MIT |

The agent says at the start that it is an AI assistant and that the call is written down for processing. It promises nothing beyond the facts it is given (products and prices from `crm.products`, the text in `crm.settings.assistant_facts`).

| Object | Shape |
|---|---|
| `crm.settings` | new `assistant_greeting text not null`, 1–1000 characters, default the disclosure "Guten Tag, hier ist die digitale Assistentin von RepoCity. Ich bin eine künstliche Intelligenz, kein Mensch. Unser Gespräch wird mitgeschrieben, damit Ihr Anliegen bearbeitet werden kann. Was kann ich für Sie tun?" (Art. 50(1) and (5) of Regulation (EU) 2024/1689; it can be reworded, not emptied); `assistant_facts text not null default ''`, at most 20000 characters (what the assistant may say about the business; edited in the CRM) |
| `crm.calls` | `id`, `customer_id` → `crm.customers` (null until known, deleted with the customer), `caller_number text` (null for a hidden number), `direction` (`in`), `started_at`, `ended_at` (not before `started_at`), `transcript jsonb` (list of `{"speaker": "caller"|"assistant", "text": ...}`), `summary text` (at most 2000 characters), `outcome` in (`inquiry`, `quote_accepted`, `quote_declined`, `callback`, `info`, `dropped`), `created_at`; unique (`caller_number`, `started_at`); the signed-in administrator reads, only the service role writes |
| `crm.phone_key(p_number text) returns text` | digits of a number with `+49`, `0049`, a national `0` and `(0)` after the country code all turned into `49`, the user part of a SIP address only; null below six digits. Numbers are compared by this key |
| `crm.intake_call(p_caller_number text, p_name text, p_company text, p_email text, p_subject text, p_message text) returns uuid` | service role only; finds the customer by the number of the line (the oldest one sharing it), then by a valid spoken e-mail address, else creates one with source `phone` (e-mail optional; a spoken address that is not valid stays in the message); files an inquiry with channel `phone` and a task "Rückruf <name>, <number>" ("Rufnummer unbekannt" for a hidden number); returns the customer id |
| `crm.phone_quote_decision(p_caller_number text, p_quote_number text, p_intent text, p_summary text) returns jsonb` | service role only; `p_intent` in (`accept`, `decline`); the quote is found by number regardless of separators and leading zeros ("an 2026 4" is `AN-2026-0004`), without a number it is the only sent quote of the customers on this line; decides automatically only when the caller number matches the phone of the quote's customer, the quote is sent and (for accept) still valid, a decline is also announced (kind `kundenmail`, "Absage am Telefon: <customer> – <quote number>"); otherwise a Cockpit notice (kind `annahme` or `kundenmail`) naming the quote, whether it expired or is no longer open, and whether the line fits, with the `accept_quote` button for a sent quote; returns `{"done": true|false, "text": German sentence the assistant reads out}`, and every case not decided gets the same sentence, so the caller learns nothing about other customers' quotes |
| `crm.record_call(p_call jsonb) returns uuid` | service role only; stores one finished call from `{"caller_number", "customer_id", "started_at", "ended_at", "transcript", "summary", "outcome"}` (`started_at` and `outcome` required, `customer_id` is the id `crm.intake_call` returned, no other keys); links the customer by `customer_id`, else by number; Cockpit notice kind `anruf` "Anruf von <customer, number or 'unbekannter Rufnummer'>" with the summary; the same call sent again returns the stored id without a second notice |
