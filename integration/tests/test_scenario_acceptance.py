"""Scenarios Q1-Q12: a sent quote is accepted, declined or left to expire on every channel.

Context: The decision can come from the RadarAuditor app, the CRM, a customer mail read by the
server worker, the phone agent or a tap in the Cockpit; every path must end in exactly one order
with its subscription and both contracts, or in a declined quote, and never in a second order. |
Input: the callers in actors.py. | Output: Assertions on quotes, orders, subscriptions, contracts,
outbox and Cockpit.
"""

import json
from typing import Any

import psycopg
import pytest
from actors import (
    fail_outbox,
    file_customer_mail,
    phone_decision,
    phone_record,
    radar_quote,
    send_outbox,
    server_classifies,
    tap,
)
from steps import (
    CUSTOMER_EMAIL,
    MONTHLY_QUOTED_PRICE,
    add_products,
    audited_customer,
    messages,
    set_company,
)

from repocity_integration.database import ADMIN, SERVICE, Database

PHONE = "0251 1234567"


def _sent_quote(db: Database) -> dict[str, Any]:
    set_company(db)
    once, monthly = add_products(db)
    customer = audited_customer(db)
    db.run("update crm.customers set phone = %s where id = %s", (PHONE, customer))
    quote = radar_quote(
        db,
        customer,
        [
            (once, "Website-Optimierung", "Stück", 900),
            (monthly, "Monatliche Pflege", "Monat", MONTHLY_QUOTED_PRICE),
        ],
    )
    db.run("select crm.send_quote(p_quote => %s)", (quote,), ADMIN)
    number: str = db.value("select number from crm.quotes where id = %s", (quote,))
    return {"customer": customer, "quote": quote, "number": number}


def _accepted_via(db: Database) -> list[tuple[str, str | None]]:
    return [
        (row["status"], row["accepted_via"])
        for row in db.rows("select status, accepted_via from crm.quotes")
    ]


def _assert_one_order_with_everything(db: Database, channel: str) -> None:
    assert _accepted_via(db) == [("accepted", channel)]
    assert db.value("select count(*) from crm.orders") == 1
    assert db.one(
        "select unit_price_net, next_audit_date is not null as audited from crm.subscriptions"
    ) == {"unit_price_net": MONTHLY_QUOTED_PRICE, "audited": True}
    assert sorted(db.value("select array_agg(template_key) from crm.contracts")) == [
        "maintenance",
        "order_confirmation",
    ]
    assert db.value("select count(*) from crm.approvals") == 0
    assert db.value("select count(*) from cockpit.messages where kind = 'auftrag'") == 1


def _mail_answer(db: Database, ids: dict[str, Any], verified: bool, result: dict[str, Any]) -> None:
    file_customer_mail(db, ids["customer"], CUSTOMER_EMAIL, verified)
    assert server_classifies(db, {CUSTOMER_EMAIL: result}) == ["applied"]


def _accept(number: str | None, confidence: str = "high") -> dict[str, Any]:
    return {
        "intent": "accept",
        "quote_number": number,
        "confidence": confidence,
        "summary": "nimmt das Angebot an",
    }


def test_q1_accepted_in_the_app_then_order_mails_go_out_without_approval(db: Database) -> None:
    ids = _sent_quote(db)
    send_outbox(db)

    db.run("select crm.accept_quote(p_quote => %s)", (ids["quote"],), ADMIN)
    sent = send_outbox(db)

    _assert_one_order_with_everything(db, "app")
    assert len(sent) == 2
    assert db.value("select array_agg(status order by template_key) from crm.contracts") == [
        "sent",
        "sent",
    ]
    assert db.value("select count(*) from crm.documents where kind = 'contract'") == 2
    mail_notices = [m for m in messages(db) if m["kind"].startswith("mail-")]
    assert {m["kind"] for m in mail_notices} == {"mail-erstellt", "mail-verschickt"}
    assert len({m["tag"] for m in mail_notices}) == 3


def test_q2_quote_from_the_crm_accepted_by_a_proven_mail(db: Database) -> None:
    ids = _sent_quote(db)

    _mail_answer(db, ids, True, _accept(ids["number"]))

    _assert_one_order_with_everything(db, "email")
    assert db.value("select decision_note from crm.quotes") == "nimmt das Angebot an"


def test_q3_an_unproven_mail_waits_for_one_tap_and_a_second_tap_changes_nothing(
    db: Database,
) -> None:
    ids = _sent_quote(db)
    _mail_answer(db, ids, False, _accept(ids["number"]))
    assert _accepted_via(db) == [("sent", None)]

    first = tap(db, "annahme", "accept_quote")
    second = tap(db, "annahme", "accept_quote")

    assert first["ok"] and first["text"].startswith("Angebot angenommen, Auftrag AU-")
    assert second == {"ok": False, "text": "Das wurde bereits erledigt."}
    _assert_one_order_with_everything(db, "crm")
    assert db.value("select decision_note from crm.quotes") == "im Cockpit bestätigt"


def test_q4_accepted_on_the_phone_from_the_customers_number(db: Database) -> None:
    ids = _sent_quote(db)

    answer = phone_decision(db, "+49 251 1234567", ids["number"].replace("-", " "), "accept")
    call = phone_record(db, "+49 251 1234567", "quote_accepted", None)

    assert answer["done"] is True
    _assert_one_order_with_everything(db, "phone")
    assert db.value("select customer_id from crm.calls where id = %s", (call,)) == ids["customer"]
    assert db.value("select title from cockpit.messages where kind = 'anruf'") == (
        "Anruf von Bäckerei Korn"
    )


