"""Scenarios A1-A10: the assistant in the Cockpit, by text or by voice.

Context: Daniel types or speaks a request in the Cockpit; the server worker turns speech into text
(faster-whisper), lets Claude Code read the request as one of four fixed tasks and hands that back;
the database carries it out with its own checks, reads back what it stored and reports it on the
lock screen; a mail goes out only after "Senden" (migration crm/012_assistent.sql). | Input:
requests as the Cockpit stores them, intents as the worker hands them back. | Output: Assertions on
crm.assistant_requests, customers, appointments, approvals, outbox and Cockpit.
"""

from typing import Any

import psycopg
import pytest
from psycopg.types.json import Jsonb
from steps import CUSTOMER_EMAIL, audited_customer

from repocity_integration.database import ADMIN, READER, SERVICE, Database

AUDIO = "anfragen/3f2b8c1e-0000-4000-8000-000000000001.wav"
ORPHAN = "anfragen/00000000-0000-4000-8000-0000000000a1.wav"
FRESH = "anfragen/00000000-0000-4000-8000-0000000000a2.wav"


def ask(db: Database, text: str | None = "Leg Erika Korn an", audio: str | None = None) -> str:
    request: str = db.value("select (crm.ask_assistant(%s, %s)).id", (text, audio), ADMIN)
    return request


def claim(db: Database) -> dict[str, Any] | None:
    rows = db.rows("select * from crm.claim_assistant_request()", caller=SERVICE)
    return rows[0] if rows else None


def apply(db: Database, request: str, intent: dict[str, Any]) -> dict[str, Any]:
    result: dict[str, Any] = db.value(
        "select crm.apply_assistant_intent(%s, %s::jsonb)",
        (request, Jsonb(intent)),
        SERVICE,
    )
    return result


def notice(db: Database) -> dict[str, Any]:
    row: dict[str, Any] = db.one(
        "select title, body from cockpit.messages where kind = 'assistent' "
        "order by created_at desc limit 1"
    )
    return row


def test_a1_a_typed_request_waits_for_the_worker(db: Database) -> None:
    request = ask(db, "Wie viel Umsatz hatte ich im Oktober?")

    claimed = claim(db)

    assert claimed is not None
    assert (claimed["id"], claimed["status"], claimed["text"]) == (
        request,
        "claimed",
        "Wie viel Umsatz hatte ich im Oktober?",
    )
    assert claim(db) is None


def test_a2_a_spoken_request_gets_its_transcript(db: Database) -> None:
    request = ask(db, None, AUDIO)
    claimed = claim(db)
    assert claimed is not None and claimed["audio_path"] == AUDIO

    db.run("select crm.save_assistant_transcript(%s, 'Leg Erika Korn an')", (request,), SERVICE)

    assert db.value("select text from crm.assistant_requests") == "Leg Erika Korn an"


def test_a3_a_contact_is_created_and_read_back(db: Database) -> None:
    request = ask(db)
    claim(db)

    result = apply(
        db,
        request,
        {
            "action": "create_contact",
            "name": "Erika Korn",
            "company": "Bäckerei Korn",
            "email": "Erika@Korn.de",
            "phone": "0251 123",
        },
    )

    assert result["ok"] is True
    assert (
        result["text"] == "Kontakt angelegt: Bäckerei Korn (Erika Korn), erika@korn.de, 0251 123."
    )
    customer = db.one("select name, contact_person, email, source from crm.customers")
    assert customer == {
        "name": "Bäckerei Korn",
        "contact_person": "Erika Korn",
        "email": "erika@korn.de",
        "source": "agent",
    }
    assert db.value("select status from crm.assistant_requests") == "done"
    assert notice(db) == {"title": "Assistent: erledigt", "body": result["text"]}


