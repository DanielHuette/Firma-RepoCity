"""The phone assistant: greeting, inquiries by phone, quote decisions on the phone, call records.

Context: crm.intake_call, crm.phone_quote_decision and crm.record_call are called by the agent on
the server with the service key; the caller number comes from the phone line. | Input: customers
with phone numbers in several spellings and sent quotes. | Output: Assertions on customers,
inquiries, tasks, quotes, calls and Cockpit notices.
"""

import json
from typing import Any

import psycopg
import pytest
from steps import add_products, audited_customer, sent_quote, set_company

from repocity_integration.database import ADMIN, ANON, READER, SERVICE, Database
from repocity_integration.project import migration_sql

STORED_PHONE = "0251 1234567"
SAME_NUMBER = ["+49 251 1234567", "0049 251 1234567", "+49 (0)251 123 45 67", "02511234567"]
OTHER_NUMBER = "+49 171 9876543"
PASSED_ON = (
    "Vielen Dank. Ich habe Ihre Rückmeldung notiert und gebe sie zur persönlichen Prüfung weiter."
)
STARTED = "2026-10-25T09:15:00+02:00"


def _intake(db: Database, number: str | None, email: str = "", name: str = "Erika Muster") -> str:
    customer: str = db.value(
        "select crm.intake_call(%s, %s, 'Muster GmbH', %s, 'Neue Webseite', "
        "'Möchte ein Angebot für eine neue Webseite.')",
        (number, name, email),
        SERVICE,
    )
    return customer


def _customer_with_quote(db: Database, count: int = 1) -> tuple[str, list[str]]:
    set_company(db)
    once, _ = add_products(db)
    customer = audited_customer(db)
    db.run("update crm.customers set phone = %s where id = %s", (STORED_PHONE, customer))
    return customer, [sent_quote(db, customer, once, None) for _ in range(count)]


def _number(db: Database, quote: str) -> str:
    number: str = db.value("select number from crm.quotes where id = %s", (quote,))
    return number


def _decide(db: Database, caller: str | None, number: str | None, intent: str) -> Any:
    return db.value(
        "select crm.phone_quote_decision(%s, %s, %s, 'sagt am Telefon zu')",
        (caller, number, intent),
        SERVICE,
    )


def _record(db: Database, call: dict[str, Any]) -> str:
    call_id: str = db.value("select crm.record_call(%s::jsonb)", (json.dumps(call),), SERVICE)
    return call_id


def _call(**changes: Any) -> dict[str, Any]:
    call: dict[str, Any] = {
        "caller_number": SAME_NUMBER[0],
        "started_at": STARTED,
        "ended_at": "2026-10-25T09:18:30+02:00",
        "transcript": [
            {"speaker": "assistant", "text": "Guten Tag, hier ist die digitale Assistentin."},
            {"speaker": "caller", "text": "Ich hätte gern einen Rückruf."},
        ],
        "summary": "bittet um Rückruf wegen der Webseite",
        "outcome": "callback",
    }
    call.update(changes)
    return call


@pytest.mark.parametrize(
    "spelling",
    [*SAME_NUMBER, STORED_PHONE, "0251/123 45-67", "sip:+492511234567@10.0.0.1", "492511234567"],
)
def test_german_numbers_in_every_spelling_have_one_key(db: Database, spelling: str) -> None:
    assert db.value("select crm.phone_key(%s)", (spelling,)) == "492511234567"


@pytest.mark.parametrize(
    ("spelling", "key"),
    [("+43 1 2345678", "4312345678"), ("0043 1 2345678", "4312345678"), ("", None), (None, None)],
)
def test_foreign_and_missing_numbers(db: Database, spelling: str | None, key: str | None) -> None:
    assert db.value("select crm.phone_key(%s)", (spelling,)) == key


def test_the_greeting_says_plainly_it_is_an_ai_and_the_call_is_written_down(db: Database) -> None:
    settings = db.one("select assistant_greeting, assistant_facts from crm.settings")

    assert settings == {
        "assistant_greeting": "Guten Tag, hier ist die digitale Assistentin von RepoCity. "
        "Ich bin eine künstliche Intelligenz, kein Mensch. Unser Gespräch wird mitgeschrieben, "
        "damit Ihr Anliegen bearbeitet werden kann. Was kann ich für Sie tun?",
        "assistant_facts": "",
    }


