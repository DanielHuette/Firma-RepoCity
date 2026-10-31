"""Scenarios T1-T20: a business asks for an audit on the website, Daniel decides in the Cockpit.

Context: The form offers only free hours of Daniel's calendar (one hour each, business hours, from
tomorrow for 21 days); a proposed hour stays reserved for its business for 48 hours. The request
lands in the CRM with channel and campaign; the business hears nothing until Daniel taps
„Bestätigen“, „Anderen Termin vorschlagen“ (then „Senden“) or „Prüfen“. A confirmation carries the
calendar file, the place (address, phone number or Jitsi link) and the link „Anderen Termin
wünschen“; a rebooking also cancels the old appointment; the day before, the customer gets a
reminder (migration crm/013_audit_anfragen.sql, buttons in cockpit/007_audit_anfragen.sql). |
Input: the built project. | Output: Assertions on crm.audit_requests, appointments, outbox and
Cockpit.
"""

import re
from datetime import timedelta
from itertools import pairwise
from typing import Any

import psycopg
import pytest
from actors import (
    ask_reschedule,
    audit_form,
    audit_slots,
    book_offer,
    offer_page,
    reschedule_page,
    send_outbox,
    tap,
    web_form,
)
from steps import set_company

from repocity_integration.database import ADMIN, ANON, READER, SERVICE, Database
from repocity_integration.project import migration_sql

EMAIL = "info@baeckerei-korn.de"
JITSI = re.compile(r"https://meet\.jit\.si/RepoCity-[0-9a-f]{32}")
FUNCTIONS = "https://yizvntdwdajlgcbjcves.supabase.co/functions/v1"


def _open_every_day(db: Database) -> None:
    """Business on all seven days, so tomorrow always has free hours, whatever today is."""
    db.run("update crm.settings set business_days = '{1,2,3,4,5,6,7}'")


def _ask(db: Database, kind: str = "video", **fields: Any) -> dict[str, Any]:
    """A request for the first free hour; answers the stored request."""
    _open_every_day(db)
    set_company(db)
    starts_at = fields.pop("starts_at", None) or audit_slots(db, kind)[0]
    assert audit_form(db, kind, starts_at, **fields) == {"ok": True}
    row: dict[str, Any] = db.one(
        "select * from crm.audit_requests order by created_at desc limit 1"
    )
    return row


def _buttons(db: Database, kind: str = "audit-anfrage") -> list[str]:
    actions = db.value(
        "select actions from cockpit.messages where kind = %s order by created_at desc limit 1",
        (kind,),
    )
    return [action["title"] for action in actions]


def _mails(db: Database) -> list[dict[str, Any]]:
    return db.rows(
        "select kind, to_address, subject, body, appointment_id, list_unsubscribe, status "
        "from crm.outbox order by created_at"
    )


def _offers(db: Database) -> list[dict[str, Any]]:
    return db.rows("select token, starts_at, status from crm.audit_offers order by starts_at")


def _propose_and_send(db: Database) -> list[dict[str, Any]]:
    tap(db, "audit-anfrage", "audit_propose")
    tap(db, "audit-vorschlag", "audit_send")
    return [offer for offer in _offers(db) if offer["status"] == "sent"]


def _block(db: Database, starts_at: Any) -> None:
    """Daniel books something else into the hour."""
    db.run(
        "select crm.create_appointment('other', 'Zahnarzt', %s, 60, null, '', '')",
        (starts_at,),
        ADMIN,
    )


def test_t1_the_form_offers_free_hours_from_tomorrow_only(db: Database) -> None:
    _open_every_day(db)
    slots = audit_slots(db, "call")
    tomorrow = db.value("select (now() at time zone 'Europe/Berlin')::date + 1")
    first = db.value("select %s at time zone 'Europe/Berlin'", (slots[0],))

    assert first.date() == tomorrow
    assert first.time().isoformat() == "08:00:00"
    assert len(slots) == 21 * 10
    last = db.value("select %s at time zone 'Europe/Berlin'", (slots[-1],))
    assert last.date() == tomorrow + timedelta(days=20)
    assert slots == sorted(slots)
    assert all(later - earlier >= timedelta(hours=1) for earlier, later in pairwise(slots))
    _block(db, slots[1])
    cancelled = db.value(
        "select id from crm.create_appointment('other', 'Abgesagt', %s, 60, null, '', '')",
        (slots[2],),
        ADMIN,
    )
    db.run("select crm.set_appointment_status(%s, 'cancelled')", (cancelled,), ADMIN)
    free = audit_slots(db, "visit")
    assert slots[1] not in free
    assert slots[2] in free
    columns = db.rows("select * from crm.audit_slots('video') limit 1", caller=ANON)
    assert list(columns[0]) == ["starts_at"]
    with pytest.raises(psycopg.errors.RaiseException, match="vor Ort, am Telefon oder per Video"):
        audit_slots(db, "party")