def test_q5_a_call_from_another_number_waits_for_daniels_tap(db: Database) -> None:
    ids = _sent_quote(db)

    answer = phone_decision(db, "+49 171 9876543", ids["number"], "accept")
    assert answer["done"] is False and _accepted_via(db) == [("sent", None)]
    assert tap(db, "annahme", "accept_quote")["ok"] is True

    _assert_one_order_with_everything(db, "crm")


def test_q6_an_expired_quote_is_never_accepted_automatically_but_daniel_may(db: Database) -> None:
    ids = _sent_quote(db)
    db.run("update crm.quotes set valid_until = current_date - 1")

    _mail_answer(db, ids, True, _accept(None))
    phone_decision(db, PHONE, None, "accept")

    assert _accepted_via(db) == [("sent", None)]
    bodies = db.value(
        "select array_agg(body order by created_at) from cockpit.messages where kind = 'annahme'"
    )
    assert len(bodies) == 2 and all("abgelaufen" in body for body in bodies)
    assert tap(db, "annahme", "accept_quote", newest=False)["ok"] is True
    assert tap(db, "annahme", "accept_quote")["text"] == (
        "Dieses Angebot kann nicht mehr angenommen werden."
    )
    _assert_one_order_with_everything(db, "crm")


def test_q7_declined_by_proven_mail_and_a_late_acceptance_does_not_revive_it(
    db: Database,
) -> None:
    ids = _sent_quote(db)
    decline = {
        "intent": "decline",
        "quote_number": ids["number"],
        "confidence": "high",
        "summary": "hat sich anders entschieden",
    }

    _mail_answer(db, ids, True, decline)
    _mail_answer(db, ids, True, _accept(ids["number"]))

    assert db.value("select status from crm.quotes") == "declined"
    assert db.value("select count(*) from crm.orders") == 0
    assert db.value("select title from cockpit.messages where kind = 'kundenmail'") == (
        f"Absage per E-Mail: Bäckerei Korn – {ids['number']}"
    )
    assert db.value("select actions from cockpit.messages where kind = 'annahme'") == []


def test_q8_declined_on_the_phone_from_the_right_number(db: Database) -> None:
    ids = _sent_quote(db)

    answer = phone_decision(db, PHONE, ids["number"], "decline")

    assert answer["done"] is True
    assert db.one("select status, accepted_via from crm.quotes") == {
        "status": "declined",
        "accepted_via": None,
    }
    assert db.value("select count(*) from crm.orders") == 0


def test_q9_declined_in_the_crm(db: Database) -> None:
    ids = _sent_quote(db)

    db.run(
        "select crm.decline_quote_via(p_quote => %s, p_channel => 'crm')", (ids["quote"],), ADMIN
    )

    assert db.value("select status from crm.quotes") == "declined"
    assert db.value("select count(*) from crm.subscriptions") == 0


def test_q10_two_channels_accepting_the_same_quote_make_one_order(db: Database) -> None:
    ids = _sent_quote(db)

    phone_decision(db, PHONE, ids["number"], "accept")
    _mail_answer(db, ids, True, _accept(ids["number"]))

    _assert_one_order_with_everything(db, "phone")


def test_q11_a_repeated_classification_of_the_same_mail_is_refused(db: Database) -> None:
    ids = _sent_quote(db)
    row = file_customer_mail(db, ids["customer"], CUSTOMER_EMAIL, True)
    server_classifies(db, {CUSTOMER_EMAIL: _accept(ids["number"])})

    with pytest.raises(psycopg.errors.ObjectNotInPrerequisiteState):
        db.run(
            "select crm.classify_mail_triage(%s, %s::jsonb)",
            (row, json.dumps(_accept(ids["number"]))),
            SERVICE,
        )

    assert db.rows("select * from crm.claim_mail_triage(5, 600)", caller=SERVICE) == []
    _assert_one_order_with_everything(db, "email")


def test_q12_a_quote_mail_that_fails_three_times_is_announced_and_can_be_sent_again(
    db: Database,
) -> None:
    _sent_quote(db)
    mail: str = db.value("select id from crm.outbox")
    statuses = [fail_outbox(db, mail, "Zoho antwortet nicht") for _ in range(3)]
    db.run(
        "update crm.outbox set status = 'queued', attempts = 0, error = '' "
        "where id = %s and status = 'failed'",
        (mail,),
        ADMIN,
    )
    statuses += [fail_outbox(db, mail, "Zoho antwortet wieder nicht") for _ in range(3)]
    db.run(
        "update crm.outbox set status = 'queued', attempts = 0, error = '' "
        "where id = %s and status = 'failed'",
        (mail,),
        ADMIN,
    )
    send_outbox(db)

    assert statuses == ["queued", "queued", "failed"] * 2
    assert db.value(
        "select array_agg(body order by created_at) from cockpit.messages "
        "where kind = 'mail-fehler'"
    ) == [
        "An info@baeckerei-korn.de · Zoho antwortet nicht",
        "An info@baeckerei-korn.de · Zoho antwortet wieder nicht",
    ]
    assert db.value("select count(*) from cockpit.messages where kind = 'mail-verschickt'") == 1
    assert db.value("select count(*) from crm.emails where direction = 'out'") == 1