def test_a4_a_known_address_is_not_created_twice(db: Database) -> None:
    audited_customer(db)
    request = ask(db)
    claim(db)

    result = apply(db, request, {"action": "create_contact", "name": "X", "email": CUSTOMER_EMAIL})

    assert result == {
        "ok": False,
        "text": f"Die Adresse {CUSTOMER_EMAIL} gehört schon zu Bäckerei Korn; nichts angelegt.",
    }
    assert db.value("select status from crm.assistant_requests") == "failed"
    assert notice(db)["title"] == "Assistent: nicht erledigt"


def test_a5_an_appointment_is_booked_for_the_named_customer(db: Database) -> None:
    customer = audited_customer(db)
    request = ask(db, "Termin morgen 10 Uhr bei Bäckerei Korn")
    claim(db)
    starts_at = db.value(
        "select to_char(((current_date + 1) + time '10:00') at time zone 'Europe/Berlin', "
        "'YYYY-MM-DD\"T\"HH24:MI:SSOF')"
    )

    result = apply(
        db,
        request,
        {
            "action": "create_appointment",
            "customer": "Bäckerei Korn",
            "kind": "visit",
            "starts_at": starts_at,
            "duration_minutes": 45,
            "location": "Laden",
        },
    )

    row = db.one("select customer_id, origin, kind, location from crm.appointments")
    assert row == {
        "customer_id": customer,
        "origin": "assistant",
        "kind": "visit",
        "location": "Laden",
    }
    assert result["ok"] is True
    assert result["text"].startswith("Termin eingetragen: Vor-Ort-Gespräch Bäckerei Korn, ")
    assert result["text"].endswith(", 10:00 Uhr, 45 Minuten, Laden.")


def test_a6_two_matching_customers_are_named_instead_of_guessed(db: Database) -> None:
    db.run("insert into crm.customers (name) values ('Bäckerei Korn Mitte'), ('Bäckerei Korn Süd')")
    request = ask(db)
    claim(db)

    result = apply(
        db,
        request,
        {
            "action": "create_appointment",
            "customer": "Korn",
            "kind": "call",
            "starts_at": "2030-01-07T10:00:00+01:00",
            "duration_minutes": 15,
        },
    )

    assert result == {
        "ok": False,
        "text": "Mehrere Kunden passen zu „Korn“: Bäckerei Korn Mitte, Bäckerei Korn Süd. "
        "Bitte genauer sagen.",
    }
    assert db.value("select count(*) from crm.appointments") == 0


def test_a7_a_mail_waits_for_senden(db: Database) -> None:
    customer = audited_customer(db)
    request = ask(db, "Schreib Bäckerei Korn, dass ich Montag komme")
    claim(db)

    result = apply(
        db,
        request,
        {
            "action": "draft_mail",
            "customer": "Bäckerei Korn",
            "subject": "Termin am Montag",
            "body": "Guten Tag Frau Korn,\n\nich komme am Montag um 10 Uhr vorbei.\n\nDaniel Hütte",
        },
    )
    assert result["ok"] is True
    assert result["text"] == (
        f"Mail an Bäckerei Korn ({CUSTOMER_EMAIL}) „Termin am Montag“ wartet auf dein Senden."
    )
    assert db.value("select count(*) from crm.outbox") == 0

    approval = db.value("select id from crm.approvals where kind = 'assistant_mail'")
    db.run("select crm.decide_approval(%s, true)", (approval,), ADMIN)
    mail = db.one("select kind, customer_id, to_address, subject, body from crm.outbox")
    assert mail == {
        "kind": "assistant",
        "customer_id": customer,
        "to_address": CUSTOMER_EMAIL,
        "subject": "Termin am Montag",
        "body": "Guten Tag Frau Korn,\n\nich komme am Montag um 10 Uhr vorbei.\n\nDaniel Hütte",
    }


def test_a8_revenue_is_read_from_the_books(db: Database) -> None:
    request = ask(db, "Umsatz Oktober")
    claim(db)

    result = apply(db, request, {"action": "revenue", "from": "2030-10-01", "to": "2030-10-31"})

    assert result == {
        "ok": True,
        "text": "01.10.2030 bis 31.10.2030: Einnahmen 0,00 €, Ausgaben 0,00 €, Gewinn 0,00 €.",
    }


