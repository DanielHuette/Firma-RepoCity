"""Step 3 by mail: the server worker claims mails, Claude Code classifies, the CRM applies.

Context: crm.claim_mail_triage, crm.classify_mail_triage and crm.fail_mail_triage are for the
service key only. | Input: a customer with sent quotes and queued triage rows. | Output:
Assertions on triage rows, quotes, orders and Cockpit notices.
"""

import json
from typing import Any

import psycopg
import pytest
from steps import add_products, audited_customer, sent_quote, set_company

from repocity_integration.database import ADMIN, ANON, SERVICE, Database


def _queue(db: Database, kind: str, customer: str | None = None, verified: bool = True) -> str:
    row: str = db.value(
        "insert into crm.mail_triage (kind, direction, address, name, subject, body_text, "
        "folder, customer_id, sender_verified) values (%s, 'in', 'info@baeckerei-korn.de', "
        "'Erika Korn', 'Ihr Angebot', 'Hiermit nehmen wir Ihr Angebot an.', 'INBOX', %s, %s) "
        "returning id",
        (kind, customer, verified),
        SERVICE,
    )
    return row


def _claim(db: Database, limit: int = 10) -> list[dict[str, Any]]:
    return db.rows("select * from crm.claim_mail_triage(%s, 300)", (limit,), SERVICE)


def _classify(db: Database, row: str, result: dict[str, Any]) -> dict[str, Any]:
    classified: dict[str, Any] = db.one(
        "select * from crm.classify_mail_triage(%s, %s::jsonb)", (row, json.dumps(result)), SERVICE
    )
    return classified


def _customer_with_quotes(db: Database, count: int) -> tuple[str, list[str]]:
    set_company(db)
    once, _ = add_products(db)
    customer = audited_customer(db)
    return customer, [sent_quote(db, customer, once, None) for _ in range(count)]


def _number(db: Database, quote: str) -> str:
    number: str = db.value("select number from crm.quotes where id = %s", (quote,))
    return number


def _accept(confidence: str, number: str | None) -> dict[str, Any]:
    return {
        "intent": "accept",
        "quote_number": number,
        "confidence": confidence,
        "summary": "nimmt das Angebot an",
    }


def test_claim_takes_each_queued_row_once_and_counts_the_attempt(db: Database) -> None:
    first = _queue(db, "unknown_sender")
    second = _queue(db, "unknown_sender")

    claimed = _claim(db)

    assert sorted(row["id"] for row in claimed) == sorted([first, second])
    assert {(row["status"], row["attempts"]) for row in claimed} == {("claimed", 1)}
    assert _claim(db) == []


def test_an_expired_claim_is_claimed_again(db: Database) -> None:
    row = _queue(db, "unknown_sender")
    _claim(db)
    db.run("update crm.mail_triage set claimed_until = now() - interval '1 second'")

    assert [(r["id"], r["attempts"]) for r in _claim(db)] == [(row, 2)]


def test_the_triage_functions_are_closed_to_signed_in_users(db: Database) -> None:
    for statement in (
        "select crm.claim_mail_triage(1, 60)",
        "select crm.classify_mail_triage(gen_random_uuid(), '{}')",
        "select crm.fail_mail_triage(gen_random_uuid(), 'x')",
    ):
        for caller in (ADMIN, ANON):
            with pytest.raises(psycopg.errors.InsufficientPrivilege):
                db.run(statement, caller=caller)


def test_a_high_acceptance_with_number_accepts_that_quote_by_mail(db: Database) -> None:
    customer, quotes = _customer_with_quotes(db, 2)
    row = _queue(db, "customer_mail", customer)
    _claim(db)

    classified = _classify(db, row, _accept("high", _number(db, quotes[1]).lower()))

    assert classified["status"] == "applied"
    assert db.rows(
        "select status, accepted_via, decision_note from crm.quotes order by number"
    ) == [
        {"status": "sent", "accepted_via": None, "decision_note": ""},
        {"status": "accepted", "accepted_via": "email", "decision_note": "nimmt das Angebot an"},
    ]
    assert db.value("select count(*) from crm.orders") == 1


def test_a_high_acceptance_without_number_accepts_the_only_sent_quote(db: Database) -> None:
    customer, quotes = _customer_with_quotes(db, 1)
    row = _queue(db, "customer_mail", customer)
    _claim(db)

    _classify(db, row, _accept("high", None))

    assert db.value("select accepted_via from crm.quotes where id = %s", (quotes[0],)) == "email"


