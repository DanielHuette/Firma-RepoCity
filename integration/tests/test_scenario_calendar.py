"""Scenarios K1-K10: appointments, reminders, the calendar feed and callbacks asked for by phone.

Context: Daniel keeps on-site meetings, callbacks and calls in the CRM calendar; the Cockpit lists
the day's appointments in the morning and pushes a reminder before each one; a customer may get a
confirmation mail with the appointment as a calendar file; the phone assistant books a callback at
the time the caller names when it lies in the business hours (migration crm/009_kalender.sql). |
Input: customers from steps.py. | Output: Assertions on crm.appointments, outbox and Cockpit.
"""

from datetime import date, timedelta
from typing import Any

import psycopg
import pytest
from steps import CUSTOMER_EMAIL, audited_customer

from repocity_integration.database import ADMIN, READER, SERVICE, Database

# The next working day (Monday to Friday) at a Berlin time, as the database sees it.
NEXT_WORKDAY = (
    "(select d from generate_series(current_date + 1, current_date + 7, interval '1 day') d "
    "where extract(isodow from d) between 1 and 5 order by d limit 1)::date"
)
NEXT_SATURDAY = (
    "(select d from generate_series(current_date + 1, current_date + 7, interval '1 day') d "
    "where extract(isodow from d) = 6 limit 1)::date"
)


def berlin(day_sql: str, clock: str) -> str:
    return f"(({day_sql} + time '{clock}') at time zone 'Europe/Berlin')"


def create(db: Database, caller: Any = ADMIN, **kw: Any) -> dict[str, Any]:
    """crm.create_appointment as the calendar page calls it; starts_at as SQL."""
    starts_at = kw.pop("starts_at", berlin(NEXT_WORKDAY, "10:00"))
    params = {
        "p_kind": "visit",
        "p_title": "Erstgespräch",
        "p_duration": 60,
        "p_customer": None,
        "p_location": "Ludgeristraße 1, Münster",
        "p_note": "",
        "p_confirm": False,
        **kw,
    }
    names = ", ".join(f"{key} => %({key})s" for key in params)
    row: dict[str, Any] = db.one(
        f"select * from crm.create_appointment(p_starts_at => {starts_at}, {names})".encode(),
        params,
        caller,
    )
    return row


def test_k1_an_appointment_is_kept_with_its_berlin_day(db: Database) -> None:
    customer = audited_customer(db)

    row = create(db, p_customer=customer)

    assert row["kind"] == "visit"
    assert row["status"] == "planned"
    assert row["origin"] == "person"
    assert row["starts_on"] == db.value(f"select {NEXT_WORKDAY}")
    assert row["ends_at"] - row["starts_at"] == db.value("select interval '60 minutes'")
    assert (
        db.value(
            "select count(*) from crm.activities where customer_id = %s and body like 'Termin%%'",
            (customer,),
        )
        == 1
    )


def test_k2_without_title_the_kind_and_customer_name_it(db: Database) -> None:
    customer = audited_customer(db)

    row = create(db, p_customer=customer, p_title="", p_kind="callback")

    assert row["title"] == "Rückruf Bäckerei Korn"


def test_k3_wrong_input_is_refused_in_plain_german(db: Database) -> None:
    with pytest.raises(psycopg.errors.RaiseException, match="Dauer"):
        create(db, p_duration=0)
    with pytest.raises(psycopg.errors.RaiseException, match="Art"):
        create(db, p_kind="party")
    with pytest.raises(psycopg.errors.RaiseException, match="Administrator"):
        create(db, caller=READER)
    row = create(db)
    for call in (
        "crm.confirm_appointment(%s)",
        "crm.book_appointment('call', '', now(), null, 15, null, '', '', %s)",
    ):
        with pytest.raises(psycopg.errors.RaiseException, match="Administrator"):
            db.run(f"select {call}", (row["id"] if "confirm" in call else "person",), READER)


def test_k4_the_reminder_comes_once_before_the_start(db: Database) -> None:
    create(db, starts_at="(now() + interval '30 minutes')", p_title="Rückruf Korn")
    create(db, starts_at="(now() + interval '3 hours')", p_title="Später")

    first = db.value("select crm.remind_appointments()", caller=SERVICE)
    second = db.value("select crm.remind_appointments()", caller=SERVICE)

    assert (first, second) == (1, 0)
    notice = db.one("select title, priority, link from cockpit.messages where kind = 'termin'")
    assert notice["title"].startswith("Termin um ")
    assert notice["title"].endswith(": Rückruf Korn")
    assert notice["link"] == "https://crm.speedofthespirit.dev/kalender"


def test_k5_a_cancelled_appointment_is_not_reminded(db: Database) -> None:
    row = create(db, starts_at="(now() + interval '30 minutes')")

    db.run("select crm.set_appointment_status(%s, 'cancelled')", (row["id"],), ADMIN)

    assert db.value("select crm.remind_appointments()", caller=SERVICE) == 0
    with pytest.raises(psycopg.errors.RaiseException, match="Status"):
        db.run("select crm.set_appointment_status(%s, 'later')", (row["id"],), ADMIN)