def test_t1_the_slots_keep_to_business_hours_and_21_days(db: Database) -> None:
    db.run("update crm.settings set business_hours_start = '09:00', business_hours_end = '12:30'")

    local = db.rows(
        "select (starts_at at time zone 'Europe/Berlin') as local from crm.audit_slots('video')",
        caller=ANON,
    )

    days = {row["local"].date() for row in local}
    hours = {row["local"].time().isoformat() for row in local}
    tomorrow = db.value("select (now() at time zone 'Europe/Berlin')::date + 1")
    assert hours == {"09:00:00", "10:00:00", "11:00:00"}
    assert min(days) >= tomorrow
    assert max(days) <= tomorrow + timedelta(days=20)
    assert all(day.isoweekday() <= 5 for day in days)


def test_t2_a_request_creates_customer_inquiry_and_one_cockpit_notice(db: Database) -> None:
    row = _ask(db)

    customer = db.one(
        "select name, contact_person, email, phone, source, channel, campaign from crm.customers"
    )
    assert customer == {
        "name": "Bäckerei Korn",
        "contact_person": "Erika Korn",
        "email": EMAIL,
        "phone": "0251 123456",
        "source": "website",
        "channel": "linkedin",
        "campaign": "sichtbarkeit-muenster",
    }
    inquiry = db.one("select subject, source_channel, campaign, message, status from crm.inquiries")
    assert (inquiry["subject"], inquiry["source_channel"]) == ("Audit anfragen", "linkedin")
    assert "Videogespräch" in inquiry["message"]
    assert (row["status"], row["kind"], row["appointment_id"]) == ("open", "video", None)
    assert _mails(db) == []
    assert db.value("select count(*) from crm.tasks") == 0
    notice = db.one(
        "select title, body, priority, link, action_payload from cockpit.messages "
        "where kind = 'audit-anfrage'"
    )
    assert notice["title"] == "Audit-Anfrage: Bäckerei Korn"
    assert "Erika Korn" in notice["body"] and "Videogespräch" in notice["body"]
    assert notice["priority"] == "wichtig"
    assert notice["link"] == "/"
    assert notice["action_payload"]["request_id"] == str(row["id"])
    assert _buttons(db) == ["Bestätigen", "Anderen Termin vorschlagen", "Prüfen"]
    assert db.value("select count(*) from cockpit.messages where kind = 'kunde'") == 0
    web_form(db, "Max Sonne", "max@cafe-sonne.de")
    assert db.value("select count(*) from cockpit.messages where kind = 'kunde'") == 1


