"""Scenarios N1-N9: follow-up mails on sent quotes, each approved in the Cockpit, and opting out.

Context: A quote without an answer gets a reminder after 5 and after 12 days. Each reminder
waits for "Senden" in the Cockpit or on the lock screen; none is proposed when the customer has
written, called or asked since the quote, when the quote ran out (it is then set to expired) or
when the customer opted out with the link in the mail (migration crm/010_nachfassen.sql). |
Input: a sent quote from steps.py. | Output: Assertions on approvals, outbox, quotes, customers
and Cockpit.
"""

from typing import Any

import pytest
from actors import tap
from steps import add_products, audited_customer, sent_quote, set_company

from repocity_integration.database import ADMIN, SERVICE, Database


def _quote(db: Database) -> dict[str, Any]:
    set_company(db)
    once, monthly = add_products(db)
    customer = audited_customer(db)
    quote = sent_quote(db, customer, once, monthly)
    db.run("update crm.outbox set status = 'sent', sent_at = now()")
    return {"customer": customer, "quote": quote}


def _age(db: Database, quote: str, days: int) -> None:
    db.run(
        "set session_replication_role = replica; "
        f"update crm.quotes set sent_at = now() - interval '{days} days' where id = '{quote}'; "
        "set session_replication_role = origin".encode()
    )


def _last_follow_up(db: Database, quote: str, days: int) -> None:
    db.run(
        "update crm.quotes set follow_up_at = now() - make_interval(days => %s) where id = %s",
        (days, quote),
    )


def _run(db: Database) -> int:
    proposed: int = db.value("select crm.run_follow_ups()", caller=SERVICE)
    return proposed


def _follow_ups(db: Database) -> list[dict[str, Any]]:
    return db.rows(
        "select status, payload ->> 'level' as level from crm.approvals "
        "where kind = 'follow_up' order by created_at"
    )


def test_n1_after_five_days_a_reminder_waits_for_senden(db: Database) -> None:
    ids = _quote(db)
    _age(db, ids["quote"], 4)
    assert _run(db) == 0
    _age(db, ids["quote"], 5)

    assert _run(db) == 1
    buttons = db.value("select actions from cockpit.messages where kind = 'freigabe'")
    assert [button["title"] for button in buttons] == ["Senden", "Nicht senden"]
    assert tap(db, "freigabe", "approve") == {"ok": True, "text": "Freigabe erteilt."}

    mail = db.one(
        "select kind, subject, body, list_unsubscribe from crm.outbox where kind = 'follow_up'"
    )
    token = db.value("select optout_token from crm.customers where id = %s", (ids["customer"],))
    assert mail["subject"].startswith("Kurze Nachfrage zu meinem Angebot")
    assert mail["list_unsubscribe"].endswith(f"/crm-abmelden?t={token}")
    assert mail["list_unsubscribe"] in mail["body"]
    assert db.value("select follow_up_level from crm.quotes") == 1


def test_n2_the_second_reminder_comes_after_twelve_days_and_only_once(db: Database) -> None:
    ids = _quote(db)
    _age(db, ids["quote"], 5)
    _run(db)
    tap(db, "freigabe", "approve")
    _age(db, ids["quote"], 11)
    assert _run(db) == 0
    _age(db, ids["quote"], 12)
    _last_follow_up(db, ids["quote"], 7)

    assert _run(db) == 1
    assert _run(db) == 0
    tap(db, "freigabe", "approve")
    assert db.value("select follow_up_level from crm.quotes") == 2
    _age(db, ids["quote"], 20)
    assert _run(db) == 0


def test_n3_nicht_senden_skips_that_reminder_for_good(db: Database) -> None:
    ids = _quote(db)
    _age(db, ids["quote"], 6)
    _run(db)

    tap(db, "freigabe", "reject")

    assert db.value("select count(*) from crm.outbox where kind = 'follow_up'") == 0
    assert db.value("select follow_up_level from crm.quotes") == 1
    assert _run(db) == 0


@pytest.mark.parametrize("contact", ["mail", "call", "inquiry"])
def test_n4_no_reminder_when_the_customer_got_in_touch(db: Database, contact: str) -> None:
    ids = _quote(db)
    _age(db, ids["quote"], 6)
    statement = {
        "mail": "insert into crm.emails (customer_id, message_id, direction, subject, sent_at) "
        "values (%s, 'm1@test', 'in', 'Rückfrage', now() - interval '1 day')",
        "call": "insert into crm.calls (customer_id, caller_number, started_at, ended_at, "
        "transcript, summary, outcome) values (%s, '+492511', now() - interval '1 day', "
        "now() - interval '1 day' + interval '2 minutes', '[]', 'Frage', 'info')",
        "inquiry": "insert into crm.inquiries (customer_id, channel, subject, created_at) "
        "values (%s, 'website', 'Nachfrage', now() - interval '1 day')",
    }[contact]
    db.run(statement, (ids["customer"],))

    assert _run(db) == 0


