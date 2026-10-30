# Integration tests

[Deutsche Fassung](README.de.md)

RadarAuditor, CRM and Cockpit share one Supabase project and call each other's functions and
triggers. These tests build that database on a throwaway PostgreSQL and run the whole flow of
`Dokumentation/INTEGRATION.md` against it: quote, acceptance, mail triage, completed order,
monthly invoice, monthly audit through the lock-screen action, review requests, dunning, the phone assistant, bank statements and reversals, the calendar, follow-ups, the channel of a customer, the assistant and audit requests from the website.

## Scenarios
**Context:** every path a customer and Daniel can take, end to end, through the calls each part makes (`tests/actors.py`). | **Input:** the built project. | **Output:** one test per row, named after its number.

| No. | Path | Outcome | Test file |
|---|---|---|---|
| L1 | Lead by web form, then the field audit | same CRM customer, its address kept, quote sent without retyping | `tests/test_scenario_leads.py` |
| L2 | Unknown sender, the server worker says customer, the mail worker takes it in, then the field audit | one customer, inquiry by e-mail, quote sent | `tests/test_scenario_leads.py` |
| L3 | Lead by phone from an unknown number, address added in the RadarAuditor | one customer with number and address | `tests/test_scenario_leads.py` |
| L4 | Same address by form twice (any case), mail intake and phone | one customer, every inquiry filed to it | `tests/test_scenario_leads.py` |
| L5 | Same number in another spelling | one customer, one callback task per call | `tests/test_scenario_leads.py` |
| L6 | Server worker fails three times on a mail | queued, queued, failed; Cockpit notice; Daniel's review list | `tests/test_scenario_leads.py` |
| Q1 | Quote from the RadarAuditor, accepted in the app | order, subscription at the quoted price, both contracts sent without approval, one "Neuer Auftrag" | `tests/test_scenario_acceptance.py` |
| Q2 | Quote accepted by a proven mail | channel e-mail, same order | `tests/test_scenario_acceptance.py` |
| Q3 | Unproven mail, Daniel taps "Annahme bestätigen" twice | one order (channel CRM), second tap "Das wurde bereits erledigt." | `tests/test_scenario_acceptance.py` |
| Q4 | Accepted on the phone from the customer's number, call recorded | channel phone, call linked and announced | `tests/test_scenario_acceptance.py` |
| Q5 | Accepted on the phone from another number | nothing decided until Daniel's tap | `tests/test_scenario_acceptance.py` |
| Q6 | Quote expired, then accepted by mail and phone | never automatic, two notices naming the expiry, Daniel's tap accepts, the other tap is refused | `tests/test_scenario_acceptance.py` |
| Q7 | Declined by proven mail, later an acceptance mail | stays declined, no order, notice without button | `tests/test_scenario_acceptance.py` |
| Q8 | Declined on the phone from the right number | declined, no order | `tests/test_scenario_acceptance.py` |
| Q9 | Declined in the CRM | declined, no subscription | `tests/test_scenario_acceptance.py` |
| Q10 | Phone and mail accept the same quote | one order | `tests/test_scenario_acceptance.py` |
| Q11 | Server worker classifies the same mail again | refused, one order | `tests/test_scenario_acceptance.py` |
| Q12 | Quote mail fails three times, Daniel queues it again, fails again, then sent | two failure notices, one "Mail verschickt", one filed mail | `tests/test_scenario_acceptance.py` |
| O1 | Drafts approved and applied | event once, invoice of the one-off items sent with PDF, review request | `tests/test_scenario_order.py` |
| O2 | Optimisation finds nothing to change | order completed | `tests/test_scenario_order.py` |
| O3 | A change fails, Daniel completes the order by hand, later a new run | one invoice, no error notice | `tests/test_scenario_order.py` |
| O4 | A change must be done by hand and is ticked off | order completed | `tests/test_scenario_order.py` |
| O5 | Every draft rejected | order completed | `tests/test_scenario_order.py` |
| O6 | Company data missing at completion | draft, task, notice; sent after Daniel fills it in | `tests/test_scenario_order.py` |
| O7 | Apply job retried | one event, one invoice | `tests/test_scenario_order.py` |
| O8 | Completed by hand twice after the event | nothing doubled | `tests/test_scenario_order.py` |
| O9 | Order of monthly items only | done, no invoice, review request | `tests/test_scenario_order.py` |
| M1 | Payment in full | paid, no reminder, payment notice | `tests/test_scenario_money.py` |
| M2 | Overdue, daily routine twice, "Senden" tapped twice | one approval, one reminder with PDF | `tests/test_scenario_money.py` |
| M3 | "Nicht senden" | no mail, asked again after seven days | `tests/test_scenario_money.py` |
| M4 | Paid after the notice, then "Senden" | refused, no mail | `tests/test_scenario_money.py` |
| M5 | Part payment, reminders | open rest stated, levels 1–3, then nothing | `tests/test_scenario_money.py` |
| M6 | Monthly invoice, daily routine twice | one invoice, one mail; next month the next | `tests/test_scenario_money.py` |
| M7 | Monthly invoice without company data | draft and notice, sent from the CRM | `tests/test_scenario_money.py` |
| M8 | Subscription cancelled | billed to the end, then inactive, contract ended, no audit | `tests/test_scenario_money.py` |
| M9 | Tax adviser package of the month with a cancellation | invoices, credit note, payments and every invoice PDF | `tests/test_scenario_money.py` |
| M10 | Invoice mail without customer address | draft and task, review request still created | `tests/test_scenario_money.py` |
| S1 | Monthly audit due, tapped on the lock screen, reported twice | run reported with both scores, one notice, customer file | `tests/test_scenario_service.py` |
| S2 | Started in the CRM, old lock screen button tapped | refused with the reason, one audit | `tests/test_scenario_service.py` |
| S3 | Monthly audit failed, "Erneut auslösen" | second audit reported | `tests/test_scenario_service.py` |
| S4 | Daily routine twice on one day | no second invoice, mail, approval, run or notice | `tests/test_scenario_service.py` |
| S5 | Review link missing, then set, reminder | waiting with one notice, request, one reminder, nothing more | `tests/test_scenario_service.py` |
| S6 | Customer objected before | no mail, request cancelled | `tests/test_scenario_service.py` |
| S7 | Customer objected after the request | no reminder | `tests/test_scenario_service.py` |
| S8 | Request ticked off by Daniel | no reminder | `tests/test_scenario_service.py` |
| S9 | One step of the daily routine fails | the others run, one notice per day | `tests/test_scenario_service.py` |
| S10 | Link set while the customer has no address | no more "link missing" notices, request goes out once the address is there | `tests/test_scenario_service.py` |
| F1 | Statement with invoice number and exact open amount | invoice paid on the booking date, no approval | `tests/test_scenario_finance.py` |
| F2 | Same file twice | nothing added, one payment, one expense | `tests/test_scenario_finance.py` |
| F3 | Number with another amount, "Zuordnen" tapped | part payment booked, link to Finanzen | `tests/test_scenario_finance.py` |
| F4 | Amount without number, "Nicht zuordnen" | transaction open, invoice unpaid | `tests/test_scenario_finance.py` |
| F5 | Unknown payment marked as other income | notice "Zahlungseingang ohne Rechnung", counted as income | `tests/test_scenario_finance.py` |
| F6 | Account chosen once for a payee | next expense of that payee gets it by itself | `tests/test_scenario_finance.py` |
| F7 | Private withdrawal | not in the profit | `tests/test_scenario_finance.py` |
| F8 | No IBAN in the settings, statement of another account | refused, nothing stored | `tests/test_scenario_finance.py` |
| F9 | Version 08, entry split into transactions, identical twins | each stored once, second load adds none | `tests/test_scenario_finance.py` |
| F10 | Pending entry, entry in dollars | skipped | `tests/test_scenario_finance.py` |
| F11 | File with DOCTYPE, not CAMT, broken XML | refused | `tests/test_scenario_finance.py` |
| F12 | Overdue with current bank data | reminder sent without approval | `tests/test_scenario_finance.py` |
| F13 | Old bank data, or an unclear payment | approval as before | `tests/test_scenario_finance.py` |
| F14 | Overdue, customer without address | approval instead of failing | `tests/test_scenario_finance.py` |
| F15 | Cash expense with receipt | receipt cannot be removed, amount fixed, account can change | `tests/test_scenario_finance.py` |
| F16 | Profit of two months | equals the count by hand | `tests/test_scenario_finance.py` |
| F17 | Signed-in reader | cannot load a statement or read transactions | `tests/test_scenario_finance.py` |
| F18 | Placeholder reference NONREF on several bookings | each stored, payment booked | `tests/test_scenario_finance.py` |
| F19 | Payment entered by hand, then the statement | linked, counted once | `tests/test_scenario_finance.py` |
| F20 | Suggestion, then a payment by hand | transaction unclear again, can be filed | `tests/test_scenario_finance.py` |
| F21 | Version 08 with amounts directly below the transaction | entry split | `tests/test_scenario_finance.py` |
| F22 | Reversal | notice, no expense until Daniel files it | `tests/test_scenario_finance.py` |
| F23 | Entry without status | skipped | `tests/test_scenario_finance.py` |
| F24 | Same transaction with other spacing | stored once | `tests/test_scenario_finance.py` |
| F25 | Assignment taken back | payment removed, invoice open | `tests/test_scenario_finance.py` |
| F26 | Statements do not cover the due date yet | approval | `tests/test_scenario_finance.py` |
| F27 | Unclear payment, routine twice | one approval, one notice | `tests/test_scenario_finance.py` |
| F28 | Tax and private accounts, payment service | no VAT, nothing learnt | `tests/test_scenario_finance.py` |
| F29 | Account and rate changed | change kept, cannot be removed | `tests/test_scenario_finance.py` |
| F30 | Customer payment taken back | tap in the Cockpit, invoice open, no income | `tests/test_scenario_reversal.py` |
| F31 | New payment after that | invoice paid again | `tests/test_scenario_reversal.py` |
| F32 | Our transfer returned (RRTN, RtrInf) | expense no longer counts | `tests/test_scenario_reversal.py` |
| F33 | "Nicht verrechnen" | both bookings as before | `tests/test_scenario_reversal.py` |
| F34 | No clear booking | notice, Daniel picks on the page | `tests/test_scenario_reversal.py` |
| F35 | Wrong amount, wrong booking, twice, reader | refused | `tests/test_scenario_reversal.py` |
| F36 | Suggestion taken back | no approval left waiting | `tests/test_scenario_reversal.py` |
| F37 | Same receipt saved twice | one receipt | `tests/test_scenario_reversal.py` |
| F38 | File without entry | added by the hourly check | `tests/test_scenario_reversal.py` |
| F39 | File that cannot be added | one notice each | `tests/test_scenario_reversal.py` |
| F40 | Hourly job | scheduled at minute 41 | `tests/test_scenario_reversal.py` |
| F41 | Booking naming only this account | no counterparty | `tests/test_scenario_reversal.py` |
| F42 | Reversal filed on the page | its approval settled | `tests/test_scenario_reversal.py` |
| F43 | Payment by hand while a reversal waits | approval stays | `tests/test_scenario_reversal.py` |
| F44 | Linked payment entered by hand | removed, kept in the customer file | `tests/test_scenario_reversal.py` |
| F45 | Open reversal | reminders not held | `tests/test_scenario_reversal.py` |
| F46 | Asked twice or for a normal booking | nothing changes | `tests/test_scenario_reversal.py` |
| F47 | Return codes of German banks (GVC) and ISO | known as reversal | `tests/test_scenario_reversal.py` |
| K1 | Appointment at a time | kept with its Berlin day, one entry in the customer file | `tests/test_scenario_calendar.py` |
| K2 | Appointment without title | kind and customer name it | `tests/test_scenario_calendar.py` |
| K3 | Unknown kind, no day, wrong duration, unknown customer, reader | refused in plain German | `tests/test_scenario_calendar.py` |
| K4 | Reminder routine before the start, twice | one "Termin um …" notice | `tests/test_scenario_calendar.py` |
| K5 | Cancelled appointment | no reminder | `tests/test_scenario_calendar.py` |
| K6 | Confirmation box ticked or not, without customer or time | mail with appointment only when ticked, refused without customer or time | `tests/test_scenario_calendar.py` |
| K7 | Calendar feed with right and wrong token, signed-in user | appointments only for the right token, closed to signed-in users | `tests/test_scenario_calendar.py` |
| K8 | Caller wants a callback inside business hours | callback at that time, notice "Rückruf gewünscht" | `tests/test_scenario_calendar.py` |
| K9 | Wish on Saturday, in the evening, in the past, 90 days ahead | callback today without time, the note says why | `tests/test_scenario_calendar.py` |
| K10 | Morning brief | starts with today's appointments | `tests/test_scenario_calendar.py` |
| K11 | Customer dismissed | their appointments deleted | `tests/test_scenario_calendar.py` |
| K12 | Callback booked in a call, either order | one appointment, no second task | `tests/test_scenario_calendar.py` |
| N1 | Quote sent five days ago without answer | approval "Nachfass-Mail … senden?", "Senden" queues the mail with opt-out link and header | `tests/test_scenario_follow_up.py` |
| N2 | Twelve days | second reminder, once | `tests/test_scenario_follow_up.py` |
| N3 | "Nicht senden" | that reminder skipped for good | `tests/test_scenario_follow_up.py` |
| N4 | Customer wrote, called or asked since the quote | no reminder | `tests/test_scenario_follow_up.py` |
| N5 | Customer opted out | no reminders, no review requests | `tests/test_scenario_follow_up.py` |
| N6 | Quote decided while a reminder waits | waiting reminder dropped | `tests/test_scenario_follow_up.py` |
| N7 | Quote past its date | set to expired, no reminder | `tests/test_scenario_follow_up.py` |
| N8 | Daily routine | expires and follows up | `tests/test_scenario_follow_up.py` |
| N9 | Opting out from the web or as signed-in user | refused | `tests/test_scenario_follow_up.py` |
| N10 | Customer answers while a reminder waits | question withdrawn, "Senden" sends nothing | `tests/test_scenario_follow_up.py` |
| N11 | First reminder late | the second comes a week later at the earliest | `tests/test_scenario_follow_up.py` |
| N12 | Opting out with mails waiting to be sent | reminder and review mails deleted, others stay | `tests/test_scenario_follow_up.py` |
| H1 | Link markers | the right channel, none without markers | `tests/test_scenario_channel.py` |
| H2 | Web form with markers | channel and campaign on customer and inquiry | `tests/test_scenario_channel.py` |
| H3 | Second inquiry from another channel | customer keeps the first, inquiry its own | `tests/test_scenario_channel.py` |
| H4 | Contact mail with "Anfrage – über …" | channel and campaign from the subject | `tests/test_scenario_channel.py` |
| H5 | Caller's answer on the phone | channel on the customer | `tests/test_scenario_channel.py` |
| H6 | Unknown channel | refused | `tests/test_scenario_channel.py` |
| H7 | Report of a month | inquiries, new customers and payments per channel | `tests/test_scenario_channel.py` |
| H8 | Labels | plain German, "Unbekannt" without channel | `tests/test_scenario_channel.py` |
| H9 | Ordinary subjects with "über", a reply | no channel; "AW: Anfrage – über …" still read | `tests/test_scenario_channel.py` |
| A1 | Typed request | waits, claimed once | `tests/test_scenario_assistant.py` |
| A2 | Spoken request | transcript stored | `tests/test_scenario_assistant.py` |
| A3 | Create contact | created, read back, notice "Assistent: erledigt" | `tests/test_scenario_assistant.py` |
| A4 | Address already known | nothing created, notice "nicht erledigt" | `tests/test_scenario_assistant.py` |
| A5 | Book appointment for a named customer | appointment with origin assistant, read back | `tests/test_scenario_assistant.py` |
| A6 | Two customers fit the name | both named, nothing booked | `tests/test_scenario_assistant.py` |
| A7 | Draft mail | approval, mail only after "Senden" | `tests/test_scenario_assistant.py` |
| A8 | Revenue of a month | income, expenses and profit from the books | `tests/test_scenario_assistant.py` |
| A9 | Unknown task, question back, wrong period | said plainly, nothing done | `tests/test_scenario_assistant.py` |
| A10 | Reader asks, administrator claims, worker fails | refused, refused, failed with the message | `tests/test_scenario_assistant.py` |
| A11 | Recording uploaded, request never stored | named for removal after ten minutes | `tests/test_scenario_assistant.py` |
| A12 | Server never finished a request three times | not done with a German sentence | `tests/test_scenario_assistant.py` |
| A13 | Long drafted mail | whole text in the approval, no lock screen buttons | `tests/test_scenario_assistant.py` |
| A14 | Requests older than 30 days | deleted daily | `tests/test_scenario_assistant.py` |
| T1 | Form loads the free hours | from tomorrow only, all 21 days, business hours, full hours, taken ones missing, cancelled ones not, times only | `tests/test_scenario_audit_request.py` |
| T2 | Request through the form with link markers | customer with channel and campaign, inquiry, no mail, no task, only „Audit-Anfrage“ with three buttons (no „Neuer Kunde“), leading to the message centre | `tests/test_scenario_audit_request.py` |
| T3 | Missing or too short field, e-mail, phone, address for on site, website, lengths, hour not free | refused with a German sentence (P0001), nothing stored | `tests/test_scenario_audit_request.py` |
| T4 | No website, known e-mail address | no „Prüfen“, the same customer, its channel stays | `tests/test_scenario_audit_request.py` |
| T5 | „Bestätigen“ for video | appointment at the wished hour with its own Jitsi link in mail, place and calendar feed, link „Anderen Termin wünschen“ | `tests/test_scenario_audit_request.py` |
| T6 | „Bestätigen“ for phone and on site, hour taken meanwhile | number or address in the mail; taken: refused, no mail | `tests/test_scenario_audit_request.py` |
| T7 | „Anderen Termin vorschlagen“, then „Senden“ | three free hours without the wished one, mail with three links only after „Senden“ | `tests/test_scenario_audit_request.py` |
| T8 | Customer clicks a proposal | booked and confirmed at once, a second click changes nothing, the other links invalid, notice to Daniel | `tests/test_scenario_audit_request.py` |
| T9 | Proposed hour taken meanwhile | clear message, notice as for a new request, the other links stay valid | `tests/test_scenario_audit_request.py` |
| T10 | „Prüfen“ | RadarAuditor audit of the website linked to the CRM customer, remaining buttons sent again, not twice | `tests/test_scenario_audit_request.py` |
| T11 | Day before a confirmed appointment | one reminder with time and number, address or link; none without a sent confirmation | `tests/test_scenario_audit_request.py` |
| T12 | „Anderen Termin wünschen“, booked again | old appointment stays until the new booking, then cancelled; the confirmation names the old one, a mail of its own carries the cancellation as calendar file; the old booking link is invalid; invalid after the appointment | `tests/test_scenario_audit_request.py` |
| T13 | 24 hours without decision | exactly one reminder with the same buttons | `tests/test_scenario_audit_request.py` |
| T14 | List of requests | only those neither booked nor checked, open ones first, newest on top, administrator only | `tests/test_scenario_audit_request.py` |
| T15 | „Senden“, one hour taken meanwhile | new proposals instead of a mail | `tests/test_scenario_audit_request.py` |
| T16 | Schedules | hourly and daily, never on the full or half hour | `tests/test_scenario_audit_request.py` |
| T17 | Proposal link after 48 hours, unknown link, signed-in user | books nothing, clear message, Daniel asked once as for a new request; functions for the service key only | `tests/test_scenario_audit_request.py` |
| T18 | Proposed hours | 48 hours for that business only: not in the form, not in other proposals, not confirmable for others | `tests/test_scenario_audit_request.py` |
| T19 | The same request sent twice (same key) | one request, one notice, „ok“ both times | `tests/test_scenario_audit_request.py` |
| T20 | Whole chain twice, 009 alone, Cockpit 002 alone run again | the audit flow keeps working | `tests/test_scenario_audit_request.py` |