def test_the_greeting_cannot_be_emptied(db: Database) -> None:
    with pytest.raises(psycopg.errors.CheckViolation):
        db.run("update crm.settings set assistant_greeting = ' '", caller=ADMIN)


def test_rerunning_keeps_greeting_facts_and_calls(db: Database) -> None:
    db.run("update crm.settings set assistant_greeting = 'Hallo, KI von RepoCity.'")
    db.run("update crm.settings set assistant_facts = 'Öffnungszeiten: werktags 8 bis 18 Uhr'")
    _record(db, _call())

    db.run(migration_sql("crm/supabase/migrations/005_calls.sql").encode())

    assert db.one("select assistant_greeting, assistant_facts from crm.settings") == {
        "assistant_greeting": "Hallo, KI von RepoCity.",
        "assistant_facts": "Öffnungszeiten: werktags 8 bis 18 Uhr",
    }
    assert db.value("select count(*) from crm.calls") == 1


def test_an_unknown_caller_becomes_a_customer_without_email(db: Database) -> None:
    customer = _intake(db, "+49 251 1234567")

    assert db.one(
        "select id, kind, name, contact_person, email, phone, source from crm.customers"
    ) == {
        "id": customer,
        "kind": "company",
        "name": "Muster GmbH",
        "contact_person": "Erika Muster",
        "email": None,
        "phone": "+49 251 1234567",
        "source": "phone",
    }
    assert db.one("select customer_id, channel, subject, message, status from crm.inquiries") == {
        "customer_id": customer,
        "channel": "phone",
        "subject": "Neue Webseite",
        "message": "Möchte ein Angebot für eine neue Webseite.",
        "status": "new",
    }
    assert db.one("select title, customer_id, done from crm.tasks") == {
        "title": "Rückruf Erika Muster, +49 251 1234567",
        "customer_id": customer,
        "done": False,
    }


def test_an_unknown_caller_with_a_valid_email_keeps_it(db: Database) -> None:
    _intake(db, OTHER_NUMBER, email=" Erika@Muster.de ")

    assert db.value("select email from crm.customers") == "erika@muster.de"


@pytest.mark.parametrize("spelling", SAME_NUMBER)
def test_a_known_number_in_another_spelling_finds_the_customer(db: Database, spelling: str) -> None:
    customer, _ = _customer_with_quote(db)

    assert _intake(db, spelling) == customer
    assert db.value("select count(*) from crm.customers") == 1
    assert db.one("select name, phone, email from crm.customers") == {
        "name": "Bäckerei Korn",
        "phone": STORED_PHONE,
        "email": "info@baeckerei-korn.de",
    }
    assert db.value("select customer_id from crm.inquiries") == customer


def test_a_caller_with_a_new_number_is_found_by_email(db: Database) -> None:
    customer, _ = _customer_with_quote(db)

    assert _intake(db, OTHER_NUMBER, email="INFO@baeckerei-korn.de") == customer
    assert db.value("select count(*) from crm.customers") == 1


def test_a_misheard_email_is_kept_in_the_message_but_not_stored(db: Database) -> None:
    _intake(db, OTHER_NUMBER, email="erika at muster punkt de")

    assert db.value("select email from crm.customers") is None
    assert db.value("select message from crm.inquiries") == (
        "Möchte ein Angebot für eine neue Webseite.\n\n"
        "E-Mail-Adresse laut Anruf, nicht erkannt: erika at muster punkt de"
    )


def test_a_caller_without_number_and_name_still_gets_a_callback_task(db: Database) -> None:
    db.value("select crm.intake_call(null, '', '', '', '', 'Bitte zurückrufen.')", caller=SERVICE)

    assert db.one("select name, phone, source from crm.customers") == {
        "name": "Anrufer ohne Rufnummer",
        "phone": "",
        "source": "phone",
    }
    assert db.value("select subject from crm.inquiries") == "Anruf"
    assert db.value("select title from crm.tasks") == (
        "Rückruf Anrufer ohne Rufnummer, Rufnummer unbekannt"
    )


