"""Steps 4 and 5 of the flow: the finished optimisation completes the order in the CRM.

Context: The RadarAuditor writes optimization.finished, the CRM trigger runs crm.complete_order. |
Input: an accepted order. | Output: Assertions on order, invoice, outbox, review request, Cockpit.
"""

import psycopg
import pytest
from steps import ONCE_PRICE, accepted_order, finish_optimization, outbox, titles

from repocity_integration.database import ADMIN, READER, SERVICE, Database


def test_finished_optimization_invoices_only_the_one_off_items_and_sends_it(db: Database) -> None:
    ids = accepted_order(db)

    finish_optimization(db, ids["order"])

    invoice = db.one(
        "select id, number, status, net, gross from crm.invoices where order_id = %s",
        (ids["order"],),
    )
    assert invoice["status"] == "open"
    assert invoice["number"].startswith("RE-")
    assert (invoice["net"], invoice["gross"]) == (ONCE_PRICE, 1071)
    assert db.rows(
        "select title, unit_price_net from crm.invoice_items where invoice_id = %s",
        (invoice["id"],),
    ) == [{"title": "Website-Optimierung", "unit_price_net": ONCE_PRICE}]
    assert db.value("select status from crm.orders where id = %s", (ids["order"],)) == "invoiced"
    mails = [mail for mail in outbox(db) if mail["kind"] == "invoice"]
    assert [(m["invoice_id"], m["subject"]) for m in mails] == [
        (invoice["id"], f"Rechnung {invoice['number']}")
    ]
    assert f"Mail erstellt: Rechnung {invoice['number']}" in titles(db)


def test_finished_optimization_creates_one_review_request(db: Database) -> None:
    ids = accepted_order(db)

    finish_optimization(db, ids["order"])

    assert db.rows("select customer_id, order_id, status from crm.review_requests") == [
        {"customer_id": ids["customer"], "order_id": ids["order"], "status": "due"}
    ]
    assert db.value("select count(*) from public.events where kind = 'optimization.finished'") == 1


def test_missing_company_data_leaves_draft_task_and_notice(db: Database) -> None:
    ids = accepted_order(db)
    db.run("update crm.settings set tax_number = '', vat_id = ''")

    finish_optimization(db, ids["order"])

    assert db.value("select status from crm.invoices where order_id = %s", (ids["order"],)) == (
        "draft"
    )
    task = db.value("select title from crm.tasks where order_id = %s and not done", (ids["order"],))
    assert task.startswith("Rechnung zu Auftrag ")
    assert "Steuernummer" in task
    notice = db.one(
        "select title, priority, link from cockpit.messages where kind = 'rechnung-offen'"
    )
    assert notice["priority"] == "dringend"
    assert notice["title"].startswith("Rechnung nicht verschickt: ")
    assert [m for m in outbox(db) if m["kind"] == "invoice"] == []
    assert db.value("select status from crm.review_requests") == "due"


def test_an_order_with_only_monthly_items_has_nothing_to_invoice(db: Database) -> None:
    ids = accepted_order(db)
    db.run("delete from crm.quote_items where product_id = %s", (ids["once"],))

    assert db.value("select crm.invoice_from_order(%s) is null", (ids["order"],), ADMIN)
    finish_optimization(db, ids["order"])

    assert db.value("select count(*) from crm.invoices") == 0
    assert db.value("select status from crm.orders where id = %s", (ids["order"],)) == "done"


def test_an_order_without_quote_still_gets_an_empty_draft_to_fill_in(db: Database) -> None:
    customer = db.value("insert into crm.customers (name) values ('Handwerk') returning id")
    order = db.value(
        "insert into crm.orders (number, customer_id) values ('AU-X', %s) returning id",
        (customer,),
    )

    invoice = db.one("select status, net from crm.invoice_from_order(%s)", (order,), ADMIN)

    assert invoice == {"status": "draft", "net": 0}