def test_n5_opting_out_stops_reminders_and_review_requests(db: Database) -> None:
    ids = _quote(db)
    _age(db, ids["quote"], 6)
    _run(db)
    token = db.value("select optout_token from crm.customers where id = %s", (ids["customer"],))

    assert db.value("select crm.opt_out(%s)", (token,), SERVICE) is True
    assert db.value("select crm.opt_out(gen_random_uuid())", caller=SERVICE) is False

    customer = db.one(
        "select no_follow_ups, no_review_requests from crm.customers where id = %s",
        (ids["customer"],),
    )
    assert customer == {"no_follow_ups": True, "no_review_requests": True}
    assert [row["status"] for row in _follow_ups(db)] == ["rejected"]
    _age(db, ids["quote"], 13)
    assert _run(db) == 0


def test_n6_a_decided_quote_drops_its_waiting_reminder(db: Database) -> None:
    ids = _quote(db)
    _age(db, ids["quote"], 6)
    _run(db)

    db.run("select crm.accept_quote(%s)", (ids["quote"],), ADMIN)

    assert [row["status"] for row in _follow_ups(db)] == ["rejected"]


def test_n7_a_quote_past_its_date_is_expired_and_not_followed_up(db: Database) -> None:
    ids = _quote(db)
    _age(db, ids["quote"], 6)
    db.run(
        "set session_replication_role = replica; "
        "update crm.quotes set valid_until = current_date - 1; "
        "set session_replication_role = origin"
    )

    expired = db.value("select crm.expire_quotes()", caller=SERVICE)

    assert expired == 1
    assert db.value("select status from crm.quotes") == "expired"
    assert _run(db) == 0


def test_n8_the_daily_routine_does_both(db: Database) -> None:
    ids = _quote(db)
    _age(db, ids["quote"], 6)

    db.run("select crm.daily_routine()", caller=SERVICE)

    assert [row["level"] for row in _follow_ups(db)] == ["1"]


def test_n9_opting_out_is_not_open_to_the_web_or_signed_in_users(db: Database) -> None:
    rights = db.one(
        "select has_function_privilege('anon', 'crm.opt_out(uuid)', 'execute') as anon, "
        "has_function_privilege('authenticated', 'crm.opt_out(uuid)', 'execute') as signed_in"
    )

    assert rights == {"anon": False, "signed_in": False}


CONTACT = {
    "mail": "insert into crm.emails (customer_id, message_id, direction, subject, sent_at) "
    "values (%s, 'm2@test', 'in', 'Antwort', now())",
    "call": "insert into crm.calls (customer_id, caller_number, started_at, ended_at, "
    "transcript, summary, outcome) values (%s, '+492512', now(), now() + interval '2 minutes', "
    "'[]', 'Frage', 'info')",
    "inquiry": "insert into crm.inquiries (customer_id, channel, subject) "
    "values (%s, 'website', 'Nachfrage')",
}


@pytest.mark.parametrize("contact", sorted(CONTACT))
def test_n10_an_answer_withdraws_the_waiting_reminder(db: Database, contact: str) -> None:
    ids = _quote(db)
    _age(db, ids["quote"], 6)
    _run(db)

    db.run(CONTACT[contact], (ids["customer"],))

    assert [row["status"] for row in _follow_ups(db)] == ["rejected"]
    assert tap(db, "freigabe", "approve")["ok"] is False
    assert db.value("select count(*) from crm.outbox where kind = 'follow_up'") == 0


def test_n11_the_second_reminder_waits_a_week_after_the_first(db: Database) -> None:
    ids = _quote(db)
    _age(db, ids["quote"], 11)
    _run(db)
    tap(db, "freigabe", "approve")
    _age(db, ids["quote"], 13)

    assert _run(db) == 0
    _last_follow_up(db, ids["quote"], 7)
    assert _run(db) == 1


def test_n12_opting_out_stops_mails_already_waiting(db: Database) -> None:
    ids = _quote(db)
    _age(db, ids["quote"], 6)
    _run(db)
    tap(db, "freigabe", "approve")
    db.run(
        "insert into crm.outbox (customer_id, kind, to_address, subject, body) "
        "values (%s, 'review_request', 'a@b.de', 'Bewertung', 'Bitte'), "
        "(%s, 'invoice', 'a@b.de', 'Rechnung', 'Anbei')",
        (ids["customer"], ids["customer"]),
    )
    token = db.value("select optout_token from crm.customers where id = %s", (ids["customer"],))

    db.value("select crm.opt_out(%s)", (token,), SERVICE)

    kinds = db.rows("select kind from crm.outbox where status = 'queued' order by kind")
    assert [row["kind"] for row in kinds] == ["invoice"]