@pytest.mark.parametrize("spelling", SAME_NUMBER)
def test_an_acceptance_from_the_customers_number_accepts_by_phone(
    db: Database, spelling: str
) -> None:
    _, quotes = _customer_with_quote(db)
    number = _number(db, quotes[0])

    answer = _decide(db, spelling, number.lower().replace("-", " "), "accept")

    assert answer == {
        "done": True,
        "text": f"Vielen Dank. Ich habe Ihre Annahme des Angebots {number} eingetragen.",
    }
    assert db.one("select status, accepted_via, decision_note from crm.quotes") == {
        "status": "accepted",
        "accepted_via": "phone",
        "decision_note": "sagt am Telefon zu",
    }
    assert db.value("select count(*) from crm.orders") == 1


def test_a_shortened_quote_number_is_found(db: Database) -> None:
    _, quotes = _customer_with_quote(db)
    number = _number(db, quotes[0])
    prefix, year, sequence = number.split("-")

    answer = _decide(db, SAME_NUMBER[0], f"{prefix} {year} {int(sequence)}", "accept")

    assert answer["done"] is True


def test_without_quote_number_the_callers_only_sent_quote_is_accepted(db: Database) -> None:
    _, quotes = _customer_with_quote(db)

    assert _decide(db, SAME_NUMBER[1], None, "accept")["done"] is True
    assert db.value("select accepted_via from crm.quotes where id = %s", (quotes[0],)) == "phone"


def test_without_quote_number_and_two_quotes_nothing_is_accepted(db: Database) -> None:
    _customer_with_quote(db, 2)

    assert _decide(db, SAME_NUMBER[0], None, "accept") == {"done": False, "text": PASSED_ON}
    assert db.value("select count(*) from crm.quotes where status = 'sent'") == 2
    assert db.one("select title, body, actions from cockpit.messages where kind = 'annahme'") == {
        "title": "Mögliche Annahme am Telefon: +49 251 1234567",
        "body": "sagt am Telefon zu · Angebot nicht eindeutig · Anruf von +49 251 1234567",
        "actions": [],
    }


def test_a_decline_from_the_customers_number_declines_and_tells_daniel(db: Database) -> None:
    _, quotes = _customer_with_quote(db)
    number = _number(db, quotes[0])

    answer = _decide(db, SAME_NUMBER[2], number, "decline")

    assert answer == {
        "done": True,
        "text": "Vielen Dank für Ihre Rückmeldung. Ich habe Ihre Absage zum Angebot "
        f"{number} eingetragen.",
    }
    assert db.one("select status, decision_note from crm.quotes") == {
        "status": "declined",
        "decision_note": "sagt am Telefon zu",
    }
    notice = db.one("select title, body, priority from cockpit.messages where kind = 'kundenmail'")
    assert notice == {
        "title": f"Absage am Telefon: Bäckerei Korn – {number}",
        "body": "sagt am Telefon zu",
        "priority": "info",
    }


def test_a_wrong_caller_number_only_asks_daniel_with_the_accept_button(db: Database) -> None:
    _, quotes = _customer_with_quote(db)
    number = _number(db, quotes[0])

    assert _decide(db, OTHER_NUMBER, number, "accept") == {"done": False, "text": PASSED_ON}

    assert db.value("select status from crm.quotes") == "sent"
    notice = db.one(
        "select id, action_token, title, body, actions, action_payload, priority "
        "from cockpit.messages where kind = 'annahme'"
    )
    assert notice["title"] == "Mögliche Annahme am Telefon: Bäckerei Korn"
    assert notice["body"] == (
        f"sagt am Telefon zu · Angebot {number} · Rufnummer {OTHER_NUMBER} passt nicht zum Kunden"
    )
    assert notice["actions"] == [{"action": "accept_quote", "title": "Annahme bestätigen"}]
    assert notice["action_payload"] == {"quote_id": str(quotes[0])}
    assert notice["priority"] == "wichtig"

    db.value(
        "select cockpit.run_action(%s, %s, 'accept_quote')",
        (notice["id"], notice["action_token"]),
        ANON,
    )
    assert db.value("select accepted_via from crm.quotes") == "crm"