def test_completing_twice_changes_nothing(db: Database) -> None:
    ids = accepted_order(db)
    finish_optimization(db, ids["order"])
    before = db.value("select count(*) from crm.outbox")

    db.run("select crm.complete_order(%s)", (ids["order"],), SERVICE)

    assert db.value("select count(*) from crm.outbox") == before
    assert db.value("select count(*) from crm.invoices") == 1


def test_only_the_two_mail_notices_carry_a_tag(db: Database) -> None:
    ids = accepted_order(db)
    finish_optimization(db, ids["order"])
    db.run("update crm.outbox set status = 'sent'", caller=SERVICE)

    assert (
        db.value(
            "select count(*) from cockpit.messages "
            "where (tag is null) = (kind in ('mail-erstellt', 'mail-verschickt'))"
        )
        == 0
    )
    assert db.value(
        "select bool_and(m.tag = 'mail-' || o.id) and count(*) = 2 * (select count(*) "
        "from crm.outbox) from cockpit.messages m join crm.outbox o "
        "on m.dedupe_key in ('mail-erstellt-' || o.id, 'mail-verschickt-' || o.id)"
    )


def test_ticking_off_the_last_manual_change_in_the_app_completes_the_order(db: Database) -> None:
    ids = accepted_order(db)
    change = db.value(
        "insert into public.optimization_changes (order_id, target, after, status, error) "
        "values (%s, 'google', 'Öffnungszeiten', 'manual', 'Manuell umsetzen: Zeiten eintragen') "
        "returning id",
        (ids["order"],),
        SERVICE,
    )

    db.run("select public.mark_manual_done(%s)", (change,), ADMIN)

    assert db.value("select status from crm.orders where id = %s", (ids["order"],)) == "invoiced"
    assert db.value("select count(*) from crm.review_requests") == 1


def test_a_failed_completion_leaves_its_own_kind_of_notice(db: Database) -> None:
    db.run(
        "insert into public.events (kind, payload) "
        "values ('optimization.finished', '{\"order_id\": \"keine-nummer\"}')"
    )

    assert db.rows(
        "select kind, title, priority from cockpit.messages where kind like 'auftrag%%'"
    ) == [
        {
            "kind": "auftrag-fehler",
            "title": "Auftrag konnte nicht abgeschlossen werden",
            "priority": "dringend",
        }
    ]


def test_daniel_can_complete_an_order_by_hand_once(db: Database) -> None:
    ids = accepted_order(db)

    db.run("select crm.complete_order(%s)", (ids["order"],), ADMIN)
    db.run("select crm.complete_order(%s)", (ids["order"],), ADMIN)

    assert db.value("select status from crm.orders where id = %s", (ids["order"],)) == "invoiced"
    assert db.value("select count(*) from crm.review_requests") == 1
    assert db.value("select count(*) from crm.invoices") == 1


def test_an_order_invoiced_some_other_way_is_refused(db: Database) -> None:
    ids = accepted_order(db)
    invoice = db.value("select (crm.invoice_from_order(%s)).id", (ids["order"],), ADMIN)
    db.run("select crm.finalize_invoice(%s)", (invoice,), ADMIN)
    number = db.value("select number from crm.orders where id = %s", (ids["order"],))

    with pytest.raises(psycopg.Error, match=f"Auftrag {number} ist bereits abgeschlossen."):
        db.run("select crm.complete_order(%s)", (ids["order"],), ADMIN)


def test_a_reader_cannot_complete_an_order(db: Database) -> None:
    ids = accepted_order(db)

    with pytest.raises(psycopg.Error, match="Nur der Administrator darf das."):
        db.run("select crm.complete_order(%s)", (ids["order"],), READER)


def test_a_finished_event_that_cannot_complete_leaves_its_own_notice(db: Database) -> None:
    db.run(
        "insert into public.events (kind, payload) values ('optimization.finished', "
        "jsonb_build_object('order_id', gen_random_uuid()))",
        caller=SERVICE,
    )

    assert db.one("select title, priority from cockpit.messages where kind = 'auftrag-fehler'") == {
        "title": "Auftrag konnte nicht abgeschlossen werden",
        "priority": "dringend",
    }