@pytest.mark.parametrize(
    ("fields", "sentence"),
    [
        ({"p_company": " "}, "Bitte geben Sie den Namen Ihres Betriebs an"),
        ({"p_company": "X"}, "Bitte geben Sie den Namen Ihres Betriebs an"),
        ({"p_company": "B" * 201}, "Der Name des Betriebs ist zu lang"),
        ({"p_contact": ""}, "Bitte geben Sie den Namen Ihres Ansprechpartners an"),
        ({"p_contact": "M"}, "Bitte geben Sie den Namen Ihres Ansprechpartners an"),
        ({"p_contact": "M" * 201}, "Der Name des Ansprechpartners ist zu lang"),
        ({"p_email": "erika@"}, "Bitte geben Sie eine gültige E-Mail-Adresse an"),
        ({"p_email": "a" * 190 + "@betrieb-sehr-lang.de"}, "Die E-Mail-Adresse ist zu lang"),
        ({"p_phone": "bitte anrufen"}, "Bitte geben Sie Ihre Telefonnummer an"),
        ({"p_phone": "0251 123 456 789 012 345 678"}, "Bitte geben Sie Ihre Telefonnummer an"),
        ({"p_phone": "0251+123456"}, "Bitte geben Sie Ihre Telefonnummer an"),
        (
            {"p_kind": "visit", "p_address": ""},
            "Für ein Gespräch vor Ort brauchen wir Ihre Anschrift",
        ),
        ({"p_address": "A" * 301}, "Die Anschrift ist zu lang"),
        ({"p_website": "keine webseite"}, "Bitte prüfen Sie die Adresse Ihrer Webseite"),
        ({"p_message": "x" * 5001}, "Ihre Nachricht ist zu lang"),
        ({"p_utm_campaign": "k" * 101}, "Die Angaben im Link sind zu lang"),
    ],
)
def test_t3_wrong_input_is_refused_in_a_sentence_the_customer_understands(
    db: Database, fields: dict[str, Any], sentence: str
) -> None:
    _open_every_day(db)
    slot = audit_slots(db, "video")[0]
    kind = fields.pop("p_kind", "video")

    with pytest.raises(psycopg.errors.RaiseException, match=sentence) as raised:
        audit_form(db, kind, slot, **fields)

    assert raised.value.sqlstate == "P0001"
    assert db.value("select count(*) from crm.audit_requests") == 0
    assert db.value("select count(*) from crm.customers") == 0


def test_t3_only_a_free_hour_from_the_list_is_accepted(db: Database) -> None:
    _open_every_day(db)
    slots = audit_slots(db, "video")
    _block(db, slots[0])

    for starts_at in (slots[0], slots[1] + timedelta(minutes=30), slots[1] - timedelta(days=2)):
        with pytest.raises(psycopg.errors.RaiseException, match="nicht mehr frei"):
            audit_form(db, "video", starts_at)
    with pytest.raises(psycopg.errors.RaiseException, match="Wunschtermin"):
        audit_form(db, "video", None)
    assert audit_form(db, "video", slots[1]) == {"ok": True}


def test_t4_without_website_there_is_no_check_button_and_the_customer_is_reused(
    db: Database,
) -> None:
    _open_every_day(db)
    existing = db.value(
        "insert into crm.customers (name, email, channel) values ('Korn', %s, 'xing') returning id",
        (EMAIL.upper(),),
    )

    _ask(db, "call", p_website="", p_email=EMAIL)

    assert db.value("select count(*) from crm.customers") == 1
    assert db.value("select customer_id from crm.audit_requests") == existing
    assert db.value("select channel from crm.customers") == "xing"
    assert _buttons(db) == ["Bestätigen", "Anderen Termin vorschlagen"]


def test_t5_bestaetigen_books_a_video_call_with_its_own_jitsi_link(db: Database) -> None:
    row = _ask(db)

    answer = tap(db, "audit-anfrage", "audit_confirm")

    assert answer["ok"] is True
    assert answer["text"].startswith("Termin bestätigt: ")
    appointment = db.one("select * from crm.appointments")
    assert (appointment["kind"], appointment["status"]) == ("video", "planned")
    assert appointment["starts_at"] == row["wished_at"]
    assert appointment["ends_at"] - appointment["starts_at"] == timedelta(hours=1)
    assert appointment["title"] == "Videogespräch Bäckerei Korn"
    assert JITSI.fullmatch(appointment["location"])
    mail = _mails(db)[0]
    assert (mail["kind"], mail["to_address"], mail["appointment_id"]) == (
        "appointment",
        EMAIL,
        appointment["id"],
    )
    assert mail["list_unsubscribe"] == ""
    assert appointment["location"] in mail["body"]
    token = db.value("select reschedule_token from crm.audit_requests")
    assert f"{FUNCTIONS}/crm-termin?anders={token}" in mail["body"]
    assert db.value("select status from crm.audit_requests") == "booked"
    assert db.value("select status from crm.inquiries") == "done"
    feed = db.rows(
        "select kind, location from crm.calendar_events((select calendar_token from crm.settings))",
        caller=SERVICE,
    )
    assert feed == [{"kind": "video", "location": appointment["location"]}]
    assert _buttons(db, "audit-termin") == ["Prüfen"]


def test_t5_every_video_appointment_gets_a_link_of_its_own(db: Database) -> None:
    _ask(db)
    tap(db, "audit-anfrage", "audit_confirm")
    second = audit_slots(db, "video")[0]
    _ask(db, p_email="kontakt@cafe-sonne.de", p_company="Café Sonne", starts_at=second)
    tap(db, "audit-anfrage", "audit_confirm")

    links = [row["location"] for row in db.rows("select location from crm.appointments")]

    assert len(set(links)) == 2