def test_k6_a_confirmation_goes_out_only_when_asked_for(db: Database) -> None:
    customer = audited_customer(db)

    create(db, p_customer=customer)
    row = create(db, p_customer=customer, p_confirm=True)

    mail = db.one("select kind, to_address, subject, body, appointment_id from crm.outbox")
    assert mail["kind"] == "appointment"
    assert mail["to_address"] == CUSTOMER_EMAIL
    assert mail["appointment_id"] == row["id"]
    assert mail["subject"].startswith("Terminbestätigung")
    assert "Ludgeristraße 1, Münster" in mail["body"]
    with pytest.raises(psycopg.errors.RaiseException, match="ohne Kunde"):
        create(db, p_confirm=True)
    with pytest.raises(psycopg.errors.RaiseException, match="braucht eine Uhrzeit"):
        create(
            db,
            starts_at="null",
            p_starts_on=date.today() + timedelta(days=1),
            p_customer=customer,
            p_confirm=True,
        )
    assert db.value("select count(*) from crm.outbox") == 1


def test_k7_the_feed_shows_planned_appointments_to_the_right_token_only(db: Database) -> None:
    create(db, p_title="Erstgespräch")
    gone = create(db, p_title="Abgesagt")
    db.run("select crm.set_appointment_status(%s, 'cancelled')", (gone["id"],), ADMIN)
    token = db.value("select calendar_token from crm.settings")

    events = db.rows("select title from crm.calendar_events(%s)", (token,), SERVICE)
    stranger = db.rows("select title from crm.calendar_events(gen_random_uuid())", caller=SERVICE)

    assert [event["title"] for event in events] == ["Erstgespräch"]
    assert stranger == []
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        db.run("select crm.calendar_events(%s)", (token,), ADMIN)


def test_k8_a_callback_lands_at_the_wished_time_inside_business_hours(db: Database) -> None:
    db.value(
        "select crm.callback_from_call('+49 251 1234567', 'Erika Korn', 'Frage zum Angebot', "
        f"{berlin(NEXT_WORKDAY, '10:00')})",
        caller=SERVICE,
    )

    row = db.one("select kind, origin, starts_at, title, note from crm.appointments")
    assert (row["kind"], row["origin"]) == ("callback", "phone")
    assert row["starts_at"] == db.value(f"select {berlin(NEXT_WORKDAY, '10:00')}")
    assert row["note"] == "Frage zum Angebot · Rufnummer +49 251 1234567"
    assert db.value("select title from cockpit.messages where kind = 'termin'") == (
        "Rückruf gewünscht: Erika Korn"
    )


@pytest.mark.parametrize(
    ("wished", "why"),
    [
        (berlin(NEXT_SATURDAY, "10:00"), "lag außerhalb der Geschäftszeiten"),
        (berlin(NEXT_WORKDAY, "21:00"), "lag außerhalb der Geschäftszeiten"),
        ("(now() - interval '1 hour')", "lag in der Vergangenheit"),
        ("(now() + interval '90 days')", "lag mehr als 60 Tage voraus"),
    ],
)
def test_k9_a_wish_that_does_not_fit_becomes_a_callback_today(
    db: Database, wished: str, why: str
) -> None:
    db.value(
        f"select crm.callback_from_call('+49 251 1234567', 'Erika Korn', 'Rückruf', {wished})",
        caller=SERVICE,
    )

    row = db.one("select starts_at, starts_on, note from crm.appointments")
    assert row["starts_at"] is None
    assert row["starts_on"] == db.value("select (now() at time zone 'Europe/Berlin')::date")
    assert f"Gewünschte Zeit {why}: " in row["note"]


def test_k10_the_morning_brief_names_todays_appointments(db: Database) -> None:
    create(db, starts_at="(now() + interval '1 minute')", p_title="Rückruf Korn")

    db.run("select cockpit.daily_brief()", caller=SERVICE)

    body: str = db.value("select body from cockpit.messages where kind = 'tagesueberblick'")
    assert body.startswith("1 Termin heute: ")
    assert body.split(" · ")[0].endswith(" Rückruf Korn")


def test_k11_dismissing_a_customer_removes_their_appointments(db: Database) -> None:
    customer = audited_customer(db)
    create(db, p_customer=customer)
    create(db, p_title="Ohne Kunde")

    db.run("select crm.dismiss_customer(%s)", (customer,), ADMIN)

    assert [row["title"] for row in db.rows("select title from crm.appointments")] == ["Ohne Kunde"]


@pytest.mark.parametrize("callback_first", [False, True])
def test_k12_a_booked_callback_is_not_a_second_task(db: Database, callback_first: bool) -> None:
    line = "'+49 251 1234567', 'Erika Korn'"
    intake = f"select crm.intake_call({line}, '', '', 'Rückruf', 'Bitte anrufen')"
    wished = berlin(NEXT_WORKDAY, "10:00")
    callback = f"select crm.callback_from_call({line}, 'Frage', {wished})"
    for statement in [callback, intake] if callback_first else [intake, callback]:
        db.run(statement, caller=SERVICE)

    assert db.value("select count(*) from crm.tasks") == 0
    assert db.value("select count(*) from crm.appointments where kind = 'callback'") == 1
