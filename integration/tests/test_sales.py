"""Steps 1 to 3 of the flow: quote sent from the app, accepted or declined.

Context: The RadarAuditor app creates, sends and decides quotes through the CRM functions. | Input:
a fresh project. | Output: Assertions on quotes, orders, subscriptions, outbox and Cockpit.
"""

import psycopg
import pytest
from steps import (
    CUSTOMER_EMAIL,
    MONTHLY_QUOTED_PRICE,
    accepted_order,
    add_products,
    audited_customer,
    outbox,
    quote_with_items,
    sent_quote,
    set_company,
    titles,
)

from repocity_integration.database import ADMIN, SERVICE, Database


def test_send_quote_marks_it_sent_and_queues_the_rendered_mail(db: Database) -> None:
    set_company(db)
    once, monthly = add_products(db)
    customer = audited_customer(db)
    quote = quote_with_items(db, customer, once, monthly)

    mail = db.one("select * from crm.send_quote(%s)", (quote,), ADMIN)

    number, valid_until = db.one(
        "select number, valid_until from crm.quotes where id = %s", (quote,)
    ).values()
    assert db.value("select status from crm.quotes where id = %s", (quote,)) == "sent"
    assert (mail["kind"], mail["quote_id"], mail["to_address"]) == ("quote", quote, CUSTOMER_EMAIL)
    assert mail["subject"] == f"Angebot {number}"
    assert mail["body"] == (
        "Guten Tag Erika Korn,\n\n"
        f"anbei erhalten Sie mein Angebot {number} über 1.165,01 € als PDF. "
        f"Es ist gültig bis zum {valid_until:%d.%m.%Y}.\n\n"
        "Mit freundlichen Grüßen\nDaniel Hütte"
    )


def test_quote_mail_is_announced_and_its_sending_replaces_the_notice(db: Database) -> None:
    once, monthly = add_products(db)
    quote = sent_quote(db, audited_customer(db), once, monthly)
    mail = outbox(db)[0]

    db.run(
        "update crm.outbox set status = 'sent', sent_at = now() where id = %s",
        (mail["id"],),
        SERVICE,
    )

    notices = db.rows(
        "select title, tag, link from cockpit.messages "
        "where kind in ('mail-erstellt', 'mail-verschickt') order by title"
    )
    number = db.value("select number from crm.quotes where id = %s", (quote,))
    tag = f"mail-{mail['id']}"
    link = f"https://crm.speedofthespirit.dev/angebot/{quote}"
    assert notices == [
        {"title": f"Mail erstellt: Angebot {number}", "tag": tag, "link": link},
        {"title": f"Mail verschickt: Angebot {number}", "tag": tag, "link": link},
    ]


def test_send_quote_needs_an_email_address(db: Database) -> None:
    once, monthly = add_products(db)
    quote = quote_with_items(db, audited_customer(db, email=None), once, monthly)

    with pytest.raises(psycopg.Error, match="Beim Kunden fehlt die E-Mail-Adresse"):
        db.run("select crm.send_quote(%s)", (quote,), ADMIN)

    assert db.value("select status from crm.quotes where id = %s", (quote,)) == "draft"


def test_app_acceptance_creates_order_and_one_subscription_at_the_quoted_price(
    db: Database,
) -> None:
    ids = accepted_order(db)

    assert db.one("select status, accepted_via from crm.quotes where id = %s", (ids["quote"],)) == {
        "status": "accepted",
        "accepted_via": "app",
    }
    assert (
        db.value("select quote_id from crm.orders where id = %s", (ids["order"],)) == ids["quote"]
    )
    assert db.rows(
        "select customer_id, product_id, quote_id, unit_price_net, start_date, next_audit_date "
        "from crm.subscriptions"
    ) == [
        {
            "customer_id": ids["customer"],
            "product_id": ids["monthly"],
            "quote_id": ids["quote"],
            "unit_price_net": MONTHLY_QUOTED_PRICE,
            "start_date": db.value("select current_date"),
            "next_audit_date": db.value("select (current_date + interval '1 month')::date"),
        }
    ]