@pytest.mark.parametrize(
    ("kind", "place", "label"),
    [
        ("call", "Ich rufe Sie zum Termin unter 0251 123456 an.", "Telefonat"),
        ("visit", "Ort: Ludgeristraße 1, 48143 Münster", "Vor-Ort-Gespräch"),
    ],
)
def test_t6_a_call_names_the_number_a_visit_the_address(
    db: Database, kind: str, place: str, label: str
) -> None:
    _ask(db, kind)

    tap(db, "audit-anfrage", "audit_confirm")

    assert place in _mails(db)[0]["body"]
    assert db.value("select title from crm.appointments") == f"{label} Bäckerei Korn"


def test_t6_bestaetigen_is_refused_when_the_hour_was_taken_meanwhile(db: Database) -> None:
    row = _ask(db)
    _block(db, row["wished_at"])

    answer = tap(db, "audit-anfrage", "audit_confirm")

    assert answer["ok"] is False
    assert "nicht mehr frei" in answer["text"]
    assert db.value("select count(*) from crm.outbox") == 0
    assert tap(db, "audit-anfrage", "audit_propose")["ok"] is True


def test_t7_vorschlagen_shows_three_hours_and_mails_only_after_senden(db: Database) -> None:
    row = _ask(db)
    free = audit_slots(db, "video")

    answer = tap(db, "audit-anfrage", "audit_propose")

    drafts = _offers(db)
    assert answer["ok"] is True
    assert [offer["status"] for offer in drafts] == ["draft"] * 3
    assert free[0] == row["wished_at"]
    assert [offer["starts_at"] for offer in drafts] == free[1:4]
    notice = db.one(
        "select title, body, actions, action_payload from cockpit.messages "
        "where kind = 'audit-vorschlag'"
    )
    assert notice["title"] == "Vorschlag für Bäckerei Korn"
    assert notice["body"].count(" Uhr") == 3
    assert [action["title"] for action in notice["actions"]] == ["Senden", "Prüfen"]
    assert _mails(db) == []

    assert tap(db, "audit-vorschlag", "audit_send")["ok"] is True

    mail = _mails(db)[0]
    assert (mail["kind"], mail["to_address"], mail["list_unsubscribe"]) == (
        "audit_proposal",
        EMAIL,
        "",
    )
    for offer in _offers(db):
        assert offer["status"] == "sent"
        assert f"{FUNCTIONS}/crm-termin?buchen={offer['token']}" in mail["body"]
    assert db.value("select status from crm.audit_requests") == "proposed"
    assert db.value("select count(*) from crm.appointments") == 0


def test_t8_a_click_on_a_proposal_books_it_at_once(db: Database) -> None:
    _ask(db)
    offers = _propose_and_send(db)
    chosen = offers[1]

    page = offer_page(db, chosen["token"])
    assert page["state"] == "open"
    assert page["kind"] == "video"
    assert db.value("select count(*) from crm.appointments") == 0

    assert book_offer(db, chosen["token"])["result"] == "booked"
    assert book_offer(db, chosen["token"])["result"] == "booked"

    appointment = db.one("select starts_at, location from crm.appointments")
    assert appointment["starts_at"] == chosen["starts_at"]
    confirmation = [mail for mail in _mails(db) if mail["kind"] == "appointment"]
    assert len(confirmation) == 1
    assert appointment["location"] in confirmation[0]["body"]
    assert [offer["status"] for offer in _offers(db)] == ["void", "booked", "void"]
    assert offer_page(db, offers[0]["token"])["state"] == "invalid"
    assert book_offer(db, offers[0]["token"])["result"] == "invalid"
    assert offer_page(db, chosen["token"])["state"] == "booked"
    assert db.value("select title from cockpit.messages where kind = 'audit-termin'") == (
        "Termin gebucht: Bäckerei Korn"
    )