def test_without_number_and_two_quotes_a_notice_asks_without_accepting(db: Database) -> None:
    customer, _ = _customer_with_quotes(db, 2)
    row = _queue(db, "customer_mail", customer)
    _claim(db)

    _classify(db, row, _accept("high", None))

    assert db.value("select count(*) from crm.quotes where status = 'sent'") == 2
    notice = db.one("select title, body, actions from cockpit.messages where kind = 'annahme'")
    assert notice == {
        "title": "Mögliche Annahme: Bäckerei Korn",
        "body": "nimmt das Angebot an · Angebot nicht eindeutig",
        "actions": [],
    }


def test_a_low_acceptance_becomes_a_notice_with_the_accept_button(db: Database) -> None:
    customer, quotes = _customer_with_quotes(db, 1)
    row = _queue(db, "customer_mail", customer)
    _claim(db)
    number = _number(db, quotes[0])

    _classify(db, row, _accept("low", number))

    assert db.value("select status from crm.quotes") == "sent"
    notice = db.one(
        "select id, action_token, body, actions, action_payload, priority "
        "from cockpit.messages where kind = 'annahme'"
    )
    assert notice["body"] == f"nimmt das Angebot an · Angebot {number}"
    assert notice["actions"] == [{"action": "accept_quote", "title": "Annahme bestätigen"}]
    assert notice["action_payload"] == {"quote_id": str(quotes[0])}
    assert notice["priority"] == "wichtig"

    answer = db.value(
        "select cockpit.run_action(%s, %s, 'accept_quote')",
        (notice["id"], notice["action_token"]),
        ANON,
    )

    order = db.value("select number from crm.orders")
    assert answer == {"ok": True, "text": f"Angebot angenommen, Auftrag {order} angelegt."}
    assert db.one("select accepted_via, decision_note from crm.quotes") == {
        "accepted_via": "crm",
        "decision_note": "im Cockpit bestätigt",
    }


def test_a_high_decline_declines_the_quote(db: Database) -> None:
    customer, quotes = _customer_with_quotes(db, 1)
    row = _queue(db, "customer_mail", customer)
    _claim(db)

    _classify(
        db,
        row,
        {
            "intent": "decline",
            "quote_number": _number(db, quotes[0]),
            "confidence": "high",
            "summary": "lehnt ab, zu teuer",
        },
    )

    assert db.one("select status, decision_note from crm.quotes") == {
        "status": "declined",
        "decision_note": "lehnt ab, zu teuer",
    }
    assert db.one("select title, body from cockpit.messages where kind = 'kundenmail'") == {
        "title": f"Absage per E-Mail: Bäckerei Korn – {_number(db, quotes[0])}",
        "body": "lehnt ab, zu teuer",
    }


def test_another_customer_mail_becomes_an_information(db: Database) -> None:
    customer, _ = _customer_with_quotes(db, 1)
    row = _queue(db, "customer_mail", customer)
    _claim(db)

    _classify(
        db,
        row,
        {
            "intent": "other",
            "quote_number": None,
            "confidence": "high",
            "summary": "fragt nach dem Termin",
        },
    )

    assert db.one(
        "select title, body, priority from cockpit.messages where kind = 'kundenmail'"
    ) == {"title": "Mail von Bäckerei Korn", "body": "fragt nach dem Termin", "priority": "info"}
    assert db.value("select status from crm.quotes") == "sent"


def test_an_unknown_sender_stays_classified_for_the_mail_worker(db: Database) -> None:
    row = _queue(db, "unknown_sender")
    _claim(db)
    result = {
        "verdict": "customer",
        "name": "Erika Muster",
        "company": "Muster GmbH",
        "reason": "fragt nach einem Angebot",
    }

    classified = _classify(db, row, result)

    assert (classified["status"], classified["result"]) == ("classified", result)
    assert classified["classified_at"] is not None
    assert db.value("select count(*) from crm.customers where name = 'Muster GmbH'") == 0