def test_a_wrong_caller_number_never_declines(db: Database) -> None:
    _, quotes = _customer_with_quote(db)

    assert _decide(db, OTHER_NUMBER, _number(db, quotes[0]), "decline")["done"] is False
    assert db.value("select status from crm.quotes") == "sent"
    assert db.one("select title, actions from cockpit.messages where kind = 'kundenmail'") == {
        "title": "Mögliche Absage am Telefon: Bäckerei Korn",
        "actions": [],
    }


def test_an_expired_quote_is_not_accepted_on_the_phone(db: Database) -> None:
    _, quotes = _customer_with_quote(db)
    number = _number(db, quotes[0])
    db.run("update crm.quotes set valid_until = date '2026-01-31'")

    assert _decide(db, SAME_NUMBER[0], number, "accept") == {"done": False, "text": PASSED_ON}
    assert db.value("select status from crm.quotes") == "sent"
    assert db.value("select body from cockpit.messages where kind = 'annahme'") == (
        f"sagt am Telefon zu · Angebot {number} ist am 31.01.2026 abgelaufen "
        "· Rufnummer passt zum Kunden"
    )


def test_an_unknown_caller_without_number_only_asks_daniel(db: Database) -> None:
    _, quotes = _customer_with_quote(db)

    assert _decide(db, None, _number(db, quotes[0]), "accept") == {
        "done": False,
        "text": PASSED_ON,
    }
    assert db.value("select status from crm.quotes") == "sent"
    assert db.value("select body from cockpit.messages where kind = 'annahme'").endswith(
        "· Anruf ohne Rufnummer"
    )


def test_an_unknown_quote_number_gets_the_same_answer(db: Database) -> None:
    _customer_with_quote(db)

    assert _decide(db, SAME_NUMBER[0], "AN-1999-0042", "accept") == {
        "done": False,
        "text": PASSED_ON,
    }
    assert db.value("select body from cockpit.messages where kind = 'annahme'") == (
        "sagt am Telefon zu · Angebot „AN-1999-0042“ nicht gefunden · Anruf von +49 251 1234567"
    )


def test_another_customers_quote_reveals_nothing_and_changes_nothing(db: Database) -> None:
    _, quotes = _customer_with_quote(db)
    stranger = _intake(db, OTHER_NUMBER)
    db.run("update crm.customers set name = 'Fremde GmbH' where id = %s", (stranger,))

    answer = _decide(db, OTHER_NUMBER, _number(db, quotes[0]), "accept")

    assert answer == {"done": False, "text": PASSED_ON}
    assert db.value("select status from crm.quotes") == "sent"
    assert db.value("select count(*) from crm.orders") == 0


def test_a_quote_already_decided_is_not_decided_again(db: Database) -> None:
    _, quotes = _customer_with_quote(db)
    number = _number(db, quotes[0])
    db.run("select crm.decline_quote(%s)", (quotes[0],), ADMIN)

    assert _decide(db, SAME_NUMBER[0], number, "accept") == {"done": False, "text": PASSED_ON}
    assert db.one("select body, actions from cockpit.messages where kind = 'annahme'") == {
        "body": f"sagt am Telefon zu · Angebot {number} ist nicht mehr offen "
        "· Rufnummer passt zum Kunden",
        "actions": [],
    }


def test_an_unknown_intent_is_refused(db: Database) -> None:
    _, quotes = _customer_with_quote(db)

    with pytest.raises(psycopg.Error, match="Unbekannte Entscheidung"):
        _decide(db, SAME_NUMBER[0], _number(db, quotes[0]), "maybe")