def test_t9_a_proposal_taken_meanwhile_tells_the_customer_and_asks_daniel_again(
    db: Database,
) -> None:
    _ask(db)
    offers = _propose_and_send(db)
    _block(db, offers[0]["starts_at"])

    assert book_offer(db, offers[0]["token"]) == {"result": "taken"}

    assert db.value("select status from crm.audit_requests") == "open"
    assert db.value("select count(*) from crm.outbox where kind = 'appointment'") == 0
    notice = db.one(
        "select title, actions from cockpit.messages where kind = 'audit-anfrage' "
        "order by created_at desc limit 1"
    )
    assert notice["title"] == "Wunschzeit belegt: Bäckerei Korn"
    assert "Anderen Termin vorschlagen" in [action["title"] for action in notice["actions"]]
    assert book_offer(db, offers[1]["token"])["result"] == "booked"


def test_t10_pruefen_starts_the_radarauditor_audit_of_the_website(db: Database) -> None:
    row = _ask(db, "visit")

    answer = tap(db, "audit-anfrage", "audit_check")

    assert answer == {"ok": True, "text": "Prüfung von baeckerei-korn.de gestartet."}
    audit = db.one(
        "select a.id, a.purpose, c.website, c.city, c.crm_customer_id from public.audits a "
        "join public.customers c on c.id = a.customer_id"
    )
    assert audit["purpose"] == "sales"
    assert audit["website"] == "https://baeckerei-korn.de"
    assert audit["city"] == "Münster"
    assert audit["crm_customer_id"] == row["customer_id"]
    assert db.value("select audit_id from crm.audit_requests") == audit["id"]
    assert db.value("select count(*) from public.jobs where kind = 'collect'") == 1
    assert _buttons(db) == ["Bestätigen", "Anderen Termin vorschlagen"]
    assert tap(db, "audit-anfrage", "audit_confirm")["ok"] is True
    with pytest.raises(psycopg.errors.RaiseException, match="läuft schon"):
        db.run("select crm.check_audit_website(%s)", (row["id"],), SERVICE)


def test_t11_the_customer_is_reminded_the_day_before_once(db: Database) -> None:
    _ask(db, "call")
    tap(db, "audit-anfrage", "audit_confirm")
    send_outbox(db)
    unconfirmed = audit_slots(db, "visit")[0]
    db.run(
        "select crm.create_appointment('visit', 'Ohne Bestätigung', %s, 60, "
        "(select id from crm.customers), 'Hof 1', '')",
        (unconfirmed,),
        ADMIN,
    )

    first = db.value("select crm.send_appointment_reminders()", caller=SERVICE)
    second = db.value("select crm.send_appointment_reminders()", caller=SERVICE)

    assert (first, second) == (1, 0)
    reminder = [mail for mail in _mails(db) if mail["kind"] == "appointment_reminder"]
    assert len(reminder) == 1
    assert reminder[0]["subject"].startswith("Erinnerung an unseren Termin morgen")
    assert "Ich rufe Sie zum Termin unter 0251 123456 an." in reminder[0]["body"]
    assert re.search(r"\d\d:\d\d Uhr", reminder[0]["body"])
    assert "ich freue mich auf unser Telefonat morgen, " in reminder[0]["body"]


def test_t11_the_reminder_of_another_appointment_reads_naturally(db: Database) -> None:
    set_company(db)
    customer = db.value(
        "insert into crm.customers (name, email) values ('Alt', 'alt@example.de') returning id"
    )
    at = db.value(
        "select ((now() at time zone 'Europe/Berlin')::date + 1 + time '10:00') "
        "at time zone 'Europe/Berlin'"
    )
    db.run(
        "select crm.create_appointment('other', 'Besprechung', %s, 60, %s, '', '', true)",
        (at, customer),
        ADMIN,
    )
    db.run("update crm.outbox set status = 'sent'")

    assert db.value("select crm.send_appointment_reminders()", caller=SERVICE) == 1

    body = db.value("select body from crm.outbox where kind = 'appointment_reminder'")
    assert "ich freue mich auf unseren Termin morgen, " in body
    assert "(Termin)" not in body
    assert "Ort: nach Absprache" in body


def test_t11_no_reminder_when_the_confirmation_did_not_go_out(db: Database) -> None:
    _ask(db, "visit")
    tap(db, "audit-anfrage", "audit_confirm")

    assert db.value("select crm.send_appointment_reminders()", caller=SERVICE) == 0
    db.run("update crm.outbox set status = 'failed'")
    assert db.value("select crm.send_appointment_reminders()", caller=SERVICE) == 0