def test_acceptance_queues_both_contracts_without_approval(db: Database) -> None:
    accepted_order(db)

    contracts = [mail for mail in outbox(db) if mail["kind"] == "contract"]
    assert sorted(mail["subject"].rsplit(" ", 1)[0] for mail in contracts) == [
        "Auftragsbestätigung",
        "Wartungs- und Servicevertrag",
    ]
    assert {mail["to_address"] for mail in contracts} == {CUSTOMER_EMAIL}
    assert all(mail["approval_id"] is None for mail in contracts)
    assert db.value("select count(*) from crm.approvals where kind = 'contract'") == 0
    assert db.rows("select status from crm.contracts") == [{"status": "queued"}] * 2
    maintenance = db.value("select body from crm.contracts where template_key = 'maintenance'")
    assert "79,00 €" in maintenance


def test_acceptance_is_announced_as_important(db: Database) -> None:
    ids = accepted_order(db)

    number = db.value("select number from crm.orders where id = %s", (ids["order"],))
    assert db.rows("select title, priority, link from cockpit.messages where kind = 'auftrag'") == [
        {
            "title": f"Neuer Auftrag: {number} · Bäckerei Korn",
            "priority": "wichtig",
            "link": f"https://crm.speedofthespirit.dev/kunde/{ids['customer']}",
        }
    ]


def test_a_contract_without_address_waits_for_approval_and_approving_queues_it(
    db: Database,
) -> None:
    set_company(db)
    once, monthly = add_products(db)
    customer = audited_customer(db, email=None)
    quote = quote_with_items(db, customer, once, None)
    db.run("select crm.accept_quote(%s)", (quote,), ADMIN)
    approval = db.one("select id, body from crm.approvals where kind = 'contract'")
    assert outbox(db) == []
    assert "E-Mail-Adresse" in approval["body"]

    db.run("update crm.customers set email = 'neu@korn.de' where id = %s", (customer,))
    db.run("select crm.decide_approval(%s, true)", (approval["id"],), ADMIN)

    assert [(m["kind"], m["to_address"], m["approval_id"]) for m in outbox(db)] == [
        ("contract", "neu@korn.de", approval["id"])
    ]


def test_decline_from_any_channel_keeps_channel_note_and_lost_deal(db: Database) -> None:
    once, _ = add_products(db)
    customer = audited_customer(db)
    by_mail = sent_quote(db, customer, once, None)
    in_app = sent_quote(db, customer, once, None)

    db.run("select crm.decline_quote_via(%s, 'email', 'zu teuer')", (by_mail,), SERVICE)
    db.run("select crm.decline_quote(%s)", (in_app,), ADMIN)

    assert db.rows(
        "select status, accepted_via, decision_note from crm.quotes order by number"
    ) == [
        {"status": "declined", "accepted_via": None, "decision_note": "zu teuer"},
        {"status": "declined", "accepted_via": None, "decision_note": ""},
    ]
    assert (
        db.value(
            "select count(*) from crm.activities where body like %s", ("%abgelehnt (per E-Mail)%",)
        )
        == 1
    )


def test_an_unknown_channel_is_refused(db: Database) -> None:
    once, _ = add_products(db)
    quote = sent_quote(db, audited_customer(db), once, None)

    with pytest.raises(psycopg.Error, match="Unbekannter Weg der Entscheidung: fax"):
        db.run("select crm.accept_quote_via(%s, 'fax')", (quote,), ADMIN)


def test_a_decided_quote_cannot_be_accepted_again(db: Database) -> None:
    ids = accepted_order(db)

    with pytest.raises(psycopg.Error, match="kann nicht mehr angenommen werden"):
        db.run("select crm.accept_quote_via(%s, 'phone', 'Anruf')", (ids["quote"],), ADMIN)


def test_the_app_signatures_stay(db: Database) -> None:
    assert db.rows(
        "select p.oid::regprocedure::text as name, p.prorettype::regtype::text as returns "
        "from pg_proc p where p.oid in ('crm.accept_quote(uuid)'::regprocedure, "
        "'crm.decline_quote(uuid)'::regprocedure) order by 1"
    ) == [
        {"name": "crm.accept_quote(uuid)", "returns": "crm.orders"},
        {"name": "crm.decline_quote(uuid)", "returns": "crm.quotes"},
    ]


def test_the_customer_created_by_the_audit_is_announced_with_its_source(db: Database) -> None:
    audited_customer(db)

    assert "Neuer Kunde: Bäckerei Korn" in titles(db)
    assert db.value("select body from cockpit.messages where kind = 'kunde'") == (
        "Quelle: RadarAuditor"
    )