def test_a_call_is_stored_linked_by_number_and_announced(db: Database) -> None:
    customer, _ = _customer_with_quote(db)

    call_id = _record(db, _call(caller_number=SAME_NUMBER[3]))

    stored = db.one(
        "select customer_id, caller_number, direction, ended_at - started_at as length, "
        "transcript, summary, outcome from crm.calls where id = %s",
        (call_id,),
    )
    assert stored["customer_id"] == customer
    assert stored["caller_number"] == SAME_NUMBER[3]
    assert stored["direction"] == "in"
    assert stored["length"].total_seconds() == 210
    assert stored["transcript"] == _call()["transcript"]
    assert (stored["summary"], stored["outcome"]) == (
        "bittet um Rückruf wegen der Webseite",
        "callback",
    )
    notice = db.one("select title, body, link, priority from cockpit.messages where kind = 'anruf'")
    assert notice == {
        "title": "Anruf von Bäckerei Korn",
        "body": "bittet um Rückruf wegen der Webseite",
        "link": f"https://crm.speedofthespirit.dev/kunde/{customer}",
        "priority": "wichtig",
    }
    assert db.value(
        "select body from crm.activities where kind = 'call' and customer_id = %s", (customer,)
    ) == ("Anruf: bittet um Rückruf wegen der Webseite")


def test_a_call_from_an_unknown_number_is_announced_with_the_number(db: Database) -> None:
    _record(db, _call(caller_number=OTHER_NUMBER, summary="", outcome="info"))

    assert db.value("select customer_id from crm.calls") is None
    assert db.one("select title, body, priority from cockpit.messages where kind = 'anruf'") == {
        "title": f"Anruf von {OTHER_NUMBER}",
        "body": "Auskunft gegeben",
        "priority": "info",
    }


def test_an_anonymous_call_can_be_linked_to_the_customer_the_intake_created(db: Database) -> None:
    customer = _intake(db, None)

    _record(db, _call(caller_number=None, customer_id=str(customer), outcome="inquiry"))

    assert db.value("select customer_id from crm.calls") == customer
    assert db.value("select title from cockpit.messages where kind = 'anruf'") == (
        "Anruf von Muster GmbH"
    )


def test_a_call_sent_twice_is_stored_and_announced_once(db: Database) -> None:
    first = _record(db, _call())

    assert _record(db, _call()) == first
    assert db.value("select count(*) from crm.calls") == 1
    assert db.value("select count(*) from cockpit.messages where kind = 'anruf'") == 1


@pytest.mark.parametrize(
    "call",
    [
        _call(outcome="sold"),
        _call(started_at="gestern"),
        _call(started_at=None),
        _call(customer_id="kein-schluessel"),
        _call(transcript=[{"speaker": "bot", "text": "Hallo"}]),
        _call(transcript=[{"speaker": "caller"}]),
        _call(transcript=[{"speaker": "caller", "text": "Hallo", "mood": "gut"}]),
        _call(transcript="Hallo"),
        _call(summary=7),
        _call(recording="anruf.wav"),
        _call(ended_at="2026-10-25T09:00:00+02:00"),
    ],
)
def test_a_call_outside_the_shape_is_refused(db: Database, call: dict[str, Any]) -> None:
    with pytest.raises(psycopg.Error, match="Anruf passt nicht zum erwarteten Aufbau"):
        _record(db, call)
    assert db.value("select count(*) from crm.calls") == 0


def test_only_the_signed_in_administrator_reads_calls(db: Database) -> None:
    _record(db, _call())

    assert db.value("select count(*) from crm.calls", caller=ADMIN) == 1
    assert db.value("select count(*) from crm.calls", caller=READER) == 0
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        db.run("delete from crm.calls", caller=ADMIN)
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        db.run("select count(*) from crm.calls", caller=ANON)


def test_the_phone_functions_are_closed_to_signed_in_users(db: Database) -> None:
    for statement in (
        "select crm.intake_call('0251 1', 'a', '', '', '', '')",
        "select crm.phone_quote_decision('0251 1', 'AN-2026-0001', 'accept', '')",
        "select crm.record_call('{}')",
    ):
        for caller in (ADMIN, ANON):
            with pytest.raises(psycopg.errors.InsufficientPrivilege):
                db.run(statement, caller=caller)