def test_t12_anderen_termin_wuenschen_keeps_the_old_one_until_a_new_one_is_booked(
    db: Database,
) -> None:
    _ask(db)
    tap(db, "audit-anfrage", "audit_confirm")
    token = db.value("select reschedule_token from crm.audit_requests")
    old = db.one("select id, starts_at from crm.appointments")

    assert reschedule_page(db, token)["state"] == "open"
    assert ask_reschedule(db, token) == {"result": "requested"}
    assert ask_reschedule(db, token) == {"result": "already"}

    assert db.value("select status from crm.appointments") == "planned"
    assert db.value(
        "select title from cockpit.messages where kind = 'audit-anfrage' "
        "order by created_at desc limit 1"
    ) == ("Anderer Termin gewünscht: Bäckerei Korn")
    assert _buttons(db) == ["Anderen Termin vorschlagen", "Prüfen"]
    offers = _propose_and_send(db)
    assert old["starts_at"] not in [offer["starts_at"] for offer in offers]
    assert book_offer(db, offers[2]["token"])["result"] == "booked"

    statuses = db.rows("select id, status from crm.appointments order by created_at")
    assert [row["status"] for row in statuses] == ["cancelled", "planned"]
    assert statuses[0]["id"] == old["id"]
    assert db.value("select status from crm.audit_requests") == "booked"
    assert reschedule_page(db, token)["state"] == "open"
    new_mails = _mails(db)[1:]
    cancel = next(mail for mail in new_mails if mail["kind"] == "appointment_cancel")
    rebooked = next(mail for mail in new_mails if mail["kind"] == "appointment")
    assert cancel["appointment_id"] == old["id"]
    assert cancel["subject"].startswith("Absage: Termin ")
    assert rebooked["appointment_id"] == statuses[1]["id"]
    assert rebooked["subject"].startswith("Terminänderung: neuer Termin ")
    assert "Ihr bisheriger Termin am " in rebooked["body"]
    assert " entfällt" in rebooked["body"]
    assert f"{FUNCTIONS}/crm-termin?anders={token}" in rebooked["body"]


def test_t12_an_old_booked_link_says_it_was_replaced_after_rebooking(db: Database) -> None:
    _ask(db)
    first = _propose_and_send(db)[0]
    assert book_offer(db, first["token"])["result"] == "booked"
    ask_reschedule(db, db.value("select reschedule_token from crm.audit_requests"))
    second = _propose_and_send(db)[0]

    assert book_offer(db, second["token"])["result"] == "booked"

    assert offer_page(db, first["token"]) == {"state": "invalid"}
    assert book_offer(db, first["token"]) == {"result": "invalid"}
    assert offer_page(db, second["token"])["state"] == "booked"
    assert db.value("select count(*) from crm.appointments where status = 'planned'") == 1


def test_t12_the_reschedule_link_ends_with_the_appointment(db: Database) -> None:
    _ask(db)
    tap(db, "audit-anfrage", "audit_confirm")
    token = db.value("select reschedule_token from crm.audit_requests")
    db.run(
        "set session_replication_role = replica; update crm.appointments set "
        "starts_at = now() - interval '2 hours', ends_at = now() - interval '1 hour', "
        "starts_on = ((now() - interval '2 hours') at time zone 'Europe/Berlin')::date; "
        "set session_replication_role = origin"
    )

    assert reschedule_page(db, token) == {"state": "invalid"}
    assert ask_reschedule(db, token) == {"result": "invalid"}
    assert ask_reschedule(db, "00000000-0000-4000-8000-000000000000") == {"result": "invalid"}


def test_t13_after_24_hours_without_decision_daniel_is_reminded_exactly_once(
    db: Database,
) -> None:
    _ask(db)
    assert db.value("select crm.remind_audit_requests()", caller=SERVICE) == 0
    db.run("update crm.audit_requests set asked_at = now() - interval '25 hours'")

    first = db.value("select crm.remind_audit_requests()", caller=SERVICE)
    second = db.value("select crm.remind_audit_requests()", caller=SERVICE)

    assert (first, second) == (1, 0)
    reminder = db.one(
        "select title, priority, actions from cockpit.messages "
        "where title like 'Seit einem Tag offen%%'"
    )
    assert reminder["title"] == "Seit einem Tag offen: Bäckerei Korn"
    assert reminder["priority"] == "wichtig"
    assert len(reminder["actions"]) == 3
    tap(db, "audit-anfrage", "audit_confirm")
    db.run("update crm.audit_requests set asked_at = now() - interval '3 days'")
    assert db.value("select crm.remind_audit_requests()", caller=SERVICE) == 0