@pytest.mark.parametrize(
    ("kind", "result"),
    [
        ("unknown_sender", {"verdict": "maybe"}),
        ("unknown_sender", {"verdict": "customer", "extra": 1}),
        ("unknown_sender", {"verdict": "customer", "name": 5}),
        ("customer_mail", {"intent": "accept", "confidence": "sure", "quote_number": None}),
        ("customer_mail", {"intent": "buy", "confidence": "high", "quote_number": None}),
        ("customer_mail", {"intent": "accept", "confidence": "high", "quote_number": 4}),
    ],
)
def test_a_result_outside_the_shape_is_refused(
    db: Database, kind: str, result: dict[str, Any]
) -> None:
    customer, _ = _customer_with_quotes(db, 1)
    row = _queue(db, kind, customer if kind == "customer_mail" else None)
    _claim(db)

    with pytest.raises(psycopg.Error, match="Antwort passt nicht zum erwarteten Aufbau"):
        _classify(db, row, result)

    assert db.value("select status from crm.mail_triage") == "claimed"


def test_a_failure_requeues_twice_and_then_tells_the_cockpit(db: Database) -> None:
    row = _queue(db, "unknown_sender")
    statuses = []
    for _ in range(3):
        _claim(db)
        failed = db.one(
            "select * from crm.fail_mail_triage(%s, 'Zeitüberschreitung')", (row,), SERVICE
        )
        statuses.append(failed["status"])

    assert statuses == ["queued", "queued", "failed"]
    notice = db.one(
        "select title, body, priority from cockpit.messages where kind = 'mail-auswertung-fehler'"
    )
    assert notice == {
        "title": "Mail konnte nicht gelesen werden: Ihr Angebot",
        "body": "info@baeckerei-korn.de · Zeitüberschreitung",
        "priority": "dringend",
    }


def test_only_claimed_rows_can_be_classified(db: Database) -> None:
    row = _queue(db, "unknown_sender")

    with pytest.raises(psycopg.Error, match="nicht in Bearbeitung"):
        _classify(db, row, {"verdict": "automated"})


def test_the_mail_worker_files_a_failed_unknown_sender_and_marks_it_applied(db: Database) -> None:
    row = _queue(db, "unknown_sender")
    db.run("update crm.mail_triage set status = 'failed' where id = %s", (row,))

    db.run(
        "update crm.mail_triage set status = 'applied', applied_at = now() where id = %s",
        (row,),
        SERVICE,
    )

    assert db.value("select status from crm.mail_triage") == "applied"


def test_an_expired_quote_is_not_accepted_but_offered_with_the_button(db: Database) -> None:
    customer, quotes = _customer_with_quotes(db, 1)
    db.run("update crm.quotes set valid_until = current_date - 1")
    row = _queue(db, "customer_mail", customer)
    _claim(db)
    number = _number(db, quotes[0])
    expired = db.value("select to_char(current_date - 1, 'DD.MM.YYYY')")

    _classify(db, row, _accept("high", number))

    assert db.value("select status from crm.quotes") == "sent"
    assert db.one("select body, actions from cockpit.messages where kind = 'annahme'") == {
        "body": f"nimmt das Angebot an · Angebot {number} ist am {expired} abgelaufen",
        "actions": [{"action": "accept_quote", "title": "Annahme bestätigen"}],
    }


def test_an_unverified_sender_never_accepts_automatically(db: Database) -> None:
    customer, quotes = _customer_with_quotes(db, 1)
    row = _queue(db, "customer_mail", customer, verified=False)
    _claim(db)
    number = _number(db, quotes[0])

    _classify(db, row, _accept("high", number))

    assert db.value("select status from crm.quotes") == "sent"
    assert db.one("select body, actions from cockpit.messages where kind = 'annahme'") == {
        "body": f"nimmt das Angebot an · Angebot {number} · Absender nicht bestätigt",
        "actions": [{"action": "accept_quote", "title": "Annahme bestätigen"}],
    }


def test_an_unverified_sender_never_declines_automatically(db: Database) -> None:
    customer, quotes = _customer_with_quotes(db, 1)
    row = _queue(db, "customer_mail", customer, verified=False)
    _claim(db)
    number = _number(db, quotes[0])

    _classify(
        db,
        row,
        {"intent": "decline", "quote_number": number, "confidence": "high", "summary": "lehnt ab"},
    )

    assert db.value("select status from crm.quotes") == "sent"
    assert db.one(
        "select title, body, actions from cockpit.messages where kind = 'kundenmail'"
    ) == {
        "title": "Mögliche Absage: Bäckerei Korn",
        "body": f"lehnt ab · Angebot {number} · Absender nicht bestätigt",
        "actions": [],
    }