@pytest.mark.parametrize(
    ("intent", "text"),
    [
        ({"action": "delete_everything"}, "Das kann der Assistent nicht: delete_everything."),
        ({"action": "unclear", "question": "Welcher Kunde?"}, "Rückfrage: Welcher Kunde?"),
        (
            {"action": "revenue", "from": "2030-10-31", "to": "2030-10-01"},
            "Der Zeitraum ist ungültig.",
        ),
    ],
)
def test_a9_what_the_assistant_cannot_do_is_said_plainly(
    db: Database, intent: dict[str, Any], text: str
) -> None:
    request = ask(db)
    claim(db)

    assert apply(db, request, intent) == {"ok": False, "text": text}


def test_a10_only_the_administrator_asks_and_only_the_server_answers(db: Database) -> None:
    with pytest.raises(psycopg.errors.RaiseException, match="Administrator"):
        db.run("select crm.ask_assistant('x', null)", caller=READER)
    with pytest.raises(psycopg.errors.RaiseException, match="Text oder eine Aufnahme"):
        db.run("select crm.ask_assistant(null, null)", caller=ADMIN)
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        db.run("select * from crm.claim_assistant_request()", caller=ADMIN)
    request = ask(db)
    claim(db)
    db.run(
        "select crm.fail_assistant_request(%s, 'Claude Code antwortet nicht.')", (request,), SERVICE
    )
    assert db.one("select status, result_text from crm.assistant_requests") == {
        "status": "failed",
        "result_text": "Claude Code antwortet nicht.",
    }


def test_a11_recordings_without_a_request_are_named_for_removal(db: Database) -> None:
    db.run(
        "insert into storage.objects (bucket_id, name, created_at) values "
        "('crm-assistant', %s, now() - interval '20 minutes'), "
        "('crm-assistant', %s, now() - interval '2 minutes'), "
        "('crm-assistant', %s, now() - interval '20 minutes')",
        (ORPHAN, FRESH, AUDIO),
    )
    ask(db, None, AUDIO)

    paths = db.rows("select * from crm.orphan_recordings()", caller=SERVICE)

    assert paths == [{"path": ORPHAN}]
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        db.run("select * from crm.orphan_recordings()", caller=ADMIN)


def test_a12_a_request_the_server_never_finished_ends_as_not_done(db: Database) -> None:
    request = ask(db)
    db.run(
        "update crm.assistant_requests set status = 'claimed', attempts = 3, "
        "claimed_at = now() - interval '11 minutes' where id = %s",
        (request,),
    )

    assert claim(db) is None
    assert db.one("select status, result_text from crm.assistant_requests") == {
        "status": "failed",
        "result_text": "Der Server hat die Anfrage dreimal nicht zu Ende gebracht.",
    }
    assert notice(db)["title"] == "Assistent: nicht erledigt"


def test_a13_a_drafted_mail_is_shown_in_full_and_sent_only_from_the_crm(db: Database) -> None:
    audited_customer(db)
    request = ask(db)
    claim(db)
    body = "Guten Tag,\n\n" + "ein langer Absatz. " * 120 + "\n\nENDE"

    apply(
        db,
        request,
        {"action": "draft_mail", "customer": "Bäckerei Korn", "subject": "Lang", "body": body},
    )

    assert db.value("select body from crm.approvals where kind = 'assistant_mail'") == body
    message = db.one("select actions, link from cockpit.messages where kind = 'freigabe'")
    assert message == {"actions": [], "link": "https://crm.speedofthespirit.dev/freigaben"}


def test_a14_requests_are_deleted_after_thirty_days(db: Database) -> None:
    old = ask(db, "alt")
    ask(db, "neu")
    db.run(
        "update crm.assistant_requests set created_at = now() - interval '31 days' where id = %s",
        (old,),
    )

    assert db.value("select crm.prune_assistant_requests()", caller=SERVICE) == 1
    assert db.value("select text from crm.assistant_requests") == "neu"
    assert db.value("select count(*) from cron.job where jobname = 'crm-assistant-prune'") == 1