def test_t14_the_list_shows_open_requests_first_to_the_administrator_only(
    db: Database,
) -> None:
    _ask(db)
    tap(db, "audit-anfrage", "audit_confirm")
    _ask(db, "call", p_email="kontakt@cafe-sonne.de", p_company="Café Sonne", p_website="")
    tap(db, "audit-anfrage", "audit_propose")
    tap(db, "audit-vorschlag", "audit_send")
    _ask(db, "call", p_email="post@laden-am-dom.de", p_company="Laden am Dom", p_website="dom.de")
    tap(db, "audit-anfrage", "audit_check")
    _ask(db, "visit", p_email="hallo@hof-mueller.de", p_company="Hof Müller", p_website="hof.de")

    rows = db.rows("select * from crm.open_audit_requests()", caller=ADMIN)

    assert [(row["company"], row["status"]) for row in rows] == [
        ("Hof Müller", "open"),
        ("Café Sonne", "proposed"),
    ]
    assert list(rows[0]) == [
        "id",
        "customer_id",
        "company",
        "contact",
        "website",
        "kind",
        "wished_at",
        "status",
        "created_at",
    ]
    with pytest.raises(psycopg.errors.RaiseException, match="Administrator"):
        db.rows("select * from crm.open_audit_requests()", caller=READER)
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        db.rows("select * from crm.open_audit_requests()", caller=ANON)
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        db.rows("select * from crm.audit_requests", caller=ANON)


def test_t15_senden_with_an_hour_taken_meanwhile_brings_new_proposals(db: Database) -> None:
    _ask(db)
    tap(db, "audit-anfrage", "audit_propose")
    first = _offers(db)
    _block(db, first[1]["starts_at"])

    answer = tap(db, "audit-vorschlag", "audit_send")

    assert answer["ok"] is True
    assert "inzwischen belegt" in answer["text"]
    assert _mails(db) == []
    drafts = [offer for offer in _offers(db) if offer["status"] == "draft"]
    assert first[1]["starts_at"] not in [offer["starts_at"] for offer in drafts]
    assert len(drafts) == 3
    assert tap(db, "audit-vorschlag", "audit_send")["ok"] is True
    assert db.value("select count(*) from crm.outbox where kind = 'audit_proposal'") == 1


def test_t16_the_daily_and_hourly_runs_are_scheduled_off_the_full_and_half_hour(
    db: Database,
) -> None:
    jobs = db.rows(
        "select jobname, schedule, command from cron.job "
        "where jobname in ('crm-audit-requests', 'crm-appointment-reminders') order by jobname"
    )

    assert [(job["jobname"], job["command"].strip()) for job in jobs] == [
        ("crm-appointment-reminders", "select crm.send_appointment_reminders();"),
        ("crm-audit-requests", "select crm.remind_audit_requests();"),
    ]
    for job in jobs:
        minute = int(job["schedule"].split()[0])
        assert minute not in (0, 30)
    assert jobs[0]["schedule"].split()[1].isdigit()
    assert jobs[1]["schedule"].split()[1] == "*"


def test_t17_after_48_hours_a_proposal_link_books_nothing_and_asks_daniel_once(
    db: Database,
) -> None:
    _ask(db)
    offers = _propose_and_send(db)
    db.run("update crm.audit_offers set sent_at = now() - interval '49 hours'")

    page = offer_page(db, offers[0]["token"])
    assert (page["state"], page["kind"]) == ("expired", "video")
    assert (
        db.value("select count(*) from cockpit.messages where title like 'Vorschlag abgelaufen%%'")
        == 0
    )
    assert book_offer(db, offers[0]["token"]) == {"result": "expired"}
    assert book_offer(db, offers[0]["token"]) == {"result": "expired"}

    notices = db.rows(
        "select kind, actions from cockpit.messages "
        "where title = 'Vorschlag abgelaufen: Bäckerei Korn'"
    )
    assert len(notices) == 1
    assert notices[0]["kind"] == "audit-anfrage"
    assert "Anderen Termin vorschlagen" in [action["title"] for action in notices[0]["actions"]]
    assert db.value("select status from crm.audit_requests") == "open"
    assert book_offer(db, "00000000-0000-4000-8000-000000000000") == {"result": "invalid"}
    assert db.value("select count(*) from crm.appointments") == 0
    for call in (
        "crm.book_audit_offer(gen_random_uuid())",
        "crm.confirm_audit_request(gen_random_uuid())",
    ):
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            db.run(f"select {call}".encode(), caller=ADMIN)