The focused tests of the single steps stay in the other test files.

## Caller check
**Context:** `tests/test_callers.py` reads every database call in the source of the CRM, Cockpit and RadarAuditor apps, the Cockpit service worker, the Edge Functions `crm-mail`, `crm-calendar`, `crm-abmelden`, `crm-termin` and `cockpit-push` and the RadarAuditor repositories. | **Input:** the source and the catalog of the built project. | **Output:** a failing test that names file, line and mismatch: missing function, argument, table, column, embed or conflict key, or a right or row level security policy the caller's role lacks.

## Run

```bash
cd integration
uv sync
uv run pytest
```

PostgreSQL 14 or newer must be installed; the tests look in `REPOCITY_PG_BIN`, then `PATH`, then
`/usr/lib/postgresql/<version>/bin`. PostgreSQL refuses to run as root, so run them as a normal user.
Nothing reaches the Supabase project.

## Migration order

The live project got its migrations in this order, and `src/repocity_integration/project.py`
applies them the same way:

1. RadarAuditor 001–005
2. CRM 001–003
3. Cockpit 001
4. RadarAuditor 006–012
5. RadarAuditor 013 and 014, CRM 004, Cockpit 002
6. CRM 005
7. RadarAuditor 015, Cockpit 003, CRM 006
8. CRM 007, Cockpit 004, CRM 008, Cockpit 005
9. CRM 009, CRM 010, Cockpit 006, CRM 011, CRM 012
10. CRM 013, Cockpit 007

Re-running is safe only for the whole chain from RadarAuditor 013 on, in this order (the list `RERUNNABLE` in `tests/test_project.py`): an older migration on its own puts back older function bodies and rights that the later ones replace.

`sql/supabase_stub.sql` stands in for what Supabase provides before any migration: roles, `auth`,
`storage`, Vault, `pg_net` (every call is recorded in `net.calls`), `pg_cron` and the realtime
publication.