def test_t18_proposed_hours_stay_reserved_for_48_hours_for_that_business(db: Database) -> None:
    _ask(db)
    reserved = [offer["starts_at"] for offer in _propose_and_send(db)]
    free = audit_slots(db, "video")
    assert not set(reserved) & set(free)
    with pytest.raises(psycopg.errors.RaiseException, match="nicht mehr frei"):
        audit_form(db, "video", reserved[0], p_email="kontakt@cafe-sonne.de")
    _ask(db, "call", p_email="kontakt@cafe-sonne.de", p_company="Café Sonne")
    tap(db, "audit-anfrage", "audit_propose")
    sonne = db.rows(
        "select o.starts_at from crm.audit_offers o "
        "join crm.audit_requests r on r.id = o.request_id where r.company = 'Café Sonne'"
    )
    assert not set(reserved) & {offer["starts_at"] for offer in sonne}

    db.run(
        "update crm.audit_offers set sent_at = now() - interval '49 hours' where status = 'sent'"
    )

    assert reserved[0] in audit_slots(db, "video")


def test_t18_bestaetigen_refuses_a_wish_reserved_for_another_business(db: Database) -> None:
    _open_every_day(db)
    set_company(db)
    wish = audit_slots(db, "video")[0]
    audit_form(db, "video", wish, p_email="kontakt@cafe-sonne.de", p_company="Café Sonne")
    _ask(db, "video", starts_at=audit_slots(db, "video")[1])
    tap(db, "audit-anfrage", "audit_propose")
    tap(db, "audit-vorschlag", "audit_send")
    assert wish in [offer["starts_at"] for offer in _offers(db)]

    answer = tap(db, "audit-anfrage", "audit_confirm", newest=False)

    assert answer["ok"] is False
    assert "nicht mehr frei" in answer["text"]


def test_t19_the_same_request_sent_twice_is_stored_once(db: Database) -> None:
    _open_every_day(db)
    slot = audit_slots(db, "video")[0]
    key = "6c4b8f7e-1d2a-4e3b-9c5d-7a8b9c0d1e2f"

    assert audit_form(db, "video", slot, p_request_key=key) == {"ok": True}
    assert audit_form(db, "video", slot, p_request_key=key) == {"ok": True}

    assert db.value("select count(*) from crm.audit_requests") == 1
    assert db.value("select count(*) from crm.inquiries") == 1
    assert db.value("select count(*) from cockpit.messages where kind = 'audit-anfrage'") == 1
    assert audit_form(db, "video", slot) == {"ok": True}
    assert db.value("select count(*) from crm.audit_requests") == 2


RERUN_ALONE = [
    "crm/supabase/migrations/009_kalender.sql",
    "cockpit/supabase/migrations/002_actions.sql",
]


def _full_chain() -> list[str]:
    from test_project import RERUNNABLE

    return list(RERUNNABLE)


@pytest.mark.parametrize("paths", [_full_chain() * 2, RERUN_ALONE[:1], RERUN_ALONE[1:]])
def test_t20_running_migrations_again_keeps_the_audit_flow(db: Database, paths: list[str]) -> None:
    _ask(db)
    tap(db, "audit-anfrage", "audit_confirm")

    for path in paths:
        db.run(migration_sql(path).encode())

    _ask(db, p_email="kontakt@cafe-sonne.de", p_company="Café Sonne")
    assert _buttons(db) == ["Bestätigen", "Anderen Termin vorschlagen", "Prüfen"]
    assert tap(db, "audit-anfrage", "audit_confirm")["ok"] is True
    assert db.value("select count(*) from crm.appointments where kind = 'video'") == 2
    overview = db.value("select crm.today_overview()", caller=ADMIN)
    assert "appointments_today_items" in overview
    assert db.value("select count(*) from cockpit.messages where kind = 'kunde'") == 0
